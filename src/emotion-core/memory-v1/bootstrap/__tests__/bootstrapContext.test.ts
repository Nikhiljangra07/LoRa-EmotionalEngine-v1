import { buildBootstrapContext, BOOTSTRAP_CONTEXT_MAX_CHARS } from '../bootstrapContext';
import type { BootstrapMemoryState, BootstrapMemoryEntry } from '../bootstrapMemory';

const FORBIDDEN_PHRASES = [
  'I remember',
  'You told me',
  'You said earlier',
  'Previously you mentioned',
  'You mentioned before',
  'As you shared',
  'our relationship',
  'our bond',
  'our connection',
];

const MARKER_PATTERN = /\[[A-Z_]+:[A-Z0-9_]+\]/;

function makeState(entries: Partial<BootstrapMemoryEntry>[] = []): BootstrapMemoryState {
  return {
    version: 1,
    userId: 'test-user',
    entries: entries.map((e, i) => ({
      themes: e.themes ?? [`theme${i}`],
      role: e.role ?? 'user',
      emotionVec: e.emotionVec,
      eiv: e.eiv,
      sessionIndex: e.sessionIndex ?? 0,
      timestamp: e.timestamp ?? Date.now() + i,
    })),
    sessionCount: 1,
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
}

describe('buildBootstrapContext', () => {
  it('returns empty for null state', () => {
    expect(buildBootstrapContext(null)).toBe('');
  });

  it('returns empty for state with no entries', () => {
    expect(buildBootstrapContext(makeState())).toBe('');
  });

  it('includes emotional pattern line', () => {
    const state = makeState([
      { themes: ['good', 'today'], emotionVec: [0.5, 0.4, 0.3, 0.9] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('Recent emotional pattern:');
  });

  it('includes aggregated themes from entries', () => {
    const state = makeState([
      { themes: ['exercise', 'goal'] },
      { themes: ['exercise', 'fitness'] },
      { themes: ['running', 'exercise'] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('Themes noticed so far:');
    expect(result).toMatch(/exercise/i);
  });

  it('includes recent user themes section', () => {
    const state = makeState([
      { themes: ['tough', 'work'] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('Recent user themes:');
    expect(result).toContain('tough');
    expect(result).toContain('work');
  });

  it('does not contain raw user text', () => {
    const state = makeState([
      { themes: ['discipline', 'wake', 'earlier'] },
      { themes: ['exercise', 'morning'] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).not.toContain('I want to');
    expect(result).not.toContain('my goal');
  });

  it('output is bounded by BOOTSTRAP_CONTEXT_MAX_CHARS', () => {
    const entries: Partial<BootstrapMemoryEntry>[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        themes: [`topic${i}`, `subject${i}`, `area${i}`, `field${i}`, `domain${i}`],
      });
    }
    const result = buildBootstrapContext(makeState(entries));
    expect(result.length).toBeLessThanOrEqual(BOOTSTRAP_CONTEXT_MAX_CHARS);
  });

  it('does not contain forbidden recall phrases', () => {
    const state = makeState([
      { themes: ['exercise', 'goals'] },
      { themes: ['exercise', 'better'] },
    ]);
    const result = buildBootstrapContext(state);
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(result.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it('does not contain bracket markers', () => {
    const state = makeState([
      { themes: ['testing', 'output'] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).not.toMatch(MARKER_PATTERN);
  });

  it('derives positive trend from high-valence vectors', () => {
    const state = makeState([
      { themes: ['great', 'day'], emotionVec: [0.6, 0.5, 0.3, 0.9] },
      { themes: ['happy'], emotionVec: [0.7, 0.4, 0.3, 0.85] },
      { themes: ['wonderful', 'news'], emotionVec: [0.8, 0.6, 0.4, 0.9] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('generally upbeat');
  });

  it('derives negative trend from low-valence vectors', () => {
    const state = makeState([
      { themes: ['bad', 'day'], emotionVec: [-0.5, 0.3, 0.3, 0.9] },
      { themes: ['down'], emotionVec: [-0.6, 0.2, 0.2, 0.85] },
      { themes: ['sad', 'still'], emotionVec: [-0.4, 0.3, 0.3, 0.8] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('tending toward low mood');
  });

  it('derives mixed trend from high-spread valence', () => {
    const state = makeState([
      { themes: ['great', 'day'], emotionVec: [0.8, 0.5, 0.3, 0.9] },
      { themes: ['terrible', 'day'], emotionVec: [-0.5, 0.5, 0.3, 0.9] },
      { themes: ['great', 'again'], emotionVec: [0.7, 0.5, 0.3, 0.9] },
      { themes: ['awful', 'again'], emotionVec: [-0.4, 0.3, 0.3, 0.85] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('fluctuating');
  });
});
