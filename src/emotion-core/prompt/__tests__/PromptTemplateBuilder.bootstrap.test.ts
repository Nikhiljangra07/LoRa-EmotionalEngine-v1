import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import { BOOTSTRAP_CONTEXT_MAX_CHARS } from '../../memory-v1/bootstrap/bootstrapContext';

const FORBIDDEN_PHRASES = [
  'I remember',
  'You told me',
  'You said earlier',
  'Previously you mentioned',
];

const MARKER_PATTERN = /\[[A-Z_]+:[A-Z0-9_]+\]/;

const emotionalState = {
  dominant: 'NEUTRAL' as const,
  arousal: 'LOW' as const,
  valence: 'NEUTRAL' as const,
  sentiment: { label: 'neutral', score: 0 },
  stressLevel: 0,
  emotionalDepth: 0.5,
  confidence: 0.9,
};
const etvState = { value: 0.5, sessionEIVs: [] as number[], messageCount: 1, lastUpdated: Date.now() };

describe('PromptTemplateBuilder — BOOTSTRAP CONTEXT block', () => {
  it('appears in prompt when bootstrapContext is provided', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: 'Themes noticed so far: exercise, running.\nRecent emotional pattern: generally upbeat.',
      band: 'B2',
      eiv: 0.4,
    });

    expect(prompt).toContain('BOOTSTRAP CONTEXT');
    expect(prompt).toContain('exercise');
    expect(prompt).toContain('generally upbeat');
  });

  it('does NOT appear when bootstrapContext is undefined', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      band: 'B2',
      eiv: 0.4,
    });

    expect(prompt).not.toContain('BOOTSTRAP CONTEXT');
  });

  it('does NOT appear when bootstrapContext is empty string', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: '',
      band: 'B2',
      eiv: 0.4,
    });

    expect(prompt).not.toContain('BOOTSTRAP CONTEXT');
  });

  it('does NOT appear when bootstrapContext is whitespace-only', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: '   \n  ',
      band: 'B2',
      eiv: 0.4,
    });

    expect(prompt).not.toContain('BOOTSTRAP CONTEXT');
  });

  it('the block does not contain forbidden recall phrases', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: 'Themes noticed so far: goals, wellness.\nRecent emotional pattern: neutral.',
      band: 'B3',
      eiv: 0.5,
    });

    for (const phrase of FORBIDDEN_PHRASES) {
      expect(prompt.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it('the block does not add bracket markers', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: 'Themes noticed so far: testing.\nRecent emotional pattern: steady.',
      band: 'B2',
      eiv: 0.4,
    });

    const bootstrapSection = prompt.split('BOOTSTRAP CONTEXT')[1]?.split('\n\n')[0] ?? '';
    expect(bootstrapSection).not.toMatch(MARKER_PATTERN);
  });

  it('BOOTSTRAP CONTEXT is placed after FACT CONTEXT block area', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: 'Themes: exercise.',
      band: 'B2',
      eiv: 0.4,
    });

    const constraintsIdx = prompt.indexOf('GLOBAL CONSTRAINTS');
    const bootstrapIdx = prompt.indexOf('BOOTSTRAP CONTEXT');
    expect(constraintsIdx).toBeGreaterThan(-1);
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(bootstrapIdx).toBeGreaterThan(constraintsIdx);
  });

  it('coexists with FACT CONTEXT when both provided', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      bootstrapContext: 'Themes: exercise.',
      relevantAnchors: [{
        anchorId: 'a1',
        contentSummary: 'User values fitness',
        timestamp: Date.now(),
        emotion: { valence: 0.5, arousal: 0.3, expressionStrength: 0.4, inferenceReliability: 0.9 },
        metrics: { band: 'B3', etv: 0.6, eiv: 0.5 },
      }],
      band: 'B3',
      eiv: 0.5,
    });

    expect(prompt).toContain('FACT CONTEXT');
    expect(prompt).toContain('BOOTSTRAP CONTEXT');
  });
});
