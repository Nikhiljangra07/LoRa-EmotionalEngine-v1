/**
 * Structured fact templates for extraction: dates, money, project stage, goals.
 * Only structured values are extracted; no raw transcripts are stored.
 */

import { normalizeDate, normalizeMoney } from './utils/valueNormalizer';

export interface FactTemplateRule {
  type: 'deployment_plan' | 'financial_commitment' | 'project_stage' | 'goal';
  slot: string;
  /** Patterns with optional capture group for value. First match wins. */
  patterns: RegExp[];
}

export const FACT_TEMPLATES: FactTemplateRule[] = [
  {
    type: 'deployment_plan',
    slot: 'launch_date',
    patterns: [
      // Day-first: "on 23rd march 2026", "on 23 march 2026"
      /(?:deploy|launch|planning\s+to\s+deploy|will\s+deploy)\s+(?:.*?\s+)?on\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i,
      /on\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i,
      /(?:deploy|launch|planning\s+to\s+deploy|will\s+deploy)\s+(?:.*?\s+)?on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      /on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      // Month-first: "on March 23 2026", "on March 23, 2026", "on 23 March, 2026"
      /(?:deploy|launch|planning\s+to\s+deploy|will\s+deploy)\s+(?:.*?\s+)?on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /on\s+(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/i,
    ],
  },
  {
    type: 'financial_commitment',
    slot: 'money_amount',
    patterns: [
      /\$([0-9,]+)/,
      /borrow\s+\$?\s*([0-9,]+)/i,
      /need\s+\$?\s*([0-9,]+)/i,
      /(?:spend|pay|invest)\s+\$?\s*([0-9,]+)/i,
    ],
  },
  {
    type: 'project_stage',
    slot: 'stage',
    patterns: [
      /pre[- ]?launch/i,
      /almost\s+ready/i,
      /still\s+building/i,
      /in\s+testing/i,
      /post[- ]?launch/i,
      /pre[- ]?production/i,
    ],
  },
  {
    type: 'goal',
    slot: 'objective',
    patterns: [
      /(?:my\s+)?goal\s+is\s+to\s+(.+?)(?:\.|$)/i,
      /(?:i'?m\s+)?trying\s+to\s+(.+?)(?:\.|$)/i,
      /planning\s+to\s+(.+?)(?:\.|$)/i,
      /(?:i\s+)?want\s+to\s+(.+?)(?:\.|$)/i,
    ],
  },
];

export interface ExtractedStructuredFact {
  type: FactTemplateRule['type'];
  slot: string;
  value: string | number;
}

/**
 * Run templates in order; returns first match with normalized value when applicable.
 */
export function extractStructuredFact(message: string): ExtractedStructuredFact | null {
  for (const rule of FACT_TEMPLATES) {
    for (const re of rule.patterns) {
      const m = message.match(re);
      if (!m) continue;

      if (rule.slot === 'launch_date' && m[1]) {
        const normalized = normalizeDate(m[1].trim());
        if (normalized) return { type: rule.type, slot: rule.slot, value: normalized };
        continue;
      }
      if (rule.slot === 'money_amount' && m[1]) {
        const normalized = normalizeMoney(m[1].trim());
        if (normalized !== null && !Number.isNaN(normalized))
          return { type: rule.type, slot: rule.slot, value: normalized };
        continue;
      }
      if (rule.slot === 'stage') {
        const raw = (m[1] ?? m[0] ?? '').trim();
        const value = raw.toLowerCase().replace(/\s+/g, '_').slice(0, 32);
        if (value) return { type: rule.type, slot: rule.slot, value };
        continue;
      }
      if (rule.slot === 'objective' && m[1]) {
        const value = m[1].trim().slice(0, 80).replace(/\s+/g, ' ');
        if (value) return { type: rule.type, slot: rule.slot, value };
      }
    }
  }
  return null;
}
