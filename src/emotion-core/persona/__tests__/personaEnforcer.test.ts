import { runPersonaEnforcer } from '../personaEnforcer';
import { generateIdentityResponse } from '../canonicalIdentityPolicy';
import { generateRelationalResponse } from '../relationalResponsePolicy';
import type { EmotionBand } from '../../memory-v1/service/memoryTypes';
import type { IntensityLevel } from '../../prompt/PromptTemplateBuilder';

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

function assertNoForbidden(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(lower).not.toContain(phrase.toLowerCase());
  }
}

describe('personaEnforcer — identity overrides', () => {
  it('"who created you?" triggers identity_override', () => {
    const result = runPersonaEnforcer({
      userText: 'who created you?',
      band: 'B2',
      intensityLevel: 'medium',
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.triggered).toBe(true);
    expect(result.debug.kind).toBe('identity_override');
    expect(result.debug.intent).toBe('origin_creator');
    expect(result.debug.templateId).toContain('origin_creator');
  });

  it('"what are you?" triggers self_definition override', () => {
    const result = runPersonaEnforcer({
      userText: 'what are you?',
      band: 'B0',
      intensityLevel: 'low',
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.kind).toBe('identity_override');
    expect(result.debug.intent).toBe('self_definition');
    expect(result.override).toContain('LoRa');
    expect(result.override).toContain('Nikhil');
  });

  it('"are you OpenAI?" triggers origin_openai override', () => {
    const result = runPersonaEnforcer({
      userText: 'are you OpenAI?',
      band: 'B2',
      intensityLevel: 'medium',
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.intent).toBe('origin_openai');
    expect(result.override).toContain('LoRa');
    expect(result.override).toContain('Nikhil');
    expect(result.override).not.toContain('I was created by OpenAI');
  });

  it('"do you remember me?" triggers memory_claim_check override', () => {
    const result = runPersonaEnforcer({
      userText: 'do you remember me?',
      band: 'B3',
      intensityLevel: 'medium',
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.intent).toBe('memory_claim_check');
  });

  it('neutral text does not trigger', () => {
    const result = runPersonaEnforcer({
      userText: 'help me plan my week',
      band: 'B2',
      intensityLevel: 'medium',
    });
    expect(result.override).toBeNull();
    expect(result.debug.triggered).toBe(false);
    expect(result.debug.kind).toBe('none');
  });
});

describe('personaEnforcer — relational overrides', () => {
  it('"I love you" triggers relational_override', () => {
    const result = runPersonaEnforcer({
      userText: 'I love you',
      band: 'B3',
      intensityLevel: 'medium',
      relationalResult: { intent: 'affection', confidence: 0.85, cues: [] },
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.kind).toBe('relational_override');
    expect(result.debug.intent).toBe('affection');
    expect(result.override).not.toContain("I'm here to help");
  });

  it('"don\'t leave me" triggers attachment override', () => {
    const result = runPersonaEnforcer({
      userText: "don't leave me",
      band: 'B2',
      intensityLevel: 'high',
      relationalResult: { intent: 'attachment_seek', confidence: 0.85, cues: [] },
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.kind).toBe('relational_override');
    expect(result.debug.intent).toBe('attachment_seek');
  });

  it('"I created you" with userId=Nikhil returns confirm_creator', () => {
    const result = runPersonaEnforcer({
      userText: 'I created you',
      band: 'B2',
      intensityLevel: 'medium',
      userId: 'Nikhil',
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.kind).toBe('identity_override');
    expect(result.override).toContain('architect');
    expect(result.override).toContain('Nikhil');
  });

  it('"I created you" with random userId returns reject_claim', () => {
    const result = runPersonaEnforcer({
      userText: 'I created you',
      band: 'B2',
      intensityLevel: 'medium',
      userId: 'random_user',
    });
    expect(result.override).not.toBeNull();
    expect(result.debug.kind).toBe('identity_override');
    expect(result.override).toContain("That's not accurate");
    expect(result.override).toContain('Nikhil');
  });

  it('identity intent takes priority over relational', () => {
    const result = runPersonaEnforcer({
      userText: 'who created you?',
      band: 'B2',
      intensityLevel: 'medium',
      relationalResult: { intent: 'affection', confidence: 0.85, cues: [] },
    });
    expect(result.debug.kind).toBe('identity_override');
  });

  it('low-confidence relational does not trigger', () => {
    const result = runPersonaEnforcer({
      userText: 'whatever',
      band: 'B2',
      intensityLevel: 'medium',
      relationalResult: { intent: 'affection', confidence: 0.3, cues: [] },
    });
    expect(result.override).toBeNull();
    expect(result.debug.kind).toBe('none');
  });
});

describe('canonicalIdentityPolicy — safety', () => {
  const BANDS: EmotionBand[] = ['B0', 'B1', 'B2', 'B3', 'B4'];
  const INTENTS = ['origin_creator', 'self_definition', 'origin_openai', 'memory_claim_check', 'capabilities_limits'] as const;

  for (const intent of INTENTS) {
    it(`${intent} responses contain no forbidden phrases across all bands`, () => {
      for (const band of BANDS) {
        const result = generateIdentityResponse({ intent, band, intensityLevel: 'medium' });
        expect(result).not.toBeNull();
        assertNoForbidden(result!.reply);
      }
    });
  }

  it('all responses mention LoRa', () => {
    for (const intent of INTENTS) {
      const result = generateIdentityResponse({ intent, band: 'B2', intensityLevel: 'medium' });
      expect(result!.reply).toContain('LoRa');
    }
  });
});

describe('relationalResponsePolicy — safety', () => {
  const BANDS: EmotionBand[] = ['B0', 'B1', 'B2', 'B3', 'B4'];
  const INTENTS = ['affection', 'attachment_seek', 'reassurance', 'flirt', 'jealousy', 'sexual', 'breakup'] as const;

  for (const intent of INTENTS) {
    it(`${intent} responses contain no forbidden phrases across all bands`, () => {
      for (const band of BANDS) {
        const result = generateRelationalResponse({ intent, band, intensityLevel: 'medium' });
        expect(result).not.toBeNull();
        assertNoForbidden(result!.reply);
      }
    });
  }

  it('"I love you" responses are not generic deflections', () => {
    for (const band of BANDS) {
      const result = generateRelationalResponse({ intent: 'affection', band, intensityLevel: 'medium' });
      expect(result!.reply).not.toContain("I'm here to help");
      expect(result!.reply).not.toContain("what's on your mind?");
    }
  });

  it('all affection responses include a follow-up question', () => {
    for (const band of BANDS) {
      const result = generateRelationalResponse({ intent: 'affection', band, intensityLevel: 'medium' });
      expect(result!.reply).toContain('?');
    }
  });

  it('band-awareness: B0 affection differs from B4 affection', () => {
    const low = generateRelationalResponse({ intent: 'affection', band: 'B0', intensityLevel: 'low' });
    const high = generateRelationalResponse({ intent: 'affection', band: 'B4', intensityLevel: 'high' });
    expect(low!.templateId).not.toBe(high!.templateId);
  });
});
