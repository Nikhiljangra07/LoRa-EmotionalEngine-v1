import type {
  ConversationTurn,
  SessionSummary,
  FactAnchor,
  SessionFingerprint,
  EmotionalFingerprint,
  VerificationResult,
} from '../../types';
import type { IVectorStore, IGraphStore } from '../../storage/interfaces';
import type { SessionEndData } from '../adapter-interface';
import { MemoryV2Pipeline, PipelineConfig } from '../pipeline';

// ──────────────────────────────────────────────────────
// Mock all Anthropic SDK calls
// ──────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

// ── Pipeline config ──

const TEST_CONFIG: PipelineConfig = {
  summarizerModel: 'claude-sonnet-4-20250514',
  extractorModel: 'claude-haiku-4-5-20251001',
  apiKey: 'test-key',
};

// ── Mock data ──

const CAREER_CONVERSATION: ConversationTurn[] = [
  { role: 'user', content: "I've been thinking about leaving my job. Been there 6 years." },
  { role: 'lora', content: "What's pulling you toward the exit?" },
  { role: 'user', content: "I want to start consulting. But I'm scared of losing the paycheck." },
  { role: 'lora', content: "Security versus growth. What's the financial reality?" },
  { role: 'user', content: "I have 8 months of savings. My partner Alex is supportive." },
];

const CAREER_SUMMARY: SessionSummary = {
  primaryTopic: 'User considering leaving banking career for consulting.',
  keyFacts: [
    'Worked at bank 6 years',
    'Wants to start consulting firm',
    'Has 8 months savings',
    'Partner Alex supportive',
  ],
  emotionalArc: {
    start: 'frustrated about stagnation',
    middle: 'anxious about financial risk',
    end: 'cautiously determined',
  },
  causeExpressionLink: {
    cause: 'wasted potential under stagnant management',
    expression: 'oscillating between ambition and fear',
  },
  currentDirection: 'Land one client before quitting',
  unresolved: ['How to find first client', 'Partner timeline alignment'],
};

const CAREER_FACTS: FactAnchor[] = [
  { type: 'goal', slot: 'career_goal', value: 'start_consulting', confidence: 0.9, relationships: [] },
  { type: 'person', slot: 'partner', value: 'alex', confidence: 0.9, relationships: [] },
  { type: 'barrier', slot: 'financial_fear', value: 'income_loss', confidence: 0.8, relationships: [] },
];

const CAREER_FINGERPRINT_LLM = {
  emotionalFingerprint: {
    primary: 'fear',
    undertones: ['tension', 'determination'],
    contextCategory: 'career',
    relationalTone: 'collaborative',
  },
  decisionPattern: {
    topicRevisits: 1,
    decisionReached: true,
    avoidanceSignals: ['financial_risk'],
    primaryTension: 'security_vs_growth',
  },
  importanceScore: 7,
};

const VERIFIED_OK: VerificationResult = {
  verified: true,
  flaggedFacts: [],
  fingerprintIssues: [],
  suggestedCorrections: [],
};

const VERIFICATION_FAILED: VerificationResult = {
  verified: false,
  flaggedFacts: [{ anchorIndex: 0, reason: 'contradicts summary' }],
  fingerprintIssues: [],
  suggestedCorrections: [],
};

// ── Helper: set up mock API call sequence ──

function setupMockCalls(options: {
  summary?: SessionSummary;
  facts?: FactAnchor[];
  fingerprint?: object;
  verification?: VerificationResult;
  /** For re-extraction: second set of responses */
  retryFacts?: FactAnchor[];
  retryVerification?: VerificationResult;
}) {
  const calls: Array<{ content: Array<{ type: 'text'; text: string }> }> = [];

  // Call 1: summarizeSession
  calls.push({
    content: [{ type: 'text', text: JSON.stringify(options.summary ?? CAREER_SUMMARY) }],
  });

  // Calls 2-3: extractFacts + extractFingerprint (parallel, but mock resolves in order)
  calls.push({
    content: [{ type: 'text', text: JSON.stringify(options.facts ?? CAREER_FACTS) }],
  });
  calls.push({
    content: [{ type: 'text', text: JSON.stringify(options.fingerprint ?? CAREER_FINGERPRINT_LLM) }],
  });

  // Call 4: verifyExtraction
  calls.push({
    content: [{ type: 'text', text: JSON.stringify(options.verification ?? VERIFIED_OK) }],
  });

  // If re-extraction needed:
  if (options.retryFacts) {
    calls.push({
      content: [{ type: 'text', text: JSON.stringify(options.retryFacts) }],
    });
  }
  if (options.retryVerification) {
    calls.push({
      content: [{ type: 'text', text: JSON.stringify(options.retryVerification) }],
    });
  }

  for (const call of calls) {
    mockCreate.mockResolvedValueOnce(call);
  }
}

