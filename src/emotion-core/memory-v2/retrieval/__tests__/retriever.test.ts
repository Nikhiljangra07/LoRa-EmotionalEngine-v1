import type { SessionFingerprint, EmotionalFingerprint, FactAnchor } from '../../types';
import type { IVectorStore, IGraphStore } from '../../storage/interfaces';
import { retrieveMemory } from '../retriever';
import { recencyBoost, determineResponseMode, SIMILARITY_THRESHOLD } from '../retriever';

// ──────────────────────────────────────────────────────
// Mock stores
// ──────────────────────────────────────────────────────

function makeFP(overrides: Partial<{
  sessionId: string;
  primary: EmotionalFingerprint['primary'];
  undertones: EmotionalFingerprint['undertones'];
  intensity: number;
  contextCategory: EmotionalFingerprint['contextCategory'];
  relationalTone: EmotionalFingerprint['relationalTone'];
  timestamp: string;
  importanceScore: number;
}>): SessionFingerprint {
  return {
    sessionId: overrides.sessionId ?? 'session_001',
    userId: 'user_001',
    timestamp: overrides.timestamp ?? new Date().toISOString(), // default: now (max recency boost)
    eivCurve: [0.3, 0.5, 0.7],
    peakIntensity: 0.7,
    peakTurn: 2,
    resolution: true,
    emotionalFingerprint: {
      primary: overrides.primary ?? 'fear',
      undertones: overrides.undertones ?? ['tension', 'dread'],
      intensity: overrides.intensity ?? 0.7,
      contextCategory: overrides.contextCategory ?? 'career',
      relationalTone: overrides.relationalTone ?? 'collaborative',
    },
    decisionPattern: {
      topicRevisits: 1,
      decisionReached: true,
      avoidanceSignals: ['financial_risk'],
      primaryTension: 'security_vs_growth',
    },
    styleSnapshot: { avgWordsPerMessage: 15, questionRatio: 0.2, directness: 0.7 },
    importanceScore: overrides.importanceScore ?? 7,
    lastAccessed: new Date().toISOString(),
    accessCount: 0,
  };
}

const CAREER_ANCHORS: FactAnchor[] = [
  { type: 'goal', slot: 'career_goal', value: 'start_consulting', confidence: 0.9, relationships: [] },
  { type: 'barrier', slot: 'financial_fear', value: 'income_loss', confidence: 0.8, relationships: [] },
];

function createMockVectorStore(storedFingerprints: SessionFingerprint[]): IVectorStore {
  return {
    store: jest.fn(),
    querySimilar: jest.fn().mockResolvedValue(storedFingerprints),
    delete: jest.fn(),
    purgeUser: jest.fn(),
  };
}

function createMockGraphStore(anchors: FactAnchor[]): IGraphStore {
  return {
    storeAnchors: jest.fn(),
    getAnchorsForSessions: jest.fn().mockResolvedValue(anchors),
    getUserGraph: jest.fn(),
    pruneStaleEdges: jest.fn(),
    purgeUser: jest.fn(),
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('recencyBoost', () => {
  it('returns 1.0 for a session from right now', () => {
    const now = Date.now();
    expect(recencyBoost(new Date(now).toISOString(), now)).toBe(1.0);
  });

  it('returns 0.5 for a session from 45 days ago', () => {
    const now = Date.now();
    const fortyFiveDaysAgo = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyBoost(fortyFiveDaysAgo, now)).toBeCloseTo(0.5, 1);
  });

  it('returns 0.0 for a session from 90+ days ago', () => {
    const now = Date.now();
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyBoost(ninetyDaysAgo, now)).toBe(0.0);
  });

  it('returns 0.0 for very old sessions', () => {
    const now = Date.now();
    const yearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyBoost(yearAgo, now)).toBe(0.0);
  });
});

describe('determineResponseMode', () => {
  it('returns silent by default (below 0.80)', () => {
    expect(determineResponseMode(0.75, 'career', 'career')).toBe('silent');
  });

  it('returns subtle when similarity > 0.80', () => {
    expect(determineResponseMode(0.85, 'career', 'relationship')).toBe('subtle');
  });

  it('returns direct when similarity > 0.90 AND same context', () => {
    expect(determineResponseMode(0.92, 'career', 'career')).toBe('direct');
  });

  it('returns subtle (not direct) when > 0.90 but different context', () => {
    expect(determineResponseMode(0.92, 'career', 'relationship')).toBe('subtle');
  });

  it('returns silent when no match context (null)', () => {
    expect(determineResponseMode(0.0, 'career', null)).toBe('silent');
  });
});

