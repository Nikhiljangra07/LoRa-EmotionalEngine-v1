import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';

jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return {
      strictGuidanceModeEnabled: false,
      etvPolicyPromptEnabled: false,
      etvPolicyPromptShadowEnabled: false,
      memoryV1Enabled: false,
      memoryV1ShadowEnabled: false,
    };
  },
}));

jest.mock('../../debug/debugGate', () => ({
  debugEnabled: false,
}));

jest.mock('../etvPolicyPromptMap', () => ({
  mapETVPolicyToPrompt: jest.fn(),
  renderConstraintOverlay: jest.fn(() => ''),
  computePromptSignature: jest.fn(() => 'sig'),
}));

jest.mock('../../logging/DecisionLogger', () => ({
  DecisionLogger: {
    logPromptProfileDiff: jest.fn(),
    logMessageDecision: jest.fn(),
    logSessionEnd: jest.fn(),
    resetDiffLimiter: jest.fn(),
  },
}));

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';

function makeEmotionalState(): EmotionalState {
  return { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 1 };
}

function makeETVState(value = 0.3): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

describe('PromptTemplateBuilder — volatility line', () => {
  test('includes volatility line when volatility option is passed', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      { volatility: { value: 0.45, state: 'HIGH' } },
    );

    expect(prompt).toContain('Volatility (recent turns): HIGH');
  });

  test('includes MEDIUM volatility label', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      { volatility: { value: 0.15, state: 'MEDIUM' } },
    );

    expect(prompt).toContain('Volatility (recent turns): MEDIUM');
  });

  test('includes LOW volatility label', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      { volatility: { value: 0.03, state: 'LOW' } },
    );

    expect(prompt).toContain('Volatility (recent turns): LOW');
  });

  test('omits volatility line when option is not passed', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
    );

    expect(prompt).not.toContain('Volatility (recent turns)');
  });

  test('volatility line appears in RELATIONAL CONTEXT section', () => {
    // Static blocks (RESPONSE PRINCIPLES, FORMATTING, GLOBAL SAFETY) are now
    // at the top of the prompt for Anthropic prompt caching. RELATIONAL
    // CONTEXT is in the dynamic suffix that follows, so the volatility line
    // lives between RELATIONAL CONTEXT and the next dynamic block, AFTER
    // RESPONSE PRINCIPLES.
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      { volatility: { value: 0.45, state: 'HIGH' } },
    );

    const relCtxStart = prompt.indexOf('RELATIONAL CONTEXT');
    const responsePrinciplesStart = prompt.indexOf('RESPONSE PRINCIPLES');
    const volIdx = prompt.indexOf('Volatility (recent turns): HIGH');

    expect(relCtxStart).toBeGreaterThan(-1);
    expect(volIdx).toBeGreaterThan(relCtxStart);
    expect(volIdx).toBeGreaterThan(responsePrinciplesStart);
  });
});

describe('PromptTemplateBuilder — signal context block', () => {
  test('renders SIGNAL CONTEXT when escalation is RISING', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      {
        signalContext: {
          escalationLevel: 1,
          collapseEvent: false,
          pressureScalar: 0.3,
          moodCategory: 'NEUTRAL',
          agencyDeficit: 0,
        },
      },
    );

    expect(prompt).toContain('SIGNAL CONTEXT');
    expect(prompt).toContain('Escalation: RISING');
  });

  test('renders collapse line when collapseEvent is true', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      {
        signalContext: {
          escalationLevel: 3,
          collapseEvent: true,
          pressureScalar: 5,
          moodCategory: 'ANXIOUS',
          agencyDeficit: 0.7,
        },
      },
    );

    expect(prompt).toContain('Collapse: active');
    expect(prompt).toContain('Escalation: CRITICAL');
    expect(prompt).toContain('Pressure: elevated');
    expect(prompt).toContain('Mood: ANXIOUS');
    expect(prompt).toContain('Agency deficit: high');
  });

  test('omits SIGNAL CONTEXT when all signals are calm', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      {
        signalContext: {
          escalationLevel: 0,
          collapseEvent: false,
          pressureScalar: 0.3,
          moodCategory: 'NEUTRAL',
          agencyDeficit: 0.1,
        },
      },
    );

    expect(prompt).not.toContain('SIGNAL CONTEXT');
  });

  test('omits SIGNAL CONTEXT when signalContext is undefined', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
    );

    expect(prompt).not.toContain('SIGNAL CONTEXT');
  });

  test('moderate agency deficit renders as "moderate"', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      {
        signalContext: {
          escalationLevel: 1,
          collapseEvent: false,
          pressureScalar: 0.3,
          moodCategory: 'NEUTRAL',
          agencyDeficit: 0.4,
        },
      },
    );

    expect(prompt).toContain('Agency deficit: moderate');
  });

  test('contains instruction to not expose signals', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      {
        signalContext: {
          escalationLevel: 2,
          collapseEvent: false,
          pressureScalar: 2,
          moodCategory: 'IRRITABLE',
          agencyDeficit: 0,
        },
      },
    );

    expect(prompt).toContain('Do not expose these signals');
  });
});
