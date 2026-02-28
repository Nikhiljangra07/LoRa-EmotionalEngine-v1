import {
  NarrativeStateEngine,
  extractTheme,
  computeTrajectory,
  containsConcreteEvent,
  selectStrategy,
  advancePhase,
  STRATEGY_MATRIX,
  PHASE_TURN_THRESHOLD,
} from '../NarrativeStateEngine';
import type {
  NarrativeStrategy,
  ConversationPhase,
  EmotionalTrajectory,
} from '../NarrativeStateEngine';

/* ================================================================
 * extractTheme
 * ================================================================ */
describe('extractTheme', () => {
  it('returns null for empty input', () => {
    expect(extractTheme([])).toBeNull();
  });

  it('returns null when no keywords match', () => {
    expect(extractTheme(['hello there', 'nice weather'])).toBeNull();
  });

  it('extracts "work" theme', () => {
    expect(extractTheme(['I have been overwhelmed at work'])).toBe('work');
  });

  it('extracts "mistake" theme', () => {
    expect(extractTheme(['I think I messed something up'])).toBe('mistake');
  });

  it('extracts "relationship" theme', () => {
    expect(extractTheme(['My partner and I had a fight'])).toBe('relationship');
  });

  it('extracts "health" theme', () => {
    expect(extractTheme(['I have been anxious and cannot sleep'])).toBe('health');
  });

  it('extracts "family" theme', () => {
    expect(extractTheme(['my mom and dad are fighting again'])).toBe('family');
  });

  it('extracts "loss" theme', () => {
    expect(extractTheme(['my friend died last month'])).toBe('loss');
  });

  it('selects the highest-scoring theme when multiple present', () => {
    const result = extractTheme([
      'I failed at my job and got fired',
      'my career is over and it was my mistake',
    ]);
    expect(result).toBe('work');
  });

  it('uses the full 3-turn window for accumulation', () => {
    const result = extractTheme([
      'I feel off today',
      'Been overwhelmed at work',
      'The deadlines at the office are killing me',
    ]);
    expect(result).toBe('work');
  });
});

/* ================================================================
 * computeTrajectory
 * ================================================================ */
describe('computeTrajectory', () => {
  it('returns stable for fewer than 2 values', () => {
    expect(computeTrajectory([])).toBe('stable');
    expect(computeTrajectory([0.5])).toBe('stable');
  });

  it('returns rising for strictly increasing EIV', () => {
    expect(computeTrajectory([0.3, 0.5, 0.7])).toBe('rising');
  });

  it('returns decreasing for strictly decreasing EIV', () => {
    expect(computeTrajectory([0.8, 0.5, 0.2])).toBe('decreasing');
  });

  it('returns stable for mixed EIV pattern', () => {
    expect(computeTrajectory([0.5, 0.7, 0.4])).toBe('stable');
  });

  it('returns stable for equal values', () => {
    expect(computeTrajectory([0.5, 0.5, 0.5])).toBe('stable');
  });

  it('uses only last 3 values from longer history', () => {
    expect(computeTrajectory([0.1, 0.2, 0.8, 0.5, 0.3])).toBe('decreasing');
  });

  it('handles 2-value window', () => {
    expect(computeTrajectory([0.3, 0.6])).toBe('rising');
    expect(computeTrajectory([0.6, 0.3])).toBe('decreasing');
    expect(computeTrajectory([0.5, 0.5])).toBe('stable');
  });
});

/* ================================================================
 * containsConcreteEvent
 * ================================================================ */
describe('containsConcreteEvent', () => {
  it('detects personal action verbs', () => {
    expect(containsConcreteEvent('I told my boss about it')).toBe(true);
    expect(containsConcreteEvent('I went to the store yesterday')).toBe(true);
    expect(containsConcreteEvent('I tried to fix it')).toBe(true);
  });

  it('detects time references', () => {
    expect(containsConcreteEvent('it happened yesterday')).toBe(true);
    expect(containsConcreteEvent('last week was terrible')).toBe(true);
    expect(containsConcreteEvent('this morning I woke up anxious')).toBe(true);
  });

  it('detects event verbs', () => {
    expect(containsConcreteEvent('something happened at work')).toBe(true);
    expect(containsConcreteEvent('I just realized something important')).toBe(true);
  });

  it('returns false for abstract statements', () => {
    expect(containsConcreteEvent('I feel off today')).toBe(true); // "today" is a time ref
    expect(containsConcreteEvent('I feel weird')).toBe(false);
    expect(containsConcreteEvent('things are hard')).toBe(false);
  });
});

/* ================================================================
 * selectStrategy
 * ================================================================ */
