import type { ConversationTurn, SessionSummary } from '../../types';
import { summarizeSession, SummarizerConfig } from '../index';
import { formatConversation, validateSummary } from '../summarizer';

// ──────────────────────────────────────────────────────
// Mock the Anthropic SDK — no real API calls in tests
// ──────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const TEST_CONFIG: SummarizerConfig = {
  model: 'claude-sonnet-4-20250514',
  apiKey: 'test-key-not-real',
};

// ── Mock conversation: career change ──

const CAREER_CONVERSATION: ConversationTurn[] = [
  { role: 'user', content: "I've been thinking about leaving my job at the bank. I've been there 6 years." },
  { role: 'lora', content: "Six years is substantial. What's pulling you toward the exit?" },
  { role: 'user', content: "I feel like I'm wasting my potential. My manager Sarah keeps giving me the same projects." },
  { role: 'lora', content: "So there's stagnation under Sarah's management. What would growth look like for you?" },
  { role: 'user', content: "I want to start my own consulting firm. But I'm terrified of losing the steady paycheck." },
  { role: 'lora', content: "Security versus growth — that's the core tension. What's the financial reality?" },
  { role: 'user', content: "I have about 8 months of savings. My partner Alex is supportive but nervous too." },
  { role: 'lora', content: "8 months is a runway. What would need to be true for you to take the leap?" },
  { role: 'user', content: "I think I need to land at least one client before I quit. That feels manageable." },
];

const CAREER_SUMMARY_RESPONSE: SessionSummary = {
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

// ── Mock conversation: relationship breakup ──

const BREAKUP_CONVERSATION: ConversationTurn[] = [
  { role: 'user', content: "My girlfriend ended things last night. Three years, just gone." },
  { role: 'lora', content: "Three years. That's not small. What happened?" },
  { role: 'user', content: "She said I was emotionally unavailable. Maybe she's right. I don't know." },
  { role: 'lora', content: "You're sitting with the possibility that she's right. That takes something." },
  { role: 'user', content: "I keep thinking about all the times she tried to talk and I just... shut down." },
  { role: 'lora', content: "You're seeing the pattern now. Shutting down — is that familiar beyond this relationship?" },
  { role: 'user', content: "Yeah. My dad was the same way. I swore I wouldn't be like him." },
];

const BREAKUP_SUMMARY_RESPONSE: SessionSummary = {
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

// ── Helper to wrap a summary in Anthropic API response shape ──

function mockApiResponse(summary: SessionSummary) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Session Summarizer', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('formatConversation', () => {
    it('formats turns with User/LoRa labels', () => {
      const result = formatConversation([
        { role: 'user', content: 'Hello' },
        { role: 'lora', content: 'Hi there' },
      ]);
      expect(result).toBe('User: Hello\n\nLoRa: Hi there');
    });
  });

  describe('validateSummary', () => {
    it('accepts a valid summary', () => {
      const result = validateSummary(CAREER_SUMMARY_RESPONSE);
      expect(result.primaryTopic).toBe(CAREER_SUMMARY_RESPONSE.primaryTopic);
    });

    it('rejects non-object', () => {
      expect(() => validateSummary('string')).toThrow('not an object');
    });

    it('rejects missing primaryTopic', () => {
      expect(() => validateSummary({ keyFacts: [] })).toThrow('primaryTopic');
    });

    it('rejects missing emotionalArc fields', () => {
      expect(() =>
        validateSummary({
          primaryTopic: 'test',
          keyFacts: [],
          emotionalArc: { start: 'ok' },
          causeExpressionLink: { cause: 'a', expression: 'b' },
          currentDirection: null,
          unresolved: [],
        }),
      ).toThrow('emotionalArc');
    });

    it('rejects missing causeExpressionLink fields', () => {
      expect(() =>
        validateSummary({
          primaryTopic: 'test',
          keyFacts: [],
          emotionalArc: { start: 'a', middle: 'b', end: 'c' },
          causeExpressionLink: { cause: 'a' },
          currentDirection: null,
          unresolved: [],
        }),
      ).toThrow('causeExpressionLink');
    });

    it('accepts null currentDirection', () => {
      const result = validateSummary(BREAKUP_SUMMARY_RESPONSE);
      expect(result.currentDirection).toBeNull();
    });
  });

  describe('summarizeSession', () => {
    it('returns structured summary for career-change conversation', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_SUMMARY_RESPONSE));

      const result = await summarizeSession(CAREER_CONVERSATION, TEST_CONFIG);

      expect(result.primaryTopic).toContain('consulting');
      expect(result.keyFacts.length).toBeGreaterThan(0);
      expect(result.emotionalArc.start).toBeDefined();
      expect(result.emotionalArc.middle).toBeDefined();
      expect(result.emotionalArc.end).toBeDefined();
      expect(result.currentDirection).not.toBeNull();
      expect(result.unresolved.length).toBeGreaterThan(0);
    });

    it('returns structured summary for breakup conversation', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(BREAKUP_SUMMARY_RESPONSE));

      const result = await summarizeSession(BREAKUP_CONVERSATION, TEST_CONFIG);

      expect(result.primaryTopic).toContain('breakup');
      expect(result.currentDirection).toBeNull();
      expect(result.emotionalArc.end).toContain('vulnerable');
    });

    it('output matches SessionSummary structure exactly', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_SUMMARY_RESPONSE));

      const result = await summarizeSession(CAREER_CONVERSATION, TEST_CONFIG);

      // Verify every required field exists and has correct type
      expect(typeof result.primaryTopic).toBe('string');
      expect(Array.isArray(result.keyFacts)).toBe(true);
      expect(typeof result.emotionalArc.start).toBe('string');
      expect(typeof result.emotionalArc.middle).toBe('string');
      expect(typeof result.emotionalArc.end).toBe('string');
      expect(typeof result.causeExpressionLink.cause).toBe('string');
      expect(typeof result.causeExpressionLink.expression).toBe('string');
      expect(
        result.currentDirection === null || typeof result.currentDirection === 'string',
      ).toBe(true);
      expect(Array.isArray(result.unresolved)).toBe(true);
    });

    it('does NOT contain raw conversation text in the summary', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_SUMMARY_RESPONSE));

      const result = await summarizeSession(CAREER_CONVERSATION, TEST_CONFIG);
      const serialized = JSON.stringify(result);

      // None of the user's raw messages should appear verbatim in the summary
      for (const turn of CAREER_CONVERSATION) {
        if (turn.role === 'user') {
          expect(serialized).not.toContain(turn.content);
        }
      }
    });

    it('throws on empty conversation', async () => {
      await expect(summarizeSession([], TEST_CONFIG)).rejects.toThrow('empty conversation');
    });

    it('throws when API returns no text block', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      await expect(
        summarizeSession(CAREER_CONVERSATION, TEST_CONFIG),
      ).rejects.toThrow('No text response');
    });

    it('throws when API returns invalid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not json' }],
      });

      await expect(
        summarizeSession(CAREER_CONVERSATION, TEST_CONFIG),
      ).rejects.toThrow();
    });

    it('passes the correct model and system prompt to the API', async () => {
      mockCreate.mockResolvedValueOnce(mockApiResponse(CAREER_SUMMARY_RESPONSE));

      await summarizeSession(CAREER_CONVERSATION, TEST_CONFIG);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.model).toBe(TEST_CONFIG.model);
      expect(callArgs.system).toContain('clinical summarizer');
      expect(callArgs.messages[0].content).toContain('User:');
    });
  });
});
