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
      summary: e.summary ?? `entry ${i}`,
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
      { summary: 'feeling good today', emotionVec: [0.5, 0.4, 0.3, 0.9] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('Recent emotional pattern:');
  });

  it('includes themes when words repeat', () => {
    const state = makeState([
      { summary: 'exercise is my goal this week' },
      { summary: 'I want to exercise more often' },
      { summary: 'running and exercise help me' },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('Themes noticed so far:');
    expect(result).toMatch(/exercise/i);
  });

  it('includes recent topics section', () => {
    const state = makeState([
      { summary: 'I had a tough day at work' },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('Recent topics:');
    expect(result).toContain('tough day at work');
  });

  it('output is bounded by BOOTSTRAP_CONTEXT_MAX_CHARS', () => {
    const entries: Partial<BootstrapMemoryEntry>[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        summary: `This is a reasonably long entry about topic number ${i} with plenty of words to fill up space and test truncation behavior`,
      });
    }
    const result = buildBootstrapContext(makeState(entries));
    expect(result.length).toBeLessThanOrEqual(BOOTSTRAP_CONTEXT_MAX_CHARS);
  });

  it('does not contain forbidden recall phrases', () => {
    const state = makeState([
      { summary: 'user talked about exercise goals' },
      { summary: 'user mentioned feeling better after exercise' },
    ]);
    const result = buildBootstrapContext(state);
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(result.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it('does not contain bracket markers', () => {
    const state = makeState([
      { summary: 'testing output format' },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).not.toMatch(MARKER_PATTERN);
  });

  it('derives positive trend from high-valence vectors', () => {
    const state = makeState([
      { summary: 'great day', emotionVec: [0.6, 0.5, 0.3, 0.9] },
      { summary: 'feeling happy', emotionVec: [0.7, 0.4, 0.3, 0.85] },
      { summary: 'wonderful news', emotionVec: [0.8, 0.6, 0.4, 0.9] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('generally upbeat');
  });

  it('derives negative trend from low-valence vectors', () => {
    const state = makeState([
      { summary: 'bad day', emotionVec: [-0.5, 0.3, 0.3, 0.9] },
      { summary: 'feeling down', emotionVec: [-0.6, 0.2, 0.2, 0.85] },
      { summary: 'still sad', emotionVec: [-0.4, 0.3, 0.3, 0.8] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('tending toward low mood');
  });

  it('derives mixed trend from high-spread valence', () => {
    const state = makeState([
      { summary: 'great day', emotionVec: [0.8, 0.5, 0.3, 0.9] },
      { summary: 'terrible day', emotionVec: [-0.5, 0.5, 0.3, 0.9] },
      { summary: 'great again', emotionVec: [0.7, 0.5, 0.3, 0.9] },
      { summary: 'awful again', emotionVec: [-0.4, 0.3, 0.3, 0.85] },
    ]);
    const result = buildBootstrapContext(state);
    expect(result).toContain('fluctuating');
  });
});
