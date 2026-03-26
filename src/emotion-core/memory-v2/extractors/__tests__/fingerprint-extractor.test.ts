import type { SessionSummary, ConversationTurn } from '../../types';
import {
  EKMAN_EMOTIONS,
  UNDERTONE_VOCABULARY,
  CONTEXT_CATEGORIES,
  RELATIONAL_TONES,
  AVOIDANCE_VOCABULARY,
  TENSION_VOCABULARY,
} from '../../types';
import { extractFingerprint, FingerprintExtractorConfig, ConversationMetadata } from '../index';
import {
  computePeak,
  computeResolution,
  computeAverageIntensity,
  computeStyleSnapshot,
  validateLLMExtraction,
} from '../fingerprint-extractor';

// ──────────────────────────────────────────────────────
// Mock the Anthropic SDK
// ──────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const TEST_CONFIG: FingerprintExtractorConfig = {
  model: 'claude-haiku-4-5-20251001',
  apiKey: 'test-key-not-real',
};

// ── Mock summaries ──

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

const CAREER_SUMMARY: SessionSummary = {
  primaryTopic: 'User is considering leaving a 6-year banking career to start a consulting firm.',
  keyFacts: [
    'User has worked at a bank for 6 years',
    'Manager named Sarah assigns repetitive projects',
    'User wants to start own consulting firm',
    'Has 8 months of savings as financial runway',
    'Partner Alex is supportive but nervous',
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

// ── Mock LLM responses ──

const BREAKUP_LLM_RESPONSE = {
  emotionalFingerprint: {
    primary: 'sadness',
    undertones: ['loneliness', 'shame', 'guilt'],
    contextCategory: 'relationship',
    relationalTone: 'open',
  },
  decisionPattern: {
    topicRevisits: 2,
    decisionReached: false,
    avoidanceSignals: ['vulnerability', 'change'],
    primaryTension: 'honesty_vs_harmony',
  },
  importanceScore: 9,
};

const CAREER_LLM_RESPONSE = {
  emotionalFingerprint: {
    primary: 'fear',
    undertones: ['determination', 'tension'],
    contextCategory: 'career',
    relationalTone: 'collaborative',
  },
  decisionPattern: {
    topicRevisits: 1,
    decisionReached: true,
    avoidanceSignals: ['financial_risk', 'commitment'],
    primaryTension: 'security_vs_growth',
  },
  importanceScore: 7,
};

function mockApiResponse(data: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

// ── Mock conversation turns for style computation ──

const BREAKUP_TURNS: ConversationTurn[] = [
  { role: 'user', content: 'My girlfriend ended things last night. Three years, just gone.' },
  { role: 'lora', content: "Three years. That's not small. What happened?" },
  { role: 'user', content: "She said I was emotionally unavailable. Maybe she's right. I don't know." },
  { role: 'lora', content: "You're sitting with the possibility that she's right. That takes something." },
  { role: 'user', content: 'I keep thinking about all the times she tried to talk and I just... shut down.' },
  { role: 'lora', content: "You're seeing the pattern now. Shutting down — is that familiar beyond this relationship?" },
  { role: 'user', content: "Yeah. My dad was the same way. I swore I wouldn't be like him." },
];

const CAREER_TURNS: ConversationTurn[] = [
  { role: 'user', content: "I've been thinking about leaving my job at the bank. I've been there 6 years." },
  { role: 'lora', content: "Six years is substantial. What's pulling you toward the exit?" },
  { role: 'user', content: 'I feel like I\'m wasting my potential. My manager Sarah keeps giving me the same projects.' },
  { role: 'lora', content: "So there's stagnation under Sarah's management. What would growth look like for you?" },
  { role: 'user', content: "I want to start my own consulting firm. But I'm terrified of losing the steady paycheck." },
];

const BREAKUP_METADATA: ConversationMetadata = {
  turns: BREAKUP_TURNS,
  sessionId: 'session_breakup_001',
  userId: 'user_test_001',
};

const CAREER_METADATA: ConversationMetadata = {
  turns: CAREER_TURNS,
  sessionId: 'session_career_001',
  userId: 'user_test_001',
};

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Fingerprint Extractor', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // ── Pure math: EIV curve computations ──

  describe('computePeak', () => {
    it('finds peak intensity and turn', () => {
      const result = computePeak([0.3, 0.5, 0.9, 0.6, 0.4]);
      expect(result.peakIntensity).toBe(0.9);
      expect(result.peakTurn).toBe(2);
    });

    it('returns zeros for empty curve', () => {
      const result = computePeak([]);
      expect(result.peakIntensity).toBe(0);
      expect(result.peakTurn).toBe(0);
    });

    it('handles single-element curve', () => {
      const result = computePeak([0.5]);
      expect(result.peakIntensity).toBe(0.5);
      expect(result.peakTurn).toBe(0);
    });

    it('picks earliest turn on tie', () => {
      const result = computePeak([0.8, 0.5, 0.8]);
      expect(result.peakTurn).toBe(0);
    });
  });

  describe('computeResolution', () => {
    it('returns true when intensity drops 20%+ from peak', () => {
      // Peak is 0.9, last is 0.4 → 0.4 < 0.9*0.8 (0.72) → resolved
      expect(computeResolution([0.3, 0.9, 0.6, 0.4])).toBe(true);
    });

    it('returns false when intensity stays high', () => {
      // Peak is 0.9, last is 0.85 → 0.85 > 0.9*0.8 (0.72) → not resolved
      expect(computeResolution([0.3, 0.9, 0.85])).toBe(false);
    });

    it('returns false for single-element curve', () => {
      expect(computeResolution([0.5])).toBe(false);
    });

    it('returns false for empty curve', () => {
      expect(computeResolution([])).toBe(false);
    });
  });

  describe('computeAverageIntensity', () => {
    it('computes correct average', () => {
      expect(computeAverageIntensity([0.2, 0.4, 0.6, 0.8])).toBe(0.5);
    });

    it('returns 0 for empty curve', () => {
      expect(computeAverageIntensity([])).toBe(0);
    });
  });

  // ── Style snapshot ──

  describe('computeStyleSnapshot', () => {
    it('computes average words per message', () => {
      const result = computeStyleSnapshot([
        { role: 'user', content: 'one two three' },
        { role: 'user', content: 'four five' },
        { role: 'lora', content: 'this is ignored for word count' },
      ]);
      expect(result.avgWordsPerMessage).toBe(2.5);
    });

    it('computes question ratio', () => {
      const result = computeStyleSnapshot([
        { role: 'user', content: 'Is this right?' },
        { role: 'user', content: 'I think so.' },
        { role: 'user', content: 'What about this?' },
      ]);
      // 2 questions out of 3 messages
      expect(result.questionRatio).toBeCloseTo(0.67, 1);
    });

    it('reduces directness for hedging language', () => {
      const hedgy = computeStyleSnapshot([
        { role: 'user', content: 'I think maybe I should perhaps try something' },
      ]);
      const direct = computeStyleSnapshot([
        { role: 'user', content: 'I will do this now' },
      ]);
      expect(hedgy.directness).toBeLessThan(direct.directness);
    });

    it('returns defaults for no user turns', () => {
      const result = computeStyleSnapshot([
        { role: 'lora', content: 'Hello there' },
      ]);
      expect(result.avgWordsPerMessage).toBe(0);
      expect(result.questionRatio).toBe(0);
      expect(result.directness).toBe(0.5);
    });
  });

  // ── LLM validation ──

  describe('validateLLMExtraction', () => {
    it('accepts valid extraction', () => {
      const result = validateLLMExtraction(BREAKUP_LLM_RESPONSE);
      expect(result.emotionalFingerprint.primary).toBe('sadness');
    });

    it('maps non-Ekman emotions to nearest Ekman equivalent', () => {
      // 'melancholy' should map to 'sadness', not throw
      const result = validateLLMExtraction({
        ...BREAKUP_LLM_RESPONSE,
        emotionalFingerprint: {
          ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
          primary: 'melancholy',
        },
      });
      expect(result.emotionalFingerprint.primary).toBe('sadness');
    });

    it('maps hope to joy', () => {
      const result = validateLLMExtraction({
        ...BREAKUP_LLM_RESPONSE,
        emotionalFingerprint: {
          ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
          primary: 'hope',
        },
      });
      expect(result.emotionalFingerprint.primary).toBe('joy');
    });

    it('rejects completely unmappable primary emotion', () => {
      expect(() =>
        validateLLMExtraction({
          ...BREAKUP_LLM_RESPONSE,
          emotionalFingerprint: {
            ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
            primary: 'xyzzy_not_an_emotion',
          },
        }),
      ).toThrow('Cannot map primary emotion');
    });

    it('rejects empty undertones', () => {
      expect(() =>
        validateLLMExtraction({
          ...BREAKUP_LLM_RESPONSE,
          emotionalFingerprint: {
            ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
            undertones: [],
          },
        }),
      ).toThrow('undertones must be 1-3');
    });

    it('rejects more than 3 undertones', () => {
      expect(() =>
        validateLLMExtraction({
          ...BREAKUP_LLM_RESPONSE,
          emotionalFingerprint: {
            ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
            undertones: ['guilt', 'shame', 'hope', 'dread'],
          },
        }),
      ).toThrow('undertones must be 1-3');
    });

    it('filters invalid undertones but keeps valid ones', () => {
      const result = validateLLMExtraction({
        ...BREAKUP_LLM_RESPONSE,
        emotionalFingerprint: {
          ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
          undertones: ['loneliness', 'invalid_term', 'guilt'],
        },
      });
      expect(result.emotionalFingerprint.undertones).toEqual(['loneliness', 'guilt']);
    });

    it('rejects invalid contextCategory', () => {
      expect(() =>
        validateLLMExtraction({
          ...BREAKUP_LLM_RESPONSE,
          emotionalFingerprint: {
            ...BREAKUP_LLM_RESPONSE.emotionalFingerprint,
            contextCategory: 'love_life',
          },
        }),
      ).toThrow('Invalid contextCategory');
    });

    it('rejects invalid primaryTension', () => {
      expect(() =>
        validateLLMExtraction({
          ...BREAKUP_LLM_RESPONSE,
          decisionPattern: {
            ...BREAKUP_LLM_RESPONSE.decisionPattern,
            primaryTension: 'love_vs_freedom',
          },
        }),
      ).toThrow('Invalid primaryTension');
    });

    it('filters invalid avoidanceSignals silently', () => {
      const result = validateLLMExtraction({
        ...BREAKUP_LLM_RESPONSE,
        decisionPattern: {
          ...BREAKUP_LLM_RESPONSE.decisionPattern,
          avoidanceSignals: ['vulnerability', 'being_alone', 'change'],
        },
      });
      expect(result.decisionPattern.avoidanceSignals).toEqual(['vulnerability', 'change']);
    });

    it('rejects importanceScore out of range', () => {
      expect(() =>
        validateLLMExtraction({ ...BREAKUP_LLM_RESPONSE, importanceScore: 0 }),
      ).toThrow('importanceScore must be 1-10');
      expect(() =>
        validateLLMExtraction({ ...BREAKUP_LLM_RESPONSE, importanceScore: 11 }),
      ).toThrow('importanceScore must be 1-10');
    });

    it('rounds importanceScore to integer', () => {
      const result = validateLLMExtraction({
        ...BREAKUP_LLM_RESPONSE,
        importanceScore: 8.7,
      });
      expect(result.importanceScore).toBe(9);
    });
  });

  // ── Full extractFingerprint ──

  describe('extractFingerprint', () => {
    it('extracts breakup fingerprint with primary=sadness and loneliness undertone', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_LLM_RESPONSE));

      const eivCurve = [0.4, 0.6, 0.8, 0.7, 0.5];
      const result = await extractFingerprint(
        BREAKUP_SUMMARY, eivCurve, BREAKUP_METADATA, TEST_CONFIG,
      );

      expect(result.emotionalFingerprint.primary).toBe('sadness');
      expect(result.emotionalFingerprint.undertones).toContain('loneliness');
      expect(result.emotionalFingerprint.contextCategory).toBe('relationship');
    });

    it('extracts career anxiety fingerprint with primary=fear and context=career', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_LLM_RESPONSE));

      const eivCurve = [0.3, 0.5, 0.7, 0.6];
      const result = await extractFingerprint(
        CAREER_SUMMARY, eivCurve, CAREER_METADATA, TEST_CONFIG,
      );

      expect(result.emotionalFingerprint.primary).toBe('fear');
      expect(result.emotionalFingerprint.contextCategory).toBe('career');
      expect(result.decisionPattern.decisionReached).toBe(true);
      expect(result.decisionPattern.primaryTension).toBe('security_vs_growth');
    });

    it('computes EIV curve stats correctly', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_LLM_RESPONSE));

      const eivCurve = [0.3, 0.5, 0.9, 0.6, 0.4];
      const result = await extractFingerprint(
        BREAKUP_SUMMARY, eivCurve, BREAKUP_METADATA, TEST_CONFIG,
      );

      expect(result.peakIntensity).toBe(0.9);
      expect(result.peakTurn).toBe(2);
      expect(result.resolution).toBe(true); // 0.4 < 0.9*0.8
      expect(result.eivCurve).toEqual(eivCurve);
    });

    it('assigns high importanceScore for breakup', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_LLM_RESPONSE));

      const result = await extractFingerprint(
        BREAKUP_SUMMARY, [0.5, 0.7, 0.8], BREAKUP_METADATA, TEST_CONFIG,
      );

      expect(result.importanceScore).toBeGreaterThanOrEqual(8);
    });

    it('assigns moderate importanceScore for career anxiety', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_LLM_RESPONSE));

      const result = await extractFingerprint(
        CAREER_SUMMARY, [0.3, 0.5, 0.6], CAREER_METADATA, TEST_CONFIG,
      );

      expect(result.importanceScore).toBeGreaterThanOrEqual(5);
      expect(result.importanceScore).toBeLessThanOrEqual(8);
    });

    it('all vocabulary fields validate against known vocabularies', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_LLM_RESPONSE));

      const result = await extractFingerprint(
        BREAKUP_SUMMARY, [0.5, 0.7, 0.8], BREAKUP_METADATA, TEST_CONFIG,
      );

      expect(EKMAN_EMOTIONS).toContain(result.emotionalFingerprint.primary);
      for (const u of result.emotionalFingerprint.undertones) {
        expect(UNDERTONE_VOCABULARY).toContain(u);
      }
      expect(CONTEXT_CATEGORIES).toContain(result.emotionalFingerprint.contextCategory);
      expect(RELATIONAL_TONES).toContain(result.emotionalFingerprint.relationalTone);
      for (const a of result.decisionPattern.avoidanceSignals) {
        expect(AVOIDANCE_VOCABULARY).toContain(a);
      }
      expect(TENSION_VOCABULARY).toContain(result.decisionPattern.primaryTension);
    });

    it('includes style snapshot from conversation turns', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_LLM_RESPONSE));

      const result = await extractFingerprint(
        BREAKUP_SUMMARY, [0.5, 0.7], BREAKUP_METADATA, TEST_CONFIG,
      );

      expect(result.styleSnapshot.avgWordsPerMessage).toBeGreaterThan(0);
      expect(result.styleSnapshot.questionRatio).toBeGreaterThanOrEqual(0);
      expect(result.styleSnapshot.questionRatio).toBeLessThanOrEqual(1);
      expect(result.styleSnapshot.directness).toBeGreaterThanOrEqual(0);
      expect(result.styleSnapshot.directness).toBeLessThanOrEqual(1);
    });

    it('sets correct metadata fields', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_LLM_RESPONSE));

      const result = await extractFingerprint(
        BREAKUP_SUMMARY, [0.5], BREAKUP_METADATA, TEST_CONFIG,
      );

      expect(result.sessionId).toBe('session_breakup_001');
      expect(result.userId).toBe('user_test_001');
      expect(result.accessCount).toBe(0);
      expect(result.timestamp).toBeDefined();
      expect(result.lastAccessed).toBeDefined();
    });

    it('throws when API returns no text block', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      await expect(
        extractFingerprint(BREAKUP_SUMMARY, [0.5], BREAKUP_METADATA, TEST_CONFIG),
      ).rejects.toThrow('No text response');
    });

    it('throws when API returns invalid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not json at all' }],
      });

      await expect(
        extractFingerprint(BREAKUP_SUMMARY, [0.5], BREAKUP_METADATA, TEST_CONFIG),
      ).rejects.toThrow();
    });
  });
});
