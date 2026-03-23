import type { SessionFingerprint, EmotionalFingerprint } from '../../types';
import { encodeFingerprint, cosineSimilarity, VECTOR_DIMS } from '../vector/encoding';
import { ChromaVectorStore } from '../vector/chroma-adapter';

// ──────────────────────────────────────────────────────
// Mock ChromaDB client
// ──────────────────────────────────────────────────────

// In-memory store that mimics ChromaDB behavior
interface StoredDoc {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

let inMemoryDocs: StoredDoc[] = [];

const mockCollection = {
  upsert: jest.fn(async (params: { ids: string[]; embeddings: number[][]; metadatas: Record<string, unknown>[] }) => {
    for (let i = 0; i < params.ids.length; i++) {
      const id = params.ids[i]!;
      // Remove existing doc with same id
      inMemoryDocs = inMemoryDocs.filter((d) => d.id !== id);
      inMemoryDocs.push({
        id,
        embedding: params.embeddings[i]!,
        metadata: params.metadatas[i]!,
      });
    }
  }),
  query: jest.fn(async (params: { queryEmbeddings: number[][]; nResults: number; where?: Record<string, unknown> }) => {
    const queryVec = params.queryEmbeddings[0]!;
    let candidates = inMemoryDocs;

    // Filter by where clause
    if (params.where) {
      candidates = candidates.filter((doc) => {
        for (const [key, val] of Object.entries(params.where!)) {
          if (doc.metadata[key] !== val) return false;
        }
        return true;
      });
    }

    // Sort by cosine similarity
    const scored = candidates.map((doc) => ({
      doc,
      score: cosineSimilarity(queryVec, doc.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, params.nResults);

    return {
      ids: [top.map((s) => s.doc.id)],
      metadatas: [top.map((s) => s.doc.metadata)],
      distances: [top.map((s) => 1 - s.score)],
    };
  }),
  delete: jest.fn(async (params: { ids?: string[]; where?: Record<string, unknown> }) => {
    if (params.ids) {
      const idSet = new Set(params.ids);
      inMemoryDocs = inMemoryDocs.filter((d) => !idSet.has(d.id));
    }
    if (params.where) {
      inMemoryDocs = inMemoryDocs.filter((doc) => {
        for (const [key, val] of Object.entries(params.where!)) {
          if (doc.metadata[key] === val) return false;
        }
        return true;
      });
    }
  }),
};

jest.mock('chromadb', () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: jest.fn().mockResolvedValue(mockCollection),
  })),
}));

// ── Test fixtures ──