describe('selectStrategy', () => {
  it('follows the strategy matrix for opening phase', () => {
    expect(selectStrategy('opening', 'rising', 'exploration')).toBe('validation');
    expect(selectStrategy('opening', 'stable', 'exploration')).toBe('validation');
    expect(selectStrategy('opening', 'decreasing', 'exploration')).toBe('validation');
  });

  it('follows the strategy matrix for probing phase', () => {
    expect(selectStrategy('probing', 'rising', 'validation')).toBe('synthesis');
    expect(selectStrategy('probing', 'stable', 'validation')).toBe('exploration');
    expect(selectStrategy('probing', 'decreasing', 'validation')).toBe('reframing');
  });

  it('follows the strategy matrix for clarifying phase', () => {
    expect(selectStrategy('clarifying', 'rising', 'validation')).toBe('synthesis');
    expect(selectStrategy('clarifying', 'stable', 'validation')).toBe('clarification');
    expect(selectStrategy('clarifying', 'decreasing', 'validation')).toBe('grounding');
  });

  it('follows the strategy matrix for deepening phase', () => {
    expect(selectStrategy('deepening', 'rising', 'validation')).toBe('grounding');
    expect(selectStrategy('deepening', 'stable', 'validation')).toBe('reframing');
    expect(selectStrategy('deepening', 'decreasing', 'validation')).toBe('planning');
  });

  it('NEVER returns the same strategy as lastStrategy (anti-repeat)', () => {
    const phases: ConversationPhase[] = ['opening', 'probing', 'clarifying', 'deepening'];
    const trajectories: EmotionalTrajectory[] = ['rising', 'stable', 'decreasing'];
    const strategies: NarrativeStrategy[] = [
      'validation', 'exploration', 'synthesis', 'grounding', 'reframing', 'clarification', 'planning',
    ];

    for (const phase of phases) {
      for (const traj of trajectories) {
        for (const last of strategies) {
          const chosen = selectStrategy(phase, traj, last);
          expect(chosen).not.toBe(last);
        }
      }
    }
  });

  it('rotates to fallback when matrix would repeat', () => {
    expect(selectStrategy('opening', 'rising', 'validation')).not.toBe('validation');
    expect(selectStrategy('probing', 'rising', 'synthesis')).not.toBe('synthesis');
  });
});

/* ================================================================
 * advancePhase
 * ================================================================ */
describe('advancePhase', () => {
  it('stays in opening when turnsInPhase < threshold', () => {
    expect(advancePhase('opening', 1, false, false, 'stable')).toBe('opening');
  });

  it('advances from opening to probing after threshold turns', () => {
    expect(advancePhase('opening', PHASE_TURN_THRESHOLD, false, false, 'stable')).toBe('probing');
  });

  it('advances from probing to clarifying on concrete event', () => {
    expect(advancePhase('probing', 1, false, true, 'stable')).toBe('clarifying');
  });

  it('stays in probing without concrete event', () => {
    expect(advancePhase('probing', 5, false, false, 'stable')).toBe('probing');
  });

  it('advances from clarifying to deepening when rising + concrete event', () => {
    expect(advancePhase('clarifying', 1, false, true, 'rising')).toBe('deepening');
  });

  it('advances from clarifying to deepening after extended turns', () => {
    expect(advancePhase('clarifying', PHASE_TURN_THRESHOLD + 1, false, false, 'stable')).toBe('deepening');
  });

  it('stays in deepening (terminal phase)', () => {
    expect(advancePhase('deepening', 10, false, true, 'rising')).toBe('deepening');
  });

  it('resets to opening on theme change', () => {
    expect(advancePhase('deepening', 5, true, false, 'stable')).toBe('opening');
    expect(advancePhase('clarifying', 3, true, true, 'rising')).toBe('opening');
    expect(advancePhase('probing', 2, true, false, 'stable')).toBe('opening');
  });

  it('never jumps backward without theme change', () => {
    expect(advancePhase('probing', 1, false, false, 'stable')).toBe('probing');
    expect(advancePhase('clarifying', 1, false, false, 'decreasing')).toBe('clarifying');
    expect(advancePhase('deepening', 1, false, false, 'decreasing')).toBe('deepening');
  });
});

/* ================================================================
 * NarrativeStateEngine — integration
 * ================================================================ */
