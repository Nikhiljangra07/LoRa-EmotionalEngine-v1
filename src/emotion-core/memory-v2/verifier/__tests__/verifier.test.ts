import type {
  SessionSummary,
  SessionFingerprint,
  FactAnchor,
  VerificationResult,
} from '../../types';
import { verifyExtraction, VerifierConfig } from '../index';
import { validateVerificationResponse, buildVerificationPrompt } from '../verifier';

// ──────────────────────────────────────────────────────
// Mock the Anthropic SDK
// ──────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const TEST_CONFIG: VerifierConfig = {
  model: 'claude-haiku-4-5-20251001',
  apiKey: 'test-key-not-real',
};

// ── Test fixtures ──

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

const VALID_FACTS: FactAnchor[] = [
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
    relationships: [],
  },
  {
    type: 'barrier',
    slot: 'financial_fear',
    value: 'income_loss_anxiety',
    confidence: 0.8,
    relationships: [],
  },
];

const VALID_FINGERPRINT: SessionFingerprint = {
  sessionId: 'session_career_001',
  userId: 'user_test_001',
  timestamp: '2026-03-22T10:00:00Z',
  eivCurve: [0.3, 0.5, 0.7, 0.6],
  peakIntensity: 0.7,
  peakTurn: 2,
  resolution: true,
  emotionalFingerprint: {
    primary: 'fear',
    undertones: ['determination', 'tension'],
    intensity: 0.53,
    contextCategory: 'career',
    relationalTone: 'collaborative',
  },
  decisionPattern: {
    topicRevisits: 1,
    decisionReached: true,
    avoidanceSignals: ['financial_risk', 'commitment'],
    primaryTension: 'security_vs_growth',
  },
  styleSnapshot: {
    avgWordsPerMessage: 18.5,
    questionRatio: 0.1,
    directness: 0.72,
  },
  importanceScore: 7,
  lastAccessed: '2026-03-22T10:00:00Z',
  accessCount: 0,
};

// Facts with a bad name extraction
const FACTS_WITH_BAD_NAME: FactAnchor[] = [
  ...VALID_FACTS,
  {
    type: 'person',
    slot: 'user_name',
    value: 'frustrated',
    confidence: 0.6,
    relationships: [],
  },
];

// Facts that contradict the summary
const CONTRADICTING_FACTS: FactAnchor[] = [
  {
    type: 'goal',
    slot: 'career_goal',
    value: 'stay_at_current_job',
    confidence: 0.9,
    relationships: [],
  },
  {
    type: 'person',
    slot: 'partner',
    value: 'alex',
    confidence: 0.9,
    relationships: [],
  },
];

function mockApiResponse(result: VerificationResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  };
}

// ── Mock LLM verification responses ──

const VERIFIED_RESPONSE: VerificationResult = {
  verified: true,
  flaggedFacts: [],
  fingerprintIssues: [],
  suggestedCorrections: [],
};

const FLAGGED_NAME_RESPONSE: VerificationResult = {
  verified: false,
  flaggedFacts: [
    {
      anchorIndex: 4,
      reason: 'The summary does not contain a self-introduction. "frustrated" is an emotional descriptor, not a name.',
    },
  ],
  fingerprintIssues: [],
  suggestedCorrections: [
    {
      field: 'facts[4]',
      currentValue: 'frustrated',
      suggestedValue: 'REMOVE — not a valid name extraction',
    },
  ],
};

const CONTRADICTING_RESPONSE: VerificationResult = {
  verified: false,
  flaggedFacts: [
    {
      anchorIndex: 0,
      reason: 'Summary says user wants to START a consulting firm and LEAVE the bank. "stay_at_current_job" directly contradicts this.',
    },
  ],
  fingerprintIssues: [],
  suggestedCorrections: [
    {
      field: 'facts[0].value',
      currentValue: 'stay_at_current_job',
      suggestedValue: 'start_consulting_firm',
    },
  ],
};

