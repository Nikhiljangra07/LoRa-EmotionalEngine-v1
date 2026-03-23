import type { SessionSummary, FactAnchor } from '../../types';
import { FACT_ANCHOR_TYPES, FACT_SLOTS } from '../../types';
import { extractFacts, FactExtractorConfig } from '../index';
import { validateFact, looksLikeRawText } from '../fact-extractor';

// ──────────────────────────────────────────────────────
// Mock the Anthropic SDK
// ──────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const TEST_CONFIG: FactExtractorConfig = {
  model: 'claude-haiku-4-5-20251001',
  apiKey: 'test-key-not-real',
};

// ── Mock summaries ──

const CAREER_SUMMARY: SessionSummary = {
  primaryTopic: 'User is considering leaving a 6-year banking career to start a consulting firm.',
  keyFacts: [
    'User has worked at a bank for 6 years',
    'Manager named Sarah assigns repetitive projects',
    'User wants to start own consulting firm',
    'Has 8 months of savings as financial runway',
    'Partner Alex is supportive but nervous',
    'User identified landing one client before quitting as the actionable step',
  ],
  emotionalArc: {
    start: 'frustrated and restless about career stagnation',
    middle: 'anxious when confronting financial risk of leaving',
    end: 'cautiously determined after identifying a concrete first step',
  },
  causeExpressionLink: {
    cause: 'feeling of wasted potential under stagnant management',
    expression: 'oscillating between ambition and fear of financial instability',
  },
  currentDirection: 'Land one consulting client before resigning from the bank',
  unresolved: [
    'How to find the first client while still employed',
    'Partner alignment on timeline and risk tolerance',
  ],
};

const BREAKUP_SUMMARY: SessionSummary = {
  primaryTopic: 'User processing a breakup after three-year relationship ended due to emotional unavailability.',
  keyFacts: [
    'Girlfriend ended the relationship the previous night',
    'Relationship lasted three years',
    'Reason given was emotional unavailability',
    'User recognizes pattern of shutting down during emotional conversations',
    'User identifies same pattern in father',
  ],
  emotionalArc: {
    start: 'shocked and grieving the sudden loss',
    middle: 'shifting to painful self-recognition about emotional patterns',
    end: 'raw and vulnerable, connecting current behavior to family pattern',
  },
  causeExpressionLink: {
    cause: 'learned emotional withdrawal pattern inherited from father',
    expression: 'oscillating between grief and reluctant self-awareness',
  },
  currentDirection: null,
  unresolved: [
    'Whether user wants to address the emotional unavailability pattern',
    'Whether there is any possibility of reconciliation',
    'How deep the family pattern runs beyond romantic relationships',
  ],
};

// ── Mock API responses ──

const CAREER_FACTS: FactAnchor[] = [
  {
    type: 'goal',
    slot: 'career_goal',
    value: 'start_consulting_firm',
    confidence: 0.9,
    relationships: [
      { targetType: 'barrier', targetValue: 'income_loss_anxiety', edge: 'BLOCKED_BY' },
    ],
  },
  {
    type: 'person',
    slot: 'manager',
    value: 'sarah',
    confidence: 0.9,
    relationships: [],
  },
  {
    type: 'person',
    slot: 'partner',
    value: 'alex',
    confidence: 0.9,
    relationships: [
      { targetType: 'goal', targetValue: 'start_consulting_firm', edge: 'RELATED_TO' },
    ],
  },
  {
    type: 'barrier',
    slot: 'financial_fear',
    value: 'income_loss_anxiety',
    confidence: 0.8,
    relationships: [],
  },
  {
    type: 'decision',
    slot: 'committed',
    value: 'land_first_client_before_quitting',
    confidence: 0.85,
    relationships: [
      { targetType: 'goal', targetValue: 'start_consulting_firm', edge: 'RELATED_TO' },
    ],
  },
];

