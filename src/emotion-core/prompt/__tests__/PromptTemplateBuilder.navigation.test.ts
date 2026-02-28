import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';

const baseState: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'MEDIUM',
  valence: 'NEGATIVE',
  confidence: 0.7,
};

const etvState: ETVState = {
  value: 0.5,
  sessionEIVs: [],
  messageCount: 1,
  lastUpdated: Date.now(),
};

describe('PromptTemplateBuilder — navigation signals', () => {
  test('masked pressure appears in SIGNAL CONTEXT when set', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        maskedPressure: true,
      },
    });
    expect(prompt).toContain('Masked pressure: DETECTED');
  });

  test('masked pressure does NOT appear when false', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        maskedPressure: false,
      },
    });
    expect(prompt).not.toContain('Masked pressure');
  });

  test('masked pressure PERSISTENT appears when maskedPressurePersistent true', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        maskedPressure: true,
        maskedPressurePersistent: true,
      },
    });
    expect(prompt).toContain('Masked pressure: PERSISTENT');
    expect(prompt).not.toContain('Masked pressure: DETECTED');
  });

  test('masked pressure DETECTED (not PERSISTENT) when only single-turn', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        maskedPressure: true,
        maskedPressurePersistent: false,
      },
    });
    expect(prompt).toContain('Masked pressure: DETECTED');
    expect(prompt).not.toContain('Masked pressure: PERSISTENT');
  });

  test('volatility trend RISING appears in RELATIONAL CONTEXT', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        volatilityTrend: 'RISING',
      },
    });
    expect(prompt).toContain('Volatility trend: RISING');
  });

  test('volatility trend STABLE does NOT appear', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        volatilityTrend: 'STABLE',
      },
    });
    expect(prompt).not.toContain('Volatility trend');
  });

  test('gradient escalation state appears in SIGNAL CONTEXT', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 1,
        escalationState: 'TENSION',
        escalationTrend: 'UP',
      },
    });
    expect(prompt).toContain('Escalation: TENSION');
    expect(prompt).toContain('Escalation trend: UP');
  });

  test('CALM gradient state does not render escalation line', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 0,
        escalationState: 'CALM',
        escalationTrend: 'FLAT',
      },
    });
    expect(prompt).not.toContain('Escalation:');
    expect(prompt).not.toContain('Escalation trend:');
  });

  test('no raw numeric values leak into prompt for navigation signals', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 2,
        pressureScalar: 3.5,
        agencyDeficit: 0.7,
        maskedPressure: true,
        volatilityTrend: 'RISING',
        escalationState: 'ESCALATED',
        escalationTrend: 'UP',
      },
      volatility: { value: 0.35, state: 'HIGH' },
    });

    expect(prompt).not.toMatch(/\b0\.\d{2,}\b/);
    expect(prompt).not.toMatch(/\b3\.5\b/);
    expect(prompt).not.toMatch(/\b0\.7\b/);
    expect(prompt).not.toMatch(/\b0\.35\b/);
  });

  test('banned therapy phrases not present in navigation signals', () => {
    const prompt = PromptTemplateBuilder.build(baseState, etvState, {
      signalContext: {
        escalationLevel: 2,
        maskedPressure: true,
        escalationState: 'ESCALATED',
        escalationTrend: 'UP',
        volatilityTrend: 'RISING',
      },
    });

    const banned = [
      'It sounds like',
      "It's okay to feel",
      'I hear you',
      'That must be hard',
      'take a deep breath',
    ];
    for (const phrase of banned) {
      expect(prompt).not.toContain(phrase);
    }
  });
});