const FINGERPRINT_ISSUE_RESPONSE: VerificationResult = {
  verified: false,
  flaggedFacts: [],
  fingerprintIssues: [
    'Primary emotion "joy" does not match the emotional arc which describes frustration, anxiety, and cautious determination. Expected "fear" or "anger".',
  ],
  suggestedCorrections: [
    {
      field: 'emotionalFingerprint.primary',
      currentValue: 'joy',
      suggestedValue: 'fear',
    },
  ],
};

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Extraction Verifier', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('validateVerificationResponse', () => {
    it('accepts a valid verified=true response', () => {
      const result = validateVerificationResponse(VERIFIED_RESPONSE);
      expect(result.verified).toBe(true);
      expect(result.flaggedFacts).toHaveLength(0);
      expect(result.fingerprintIssues).toHaveLength(0);
    });

    it('accepts a valid verified=false response with flags', () => {
      const result = validateVerificationResponse(FLAGGED_NAME_RESPONSE);
      expect(result.verified).toBe(false);
      expect(result.flaggedFacts).toHaveLength(1);
      expect(result.flaggedFacts[0]!.anchorIndex).toBe(4);
    });

    it('forces verified=false when flaggedFacts are present even if LLM says true', () => {
      const inconsistent = {
        verified: true, // LLM said true but there are flags
        flaggedFacts: [{ anchorIndex: 0, reason: 'some problem' }],
        fingerprintIssues: [],
        suggestedCorrections: [],
      };
      const result = validateVerificationResponse(inconsistent);
      expect(result.verified).toBe(false); // Corrected to false
    });

    it('forces verified=false when fingerprintIssues are present', () => {
      const inconsistent = {
        verified: true,
        flaggedFacts: [],
        fingerprintIssues: ['wrong primary emotion'],
        suggestedCorrections: [],
      };
      const result = validateVerificationResponse(inconsistent);
      expect(result.verified).toBe(false);
    });

    it('rejects non-object response', () => {
      expect(() => validateVerificationResponse('string')).toThrow('not an object');
    });

    it('rejects missing verified field', () => {
      expect(() =>
        validateVerificationResponse({ flaggedFacts: [], fingerprintIssues: [] }),
      ).toThrow('verified');
    });

    it('silently drops malformed flaggedFacts entries', () => {
      const result = validateVerificationResponse({
        verified: false,
        flaggedFacts: [
          { anchorIndex: 0, reason: 'valid flag' },
          { anchorIndex: 'not a number', reason: 'bad entry' }, // invalid
          'just a string', // invalid
        ],
        fingerprintIssues: [],
        suggestedCorrections: [],
      });
      expect(result.flaggedFacts).toHaveLength(1);
      expect(result.flaggedFacts[0]!.reason).toBe('valid flag');
    });

    it('silently drops malformed suggestedCorrections', () => {
      const result = validateVerificationResponse({
        verified: true,
        flaggedFacts: [],
        fingerprintIssues: [],
        suggestedCorrections: [
          { field: 'a', currentValue: 'b', suggestedValue: 'c' }, // valid
          { field: 'a' }, // missing fields
          42, // not an object
        ],
      });
      expect(result.suggestedCorrections).toHaveLength(1);
    });
  });

  describe('buildVerificationPrompt', () => {
    it('includes summary, facts with indices, and fingerprint', () => {
      const prompt = buildVerificationPrompt(CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT);

      expect(prompt).toContain('SUMMARY:');
      expect(prompt).toContain('consulting firm');
      expect(prompt).toContain('FACTS');
      expect(prompt).toContain('FINGERPRINT');
      expect(prompt).toContain('fear');
    });

    it('includes facts and fingerprint data in compact format', () => {
      const prompt = buildVerificationPrompt(CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT);
      // Compact format uses JSON.stringify (no pretty-print)
      expect(prompt).toContain('SUMMARY:');
      expect(prompt).toContain('FACTS:');
      expect(prompt).toContain('FINGERPRINT:');
    });
  });

  describe('verifyExtraction', () => {
    it('returns verified=true when extraction matches summary', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(VERIFIED_RESPONSE));

      const result = await verifyExtraction(
        CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT, TEST_CONFIG,
      );

      expect(result.verified).toBe(true);
      expect(result.flaggedFacts).toHaveLength(0);
      expect(result.fingerprintIssues).toHaveLength(0);
    });

    it('flags when fact contradicts summary', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CONTRADICTING_RESPONSE));

      const result = await verifyExtraction(
        CAREER_SUMMARY, CONTRADICTING_FACTS, VALID_FINGERPRINT, TEST_CONFIG,
      );

      expect(result.verified).toBe(false);
      expect(result.flaggedFacts.length).toBeGreaterThan(0);
      expect(result.flaggedFacts[0]!.reason).toContain('contradicts');
      expect(result.suggestedCorrections.length).toBeGreaterThan(0);
    });

    it('flags when name is extracted from non-introduction context', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(FLAGGED_NAME_RESPONSE));

      const result = await verifyExtraction(
        CAREER_SUMMARY, FACTS_WITH_BAD_NAME, VALID_FINGERPRINT, TEST_CONFIG,
      );

      expect(result.verified).toBe(false);
      const nameFlag = result.flaggedFacts.find((f) => f.anchorIndex === 4);
      expect(nameFlag).toBeDefined();
      expect(nameFlag!.reason).toContain('not a name');
    });

    it('flags when fingerprint emotion does not match summary', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(FINGERPRINT_ISSUE_RESPONSE));

      // Pass a fingerprint with wrong emotion
      const badFingerprint: SessionFingerprint = {
        ...VALID_FINGERPRINT,
        emotionalFingerprint: {
          ...VALID_FINGERPRINT.emotionalFingerprint,
          primary: 'joy', // Wrong — summary describes fear/anxiety
        },
      };

      const result = await verifyExtraction(
        CAREER_SUMMARY, VALID_FACTS, badFingerprint, TEST_CONFIG,
      );

      expect(result.verified).toBe(false);
      expect(result.fingerprintIssues.length).toBeGreaterThan(0);
      expect(result.fingerprintIssues[0]).toContain('joy');
    });

    it('includes suggestedCorrections when issues are found', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CONTRADICTING_RESPONSE));

      const result = await verifyExtraction(
        CAREER_SUMMARY, CONTRADICTING_FACTS, VALID_FINGERPRINT, TEST_CONFIG,
      );

      expect(result.suggestedCorrections.length).toBeGreaterThan(0);
      expect(result.suggestedCorrections[0]!.field).toBeDefined();
      expect(result.suggestedCorrections[0]!.currentValue).toBeDefined();
      expect(result.suggestedCorrections[0]!.suggestedValue).toBeDefined();
    });

    it('retries with prefill when first attempt returns no text block, auto-verifies after 3 failures', async () => {
      // All 3 attempts return empty content
      mockCreate.mockResolvedValue({ content: [] });

      const result = await verifyExtraction(CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT, TEST_CONFIG);
      expect(result.verified).toBe(true);
      expect(result.flaggedFacts).toEqual([]);
      // Should have made 3 attempts (1 standard + 2 prefill)
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('succeeds on second attempt with prefill when first returns prose', async () => {
      // Attempt 1: prose (no JSON)
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Looking at the extracted facts, everything appears correct.' }],
      });
      // Attempt 2 (prefill): valid JSON (prefill prepends `{`, so response starts after it)
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '"verified":true,"flaggedFacts":[],"fingerprintIssues":[],"suggestedCorrections":[]}' }],
      });

      const result = await verifyExtraction(CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT, TEST_CONFIG);
      expect(result.verified).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('auto-verifies after 3 failed attempts with invalid JSON', async () => {
      // All attempts return prose with no JSON markers
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'The extracted data appears to be accurate and well-formed. All facts match the summary.' }],
      });

      const result = await verifyExtraction(CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT, TEST_CONFIG);
      expect(result.verified).toBe(true);
      expect(result.flaggedFacts).toEqual([]);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('passes correct model to API', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(VERIFIED_RESPONSE));

      await verifyExtraction(CAREER_SUMMARY, VALID_FACTS, VALID_FINGERPRINT, TEST_CONFIG);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.model).toBe(TEST_CONFIG.model);
    });
  });
});