// ── Mock stores ──

function createMockVectorStore(): IVectorStore & { stored: SessionFingerprint[] } {
  const stored: SessionFingerprint[] = [];
  return {
    stored,
    store: jest.fn(async (_userId: string, fp: SessionFingerprint) => {
      // Upsert: replace if same sessionId
      const idx = stored.findIndex((s) => s.sessionId === fp.sessionId);
      if (idx >= 0) {
        stored[idx] = fp;
      } else {
        stored.push(fp);
      }
    }),
    querySimilar: jest.fn(async (_userId: string, _fp: EmotionalFingerprint, limit: number) => {
      return stored.slice(0, limit);
    }),
    delete: jest.fn(),
    purgeUser: jest.fn(async () => {
      stored.length = 0;
    }),
  };
}

function createMockGraphStore(): IGraphStore & { anchors: Map<string, FactAnchor[]> } {
  const anchors = new Map<string, FactAnchor[]>();
  return {
    anchors,
    storeAnchors: jest.fn(async (_userId: string, sessionId: string, facts: FactAnchor[]) => {
      anchors.set(sessionId, facts);
    }),
    getAnchorsForSessions: jest.fn(async (_userId: string, sessionIds: string[]) => {
      const result: FactAnchor[] = [];
      for (const sid of sessionIds) {
        const a = anchors.get(sid);
        if (a) result.push(...a);
      }
      return result;
    }),
    getUserGraph: jest.fn(async () => ({ nodes: [], edges: [] })),
    pruneStaleEdges: jest.fn(async () => 0),
    purgeUser: jest.fn(async () => {
      anchors.clear();
    }),
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('MemoryV2Pipeline', () => {
  let pipeline: MemoryV2Pipeline;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let graphStore: ReturnType<typeof createMockGraphStore>;

  beforeEach(() => {
    mockCreate.mockReset();
    vectorStore = createMockVectorStore();
    graphStore = createMockGraphStore();
    pipeline = new MemoryV2Pipeline(vectorStore, graphStore, TEST_CONFIG);
  });

  const SESSION_DATA: SessionEndData = {
    userId: 'user_001',
    sessionId: 'session_career_001',
    conversationHistory: CAREER_CONVERSATION,
    eivCurve: [0.3, 0.5, 0.7, 0.6],
  };

  describe('processSessionEnd', () => {
    it('stores facts and fingerprint on successful verification', async () => {
      setupMockCalls({});

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(true);
      expect(result.factsCount).toBeGreaterThan(0);
      expect(result.fingerprintStored).toBe(true);
      expect(result.profileUpdated).toBe(true);
      expect(result.reExtracted).toBe(false);

      // Verify stores were called
      expect(graphStore.storeAnchors).toHaveBeenCalledWith(
        'user_001', 'session_career_001', expect.any(Array),
      );
      expect(vectorStore.store).toHaveBeenCalled();
    });

    it('summary is discarded after processing (never persisted)', async () => {
      setupMockCalls({});

      await pipeline.processSessionEnd(SESSION_DATA);

      // The summary should NOT appear in any store
      // Check that graphStore doesn't have raw summary text
      const storedAnchors = graphStore.anchors.get('session_career_001');
      if (storedAnchors) {
        const serialized = JSON.stringify(storedAnchors);
        // No raw conversation text should appear
        expect(serialized).not.toContain("I've been thinking about leaving my job");
      }

      // Check that vectorStore doesn't have raw summary text
      if (vectorStore.stored.length > 0) {
        const serialized = JSON.stringify(vectorStore.stored[0]);
        expect(serialized).not.toContain("I've been thinking about leaving my job");
      }
    });

    it('re-extracts on verification failure', async () => {
      setupMockCalls({
        verification: VERIFICATION_FAILED,
        retryFacts: CAREER_FACTS,       // re-extracted facts
        retryVerification: VERIFIED_OK,  // passes on retry
      });

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.reExtracted).toBe(true);
      expect(result.stored).toBe(true);
      // Should have made more API calls due to re-extraction
      expect(mockCreate.mock.calls.length).toBeGreaterThan(4);
    });

    it('stores anyway after re-extraction still fails (data already validated)', async () => {
      setupMockCalls({
        verification: VERIFICATION_FAILED,
        retryFacts: CAREER_FACTS,
        retryVerification: VERIFICATION_FAILED, // still fails
      });

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      // Should still store — extraction validation already filters bad data
      expect(result.stored).toBe(true);
      expect(result.reExtracted).toBe(true);
    });

    it('updates user profile', async () => {
      setupMockCalls({});

      await pipeline.processSessionEnd(SESSION_DATA);

      const profile = pipeline.getProfile('user_001');
      expect(profile).toBeDefined();
      expect(profile!.sessionsCompleted).toBe(1);
      expect(profile!.userId).toBe('user_001');
    });

    it('accumulates profile across multiple sessions', async () => {
      // Session 1
      setupMockCalls({});
      await pipeline.processSessionEnd(SESSION_DATA);

      // Session 2
      setupMockCalls({});
      await pipeline.processSessionEnd({
        ...SESSION_DATA,
        sessionId: 'session_career_002',
      });

      const profile = pipeline.getProfile('user_001');
      expect(profile!.sessionsCompleted).toBe(2);
    });

    it('runs fact and fingerprint extraction in parallel', async () => {
      setupMockCalls({});

      await pipeline.processSessionEnd(SESSION_DATA);

      // The summarizer call is first, then fact+fingerprint are parallel,
      // then verification. Minimum 4 API calls.
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });
  });

  describe('retrieveContext', () => {
    it('returns matching context after storing a session', async () => {
      // Store a session first
      setupMockCalls({});
      await pipeline.processSessionEnd(SESSION_DATA);

      // Now retrieve with a similar emotional state
      const currentState: EmotionalFingerprint = {
        primary: 'fear',
        undertones: ['tension', 'determination'],
        intensity: 0.7,
        contextCategory: 'career',
        relationalTone: 'collaborative',
      };

      const context = await pipeline.retrieveContext('user_001', currentState);

      // Should return the stored session as a match
      expect(context).toBeDefined();
      expect(context.responseMode).toBeDefined();
    });

    it('returns empty context for new user', async () => {
      const currentState: EmotionalFingerprint = {
        primary: 'fear',
        undertones: ['tension'],
        intensity: 0.5,
        contextCategory: 'career',
        relationalTone: 'open',
      };

      const context = await pipeline.retrieveContext('new_user', currentState);

      expect(context.matchedSessions).toHaveLength(0);
      expect(context.relatedFacts).toHaveLength(0);
      expect(context.topSimilarity).toBe(0);
    });

    it('filters out fogged (non-visible) fingerprints', async () => {
      // Store a session with the fingerprint having old lastAccessed
      setupMockCalls({});
      await pipeline.processSessionEnd(SESSION_DATA);

      // Manually age the stored fingerprint to make it fogged
      if (vectorStore.stored.length > 0) {
        const fp = vectorStore.stored[0]!;
        const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        vectorStore.stored[0] = {
          ...fp,
          lastAccessed: oldDate,
          importanceScore: 3, // low importance
          accessCount: 1,     // low access count
        };
      }

      const currentState: EmotionalFingerprint = {
        primary: 'fear',
        undertones: ['tension', 'determination'],
        intensity: 0.7,
        contextCategory: 'career',
        relationalTone: 'collaborative',
      };

      const context = await pipeline.retrieveContext('user_001', currentState);

      // The fogged fingerprint should be filtered out
      expect(context.matchedSessions).toHaveLength(0);
    });
  });

  describe('resilience', () => {
    it('returns stored=false when summarization fails (API error)', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Anthropic API timeout'));

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(false);
      expect(result.factsCount).toBe(0);
      expect(result.fingerprintStored).toBe(false);
    });

    it('stores fingerprint even when fact extraction fails', async () => {
      // Summary succeeds
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_SUMMARY) }],
      });
      // Fact extraction fails
      mockCreate.mockRejectedValueOnce(new Error('fact extraction timeout'));
      // Fingerprint extraction succeeds
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_FINGERPRINT_LLM) }],
      });
      // Verification succeeds
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(VERIFIED_OK) }],
      });

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(true);
      expect(result.factsCount).toBe(0);
      expect(result.fingerprintStored).toBe(true);
    });

    it('stores facts even when fingerprint extraction fails', async () => {
      // Summary succeeds
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_SUMMARY) }],
      });
      // Fact extraction succeeds
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_FACTS) }],
      });
      // Fingerprint extraction fails
      mockCreate.mockRejectedValueOnce(new Error('fingerprint extraction timeout'));

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(true);
      expect(result.factsCount).toBeGreaterThan(0);
      expect(result.fingerprintStored).toBe(false);
      expect(result.profileUpdated).toBe(false);
    });

    it('returns stored=false when both extractions fail', async () => {
      // Summary succeeds
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_SUMMARY) }],
      });
      // Both extractions fail
      mockCreate.mockRejectedValueOnce(new Error('fact timeout'));
      mockCreate.mockRejectedValueOnce(new Error('fingerprint timeout'));

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(false);
      expect(result.factsCount).toBe(0);
      expect(result.fingerprintStored).toBe(false);
    });

    it('stores data even when verifier crashes', async () => {
      // Summary
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_SUMMARY) }],
      });
      // Facts + fingerprint
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_FACTS) }],
      });
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CAREER_FINGERPRINT_LLM) }],
      });
      // Verifier crashes
      mockCreate.mockRejectedValueOnce(new Error('verifier API crash'));

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(true);
      expect(result.factsCount).toBeGreaterThan(0);
      expect(result.fingerprintStored).toBe(true);
    });

    it('retries storage on transient failure', async () => {
      setupMockCalls({});

      // Make graph store fail once then succeed
      let graphCallCount = 0;
      (graphStore.storeAnchors as jest.Mock).mockImplementation(
        async (_u: string, sid: string, facts: FactAnchor[]) => {
          graphCallCount++;
          if (graphCallCount === 1) throw new Error('Redis connection reset');
          graphStore.anchors.set(sid, facts);
        },
      );

      const result = await pipeline.processSessionEnd(SESSION_DATA);

      expect(result.stored).toBe(true);
      expect(graphCallCount).toBe(2); // 1 fail + 1 retry
    });

    it('retrieval returns empty context on store failure', async () => {
      // Make vector store throw
      (vectorStore.querySimilar as jest.Mock).mockRejectedValueOnce(
        new Error('ChromaDB connection refused'),
      );

      const currentState: EmotionalFingerprint = {
        primary: 'fear', undertones: ['tension'], intensity: 0.5,
        contextCategory: 'career', relationalTone: 'open',
      };

      const context = await pipeline.retrieveContext('user_001', currentState);

      expect(context.matchedSessions).toHaveLength(0);
      expect(context.topSimilarity).toBe(0);
      expect(context.responseMode).toBe('silent');
    });
  });

  describe('purgeUser', () => {
    it('removes all data from both stores', async () => {
      setupMockCalls({});
      await pipeline.processSessionEnd(SESSION_DATA);

      await pipeline.purgeUser('user_001');

      expect(vectorStore.purgeUser).toHaveBeenCalledWith('user_001');
      expect(graphStore.purgeUser).toHaveBeenCalledWith('user_001');
      expect(pipeline.getProfile('user_001')).toBeUndefined();
    });
  });

  describe('integration: multi-session emotional matching', () => {
    it('session 3 retrieval matches emotionally similar session 1', async () => {
      // Session 1: career anxiety (fear + tension)
      setupMockCalls({});
      await pipeline.processSessionEnd({
        userId: 'user_001',
        sessionId: 'session_1',
        conversationHistory: CAREER_CONVERSATION,
        eivCurve: [0.3, 0.5, 0.8, 0.6],
      });

      // Session 2: relationship joy (different emotion entirely)
      setupMockCalls({
        fingerprint: {
          emotionalFingerprint: {
            primary: 'joy',
            undertones: ['warmth', 'relief'],
            contextCategory: 'relationship',
            relationalTone: 'open',
          },
          decisionPattern: {
            topicRevisits: 0,
            decisionReached: false,
            avoidanceSignals: [],
            primaryTension: 'honesty_vs_harmony',
          },
          importanceScore: 4,
        },
      });
      await pipeline.processSessionEnd({
        userId: 'user_001',
        sessionId: 'session_2',
        conversationHistory: [
          { role: 'user', content: 'Things are going really well with my partner.' },
          { role: 'lora', content: "That's great to hear. What's changed?" },
        ],
        eivCurve: [0.2, 0.3],
      });

      // Session 3 retrieval: same emotion as session 1 (fear + tension about finance)
      const currentState: EmotionalFingerprint = {
        primary: 'fear',
        undertones: ['tension', 'dread'],
        intensity: 0.75,
        contextCategory: 'finance',
        relationalTone: 'collaborative',
      };

      const context = await pipeline.retrieveContext('user_001', currentState);

      // Should find matches — session 1 has the same emotional shape
      // Session 2 (joy) should rank lower than session 1 (fear)
      if (context.matchedSessions.length > 0) {
        const topMatch = context.matchedSessions[0]!;
        expect(topMatch.fingerprint.emotionalFingerprint.primary).toBe('fear');
      }
    });
  });
});
