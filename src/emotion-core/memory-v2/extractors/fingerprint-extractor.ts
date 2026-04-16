import Anthropic from '@anthropic-ai/sdk';
import { parseLLMJson } from '../utils/json-parse';
import type {
  SessionSummary,
  SessionFingerprint,
  EmotionalFingerprint,
  StructuralDynamic,
  StyleSnapshot,
  ConversationTurn,
  EkmanEmotion,
  Undertone,
  ContextCategory,
  RelationalTone,
  AvoidanceSignal,
  Tension,
  StructuralFramework,
} from '../types';
import {
  EKMAN_EMOTIONS,
  UNDERTONE_VOCABULARY,
  CONTEXT_CATEGORIES,
  RELATIONAL_TONES,
  AVOIDANCE_VOCABULARY,
  TENSION_VOCABULARY,
  STRUCTURAL_FRAMEWORKS,
} from '../types';
import type { PerspectiveSessionSummary } from '../pipeline/adapter-interface';
import {
  FINGERPRINT_EXTRACTION_SYSTEM_PROMPT,
  FINGERPRINT_EXTRACTION_USER_PROMPT,
} from './prompts/fingerprint-extraction.prompt';

// ──────────────────────────────────────────────────────
// Emotion mapping — LLMs frequently return non-Ekman emotions.
// Map them to the closest Ekman-6 equivalent instead of crashing.
// ──────────────────────────────────────────────────────

const EMOTION_MAP: Record<string, EkmanEmotion> = {
  // Direct Ekman-6 (pass-through)
  joy: 'joy', anger: 'anger', fear: 'fear',
  sadness: 'sadness', disgust: 'disgust', surprise: 'surprise',

  // Joy family
  hope: 'joy', optimism: 'joy', happiness: 'joy', excitement: 'joy',
  relief: 'joy', contentment: 'joy', gratitude: 'joy', pride: 'joy',
  amusement: 'joy', love: 'joy', elation: 'joy', delight: 'joy',

  // Sadness family
  grief: 'sadness', sorrow: 'sadness', melancholy: 'sadness',
  disappointment: 'sadness', loneliness: 'sadness', despair: 'sadness',
  helplessness: 'sadness', regret: 'sadness', nostalgia: 'sadness',
  resignation: 'sadness', emptiness: 'sadness',

  // Fear family
  anxiety: 'fear', worry: 'fear', dread: 'fear', panic: 'fear',
  nervousness: 'fear', apprehension: 'fear', insecurity: 'fear',
  vulnerability: 'fear', uncertainty: 'fear', overwhelm: 'fear',
  terror: 'fear',

  // Anger family
  frustration: 'anger', irritation: 'anger', resentment: 'anger',
  rage: 'anger', annoyance: 'anger', bitterness: 'anger',
  hostility: 'anger', contempt: 'anger', indignation: 'anger',
  betrayal: 'anger',

  // Disgust family
  revulsion: 'disgust', repulsion: 'disgust', aversion: 'disgust',
  shame: 'disgust', embarrassment: 'disgust', guilt: 'disgust',
  'self-loathing': 'disgust',

  // Surprise family
  shock: 'surprise', confusion: 'surprise', disbelief: 'surprise',
  bewilderment: 'surprise', astonishment: 'surprise',

  // Ambiguous — map by common usage
  determination: 'anger',  // shares activation energy with anger
  tension: 'fear',          // tension is anticipatory = fear-adjacent
  numbness: 'sadness',      // emotional shutdown = sadness family
  ambivalence: 'surprise',  // conflicting signals = surprise-adjacent
  neutral: 'surprise',      // neutral mapped to least-valenced

  // Undertone vocabulary used as primary — Haiku occasionally puts an
  // undertone label in the `primary` slot. These are the missing fallbacks.
  // (Most undertones — nostalgia, dread, guilt, shame, loneliness, hope,
  // pride, relief, resignation, confusion — are already covered above.)
  urgency: 'fear',         // urgency = anticipatory pressure → fear family
  warmth: 'joy',           // affectionate openness → joy family
  playfulness: 'joy',      // light/positive activation → joy family
};

