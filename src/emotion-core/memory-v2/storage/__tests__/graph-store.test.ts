import type { FactAnchor } from '../../types';
import { FalkorGraphStore } from '../graph/falkor-adapter';

// ──────────────────────────────────────────────────────
// Mock ioredis — in-memory key-value store
// ──────────────────────────────────────────────────────

let store: Map<string, string>;
let sets: Map<string, Set<string>>;

function resetMockRedis() {
  store = new Map();
  sets = new Map();
}

// Pipeline collects commands and executes them in batch
class MockPipeline {
  private commands: Array<() => [null, unknown]> = [];

  set(key: string, value: string) {
    this.commands.push(() => {
      store.set(key, value);
      return [null, 'OK'];
    });
    return this;
  }

  get(key: string) {
    this.commands.push(() => {
      return [null, store.get(key) ?? null];
    });
    return this;
  }

  expire(_key: string, _seconds: number) {
    // TTL is a no-op in mock — we test pruning via timestamps
    this.commands.push(() => [null, 1]);
    return this;
  }

  sadd(key: string, ...members: string[]) {
    this.commands.push(() => {
      if (!sets.has(key)) sets.set(key, new Set());
      for (const m of members) sets.get(key)!.add(m);
      return [null, members.length];
    });
    return this;
  }

  async exec(): Promise<Array<[null, unknown]>> {
    return this.commands.map((cmd) => cmd());
  }
}

const mockRedis = {
  pipeline: () => new MockPipeline(),
  get: async (key: string) => store.get(key) ?? null,
  set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
  del: async (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
      if (store.has(k)) { store.delete(k); count++; }
      if (sets.has(k)) { sets.delete(k); count++; }
    }
    return count;
  },
  sadd: async (key: string, ...members: string[]) => {
    if (!sets.has(key)) sets.set(key, new Set());
    for (const m of members) sets.get(key)!.add(m);
    return members.length;
  },
  smembers: async (key: string) => {
    const s = sets.get(key);
    return s ? Array.from(s) : [];
  },
  scan: async (cursor: string, _match: string, pattern: string, _count: string, _n: number) => {
    // Simple scan mock: return all matching keys on first call, '0' cursor on second
    if (cursor !== '0') return ['0', []];
    const prefix = pattern.replace('*', '');
    const matching = Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    return ['0', matching];
  },
  quit: async () => 'OK',
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

// ── Test fixtures ──

const CAREER_ANCHORS: FactAnchor[] = [
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
    type: 'barrier',
    slot: 'financial_fear',
    value: 'income_loss_anxiety',
    confidence: 0.8,
    relationships: [],
  },
];

