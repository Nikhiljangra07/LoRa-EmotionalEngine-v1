import Anthropic from '@anthropic-ai/sdk';
import type { SessionSummary, FactAnchor, FactAnchorType, FactSlot } from '../types';
import { parseLLMJson } from '../utils/json-parse';
import { FACT_ANCHOR_TYPES, FACT_SLOTS } from '../types';
import {
  FACT_EXTRACTION_SYSTEM_PROMPT,
  FACT_EXTRACTION_USER_PROMPT,
} from './prompts/fact-extraction.prompt';

// ──────────────────────────────────────────────────────
// Fact Extractor — SessionSummary → FactAnchor[]
// Calls Haiku to extract structured facts, then validates
// every field against fixed vocabularies.
// ──────────────────────────────────────────────────────

export interface FactExtractorConfig {
  model: string;
  apiKey: string;
}

/** All valid slots flattened into a single set for fast lookup */
const ALL_VALID_SLOTS: ReadonlySet<string> = new Set([
  ...FACT_SLOTS.goal,
  ...FACT_SLOTS.person,
  ...FACT_SLOTS.barrier,
  ...FACT_SLOTS.event,
  ...FACT_SLOTS.decision,
  ...FACT_SLOTS.identity,
]);

/** Valid slots per anchor type for cross-validation */
const SLOTS_BY_TYPE: Record<FactAnchorType, readonly string[]> = {
  goal: FACT_SLOTS.goal,
  person: FACT_SLOTS.person,
  barrier: FACT_SLOTS.barrier,
  event: FACT_SLOTS.event,
  decision: FACT_SLOTS.decision,
  identity: FACT_SLOTS.identity,
};

/** Valid edge types for relationships */
const VALID_EDGES = new Set([
  'BLOCKED_BY', 'RELATED_TO', 'KNOWS_PERSON', 'HAS_GOAL', 'TRIGGERED_BY',
]);

/**
 * Check if a value looks like raw transcript text that leaked through.
 * Raw text indicators: spaces, uppercase words (non-name context), long strings, quotes.
 */
function looksLikeRawText(value: string): boolean {
  // Properly normalized values are snake_case without spaces
  if (value.includes(' ')) return true;
  // Very long values are suspicious (normalized labels are short)
  if (value.length > 60) return true;
  // Contains quotes
  if (value.includes('"') || value.includes("'")) return true;
  return false;
}

/**
 * Validate a single extracted fact anchor.
 * Returns null if the fact is invalid (dropped silently — better to lose a fact than store garbage).
 */
function validateFact(raw: Record<string, unknown>): FactAnchor | null {
  // Validate type
  const type = raw['type'] as string;
  if (!FACT_ANCHOR_TYPES.includes(type as FactAnchorType)) return null;
  const anchorType = type as FactAnchorType;

  // Validate slot belongs to this type
  const slot = raw['slot'] as string;
  if (!ALL_VALID_SLOTS.has(slot)) return null;
  const validSlotsForType = SLOTS_BY_TYPE[anchorType];
  if (!validSlotsForType.includes(slot)) return null;

  // Validate value is not raw text
  const value = raw['value'];
  if (typeof value !== 'string' || value.length === 0) return null;
  if (looksLikeRawText(value)) return null;

  // Validate confidence
  const confidence = raw['confidence'];
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return null;

  // Validate relationships
  const rawRelationships = raw['relationships'];
  const relationships: FactAnchor['relationships'] = [];
  if (Array.isArray(rawRelationships)) {
    for (const rel of rawRelationships) {
      if (typeof rel !== 'object' || rel === null) continue;
      const r = rel as Record<string, unknown>;
      if (
        typeof r['targetType'] === 'string' &&
        FACT_ANCHOR_TYPES.includes(r['targetType'] as FactAnchorType) &&
        typeof r['targetValue'] === 'string' &&
        !looksLikeRawText(r['targetValue']) &&
        typeof r['edge'] === 'string' &&
        VALID_EDGES.has(r['edge'])
      ) {
        relationships.push({
          targetType: r['targetType'] as FactAnchorType,
          targetValue: r['targetValue'] as string,
          edge: r['edge'] as string,
        });
      }
    }
  }

  return {
    type: anchorType,
    slot: slot as FactSlot,
    value,
    confidence,
    relationships,
  };
}

/**
 * Format a SessionSummary as text for the extraction prompt.
 */
function formatSummaryForExtraction(summary: SessionSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Extract structured fact anchors from a session summary.
 * Calls Haiku, parses the response, validates every fact.
 * Invalid facts are silently dropped.
 */
export async function extractFacts(
  summary: SessionSummary,
  config: FactExtractorConfig,
): Promise<FactAnchor[]> {
  const client = new Anthropic({ apiKey: config.apiKey });

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: FACT_EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: FACT_EXTRACTION_USER_PROMPT + formatSummaryForExtraction(summary),
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from model');
  }

  const parsed: unknown = parseLLMJson(textBlock.text);
  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from extraction');
  }

  // Validate each fact, drop invalid ones
  const validFacts: FactAnchor[] = [];
  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue;
    const validated = validateFact(raw as Record<string, unknown>);
    if (validated !== null) {
      validFacts.push(validated);
    }
  }

  return validFacts;
}

// Export for testing
export { validateFact, looksLikeRawText, formatSummaryForExtraction };
