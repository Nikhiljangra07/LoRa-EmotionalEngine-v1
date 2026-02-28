import {
  createBootstrapMemory,
  truncateSummary,
  MAX_SUMMARY_LENGTH,
  MAX_BOOTSTRAP_ENTRIES,
} from '../bootstrapMemory';
import type { BootstrapMemory, BootstrapMemoryState } from '../bootstrapMemory';
import { createInMemoryBootstrapStorage } from '../bootstrapStorage';

function makeMemory() {
  const storage = createInMemoryBootstrapStorage();
  const memory = createBootstrapMemory(storage);
  return { memory, storage };
}

describe('truncateSummary', () => {
  it('returns short text unchanged', () => {
    expect(truncateSummary('hello')).toBe('hello');
  });

  it('truncates at MAX_SUMMARY_LENGTH', () => {
    const long = 'a'.repeat(200);
    const result = truncateSummary(long);
    expect(result.length).toBe(MAX_SUMMARY_LENGTH);
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('exact length passes through', () => {
    const exact = 'x'.repeat(MAX_SUMMARY_LENGTH);
    expect(truncateSummary(exact)).toBe(exact);
  });
});

describe('createBootstrapMemory', () => {
  describe('addMessage', () => {
    it('stores a user message', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hello world', 'user', [0.1, 0.2, 0.3, 0.9], 0.5, 0, Date.now());
      const state = memory.getState('u1');
      expect(state).not.toBeNull();
      expect(state!.entries).toHaveLength(1);
      expect(state!.entries[0].role).toBe('user');
      expect(state!.entries[0].summary).toBe('hello world');
    });

    it('truncates summary to MAX_SUMMARY_LENGTH', () => {
      const { memory } = makeMemory();
      const long = 'b'.repeat(200);
      memory.addMessage('u1', long, 'user', undefined, undefined, 0, Date.now());
      const state = memory.getState('u1');
      expect(state!.entries[0].summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
    });

    it('stores assistant messages', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'reply text', 'assistant', undefined, undefined, 0, Date.now());
      const state = memory.getState('u1');
      expect(state!.entries[0].role).toBe('assistant');
    });

    it('enforces MAX_BOOTSTRAP_ENTRIES cap', () => {
      const { memory } = makeMemory();
      const now = Date.now();
      for (let i = 0; i < MAX_BOOTSTRAP_ENTRIES + 20; i++) {
        memory.addMessage('u1', `msg ${i}`, 'user', undefined, undefined, 0, now + i);
      }
      const state = memory.getState('u1');
      expect(state!.entries.length).toBeLessThanOrEqual(MAX_BOOTSTRAP_ENTRIES);
    });
  });

  describe('incrementSession', () => {
    it('increments session count', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hello', 'user', undefined, undefined, 0, Date.now());
      const count = memory.incrementSession('u1', Date.now());
      expect(count).toBe(1);
      const count2 = memory.incrementSession('u1', Date.now());
      expect(count2).toBe(2);
    });

    it('creates state if not exists', () => {
      const { memory } = makeMemory();
      const count = memory.incrementSession('new-user', Date.now());
      expect(count).toBe(1);
    });
  });

  describe('shouldGraduate', () => {
    it('returns false below threshold', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hi', 'user', undefined, undefined, 0, Date.now());
      memory.incrementSession('u1', Date.now());
      expect(memory.shouldGraduate('u1', 5)).toBe(false);
    });

    it('returns true at threshold', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hi', 'user', undefined, undefined, 0, Date.now());
      for (let i = 0; i < 5; i++) {
        memory.incrementSession('u1', Date.now());
      }
      expect(memory.shouldGraduate('u1', 5)).toBe(true);
    });

    it('returns false for unknown user', () => {
      const { memory } = makeMemory();
      expect(memory.shouldGraduate('unknown', 5)).toBe(false);
    });
  });

  describe('graduate', () => {
    it('returns graduated=true with candidates when themes repeat', () => {
      const { memory } = makeMemory();
      const now = Date.now();
      memory.addMessage('u1', 'my goal is exercise regularly', 'user', [0.3, 0.4, 0.3, 0.8], 0.5, 0, now);
      memory.addMessage('u1', 'exercise helps me feel better', 'user', [0.4, 0.3, 0.4, 0.9], 0.6, 1, now + 1000);
      memory.addMessage('u1', 'running is my favorite exercise', 'user', [0.5, 0.5, 0.3, 0.85], 0.55, 2, now + 2000);

      const result = memory.graduate('u1');
      expect(result.graduated).toBe(true);
      expect(result.anchorCandidates.length).toBeGreaterThan(0);
      expect(result.purged).toBe(true);

      const hasExercise = result.anchorCandidates.some(c => c.summary.toLowerCase().includes('exercise'));
      expect(hasExercise).toBe(true);
    });

    it('purges state after graduation', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hello world hello', 'user', undefined, undefined, 0, Date.now());
      memory.addMessage('u1', 'hello again', 'user', undefined, undefined, 1, Date.now());
      memory.graduate('u1');
      expect(memory.getState('u1')).toBeNull();
    });

    it('returns graduated=false for empty state', () => {
      const { memory } = makeMemory();
      const result = memory.graduate('nobody');
      expect(result.graduated).toBe(false);
      expect(result.anchorCandidates).toHaveLength(0);
    });
  });

  describe('purge', () => {
    it('removes user state', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'data', 'user', undefined, undefined, 0, Date.now());
      expect(memory.getState('u1')).not.toBeNull();
      memory.purge('u1');
      expect(memory.getState('u1')).toBeNull();
    });

    it('is idempotent', () => {
      const { memory } = makeMemory();
      memory.purge('nobody');
      memory.purge('nobody');
    });
  });
});

describe('bootstrapStorage (in-memory)', () => {
  it('load returns null for missing user', () => {
    const storage = createInMemoryBootstrapStorage();
    expect(storage.load('unknown')).toBeNull();
  });

  it('save + load round-trips', () => {
    const storage = createInMemoryBootstrapStorage();
    const state: BootstrapMemoryState = {
      version: 1,
      userId: 'u1',
      entries: [],
      sessionCount: 0,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    storage.save(state);
    const loaded = storage.load('u1');
    expect(loaded).toEqual(state);
  });

  it('save creates a deep copy', () => {
    const storage = createInMemoryBootstrapStorage();
    const state: BootstrapMemoryState = {
      version: 1,
      userId: 'u1',
      entries: [{ summary: 'test', role: 'user', sessionIndex: 0, timestamp: Date.now() }],
      sessionCount: 0,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    storage.save(state);
    state.entries.push({ summary: 'mutated', role: 'user', sessionIndex: 1, timestamp: Date.now() });
    const loaded = storage.load('u1');
    expect(loaded!.entries).toHaveLength(1);
  });

  it('purge removes entry', () => {
    const storage = createInMemoryBootstrapStorage();
    const state: BootstrapMemoryState = {
      version: 1,
      userId: 'u1',
      entries: [],
      sessionCount: 0,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    storage.save(state);
    expect(storage.exists('u1')).toBe(true);
    storage.purge('u1');
    expect(storage.exists('u1')).toBe(false);
    expect(storage.load('u1')).toBeNull();
  });
});