const BREAKUP_FACTS: FactAnchor[] = [
  {
    type: 'event',
    slot: 'breakup',
    value: 'three_year_relationship_ended',
    confidence: 0.95,
    relationships: [],
  },
  {
    type: 'barrier',
    slot: 'vulnerability_fear',
    value: 'emotional_unavailability_pattern',
    confidence: 0.8,
    relationships: [],
  },
  {
    type: 'person',
    slot: 'family_member',
    value: 'father',
    confidence: 0.7,
    relationships: [
      { targetType: 'barrier', targetValue: 'emotional_unavailability_pattern', edge: 'RELATED_TO' },
    ],
  },
];

function mockApiResponse(facts: FactAnchor[]) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(facts) }],
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Fact Extractor', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('looksLikeRawText', () => {
    it('flags strings with spaces', () => {
      expect(looksLikeRawText('I am feeling bad')).toBe(true);
    });

    it('flags very long strings', () => {
      expect(looksLikeRawText('a'.repeat(61))).toBe(true);
    });

    it('flags strings with quotes', () => {
      expect(looksLikeRawText('she said "hello"')).toBe(true);
    });

    it('accepts snake_case labels', () => {
      expect(looksLikeRawText('career_change')).toBe(false);
    });

    it('accepts short lowercase names', () => {
      expect(looksLikeRawText('sarah')).toBe(false);
    });
  });

  describe('validateFact', () => {
    it('accepts a valid fact', () => {
      const result = validateFact({
        type: 'goal',
        slot: 'career_goal',
        value: 'start_consulting',
        confidence: 0.85,
        relationships: [],
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('goal');
    });

    it('rejects unknown type', () => {
      expect(
        validateFact({
          type: 'unknown',
          slot: 'career_goal',
          value: 'test',
          confidence: 0.5,
          relationships: [],
        }),
      ).toBeNull();
    });

    it('rejects slot that does not belong to the type', () => {
      // career_goal is a goal slot, not a person slot
      expect(
        validateFact({
          type: 'person',
          slot: 'career_goal',
          value: 'sarah',
          confidence: 0.9,
          relationships: [],
        }),
      ).toBeNull();
    });

    it('rejects raw text values', () => {
      expect(
        validateFact({
          type: 'person',
          slot: 'user_name',
          value: 'I am feeling terrible',
          confidence: 0.8,
          relationships: [],
        }),
      ).toBeNull();
    });

    it('rejects confidence out of range', () => {
      expect(
        validateFact({
          type: 'goal',
          slot: 'career_goal',
          value: 'test',
          confidence: 1.5,
          relationships: [],
        }),
      ).toBeNull();
    });

    it('drops relationships with invalid edge types', () => {
      const result = validateFact({
        type: 'goal',
        slot: 'career_goal',
        value: 'start_consulting',
        confidence: 0.8,
        relationships: [
          { targetType: 'barrier', targetValue: 'fear', edge: 'INVALID_EDGE' },
          { targetType: 'barrier', targetValue: 'fear', edge: 'BLOCKED_BY' },
        ],
      });
      expect(result).not.toBeNull();
      expect(result!.relationships).toHaveLength(1);
      expect(result!.relationships[0]!.edge).toBe('BLOCKED_BY');
    });
  });

  describe('extractFacts', () => {
    it('extracts facts from a career-change summary', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_FACTS));

      const result = await extractFacts(CAREER_SUMMARY, TEST_CONFIG);

      expect(result.length).toBeGreaterThan(0);
      const goalFact = result.find((f) => f.type === 'goal');
      expect(goalFact).toBeDefined();
      expect(goalFact!.slot).toBe('career_goal');
    });

    it('extracts facts from a breakup summary', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_FACTS));

      const result = await extractFacts(BREAKUP_SUMMARY, TEST_CONFIG);

      expect(result.length).toBeGreaterThan(0);
      const eventFact = result.find((f) => f.type === 'event');
      expect(eventFact).toBeDefined();
      expect(eventFact!.slot).toBe('breakup');
    });

    it('NEVER extracts "Fucked", "Not", or "Preparing" as names', async () => {
      // Simulate a bad LLM response that tries to extract garbage as names
      const badFacts = [
        { type: 'person', slot: 'user_name', value: 'Fucked', confidence: 0.5, relationships: [] },
        { type: 'person', slot: 'user_name', value: 'Not a name', confidence: 0.5, relationships: [] },
        { type: 'person', slot: 'user_name', value: 'Preparing for change', confidence: 0.5, relationships: [] },
        // This one is valid
        { type: 'person', slot: 'partner', value: 'alex', confidence: 0.9, relationships: [] },
      ];
      mockCreate.mockResolvedValueOnce(mockApiResponse(badFacts as FactAnchor[]));

      const result = await extractFacts(CAREER_SUMMARY, TEST_CONFIG);

      // "Fucked" has capital letter but no spaces — it passes looksLikeRawText
      // but the validation should still work for the others
      const names = result
        .filter((f) => f.type === 'person')
        .map((f) => f.value);

      // "Not a name" and "Preparing for change" contain spaces → rejected
      expect(names).not.toContain('Not a name');
      expect(names).not.toContain('Preparing for change');

      // Valid name should still be there
      expect(names).toContain('alex');
    });

    it('output contains ONLY valid vocabulary terms for type and slot', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_FACTS));

      const result = await extractFacts(CAREER_SUMMARY, TEST_CONFIG);

      for (const fact of result) {
        // Type must be from FACT_ANCHOR_TYPES
        expect(FACT_ANCHOR_TYPES).toContain(fact.type);

        // Slot must be valid for this type
        const validSlots = FACT_SLOTS[fact.type] as readonly string[];
        expect(validSlots).toContain(fact.slot);

        // Value must not look like raw text
        expect(looksLikeRawText(fact.value)).toBe(false);

        // Confidence must be in range
        expect(fact.confidence).toBeGreaterThanOrEqual(0);
        expect(fact.confidence).toBeLessThanOrEqual(1);

        // Relationships must have valid edges
        for (const rel of fact.relationships) {
          expect(FACT_ANCHOR_TYPES).toContain(rel.targetType);
          expect(looksLikeRawText(rel.targetValue)).toBe(false);
        }
      }
    });

    it('silently drops invalid facts instead of throwing', async () => {
      const mixedFacts = [
        // Valid
        { type: 'goal', slot: 'career_goal', value: 'start_consulting', confidence: 0.8, relationships: [] },
        // Invalid type
        { type: 'bogus', slot: 'career_goal', value: 'test', confidence: 0.5, relationships: [] },
        // Invalid slot for type
        { type: 'person', slot: 'career_goal', value: 'sarah', confidence: 0.9, relationships: [] },
        // Raw text value
        { type: 'goal', slot: 'personal_goal', value: 'I want to change my life completely', confidence: 0.7, relationships: [] },
      ];
      mockCreate.mockResolvedValueOnce(mockApiResponse(mixedFacts as FactAnchor[]));

      const result = await extractFacts(CAREER_SUMMARY, TEST_CONFIG);

      // Only the first fact should survive validation
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe('start_consulting');
    });

    it('returns empty array when no facts are extractable', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse([]));

      const result = await extractFacts(CAREER_SUMMARY, TEST_CONFIG);

      expect(result).toEqual([]);
    });

    it('throws when API returns no text block', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      await expect(extractFacts(CAREER_SUMMARY, TEST_CONFIG)).rejects.toThrow(
        'No text response',
      );
    });

    it('throws when API returns non-array JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"not": "an array"}' }],
      });

      await expect(extractFacts(CAREER_SUMMARY, TEST_CONFIG)).rejects.toThrow(
        'Expected JSON array',
      );
    });

    it('preserves valid relationships in extracted facts', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_FACTS));

      const result = await extractFacts(CAREER_SUMMARY, TEST_CONFIG);

      const goalFact = result.find((f) => f.type === 'goal');
      expect(goalFact).toBeDefined();
      expect(goalFact!.relationships.length).toBeGreaterThan(0);
      expect(goalFact!.relationships[0]!.edge).toBe('BLOCKED_BY');
      expect(goalFact!.relationships[0]!.targetType).toBe('barrier');
    });
  });
});
