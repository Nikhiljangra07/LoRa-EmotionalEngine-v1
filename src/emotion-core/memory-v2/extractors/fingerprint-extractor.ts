import Anthropic from '@anthropic-ai/sdk';
import { parseLLMJson } from '../utils/json-parse';
import type {
  SessionSummary,
  SessionFingerprint,
  EmotionalFingerprint,
  StyleSnapshot,
  ConversationTurn,
  EkmanEmotion,
  Undertone,
  ContextCategory,
  RelationalTone,
  AvoidanceSignal,
  Tension,
} from '../types';
import {
  EKMAN_EMOTIONS,
  UNDERTONE_VOCABULARY,
  CONTEXT_CATEGORIES,
  RELATIONAL_TONES,
  AVOIDANCE_VOCABULARY,
  TENSION_VOCABULARY,
} from '../types';
import {
  FINGERPRINT_EXTRACTION_SYSTEM_PROMPT,
  FINGERPRINT_EXTRACTION_USER_PROMPT,
} from './prompts/fingerprint-extraction.prompt';

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

  const primary = efObj['primary'] as string;
  if (!EKMAN_EMOTIONS.includes(primary as EkmanEmotion)) {
    throw new Error(`Invalid primary emotion: ${primary}`);
  }

  const rawUndertones = efObj['undertones'];
  if (!Array.isArray(rawUndertones) || rawUndertones.length === 0 || rawUndertones.length > 3) {
    throw new Error(`undertones must be 1-3 items, got ${Array.isArray(rawUndertones) ? rawUndertones.length : 'non-array'}`);
  }
  const validUndertones = rawUndertones.filter(
    (u): u is Undertone => UNDERTONE_VOCABULARY.includes(u as Undertone),
  );
  if (validUndertones.length === 0) {
    throw new Error('No valid undertones after filtering');
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
): Promise<SessionFingerprint> {
  const client = new Anthropic({ apiKey: config.apiKey });

  // Call Haiku for emotional extraction
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 512,
    system: FINGERPRINT_EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: FINGERPRINT_EXTRACTION_USER_PROMPT + JSON.stringify(summary, null, 2),
      },
    ],
  });

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

    importanceScore: llmResult.importanceScore,
    lastAccessed: now,
    accessCount: 0,
  };

  return fingerprint;
}

// Export for testing
export { validateLLMExtraction };