function makeFingerprint(overrides: Partial<{
  sessionId: string;
  primary: EmotionalFingerprint['primary'];
  undertones: EmotionalFingerprint['undertones'];
  intensity: number;
  contextCategory: EmotionalFingerprint['contextCategory'];
  relationalTone: EmotionalFingerprint['relationalTone'];
  importanceScore: number;
}>): SessionFingerprint {
  return {
    sessionId: overrides.sessionId ?? 'session_001',
    userId: 'user_001',
    timestamp: '2026-03-22T10:00:00Z',
    eivCurve: [0.3, 0.5, 0.7],
    peakIntensity: 0.7,
    peakTurn: 2,
    resolution: true,
    emotionalFingerprint: {
      primary: overrides.primary ?? 'fear',
      undertones: overrides.undertones ?? ['tension', 'dread'],
      intensity: overrides.intensity ?? 0.6,
      contextCategory: overrides.contextCategory ?? 'career',
      relationalTone: overrides.relationalTone ?? 'collaborative',
    },
    decisionPattern: {
      topicRevisits: 1,
      decisionReached: true,
      avoidanceSignals: ['financial_risk'],
      primaryTension: 'security_vs_growth',
    },
    styleSnapshot: {
      avgWordsPerMessage: 15,
      questionRatio: 0.2,
      directness: 0.7,
    },
    importanceScore: overrides.importanceScore ?? 7,
    lastAccessed: '2026-03-22T10:00:00Z',
    accessCount: 0,
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('Vector Encoding', () => {
  describe('encodeFingerprint', () => {
    it('produces a 256-dim vector', () => {
      const fp: EmotionalFingerprint = {
        primary: 'fear',
        undertones: ['tension', 'dread'],
        intensity: 0.7,
        contextCategory: 'career',
        relationalTone: 'collaborative',
      };
      const vec = encodeFingerprint(fp);
      expect(vec).toHaveLength(VECTOR_DIMS);
    });

    it('encodes primary emotion at correct index scaled by intensity', () => {
      const fp: EmotionalFingerprint = {
        primary: 'fear', // index 2 in EKMAN_EMOTIONS
        undertones: ['tension'],
        intensity: 0.8,
        contextCategory: 'career',
        relationalTone: 'open',
      };
      const vec = encodeFingerprint(fp);
      expect(vec[2]).toBe(0.8); // fear at index 2, scaled by intensity
      expect(vec[0]).toBe(0);   // joy not set
      expect(vec[1]).toBe(0);   // anger not set
    });

    it('encodes undertones as multi-hot at positions 6-20', () => {
      const fp: EmotionalFingerprint = {
        primary: 'sadness',
        undertones: ['loneliness', 'guilt'], // indices 10, 9 in UNDERTONE_VOCABULARY
        intensity: 0.5,
        contextCategory: 'relationship',
        relationalTone: 'open',
      };
      const vec = encodeFingerprint(fp);
      expect(vec[6 + 10]).toBe(1.0); // loneliness
      expect(vec[6 + 9]).toBe(1.0);  // guilt
      expect(vec[6 + 0]).toBe(0);    // nostalgia not set
    });

    it('encodes intensity at position 21', () => {
      const fp: EmotionalFingerprint = {
        primary: 'joy',
        undertones: ['warmth'],
        intensity: 0.42,
        contextCategory: 'relationship',
        relationalTone: 'open',
      };
      const vec = encodeFingerprint(fp);
      expect(vec[21]).toBe(0.42);
    });

    it('encodes context category one-hot at positions 22-31', () => {
      const fp: EmotionalFingerprint = {
        primary: 'fear',
        undertones: ['tension'],
        intensity: 0.5,
        contextCategory: 'career', // index 0 in CONTEXT_CATEGORIES
        relationalTone: 'open',
      };
      const vec = encodeFingerprint(fp);
      expect(vec[22]).toBe(1.0); // career at index 0
      expect(vec[23]).toBe(0);   // relationship not set
    });

    it('pads remaining dimensions with zeros', () => {
      const fp: EmotionalFingerprint = {
        primary: 'joy',
        undertones: ['warmth'],
        intensity: 0.5,
        contextCategory: 'career',
        relationalTone: 'open',
      };
      const vec = encodeFingerprint(fp);
      // All dims from 39 to 255 should be 0
      for (let i = 39; i < VECTOR_DIMS; i++) {
        expect(vec[i]).toBe(0);
      }
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const vec = [1, 0, 0, 0.5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0, 0];
      const b = [0, 1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('returns high similarity for similar emotions', () => {
      const fearCareer = encodeFingerprint({
        primary: 'fear',
        undertones: ['tension', 'dread'],
        intensity: 0.7,
        contextCategory: 'career',
        relationalTone: 'collaborative',
      });
      const fearRelationship = encodeFingerprint({
        primary: 'fear',
        undertones: ['tension', 'dread'],
        intensity: 0.65,
        contextCategory: 'relationship',
        relationalTone: 'open',
      });
      // Same emotion + undertones, different context/tone → moderate-high similarity
      const sim = cosineSimilarity(fearCareer, fearRelationship);
      expect(sim).toBeGreaterThan(0.5);
    });

    it('returns low similarity for different emotions', () => {
      const fear = encodeFingerprint({
        primary: 'fear',
        undertones: ['tension', 'dread'],
        intensity: 0.8,
        contextCategory: 'career',
        relationalTone: 'defensive',
      });
      const joy = encodeFingerprint({
        primary: 'joy',
        undertones: ['warmth', 'relief'],
        intensity: 0.8,
        contextCategory: 'career',
        relationalTone: 'open',
      });
      const sim = cosineSimilarity(fear, joy);
      expect(sim).toBeLessThan(0.5);
    });

    it('returns 0 for zero vectors', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
    });
  });
});

describe('ChromaVectorStore', () => {
  let store: ChromaVectorStore;

  beforeEach(() => {
    inMemoryDocs = [];
    mockCollection.upsert.mockClear();
    mockCollection.query.mockClear();
    mockCollection.delete.mockClear();
    store = new ChromaVectorStore({ url: 'http://mock:8000' });
  });

  it('stores a fingerprint and retrieves it via querySimilar', async () => {
    const fp = makeFingerprint({ sessionId: 'session_001', primary: 'fear' });

    await store.store('user_001', fp);

    const results = await store.querySimilar('user_001', fp.emotionalFingerprint, 5);

    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe('session_001');
    expect(results[0]!.emotionalFingerprint.primary).toBe('fear');
  });

  it('querySimilar returns emotionally similar sessions first', async () => {
    // Store three fingerprints with different emotions
    const fearFp = makeFingerprint({
      sessionId: 'fear_session',
      primary: 'fear',
      undertones: ['tension', 'dread'],
      contextCategory: 'career',
    });
    const sadFp = makeFingerprint({
      sessionId: 'sad_session',
      primary: 'sadness',
      undertones: ['loneliness', 'guilt'],
      contextCategory: 'relationship',
    });
    const fearFp2 = makeFingerprint({
      sessionId: 'fear_session_2',
      primary: 'fear',
      undertones: ['tension', 'urgency'],
      contextCategory: 'finance',
    });

    await store.store('user_001', fearFp);
    await store.store('user_001', sadFp);
    await store.store('user_001', fearFp2);

    // Query with fear-like fingerprint
    const queryFp: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const results = await store.querySimilar('user_001', queryFp, 3);

    expect(results.length).toBeGreaterThan(0);
    // First result should be the fear session (most similar)
    expect(results[0]!.emotionalFingerprint.primary).toBe('fear');
  });

  it('querySimilar only returns results for the specified user', async () => {
    const fp1 = makeFingerprint({ sessionId: 'session_a' });
    const fp2 = makeFingerprint({ sessionId: 'session_b' });

    await store.store('user_001', fp1);
    await store.store('user_002', fp2);

    const results = await store.querySimilar('user_001', fp1.emotionalFingerprint, 10);

    // Should only find user_001's session
    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe('session_a');
  });

  it('delete removes a specific session', async () => {
    const fp1 = makeFingerprint({ sessionId: 'session_keep' });
    const fp2 = makeFingerprint({ sessionId: 'session_delete' });

    await store.store('user_001', fp1);
    await store.store('user_001', fp2);

    await store.delete('user_001', 'session_delete');

    const results = await store.querySimilar('user_001', fp1.emotionalFingerprint, 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe('session_keep');
  });

  it('purgeUser removes all data for a user', async () => {
    const fp1 = makeFingerprint({ sessionId: 'session_1' });
    const fp2 = makeFingerprint({ sessionId: 'session_2' });

    await store.store('user_001', fp1);
    await store.store('user_001', fp2);

    await store.purgeUser('user_001');

    const results = await store.querySimilar('user_001', fp1.emotionalFingerprint, 10);
    expect(results).toHaveLength(0);
  });

  it('upsert replaces existing fingerprint for same session', async () => {
    const fp = makeFingerprint({ sessionId: 'session_001', primary: 'fear' });
    await store.store('user_001', fp);

    // Update same session with different emotion
    const updatedFp = makeFingerprint({ sessionId: 'session_001', primary: 'joy' });
    await store.store('user_001', updatedFp);

    const results = await store.querySimilar('user_001', updatedFp.emotionalFingerprint, 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.emotionalFingerprint.primary).toBe('joy');
  });

  it('querySimilar returns empty array when no matches', async () => {
    const fp: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension'],
      intensity: 0.5,
      contextCategory: 'career',
      relationalTone: 'open',
    };
    const results = await store.querySimilar('nonexistent_user', fp, 5);
    expect(results).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    // Store 5 sessions
    for (let i = 0; i < 5; i++) {
      const fp = makeFingerprint({ sessionId: `session_${i}`, intensity: 0.5 + i * 0.05 });
      await store.store('user_001', fp);
    }

    const queryFp: EmotionalFingerprint = {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.6,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    };

    const results = await store.querySimilar('user_001', queryFp, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