/**
 * Map a raw emotion string to the nearest Ekman-6 emotion.
 * Returns the EkmanEmotion or null if completely unmappable.
 */
function mapToEkman(raw: string): EkmanEmotion | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  // Direct match
  if (EKMAN_EMOTIONS.includes(lower as EkmanEmotion)) {
    return lower as EkmanEmotion;
  }

  // Map via lookup
  if (lower in EMOTION_MAP) {
    return EMOTION_MAP[lower]!;
  }

  // Partial match — check if any key is a substring
  for (const [key, mapped] of Object.entries(EMOTION_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return mapped;
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────
// Fingerprint Extractor — SessionSummary + EIV curve → SessionFingerprint
// Combines LLM extraction (emotional + decision pattern)
// with pure-math computation (EIV curve stats, style snapshot).
// ──────────────────────────────────────────────────────

export interface FingerprintExtractorConfig {
  model: string;
  apiKey: string;
}

/** Metadata about the conversation needed for style computation */
export interface ConversationMetadata {
  /** The conversation turns (used for style computation only) */
  turns: ConversationTurn[];
  sessionId: string;
  userId: string;
}

// ── Pure math: EIV curve computations (no LLM needed) ──

/**
 * Find the peak intensity and which turn it occurred at.
 */
export function computePeak(eivCurve: number[]): { peakIntensity: number; peakTurn: number } {
  if (eivCurve.length === 0) {
    return { peakIntensity: 0, peakTurn: 0 };
  }

  let peakIntensity = 0;
  let peakTurn = 0;

  for (let i = 0; i < eivCurve.length; i++) {
    const val = eivCurve[i]!;
    if (val > peakIntensity) {
      peakIntensity = val;
      peakTurn = i;
    }
  }

  return { peakIntensity, peakTurn };
}

/**
 * Did intensity resolve (come down) before session end?
 * Resolution = the last EIV value is lower than the peak by at least 20%.
 */
export function computeResolution(eivCurve: number[]): boolean {
  if (eivCurve.length < 2) return false;

  const { peakIntensity } = computePeak(eivCurve);
  const lastValue = eivCurve[eivCurve.length - 1]!;

  // Resolved if last value is at least 20% below peak
  return lastValue < peakIntensity * 0.8;
}

/**
 * Compute average EIV intensity across the session.
 */
export function computeAverageIntensity(eivCurve: number[]): number {
  if (eivCurve.length === 0) return 0;
  const sum = eivCurve.reduce((acc, val) => acc + val, 0);
  return sum / eivCurve.length;
}

// ── Style snapshot computation ──

/**
 * Compute communication style metrics from conversation turns.
 */
export function computeStyleSnapshot(turns: ConversationTurn[]): StyleSnapshot {
  const userTurns = turns.filter((t) => t.role === 'user');

  if (userTurns.length === 0) {
    return { avgWordsPerMessage: 0, questionRatio: 0, directness: 0.5 };
  }

  // Average words per message
  const totalWords = userTurns.reduce(
    (sum, turn) => sum + turn.content.split(/\s+/).filter(Boolean).length,
    0,
  );
  const avgWordsPerMessage = totalWords / userTurns.length;

  // Question ratio
  const questionsCount = userTurns.filter((t) => t.content.includes('?')).length;
  const questionRatio = questionsCount / userTurns.length;

  // Directness heuristic: shorter messages with fewer hedges = more direct
  // Hedge words that reduce directness
  const hedgePattern = /\b(maybe|perhaps|i think|i guess|kind of|sort of|i don't know|not sure|might|could be)\b/gi;
  const totalHedges = userTurns.reduce((sum, turn) => {
    const matches = turn.content.match(hedgePattern);
    return sum + (matches ? matches.length : 0);
  }, 0);
  const hedgeRatio = totalHedges / userTurns.length;

  // Directness: 1.0 = no hedging, shorter messages; 0.0 = lots of hedging, very long messages
  // Clamp between 0 and 1
  const wordPenalty = Math.min(avgWordsPerMessage / 100, 0.5); // long messages reduce directness
  const hedgePenalty = Math.min(hedgeRatio * 0.3, 0.5);        // hedges reduce directness
  const directness = Math.max(0, Math.min(1, 1 - wordPenalty - hedgePenalty));

  return {
    avgWordsPerMessage: Math.round(avgWordsPerMessage * 10) / 10,
    questionRatio: Math.round(questionRatio * 100) / 100,
    directness: Math.round(directness * 100) / 100,
  };
}

// ── LLM extraction validation ──

interface RawStructuralDynamic {
  dominantFramework: string;
  label: string;
  framingErrors: string[];
  reframeEffectiveness: number;
}

interface RawLLMExtraction {
  emotionalFingerprint: {
    primary: string;
    undertones: string[];
    contextCategory: string;
    relationalTone: string;
  };
  decisionPattern: {
    topicRevisits: number;
    decisionReached: boolean;
    avoidanceSignals: string[];
    primaryTension: string;
  };
  importanceScore: number;
  structuralDynamic?: RawStructuralDynamic;
}

/**
 * Validate and coerce the LLM extraction output against fixed vocabularies.
 * Throws if critical fields are missing or invalid.
 */
function validateLLMExtraction(raw: unknown): RawLLMExtraction {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('LLM extraction is not an object');
  }

  const obj = raw as Record<string, unknown>;

  // Validate emotionalFingerprint
  const ef = obj['emotionalFingerprint'];
  if (typeof ef !== 'object' || ef === null) {
    throw new Error('Missing emotionalFingerprint');
  }
  const efObj = ef as Record<string, unknown>;

  const rawPrimary = (typeof efObj['primary'] === 'string' ? efObj['primary'] : '').toLowerCase().trim();
  const primary = mapToEkman(rawPrimary);
  if (!primary) {
    throw new Error(`Cannot map primary emotion: ${rawPrimary}`);
  }

  // Undertones contract: 1-3 vocabulary-valid items.
  // Production logs showed Haiku occasionally returns an empty array or
  // entirely off-vocabulary entries on emotionally-flat sessions (factual
  // / informational chats). Previous behaviour was to throw, which lost
  // the entire fingerprint AND the profile update for that user — a
  // session-eating crash for low-stakes conversations. Now we fall back
  // to a single neutral undertone (`tension` — vocabulary-valid, broadly
  // applicable, doesn't fabricate emotional content) so the rest of the
  // pipeline can finish and the user's profile still gets refreshed.
  const FALLBACK_UNDERTONE: Undertone = 'tension';

  const rawUndertones = efObj['undertones'];
  let validUndertones: Undertone[];
  if (!Array.isArray(rawUndertones) || rawUndertones.length === 0) {
    validUndertones = [FALLBACK_UNDERTONE];
  } else {
    if (rawUndertones.length > 3) {
      throw new Error(`undertones must be 1-3 items, got ${rawUndertones.length}`);
    }
    const filtered = rawUndertones.filter(
      (u): u is Undertone => UNDERTONE_VOCABULARY.includes(u as Undertone),
    );
    validUndertones = filtered.length > 0 ? filtered : [FALLBACK_UNDERTONE];
  }

  const contextCategory = efObj['contextCategory'] as string;
  if (!CONTEXT_CATEGORIES.includes(contextCategory as ContextCategory)) {
    throw new Error(`Invalid contextCategory: ${contextCategory}`);
  }

  const relationalTone = efObj['relationalTone'] as string;
  if (!RELATIONAL_TONES.includes(relationalTone as RelationalTone)) {
    throw new Error(`Invalid relationalTone: ${relationalTone}`);
  }

  // Validate decisionPattern
  const dp = obj['decisionPattern'];
  if (typeof dp !== 'object' || dp === null) {
    throw new Error('Missing decisionPattern');
  }
  const dpObj = dp as Record<string, unknown>;

  const topicRevisits = dpObj['topicRevisits'];
  if (typeof topicRevisits !== 'number' || topicRevisits < 0) {
    throw new Error('Invalid topicRevisits');
  }

  const decisionReached = dpObj['decisionReached'];
  if (typeof decisionReached !== 'boolean') {
    throw new Error('Invalid decisionReached');
  }

  const rawAvoidance = dpObj['avoidanceSignals'];
  if (!Array.isArray(rawAvoidance)) {
    throw new Error('avoidanceSignals must be an array');
  }
  const validAvoidance = rawAvoidance.filter(
    (a): a is AvoidanceSignal => AVOIDANCE_VOCABULARY.includes(a as AvoidanceSignal),
  );

  const primaryTension = dpObj['primaryTension'] as string;
  if (!TENSION_VOCABULARY.includes(primaryTension as Tension)) {
    throw new Error(`Invalid primaryTension: ${primaryTension}`);
  }

  // Validate importanceScore
  const importanceScore = obj['importanceScore'];
  if (typeof importanceScore !== 'number' || importanceScore < 1 || importanceScore > 10) {
    throw new Error(`importanceScore must be 1-10, got ${importanceScore}`);
  }

  // Validate structuralDynamic (optional — graceful degradation, never throw)
  let structuralDynamic: RawStructuralDynamic | undefined;
  const rawSD = obj['structuralDynamic'];
  if (rawSD && typeof rawSD === 'object' && rawSD !== null) {
    const sd = rawSD as Record<string, unknown>;
    const framework = typeof sd['dominantFramework'] === 'string' ? sd['dominantFramework'] : '';
    const label = typeof sd['label'] === 'string' ? sd['label'] : '';
    const rawErrors = Array.isArray(sd['framingErrors']) ? sd['framingErrors'] : [];
    const reframeEff = typeof sd['reframeEffectiveness'] === 'number' ? sd['reframeEffectiveness'] : -1;

    if (
      STRUCTURAL_FRAMEWORKS.includes(framework as StructuralFramework) &&
      label.length > 0 && label.length <= 60 &&
      reframeEff >= 0 && reframeEff <= 1
    ) {
      structuralDynamic = {
        dominantFramework: framework,
        label,
        framingErrors: rawErrors
          .filter((e): e is string => typeof e === 'string')
          .slice(0, 3),
        reframeEffectiveness: Math.round(reframeEff * 100) / 100,
      };
    } else {
      console.warn('[LoRa::MemoryV2::FingerprintExtractor] structuralDynamic malformed, skipping', {
        framework, labelLen: label.length, reframeEff,
      });
    }
  }

  return {
    emotionalFingerprint: {
      primary,
      undertones: validUndertones,
      contextCategory,
      relationalTone,
    },
    decisionPattern: {
      topicRevisits: topicRevisits as number,
      decisionReached: decisionReached as boolean,
      avoidanceSignals: validAvoidance,
      primaryTension,
    },
    importanceScore: Math.round(importanceScore as number),
    ...(structuralDynamic ? { structuralDynamic } : {}),
  };
}

/**
 * Extract the emotional fingerprint + decision pattern from a session summary.
 *
 * Combines:
 * - LLM extraction (emotional fingerprint, decision pattern, importance) from Haiku
 * - Pure-math computation (EIV curve stats) from the eivCurve array
 * - Style computation from conversation metadata
 */
export async function extractFingerprint(
  summary: SessionSummary,
  eivCurve: number[],
  metadata: ConversationMetadata,
  config: FingerprintExtractorConfig,
  perspectiveResults?: PerspectiveSessionSummary[],
): Promise<SessionFingerprint> {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: 15_000 });

  // Call Haiku for emotional extraction
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 768,
    system: FINGERPRINT_EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: FINGERPRINT_EXTRACTION_USER_PROMPT + JSON.stringify(summary, null, 2),
      },
    ],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn('[LoRa::MemoryV2::FingerprintExtractor] response truncated (max_tokens)');
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from model');
  }

  const parsed: unknown = parseLLMJson(textBlock.text);
  const llmResult = validateLLMExtraction(parsed);

  // Pure-math EIV computation
  const { peakIntensity, peakTurn } = computePeak(eivCurve);
  const resolution = computeResolution(eivCurve);
  const avgIntensity = computeAverageIntensity(eivCurve);

  // Style computation
  const styleSnapshot = computeStyleSnapshot(metadata.turns);

  // Build the undertones tuple (1-3 elements)
  const undertones = llmResult.emotionalFingerprint.undertones.slice(0, 3) as
    EmotionalFingerprint['undertones'];

  const now = new Date().toISOString();

  // Build structuralDynamic — cross-validate with LoRaMaths perspective results
  let structuralDynamic: StructuralDynamic | undefined;
  if (llmResult.structuralDynamic) {
    let dominantFramework = llmResult.structuralDynamic.dominantFramework as StructuralFramework;

    // Cross-validation: if LoRaMaths perspective results exist, use the most frequent
    // framework as ground truth (it ran on raw conversation, more accurate than Haiku on a summary)
    if (perspectiveResults && perspectiveResults.length > 0) {
      const frameworkCounts = new Map<string, number>();
      for (const pr of perspectiveResults) {
        frameworkCounts.set(pr.framework, (frameworkCounts.get(pr.framework) ?? 0) + 1);
      }
      let bestFramework = dominantFramework;
      let bestCount = 0;
      for (const [fw, count] of frameworkCounts) {
        if (count > bestCount) {
          bestFramework = fw as StructuralFramework;
          bestCount = count;
        }
      }
      // Override only if LoRaMaths had a clear majority (>50% of messages agreed)
      if (bestCount > perspectiveResults.length / 2) {
        dominantFramework = bestFramework;
      }
    }

    structuralDynamic = {
      dominantFramework,
      label: llmResult.structuralDynamic.label,
      framingErrors: llmResult.structuralDynamic.framingErrors,
      reframeEffectiveness: llmResult.structuralDynamic.reframeEffectiveness,
    };
  } else if (perspectiveResults && perspectiveResults.length > 0) {
    // LLM didn't produce structuralDynamic, but we have LoRaMaths data — construct from it
    const frameworkCounts = new Map<string, number>();
    for (const pr of perspectiveResults) {
      frameworkCounts.set(pr.framework, (frameworkCounts.get(pr.framework) ?? 0) + 1);
    }
    let bestFramework: StructuralFramework = perspectiveResults[0]!.framework;
    let bestCount = 0;
    for (const [fw, count] of frameworkCounts) {
      if (count > bestCount) {
        bestFramework = fw as StructuralFramework;
        bestCount = count;
      }
    }
    // Use the label from the highest-strength perspective
    const bestPerspective = perspectiveResults.reduce((a, b) => a.strength > b.strength ? a : b);
    structuralDynamic = {
      dominantFramework: bestFramework,
      label: bestPerspective.label.slice(0, 60),
      framingErrors: [],
      reframeEffectiveness: 0.5,
    };
  }

  const fingerprint: SessionFingerprint = {
    sessionId: metadata.sessionId,
    userId: metadata.userId,
    timestamp: now,

    eivCurve,
    peakIntensity,
    peakTurn,
    resolution,

    emotionalFingerprint: {
      primary: llmResult.emotionalFingerprint.primary as EkmanEmotion,
      undertones,
      intensity: Math.round(avgIntensity * 100) / 100,
      contextCategory: llmResult.emotionalFingerprint.contextCategory as ContextCategory,
      relationalTone: llmResult.emotionalFingerprint.relationalTone as RelationalTone,
    },

    decisionPattern: {
      topicRevisits: llmResult.decisionPattern.topicRevisits,
      decisionReached: llmResult.decisionPattern.decisionReached,
      avoidanceSignals: llmResult.decisionPattern.avoidanceSignals as AvoidanceSignal[],
      primaryTension: llmResult.decisionPattern.primaryTension as Tension,
    },

    styleSnapshot,

    ...(structuralDynamic ? { structuralDynamic } : {}),

    importanceScore: llmResult.importanceScore,
    lastAccessed: now,
    accessCount: 0,
  };

  return fingerprint;
}

// Export for testing
export { validateLLMExtraction };
