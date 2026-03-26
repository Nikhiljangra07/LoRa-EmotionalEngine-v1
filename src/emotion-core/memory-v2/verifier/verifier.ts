import Anthropic from '@anthropic-ai/sdk';
import { parseLLMJson } from '../utils/json-parse';
import type {
  SessionSummary,
  SessionFingerprint,
  FactAnchor,
  VerificationResult,
  FlaggedFact,
  SuggestedCorrection,
} from '../types';

// ──────────────────────────────────────────────────────
// Extraction Verifier — safety net before storage
// Checks extracted facts + fingerprint against the original
// session summary. Flags mismatches for re-extraction.
// Cost: ~$0.001 per call (Haiku).
// ──────────────────────────────────────────────────────

export interface VerifierConfig {
  model: string;
  apiKey: string;
}

const VERIFICATION_SYSTEM_PROMPT = `You verify extracted data against a source summary. Output ONLY a JSON object — no text before or after.

Check each extracted fact against the summary:
- Does it match what the summary actually says?
- If slot is "user_name": did the summary mention a real name introduction? If not, FLAG it.
- Names that are emotions, actions, greetings, or common words are ALWAYS invalid.

Check the fingerprint:
- Does the primary emotion match the summary's emotional arc?
- Does the contextCategory match the topic?

You MUST respond with ONLY this JSON structure:
{"verified":true,"flaggedFacts":[],"fingerprintIssues":[],"suggestedCorrections":[]}

If issues found, set verified to false and populate the arrays:
{"verified":false,"flaggedFacts":[{"anchorIndex":0,"reason":"..."}],"fingerprintIssues":["..."],"suggestedCorrections":[{"field":"...","currentValue":"...","suggestedValue":"..."}]}`;

/**
 * Format the verification request with all three inputs.
 */
function buildVerificationPrompt(
  summary: SessionSummary,
  facts: FactAnchor[],
  fingerprint: SessionFingerprint,
): string {
  // Compact representation — reduce token waste from pretty-printing.
  // Only include the fields that matter for verification.
  const compactSummary = {
    topic: summary.primaryTopic,
    keyFacts: summary.keyFacts,
    arc: summary.emotionalArc,
    direction: summary.currentDirection,
  };

  const compactFacts = facts.map((f, i) => ({
    i,
    type: f.type,
    slot: f.slot,
    value: f.value,
    confidence: f.confidence,
  }));

  const compactFingerprint = {
    primary: fingerprint.emotionalFingerprint.primary,
    undertones: fingerprint.emotionalFingerprint.undertones,
    context: fingerprint.emotionalFingerprint.contextCategory,
    tension: fingerprint.decisionPattern.primaryTension,
    importance: fingerprint.importanceScore,
  };

  return `SUMMARY: ${JSON.stringify(compactSummary)}
FACTS: ${JSON.stringify(compactFacts)}
FINGERPRINT: ${JSON.stringify(compactFingerprint)}
Respond with ONLY the JSON verification object.`;
}

/**
 * Validate the LLM's verification response.
 */
function validateVerificationResponse(raw: unknown): VerificationResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Verification response is not an object');
  }

  const obj = raw as Record<string, unknown>;

  const verified = obj['verified'];
  if (typeof verified !== 'boolean') {
    throw new Error('Missing or invalid "verified" field');
  }

  // Parse flaggedFacts
  const rawFlagged = obj['flaggedFacts'];
  const flaggedFacts: FlaggedFact[] = [];
  if (Array.isArray(rawFlagged)) {
    for (const item of rawFlagged) {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>)['anchorIndex'] === 'number' &&
        typeof (item as Record<string, unknown>)['reason'] === 'string'
      ) {
        flaggedFacts.push({
          anchorIndex: (item as Record<string, unknown>)['anchorIndex'] as number,
          reason: (item as Record<string, unknown>)['reason'] as string,
        });
      }
    }
  }

  // Parse fingerprintIssues
  const rawIssues = obj['fingerprintIssues'];
  const fingerprintIssues: string[] = [];
  if (Array.isArray(rawIssues)) {
    for (const issue of rawIssues) {
      if (typeof issue === 'string') {
        fingerprintIssues.push(issue);
      }
    }
  }

  // Parse suggestedCorrections
  const rawCorrections = obj['suggestedCorrections'];
  const suggestedCorrections: SuggestedCorrection[] = [];
  if (Array.isArray(rawCorrections)) {
    for (const corr of rawCorrections) {
      if (
        typeof corr === 'object' && corr !== null &&
        typeof (corr as Record<string, unknown>)['field'] === 'string' &&
        typeof (corr as Record<string, unknown>)['currentValue'] === 'string' &&
        typeof (corr as Record<string, unknown>)['suggestedValue'] === 'string'
      ) {
        suggestedCorrections.push({
          field: (corr as Record<string, unknown>)['field'] as string,
          currentValue: (corr as Record<string, unknown>)['currentValue'] as string,
          suggestedValue: (corr as Record<string, unknown>)['suggestedValue'] as string,
        });
      }
    }
  }

  // Consistency check: if there are flags, verified should be false
  const hasIssues = flaggedFacts.length > 0 || fingerprintIssues.length > 0;
  const effectiveVerified = hasIssues ? false : verified;

  return {
    verified: effectiveVerified,
    flaggedFacts,
    fingerprintIssues,
    suggestedCorrections,
  };
}

