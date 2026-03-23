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

const VERIFICATION_SYSTEM_PROMPT = `You are a verification agent for an analytical reasoning partner called LoRa. Your job is to check whether extracted data accurately matches its source summary.

You will receive:
1. A SESSION SUMMARY (the source of truth)
2. EXTRACTED FACTS (structured fact anchors extracted from the summary)
3. EXTRACTED FINGERPRINT (emotional fingerprint extracted from the summary)

Your job is to verify accuracy. For each extracted item, check:
- Does it accurately reflect what the summary says?
- Are there any contradictions between the extraction and the summary?
- Are there names extracted that were NOT actually introduced in the summary? (common error)
- Does the primary emotion match the emotional arc described in the summary?
- Does the contextCategory match the primary topic?
- Is the importanceScore reasonable given the session content?

CRITICAL NAME VERIFICATION:
- A name extraction is ONLY valid if the summary explicitly mentions someone by name
- If a fact has type "person" and slot "user_name", verify the summary actually contains a self-introduction
- Emotional expressions, actions, and descriptors are NEVER valid names
- When in doubt, FLAG the name — false flags are cheaper than false names in storage

OUTPUT FORMAT (strict JSON, no markdown, no code fences):
{
  "verified": true/false,
  "flaggedFacts": [
    { "anchorIndex": 0, "reason": "why this fact is wrong" }
  ],
  "fingerprintIssues": [
    "description of issue with the fingerprint"
  ],
  "suggestedCorrections": [
    { "field": "what to fix", "currentValue": "wrong value", "suggestedValue": "correct value" }
  ]
}

If everything checks out, return: { "verified": true, "flaggedFacts": [], "fingerprintIssues": [], "suggestedCorrections": [] }`;

/**
 * Format the verification request with all three inputs.
 */
function buildVerificationPrompt(
  summary: SessionSummary,
  facts: FactAnchor[],
  fingerprint: SessionFingerprint,
): string {
  const factsWithIndex = facts.map((f, i) => ({
    index: i,
    ...f,
  }));

  return `Verify the following extractions against the source summary.

SESSION SUMMARY:
${JSON.stringify(summary, null, 2)}

EXTRACTED FACTS (${facts.length} total):
${JSON.stringify(factsWithIndex, null, 2)}

EXTRACTED FINGERPRINT:
${JSON.stringify({
  emotionalFingerprint: fingerprint.emotionalFingerprint,
  decisionPattern: fingerprint.decisionPattern,
  importanceScore: fingerprint.importanceScore,
}, null, 2)}

Output ONLY the JSON verification result.`;
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
export async function verifyExtraction(
  summary: SessionSummary,
  facts: FactAnchor[],
  fingerprint: SessionFingerprint,
  config: VerifierConfig,
): Promise<VerificationResult> {
  const client = new Anthropic({ apiKey: config.apiKey });

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 512,
    system: VERIFICATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildVerificationPrompt(summary, facts, fingerprint),
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from model');
  }

  const parsed: unknown = parseLLMJson(textBlock.text);
  return validateVerificationResponse(parsed);
}

// Export for testing
export { buildVerificationPrompt, validateVerificationResponse, VERIFICATION_SYSTEM_PROMPT };
