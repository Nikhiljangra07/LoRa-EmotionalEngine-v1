import { parseOnboardingInput } from '../onboardingQuiz';

describe('onboardingQuiz', () => {
  it('parses name, tone, goal', () => {
    const r = parseOnboardingInput({
      name: 'Nikhil',
      preferredTone: 'direct',
      goalOrientation: 'clarity',
    });
    expect(r.name).toBe('Nikhil');
    expect(r.preferredTone).toBe('direct');
    expect(r.goalOrientation).toBe('clarity');
  });

  it('maps tone variants', () => {
    expect(parseOnboardingInput({ preferredTone: 'warm' }).preferredTone).toBe('gentle');
    expect(parseOnboardingInput({ preferredTone: 'structured' }).preferredTone).toBe('logical');
  });

  it('defaults to gentle/support when unknown', () => {
    const r = parseOnboardingInput({});
    expect(r.preferredTone).toBe('gentle');
    expect(r.goalOrientation).toBe('support');
  });

  it('trims and caps name at 64 chars', () => {
    expect(parseOnboardingInput({ name: '  Bob  ' }).name).toBe('Bob');
    expect(parseOnboardingInput({ name: 'x'.repeat(100) }).name?.length).toBe(64);
  });
});