describe('NarrativeStateEngine', () => {
  let engine: NarrativeStateEngine;

  beforeEach(() => {
    engine = new NarrativeStateEngine();
  });

  it('starts in opening phase with stable trajectory', () => {
    const state = engine.getState();
    expect(state.currentPhase).toBe('opening');
    expect(state.emotionalTrajectory).toBe('stable');
    expect(state.dominantTheme).toBeNull();
    expect(state.lastStrategy).toBe('validation');
    expect(state.turnsInPhase).toBe(0);
  });

  it('extracts theme from user messages', () => {
    engine.advance({ userText: 'I have been overwhelmed at work', eiv: 0.5 });
    expect(engine.getState().dominantTheme).toBe('work');
  });

  it('detects rising trajectory from increasing EIV', () => {
    engine.advance({ userText: 'hello', eiv: 0.3 });
    engine.advance({ userText: 'I feel worse', eiv: 0.5 });
    engine.advance({ userText: 'much worse now', eiv: 0.7 });
    expect(engine.getState().emotionalTrajectory).toBe('rising');
  });

  it('detects decreasing trajectory from decreasing EIV', () => {
    engine.advance({ userText: 'hello', eiv: 0.8 });
    engine.advance({ userText: 'feeling better', eiv: 0.5 });
    engine.advance({ userText: 'much better', eiv: 0.3 });
    expect(engine.getState().emotionalTrajectory).toBe('decreasing');
  });

  it('advances from opening to probing after 2 turns', () => {
    engine.advance({ userText: 'I feel off', eiv: 0.5 });
    expect(engine.getState().currentPhase).toBe('opening');
    engine.advance({ userText: 'still feeling off', eiv: 0.5 });
    expect(engine.getState().currentPhase).toBe('opening');
    engine.advance({ userText: 'yes definitely off', eiv: 0.5 });
    expect(engine.getState().currentPhase).toBe('probing');
  });

  it('advances to clarifying when concrete event detected in probing', () => {
    engine.advance({ userText: 'work is hard', eiv: 0.5 });
    engine.advance({ userText: 'work is really hard', eiv: 0.5 });
    engine.advance({ userText: 'work is terrible', eiv: 0.5 });
    expect(engine.getState().currentPhase).toBe('probing');

    engine.advance({ userText: 'I told my boss yesterday', eiv: 0.6 });
    expect(engine.getState().currentPhase).toBe('clarifying');
  });

  it('never repeats strategy consecutively', () => {
    const strategies: NarrativeStrategy[] = [];
    const messages = [
      'I feel off today',
      'been overwhelmed at work',
      'I think I messed something important up',
      'I told my boss about it yesterday',
      'he got really upset',
      'I realized it was my fault',
      'it happened last week actually',
      'I tried to fix it but failed',
    ];

    for (let i = 0; i < messages.length; i++) {
      const state = engine.advance({ userText: messages[i], eiv: 0.3 + i * 0.05 });
      strategies.push(state.lastStrategy);
    }

    for (let i = 1; i < strategies.length; i++) {
      expect(strategies[i]).not.toBe(strategies[i - 1]);
    }
  });

  it('resets phase to opening when theme changes', () => {
    engine.advance({ userText: 'work is stressful', eiv: 0.5 });
    engine.advance({ userText: 'my boss is difficult', eiv: 0.5 });
    engine.advance({ userText: 'job pressure is mounting', eiv: 0.5 });
    expect(engine.getState().currentPhase).toBe('probing');
    expect(engine.getState().dominantTheme).toBe('work');

    engine.advance({ userText: 'actually my relationship is what hurts', eiv: 0.6 });
    engine.advance({ userText: 'my partner and I are heading for divorce', eiv: 0.6 });
    expect(engine.getState().dominantTheme).toBe('relationship');
    expect(engine.getState().currentPhase).toBe('opening');
  });

  it('toMomentumBlock() returns correct structure', () => {
    engine.advance({ userText: 'work is hard', eiv: 0.5 });
    const block = engine.toMomentumBlock();
    expect(block).toEqual({
      dominantTheme: 'work',
      emotionalTrajectory: 'stable',
      currentPhase: 'opening',
      suggestedStrategy: expect.any(String),
    });
  });

  it('reset() clears all state', () => {
    engine.advance({ userText: 'work is hard', eiv: 0.5 });
    engine.advance({ userText: 'very hard', eiv: 0.7 });
    engine.reset();

    const state = engine.getState();
    expect(state.dominantTheme).toBeNull();
    expect(state.currentPhase).toBe('opening');
    expect(state.emotionalTrajectory).toBe('stable');
    expect(state.turnsInPhase).toBe(0);
  });

  describe('full scenario: "feel off" → "overwhelmed at work" → "messed something up"', () => {
    it('progresses through phases with correct momentum', () => {
      const s1 = engine.advance({ userText: "I don't know why but I feel off today", eiv: 0.4 });
      expect(s1.currentPhase).toBe('opening');
      expect(s1.emotionalTrajectory).toBe('stable');

      const s2 = engine.advance({ userText: "I've been overwhelmed at work", eiv: 0.55 });
      expect(s2.dominantTheme).toBe('work');
      expect(s2.currentPhase).toBe('opening');

      const s3 = engine.advance({ userText: 'I think I messed something important up', eiv: 0.65 });
      expect(s3.emotionalTrajectory).toBe('rising');
      expect(s3.dominantTheme).not.toBeNull();
      expect(s3.currentPhase).toBe('probing');

      expect(s1.lastStrategy).not.toBe(s2.lastStrategy);
      expect(s2.lastStrategy).not.toBe(s3.lastStrategy);
    });
  });
});

/* ================================================================
 * STRATEGY_MATRIX completeness
 * ================================================================ */
describe('STRATEGY_MATRIX completeness', () => {
  const phases: ConversationPhase[] = ['opening', 'probing', 'clarifying', 'deepening'];
  const trajectories: EmotionalTrajectory[] = ['rising', 'stable', 'decreasing'];

  it('has an entry for every phase × trajectory combination', () => {
    for (const phase of phases) {
      expect(STRATEGY_MATRIX[phase]).toBeDefined();
      for (const traj of trajectories) {
        expect(STRATEGY_MATRIX[phase][traj]).toBeDefined();
        expect(typeof STRATEGY_MATRIX[phase][traj]).toBe('string');
      }
    }
  });
});