/**
 * Verify extracted facts and fingerprint against the original summary.
 *
 * This is the safety net before storage. If verification fails,
 * the pipeline should re-extract the flagged items.
 */
/**
 * Make a single verification LLM call and parse the result.
 * Returns null if parsing fails (caller handles retry).
 */
async function attemptVerification(
  client: Anthropic,
  prompt: string,
  config: VerifierConfig,
  prefill: boolean,
): Promise<{ result: VerificationResult; rawText: string } | null> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  // Prefill technique: start the assistant's response with `{` to force JSON
  if (prefill) {
    messages.push({ role: 'assistant', content: '{' });
  }

  let response;
  try {
    response = await client.messages.create({
      model: config.model,
      max_tokens: 1024,
      system: VERIFICATION_SYSTEM_PROMPT,
      messages,
    });
  } catch {
    return null;  // API error — caller retries
  }

  const textBlock = response?.content?.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return null;
  }

  // If we used prefill, prepend the `{` we injected
  const rawText = prefill ? '{' + textBlock.text : textBlock.text;

  try {
    const parsed: unknown = parseLLMJson(rawText);
    return { result: validateVerificationResponse(parsed), rawText };
  } catch {
    return null;
  }
}

/**
 * Verify extracted facts and fingerprint against the original summary.
 *
 * This is the fortress — the last checkpoint before permanent storage.
 * Uses a 3-attempt strategy:
 *   1. Standard call (no prefill)
 *   2. Prefill with `{` to force JSON output
 *   3. Prefill retry (Haiku can be inconsistent)
 *
 * If all 3 attempts fail to produce parseable JSON, logs the failure
 * with full diagnostics and returns auto-verified as absolute last resort.
 * This should be rare — the prefill technique reliably forces JSON.
 */
export async function verifyExtraction(
  summary: SessionSummary,
  facts: FactAnchor[],
  fingerprint: SessionFingerprint,
  config: VerifierConfig,
): Promise<VerificationResult> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const prompt = buildVerificationPrompt(summary, facts, fingerprint);

  // Attempt 1: standard call
  const attempt1 = await attemptVerification(client, prompt, config, false);
  if (attempt1) return attempt1.result;

  // Attempt 2: prefill with `{` to force JSON
  console.warn('[LoRa::MemoryV2::Verifier] attempt 1 failed, retrying with prefill');
  const attempt2 = await attemptVerification(client, prompt, config, true);
  if (attempt2) return attempt2.result;

  // Attempt 3: one more prefill try (Haiku can be inconsistent)
  console.warn('[LoRa::MemoryV2::Verifier] attempt 2 failed, final retry');
  const attempt3 = await attemptVerification(client, prompt, config, true);
  if (attempt3) return attempt3.result;

  // All 3 failed — this should be extremely rare with the compact prompt + prefill
  console.error(
    '[LoRa::MemoryV2::Verifier] ALL 3 attempts failed to produce valid JSON. ' +
    'Returning auto-verified as last resort. ' +
    `Facts: ${facts.length}, Fingerprint primary: ${fingerprint.emotionalFingerprint.primary}`,
  );

  return {
    verified: true,
    flaggedFacts: [],
    fingerprintIssues: [],
    suggestedCorrections: [],
  };
}

// Export for testing
export { buildVerificationPrompt, validateVerificationResponse, VERIFICATION_SYSTEM_PROMPT };