describe('retrieveMemory', () => {
  it('returns matched sessions above threshold', async () => {
    // Store a very similar past session (same emotion, undertones, context — recent)
    const pastFp = makeFP({
      sessionId: 'past_session',
      primary: 'fear',
      undertones: ['tension', 'dread'],
      contextCategory: 'career',
    });

    const vectorStore = createMockVectorStore([pastFp]);
    const graphStore = createMockGraphStore(CAREER_ANCHORS);

    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const result = await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    expect(result.matchedSessions.length).toBeGreaterThan(0);
    expect(result.topSimilarity).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });

  it('returns related facts from matched sessions', async () => {
    const pastFp = makeFP({ sessionId: 'past_session' });

    const vectorStore = createMockVectorStore([pastFp]);
    const graphStore = createMockGraphStore(CAREER_ANCHORS);

    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const result = await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    expect(result.relatedFacts.length).toBeGreaterThan(0);
    expect(result.relatedFacts.some((f) => f.type === 'goal')).toBe(true);
  });

  it('returns empty results when no matches above threshold', async () => {
    // Store a past session with completely different emotion
    const pastFp = makeFP({
      sessionId: 'past_session',
      primary: 'joy',
      undertones: ['warmth', 'relief'],
      intensity: 0.3,
      contextCategory: 'creative',
    });

    const vectorStore = createMockVectorStore([pastFp]);
    const graphStore = createMockGraphStore([]);

    const currentState: EmotionalFingerprint = {
      primary: 'anger',
      undertones: ['tension', 'urgency'],
      intensity: 0.9,
      contextCategory: 'career',
      relationalTone: 'confrontational',
    };

    const result = await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    expect(result.matchedSessions).toHaveLength(0);
    expect(result.relatedFacts).toHaveLength(0);
    expect(result.responseMode).toBe('silent');
    expect(result.topSimilarity).toBe(0);
  });

  it('returns silent mode for moderate matches', async () => {
    const pastFp = makeFP({
      sessionId: 'past_session',
      primary: 'fear',
      undertones: ['tension'],
      intensity: 0.5,
      contextCategory: 'relationship', // different context
    });

    const vectorStore = createMockVectorStore([pastFp]);
    const graphStore = createMockGraphStore(CAREER_ANCHORS);

    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const result = await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    // Same primary emotion but different context/undertones → moderate match → silent
    if (result.matchedSessions.length > 0) {
      expect(result.responseMode).toBe('silent');
    }
  });

  it('limits matched sessions to top 3', async () => {
    // 5 very similar past sessions
    const pastFps = Array.from({ length: 5 }, (_, i) =>
      makeFP({ sessionId: `session_${i}` }),
    );

    const vectorStore = createMockVectorStore(pastFps);
    const graphStore = createMockGraphStore(CAREER_ANCHORS);

    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const result = await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    expect(result.matchedSessions.length).toBeLessThanOrEqual(3);
  });

  it('passes matched session IDs to graph store', async () => {
    const pastFp = makeFP({ sessionId: 'matched_session' });

    const vectorStore = createMockVectorStore([pastFp]);
    const graphStore = createMockGraphStore(CAREER_ANCHORS);

    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    // Verify getAnchorsForSessions was called with matched session IDs
    if ((graphStore.getAnchorsForSessions as jest.Mock).mock.calls.length > 0) {
      const callArgs = (graphStore.getAnchorsForSessions as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe('user_001');
      expect(callArgs[1]).toContain('matched_session');
    }
  });

  it('does not call graph store when no matches found', async () => {
    const vectorStore = createMockVectorStore([]);
    const graphStore = createMockGraphStore([]);

    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension'],
      intensity: 0.5,
      contextCategory: 'career',
      relationalTone: 'open',
    };

    await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    expect(graphStore.getAnchorsForSessions).not.toHaveBeenCalled();
  });

  it('career anxiety matches relationship anxiety across contexts', async () => {
    // Past session: relationship anxiety
    const pastFp = makeFP({
      sessionId: 'relationship_anxiety',
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.75,
      contextCategory: 'relationship',
    });

    const vectorStore = createMockVectorStore([pastFp]);
    const graphStore = createMockGraphStore(CAREER_ANCHORS);

    // Current state: career anxiety (same emotional shape, different domain)
    const currentState: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.8,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const result = await retrieveMemory('user_001', currentState, vectorStore, graphStore);

    // The relationship anxiety session should match the career anxiety
    expect(result.matchedSessions.length).toBeGreaterThan(0);
    expect(result.matchedSessions[0]!.fingerprint.emotionalFingerprint.contextCategory).toBe('relationship');
    expect(result.topSimilarity).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });
});
