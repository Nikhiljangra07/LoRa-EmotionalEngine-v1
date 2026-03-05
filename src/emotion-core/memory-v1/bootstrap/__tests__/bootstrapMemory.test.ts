import {
  createBootstrapMemory,
  extractMessageThemes,
  MAX_THEMES_PER_MESSAGE,
  MAX_BOOTSTRAP_ENTRIES,
} from '../bootstrapMemory';
import type { BootstrapMemory, BootstrapMemoryState } from '../bootstrapMemory';
import { createInMemoryBootstrapStorage } from '../bootstrapStorage';

function makeMemory() {
  const storage = createInMemoryBootstrapStorage();
  const memory = createBootstrapMemory(storage);
  return { memory, storage };
}

describe('extractMessageThemes', () => {
  it('extracts key tokens from text', () => {
    const themes = extractMessageThemes('I want to improve my discipline and wake up earlier');
    expect(themes).toContain('improve');
    expect(themes).toContain('discipline');
    expect(themes).toContain('wake');
    expect(themes).toContain('earlier');
  });

  it('filters stopwords', () => {
    const themes = extractMessageThemes('I want to be a better person');
    expect(themes).not.toContain('want');
    expect(themes).not.toContain('be');
    expect(themes).toContain('better');
    expect(themes).toContain('person');
  });

  it('returns at most MAX_THEMES_PER_MESSAGE tokens', () => {
    const themes = extractMessageThemes(
      'discipline fitness productivity career education meditation strategy planning goals tracking',
    );
    expect(themes.length).toBeLessThanOrEqual(MAX_THEMES_PER_MESSAGE);
  });

  it('returns empty array for stopword-only input', () => {
    const themes = extractMessageThemes('I am the way it is');
    expect(themes).toHaveLength(0);
  });

  it('deduplicates tokens', () => {
    const themes = extractMessageThemes('exercise exercise exercise running');
    expect(themes.filter(t => t === 'exercise')).toHaveLength(1);
  });
});

describe('createBootstrapMemory', () => {
  describe('addMessage', () => {
    it('stores extracted themes instead of raw text', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hello world test message', 'user', [0.1, 0.2, 0.3, 0.9], 0.5, 0, Date.now());
      const state = memory.getState('u1');
      expect(state).not.toBeNull();
      expect(state!.entries).toHaveLength(1);
      expect(state!.entries[0].role).toBe('user');
      expect(state!.entries[0].themes).toBeInstanceOf(Array);
      expect(state!.entries[0]).not.toHaveProperty('summary');
    });

    it('does not store raw message text', () => {
      const { memory } = makeMemory();
      const rawMessage = 'I want to improve my discipline and wake up earlier every morning';
      memory.addMessage('u1', rawMessage, 'user', undefined, undefined, 0, Date.now());
      const state = memory.getState('u1');
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain(rawMessage);
      expect(serialized).not.toContain('I want to improve');
    });

    it('stores assistant message themes', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'consider your strategy carefully', 'assistant', undefined, undefined, 0, Date.now());
      const state = memory.getState('u1');
      expect(state!.entries[0].role).toBe('assistant');
      expect(state!.entries[0].themes).toBeInstanceOf(Array);
    });

    it('enforces MAX_BOOTSTRAP_ENTRIES cap', () => {
      const { memory } = makeMemory();
      const now = Date.now();
      for (let i = 0; i < MAX_BOOTSTRAP_ENTRIES + 20; i++) {
        memory.addMessage('u1', `topic number ${i} discussion`, 'user', undefined, undefined, 0, now + i);
      }
      const state = memory.getState('u1');
      expect(state!.entries.length).toBeLessThanOrEqual(MAX_BOOTSTRAP_ENTRIES);
    });
  });

  describe('incrementSession', () => {
    it('increments session count', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hello world', 'user', undefined, undefined, 0, Date.now());
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
      memory.addMessage('u1', 'hello there', 'user', undefined, undefined, 0, Date.now());
      memory.incrementSession('u1', Date.now());
      expect(memory.shouldGraduate('u1', 5)).toBe(false);
    });

    it('returns true at threshold', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'hello there', 'user', undefined, undefined, 0, Date.now());
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

      const allThemes = result.anchorCandidates.flatMap(c => c.themes);
      expect(allThemes).toContain('exercise');
    });

    it('purges state after graduation', () => {
      const { memory } = makeMemory();
      memory.addMessage('u1', 'exercise running fitness', 'user', undefined, undefined, 0, Date.now());
      memory.addMessage('u1', 'exercise running daily', 'user', undefined, undefined, 1, Date.now());
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
      memory.addMessage('u1', 'some data here', 'user', undefined, undefined, 0, Date.now());
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
      entries: [{ themes: ['test'], role: 'user', sessionIndex: 0, timestamp: Date.now() }],
      sessionCount: 0,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    storage.save(state);
    state.entries.push({ themes: ['mutated'], role: 'user', sessionIndex: 1, timestamp: Date.now() });
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
