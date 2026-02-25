export {};

const origFlag = process.env.LORA_STRICT_GUIDANCE_MODE;

const VALID_MODES = [
  'CALM_NEUTRAL',
  'ENERGY_MATCH',
  'VALIDATING',
  'DE_ESCALATE',
  'SUPPORTIVE',
  'FALLBACK',
  'STABILIZE',
  'SUPPORTIVE_REFLECTION',
] as const;

const minEmotionalState = { dominant: 'NEUTRAL' as const, arousal: 'LOW' as const, valence: 'NEUTRAL' as const, confidence: 1 };
const minETVState = { value: 0.5, sessionEIVs: [] as number[], messageCount: 0, lastUpdated: 0 };

describe('GuidanceMode strict guard', () => {
  afterEach(() => {
    if (origFlag === undefined) delete process.env.LORA_STRICT_GUIDANCE_MODE;
    else process.env.LORA_STRICT_GUIDANCE_MODE = origFlag;
    jest.resetModules();
  });

  // A) Strict flag ON → invalid mode throws
  test('throws on invalid guidanceMode when LORA_STRICT_GUIDANCE_MODE=1', () => {
    process.env.LORA_STRICT_GUIDANCE_MODE = '1';
    jest.resetModules();

    const { PromptTemplateBuilder } = require('../PromptTemplateBuilder');

    expect(() =>
      PromptTemplateBuilder.build(minEmotionalState, minETVState, {
        guidanceMode: 'TOTALLY_INVALID' as any,
      }),
    ).toThrow('[STRICT_MODE] Unknown guidanceMode: TOTALLY_INVALID');
  });

  // B) Strict flag OFF → invalid mode does NOT throw
  test('does NOT throw on invalid guidanceMode when flag is off', () => {
    delete process.env.LORA_STRICT_GUIDANCE_MODE;
    jest.resetModules();

    const { PromptTemplateBuilder } = require('../PromptTemplateBuilder');

    expect(() =>
      PromptTemplateBuilder.build(minEmotionalState, minETVState, {
        guidanceMode: 'TOTALLY_INVALID' as any,
      }),
    ).not.toThrow();
  });

  // C) All valid modes pass under strict mode
  test.each(VALID_MODES)('valid mode %s does not throw under strict mode', (mode) => {
    process.env.LORA_STRICT_GUIDANCE_MODE = '1';
    jest.resetModules();

    const { PromptTemplateBuilder } = require('../PromptTemplateBuilder');

    expect(() =>
      PromptTemplateBuilder.build(minEmotionalState, minETVState, {
        guidanceMode: mode,
      }),
    ).not.toThrow();
  });

  // D) Undefined guidanceMode does not throw under strict mode
  test('undefined guidanceMode does not throw under strict mode', () => {
    process.env.LORA_STRICT_GUIDANCE_MODE = '1';
    jest.resetModules();

    const { PromptTemplateBuilder } = require('../PromptTemplateBuilder');

    expect(() =>
      PromptTemplateBuilder.build(minEmotionalState, minETVState),
    ).not.toThrow();

    expect(() =>
      PromptTemplateBuilder.build(minEmotionalState, minETVState, {}),
    ).not.toThrow();
  });
});
