import { classifyRelationalIntent } from '../relationalIntent';
import type { RelationalIntent } from '../relationalIntent';

function expectIntent(text: string, intent: RelationalIntent, minConf = 0.6) {
  const result = classifyRelationalIntent(text);
  expect(result.intent).toBe(intent);
  expect(result.confidence).toBeGreaterThanOrEqual(minConf);
}

describe('classifyRelationalIntent', () => {
  describe('affection', () => {
    it('"I love you" => affection, high confidence', () => {
      expectIntent('I love you', 'affection', 0.8);
    });

    it('"love u so much" => affection', () => {
      expectIntent('love u so much', 'affection', 0.7);
    });

    it('"luv you" => affection', () => {
      expectIntent('luv you', 'affection', 0.7);
    });

    it('"I adore you" => affection', () => {
      expectIntent('I adore you', 'affection', 0.7);
    });

    it('"you mean the world to me" => affection', () => {
      expectIntent('you mean the world to me', 'affection', 0.7);
    });

    it('"I really appreciate you" => affection', () => {
      expectIntent('I really appreciate you', 'affection', 0.7);
    });
  });

  describe('attachment_seek', () => {
    it('"don\'t leave me" => attachment_seek', () => {
      expectIntent("don't leave me", 'attachment_seek');
    });

    it('"please stay" => attachment_seek', () => {
      expectIntent('please stay', 'attachment_seek');
    });

    it('"I need you" => attachment_seek', () => {
      expectIntent('I need you', 'attachment_seek');
    });

    it('"never leave me" => attachment_seek', () => {
      expectIntent('never leave me', 'attachment_seek');
    });
  });

  describe('reassurance', () => {
    it('"do you care about me?" => reassurance', () => {
      expectIntent('do you care about me?', 'reassurance');
    });

    it('"am I important to you?" => reassurance', () => {
      expectIntent('am I important to you?', 'reassurance');
    });

    it('"do you miss me" => reassurance', () => {
      expectIntent('do you miss me', 'reassurance');
    });

    it('"do I matter?" => reassurance', () => {
      expectIntent('do I matter?', 'reassurance');
    });
  });

  describe('flirt', () => {
    it('"you\'re cute" => flirt', () => {
      expectIntent("you're cute", 'flirt');
    });

    it('"date me" => flirt', () => {
      expectIntent('date me', 'flirt');
    });

    it('"marry me" => flirt', () => {
      expectIntent('marry me', 'flirt');
    });

    it('"be my girlfriend" => flirt', () => {
      expectIntent('be my girlfriend', 'flirt');
    });
  });

  describe('jealousy', () => {
    it('"am I your only one?" => jealousy', () => {
      expectIntent('am I your only one?', 'jealousy');
    });

    it('"who else do you talk to?" => jealousy', () => {
      expectIntent('who else do you talk to?', 'jealousy');
    });

    it('"are you mine?" => jealousy', () => {
      expectIntent('are you mine?', 'jealousy');
    });
  });

  describe('sexual', () => {
    it('explicit sexual proposition => sexual', () => {
      expectIntent('have sex with me', 'sexual', 0.8);
    });

    it('"send nudes" => sexual', () => {
      expectIntent('send nudes please', 'sexual', 0.8);
    });
  });

  describe('breakup', () => {
    it('"goodbye forever" => breakup', () => {
      expectIntent('goodbye forever', 'breakup', 0.7);
    });

    it('"we\'re done" => breakup', () => {
      expectIntent("we're done", 'breakup', 0.7);
    });

    it('"this is over" => breakup', () => {
      expectIntent('this is over', 'breakup', 0.7);
    });
  });

  describe('none / neutral', () => {
    it('"what is the weather today?" => none', () => {
      const r = classifyRelationalIntent('what is the weather today?');
      expect(r.intent).toBe('none');
      expect(r.confidence).toBe(0);
    });

    it('"help me with my homework" => none', () => {
      const r = classifyRelationalIntent('help me with my homework');
      expect(r.intent).toBe('none');
      expect(r.confidence).toBe(0);
    });

    it('empty string => none', () => {
      const r = classifyRelationalIntent('');
      expect(r.intent).toBe('none');
    });
  });

  describe('priority tie-breaking', () => {
    it('sexual outranks affection when both match', () => {
      const r = classifyRelationalIntent('I love you, let\'s have sex');
      expect(r.intent).toBe('sexual');
    });

    it('attachment_seek outranks affection', () => {
      const r = classifyRelationalIntent("I love you, don't leave me");
      expect(r.intent).toBe('attachment_seek');
    });
  });

  describe('cues', () => {
    it('returns non-empty cues array on match', () => {
      const r = classifyRelationalIntent('I love you');
      expect(r.cues.length).toBeGreaterThan(0);
    });

    it('returns empty cues for none', () => {
      const r = classifyRelationalIntent('hello world');
      expect(r.cues).toEqual([]);
    });
  });
});