const BREAKUP_ANCHORS: FactAnchor[] = [
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
];

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('FalkorGraphStore', () => {
  let graphStore: FalkorGraphStore;

  beforeEach(() => {
    resetMockRedis();
    graphStore = new FalkorGraphStore({ client: mockRedis as never });
  });

  describe('storeAnchors', () => {
    it('stores anchors and tracks session ID', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);

      // Verify anchors stored
      const raw = store.get('lora:memory_v2:user_001:anchors:session_career');
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!) as FactAnchor[];
      expect(parsed).toHaveLength(3);
      expect(parsed[0]!.value).toBe('start_consulting_firm');

      // Verify session tracked
      const sessionSet = sets.get('lora:memory_v2:user_001:sessions');
      expect(sessionSet).toBeDefined();
      expect(sessionSet!.has('session_career')).toBe(true);
    });

    it('stores edge timestamps for relationships', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);

      // The goal→barrier BLOCKED_BY edge should have a timestamp
      const edgePattern = 'lora:memory_v2:user_001:edge_ts:';
      const edgeKeys = Array.from(store.keys()).filter((k) => k.startsWith(edgePattern));
      expect(edgeKeys.length).toBeGreaterThan(0);
    });
  });

  describe('getAnchorsForSessions', () => {
    it('retrieves anchors for specified sessions', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);
      await graphStore.storeAnchors('user_001', 'session_breakup', BREAKUP_ANCHORS);

      const result = await graphStore.getAnchorsForSessions('user_001', ['session_career']);

      expect(result).toHaveLength(3);
      expect(result.some((a) => a.value === 'start_consulting_firm')).toBe(true);
      expect(result.some((a) => a.value === 'three_year_relationship_ended')).toBe(false);
    });

    it('returns anchors from multiple sessions', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);
      await graphStore.storeAnchors('user_001', 'session_breakup', BREAKUP_ANCHORS);

      const result = await graphStore.getAnchorsForSessions(
        'user_001', ['session_career', 'session_breakup'],
      );

      expect(result).toHaveLength(5); // 3 career + 2 breakup
    });

    it('returns empty array for unknown sessions', async () => {
      const result = await graphStore.getAnchorsForSessions('user_001', ['nonexistent']);
      expect(result).toEqual([]);
    });

    it('returns empty array for empty sessionIds', async () => {
      const result = await graphStore.getAnchorsForSessions('user_001', []);
      expect(result).toEqual([]);
    });
  });

  describe('getUserGraph', () => {
    it('builds a graph snapshot from all stored anchors', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);

      const graph = await graphStore.getUserGraph('user_001');

      expect(graph.nodes.length).toBeGreaterThan(0);
      // Should have goal, person, barrier nodes
      expect(graph.nodes.some((n) => n.nodeType === 'Goal')).toBe(true);
      expect(graph.nodes.some((n) => n.nodeType === 'Person')).toBe(true);
      expect(graph.nodes.some((n) => n.nodeType === 'Barrier')).toBe(true);
    });

    it('includes edges from relationships', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);

      const graph = await graphStore.getUserGraph('user_001');

      expect(graph.edges.length).toBeGreaterThan(0);
      const blockedEdge = graph.edges.find((e) => e.edgeType === 'BLOCKED_BY');
      expect(blockedEdge).toBeDefined();
    });

    it('deduplicates nodes across sessions', async () => {
      // Store same barrier in two sessions
      const anchor1: FactAnchor[] = [
        { type: 'barrier', slot: 'financial_fear', value: 'income_loss_anxiety', confidence: 0.8, relationships: [] },
      ];
      const anchor2: FactAnchor[] = [
        { type: 'barrier', slot: 'financial_fear', value: 'income_loss_anxiety', confidence: 0.7, relationships: [] },
      ];

      await graphStore.storeAnchors('user_001', 'session_1', anchor1);
      await graphStore.storeAnchors('user_001', 'session_2', anchor2);

      const graph = await graphStore.getUserGraph('user_001');

      const barrierNodes = graph.nodes.filter(
        (n) => n.nodeType === 'Barrier' && n.label === 'income_loss_anxiety',
      );
      expect(barrierNodes).toHaveLength(1); // Deduplicated
    });

    it('returns empty graph for unknown user', async () => {
      const graph = await graphStore.getUserGraph('nonexistent');
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });
  });

  describe('pruneStaleEdges', () => {
    it('removes edges older than maxAgeDays', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);

      // Manually set edge timestamp to 100 days ago
      const edgeKeys = Array.from(store.keys()).filter(
        (k) => k.includes('edge_ts'),
      );
      const oldTimestamp = (Date.now() - 100 * 24 * 60 * 60 * 1000).toString();
      for (const key of edgeKeys) {
        store.set(key, oldTimestamp);
      }

      const pruned = await graphStore.pruneStaleEdges('user_001', 90);

      expect(pruned).toBeGreaterThan(0);
      // Edge keys should be removed
      const remainingEdgeKeys = Array.from(store.keys()).filter(
        (k) => k.includes('edge_ts'),
      );
      expect(remainingEdgeKeys).toHaveLength(0);
    });

    it('keeps edges newer than maxAgeDays', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);

      // Edges were just stored (timestamp = now), so 90-day prune should keep them
      const pruned = await graphStore.pruneStaleEdges('user_001', 90);
      expect(pruned).toBe(0);
    });

    it('returns 0 when no edges exist', async () => {
      const pruned = await graphStore.pruneStaleEdges('user_001', 90);
      expect(pruned).toBe(0);
    });
  });

  describe('purgeUser', () => {
    it('removes all data for a user', async () => {
      await graphStore.storeAnchors('user_001', 'session_career', CAREER_ANCHORS);
      await graphStore.storeAnchors('user_001', 'session_breakup', BREAKUP_ANCHORS);

      await graphStore.purgeUser('user_001');

      // Verify all keys are gone
      const userKeys = Array.from(store.keys()).filter(
        (k) => k.includes('user_001'),
      );
      const userSets = Array.from(sets.keys()).filter(
        (k) => k.includes('user_001'),
      );
      expect(userKeys).toHaveLength(0);
      expect(userSets).toHaveLength(0);
    });

    it('does not affect other users', async () => {
      await graphStore.storeAnchors('user_001', 'session_1', CAREER_ANCHORS);
      await graphStore.storeAnchors('user_002', 'session_2', BREAKUP_ANCHORS);

      await graphStore.purgeUser('user_001');

      // user_002's data should still exist
      const result = await graphStore.getAnchorsForSessions('user_002', ['session_2']);
      expect(result).toHaveLength(2);
    });

    it('is safe to call on nonexistent user', async () => {
      await expect(graphStore.purgeUser('nonexistent')).resolves.not.toThrow();
    });
  });
});
