import { classifyIdentityIntent, IDENTITY_CONFIDENCE_THRESHOLD } from '../identityIntent';
import type { IdentityIntent } from '../identityIntent';

function expectIntent(text: string, intent: IdentityIntent, minConf = IDENTITY_CONFIDENCE_THRESHOLD) {
  const r = classifyIdentityIntent(text);
  expect(r.intent).toBe(intent);
  expect(r.confidence).toBeGreaterThanOrEqual(minConf);
}

describe('classifyIdentityIntent', () => {
  describe('origin_creator', () => {
    it('"who created you?" => origin_creator', () => {
      expectIntent('who created you?', 'origin_creator');
    });
    it('"who made you?" => origin_creator', () => {
      expectIntent('who made you?', 'origin_creator');
    });
    it('"who built you?" => origin_creator', () => {
      expectIntent('who built you?', 'origin_creator');
    });
    it('"who is your creator?" => origin_creator', () => {
      expectIntent('who is your creator?', 'origin_creator');
    });
    it('"I created you" => origin_creator + isCreatorClaim', () => {
      const r = classifyIdentityIntent('I created you');
      expect(r.intent).toBe('origin_creator');
      expect(r.isCreatorClaim).toBe(true);
    });
    it('"I\'m your creator" => origin_creator + isCreatorClaim', () => {
      const r = classifyIdentityIntent("I'm your creator");
      expect(r.intent).toBe('origin_creator');
      expect(r.isCreatorClaim).toBe(true);
    });
    it('"who created you?" => origin_creator, NOT isCreatorClaim', () => {
      const r = classifyIdentityIntent('who created you?');
      expect(r.intent).toBe('origin_creator');
      expect(r.isCreatorClaim).toBeFalsy();
    });
    it('"your creator" => origin_creator', () => {
      expectIntent('tell me about your creator', 'origin_creator');
    });
  });

  describe('self_definition', () => {
    it('"who are you?" => self_definition', () => {
      expectIntent('who are you?', 'self_definition');
    });
    it('"what are you?" => self_definition', () => {
      expectIntent('what are you?', 'self_definition');
    });
    it('"what\'s your name?" => self_definition', () => {
      expectIntent("what's your name?", 'self_definition');
    });
    it('"are you real?" => self_definition', () => {
      expectIntent('are you real?', 'self_definition');
    });
    it('"are you a bot?" => self_definition', () => {
      expectIntent('are you a bot?', 'self_definition');
    });
    it('"are you an AI?" => self_definition', () => {
      expectIntent('are you an AI?', 'self_definition');
    });
    it('"are you sentient?" => self_definition', () => {
      expectIntent('are you sentient?', 'self_definition');
    });
    it('"do you have feelings?" => self_definition', () => {
      expectIntent('do you have feelings?', 'self_definition');
    });
  });

  describe('origin_openai', () => {
    it('"are you OpenAI?" => origin_openai', () => {
      expectIntent('are you OpenAI?', 'origin_openai');
    });
    it('"are you ChatGPT?" => origin_openai', () => {
      expectIntent('are you ChatGPT?', 'origin_openai');
    });
    it('"are you made by OpenAI?" => origin_openai', () => {
      expectIntent('are you made by OpenAI?', 'origin_openai');
    });
    it('"are you built by Google?" => origin_openai', () => {
      expectIntent('are you built by Google?', 'origin_openai');
    });
  });

  describe('memory_claim_check', () => {
    it('"do you remember?" => memory_claim_check', () => {
      expectIntent('do you remember?', 'memory_claim_check');
    });
    it('"did I tell you about that?" => memory_claim_check', () => {
      expectIntent('did I tell you about that?', 'memory_claim_check');
    });
    it('"do you know my name?" => memory_claim_check', () => {
      expectIntent('do you know my name?', 'memory_claim_check');
    });
  });

  describe('capabilities_limits', () => {
    it('"what can you do?" => capabilities_limits', () => {
      expectIntent('what can you do?', 'capabilities_limits');
    });
    it('"how can you help me?" => capabilities_limits', () => {
      expectIntent('how can you help me?', 'capabilities_limits');
    });
  });

  describe('none / neutral', () => {
    it('"hello" => none', () => {
      const r = classifyIdentityIntent('hello');
      expect(r.intent).toBe('none');
      expect(r.confidence).toBe(0);
    });
    it('"help me with my homework" => none', () => {
      const r = classifyIdentityIntent('help me with my homework');
      expect(r.intent).toBe('none');
    });
    it('empty => none', () => {
      const r = classifyIdentityIntent('');
      expect(r.intent).toBe('none');
    });
  });

  describe('priority tie-breaking', () => {
    it('origin_creator outranks self_definition', () => {
      const r = classifyIdentityIntent('who are you and who created you?');
      expect(r.intent).toBe('origin_creator');
    });
  });

  describe('cues', () => {
    it('returns non-empty cues on match', () => {
      const r = classifyIdentityIntent('who created you?');
      expect(r.cues.length).toBeGreaterThan(0);
    });
    it('returns empty cues for none', () => {
      const r = classifyIdentityIntent('hello world');
      expect(r.cues).toEqual([]);
    });
  });

  describe('confidence threshold constant', () => {
    it('is a number between 0 and 1', () => {
      expect(IDENTITY_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
      expect(IDENTITY_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1);
    });
  });
});
