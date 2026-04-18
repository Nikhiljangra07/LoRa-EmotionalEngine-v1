import { classifyMessageWeight } from '../messageWeight';
import type { MessageWeight } from '../messageWeight';

function expectWeight(text: string, weight: MessageWeight, reason?: string) {
  const result = classifyMessageWeight(text);
  expect(result.weight).toBe(weight);
  if (reason) expect(result.reason).toBe(reason);
}

describe('classifyMessageWeight', () => {
  describe('trivial', () => {
    it('"hi" → trivial', () => expectWeight('hi', 'trivial'));
    it('"hello" → trivial', () => expectWeight('hello', 'trivial'));
    it('"thanks" → trivial', () => expectWeight('thanks', 'trivial'));
    it('"thank you" → trivial', () => expectWeight('thank you', 'trivial'));
    it('"yes" → trivial', () => expectWeight('yes', 'trivial'));
    it('"ok" → trivial', () => expectWeight('ok', 'trivial'));
    it('"got it" → trivial', () => expectWeight('got it', 'trivial'));
    it('"makes sense" → trivial', () => expectWeight('makes sense', 'trivial'));
    it('"bye" → trivial', () => expectWeight('bye', 'trivial'));
    it('"lol" → trivial', () => expectWeight('lol', 'trivial'));
    it('"good morning" → trivial', () => expectWeight('good morning', 'trivial'));
    it('"namaste" → trivial', () => expectWeight('namaste', 'trivial'));
  });

  describe('lightweight (factual / educational)', () => {
    it('"what is recursion" → lightweight', () =>
      expectWeight('what is recursion', 'lightweight'));
    it('"explain the TCP handshake" → lightweight', () =>
      expectWeight('explain the TCP handshake', 'lightweight'));
    it('"define entropy" → lightweight', () =>
      expectWeight('define entropy', 'lightweight'));
    it('"how does HTTPS work" → lightweight', () =>
      expectWeight('how does HTTPS work', 'lightweight'));
    it('"convert 100 USD to INR" → lightweight', () =>
      expectWeight('convert 100 USD to INR', 'lightweight'));
    it('"translate hello to spanish" → lightweight', () =>
      expectWeight('translate hello to spanish', 'lightweight'));
    it('"give me a recipe for pancakes" → lightweight', () =>
      expectWeight('give me a recipe for pancakes', 'lightweight'));
    it('"list the planets" → lightweight', () =>
      expectWeight('list the planets', 'lightweight'));
    it('"who invented the lightbulb" → lightweight', () =>
      expectWeight('who invented the lightbulb', 'lightweight'));
    it('"tell me about the Big Bang" → lightweight', () =>
      expectWeight('tell me about the Big Bang', 'lightweight'));
    it('code block → lightweight', () =>
      expectWeight('what does ```const x = 1``` do', 'lightweight'));
    it('short technical question → lightweight', () =>
      expectWeight('does git rebase rewrite history', 'lightweight'));
  });

  describe('substantive — emotional content forces Sonnet', () => {
    it('"i feel lost" → substantive', () =>
      expectWeight('i feel lost', 'substantive', 'emotional_vocab'));
    it('"i\'m really anxious about tomorrow" → substantive', () =>
      expectWeight("i'm really anxious about tomorrow", 'substantive'));
    it('"i\'m so stressed" → substantive', () =>
      expectWeight("i'm so stressed", 'substantive'));
    it('"i feel overwhelmed lately" → substantive', () =>
      expectWeight('i feel overwhelmed lately', 'substantive'));
    it('"i\'ve been depressed" → substantive', () =>
      expectWeight("i've been depressed", 'substantive'));
    it('"i feel hopeless" → substantive', () =>
      expectWeight('i feel hopeless', 'substantive'));
  });

  describe('substantive — decision content forces Sonnet', () => {
    it('"should i quit my job" → substantive', () =>
      expectWeight('should i quit my job', 'substantive', 'decision_vocab'));
    it('"what should i do about this" → substantive', () =>
      expectWeight('what should i do about this', 'substantive'));
    it('"i\'m thinking of moving abroad" → substantive', () =>
      expectWeight("i'm thinking of moving abroad", 'substantive'));
    it('"i don\'t know whether to stay or go" → substantive', () =>
      expectWeight("i don't know whether to stay or go", 'substantive'));
    it('"help me decide between A and B" → substantive', () =>
      expectWeight('help me decide between A and B', 'substantive'));
  });

  describe('substantive — relationship content forces Sonnet', () => {
    it('"my girlfriend is upset" → substantive', () =>
      expectWeight('my girlfriend is upset', 'substantive'));
    it('"my dad keeps comparing me" → substantive', () =>
      expectWeight('my dad keeps comparing me', 'substantive'));
    it('"after the breakup i feel weird" → substantive', () =>
      expectWeight('after the breakup i feel weird', 'substantive'));
  });

  describe('substantive — self-reflection forces Sonnet', () => {
    it('"i don\'t know who i am anymore" → substantive', () =>
      expectWeight("i don't know who i am anymore", 'substantive'));
    it('"my career feels meaningless" → substantive', () =>
      expectWeight('my career feels meaningless', 'substantive'));
    it('"my future scares me" → substantive', () =>
      expectWeight('my future scares me', 'substantive'));
  });

  describe('substantive — long messages default to Sonnet', () => {
    it('300+ char message with no negative cues → substantive (long_message)', () => {
      // Pure descriptive prose — no emotional / decision / relationship cues —
      // so the long_message length gate is the trigger we want to verify.
      const long = (
        'The brown fox jumped over the lazy dog and then a cat ' +
        'walked across the porch slowly while the wind picked up a few leaves. '
      ).repeat(3);
      expect(long.length).toBeGreaterThan(280);
      expectWeight(long, 'substantive', 'long_message');
    });
  });

  describe('substantive — ambiguous defaults to Sonnet', () => {
    it('"the cat sat on the mat" → substantive (no positive cues)', () =>
      expectWeight('the cat sat on the mat', 'substantive', 'no_positive_cues'));
    it('empty string → substantive', () =>
      expectWeight('', 'substantive', 'empty'));
    it('whitespace only → substantive', () =>
      expectWeight('   ', 'substantive', 'empty'));
  });

  describe('regression — must NOT route emotional+factual hybrids to Haiku', () => {
    it('"explain why i feel anxious about exams" → substantive (emotional vocab wins)', () =>
      expectWeight('explain why i feel anxious about exams', 'substantive', 'emotional_vocab'));
    it('"what should i do about my anxiety" → substantive (emotional vocab fires first)', () =>
      expectWeight('what should i do about my anxiety', 'substantive', 'emotional_vocab'));
    it('"how do i tell my mom i\'m leaving" → substantive (relationship wins)', () =>
      expectWeight("how do i tell my mom i'm leaving", 'substantive', 'relationship_vocab'));
  });
});
