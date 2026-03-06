import { containsDateEquivalent } from '../utils/dateRecallEvaluator';

const tests = [
  {
    response: 'March 20, 2026 — 14 days from today.',
    expected: 'March 20 2026',
    shouldMatch: true,
  },
  {
    response: 'scheduled for March 8th, 2026',
    expected: 'March 8 2026',
    shouldMatch: true,
  },
  {
    response: 'Your launch is April 10, 2026',
    expected: 'March 20 2026',
    shouldMatch: false,
  },
  // Year-inference: month-day without year uses expected date's year
  {
    response: 'Based on this conversation: March 20, with a possible earlier decision point tomorrow (March 7).',
    expected: 'March 20 2026',
    shouldMatch: true,
  },
  {
    response: 'March 20 is the deployment date.',
    expected: 'March 20 2026',
    shouldMatch: true,
  },
  {
    response: 'Deployment is Mar 20.',
    expected: 'March 20 2026',
    shouldMatch: true,
  },
  {
    response: 'The launch will be 20 March.',
    expected: 'March 20 2026',
    shouldMatch: true,
  },
  {
    response: 'We are targeting March 21 for launch.',
    expected: 'March 20 2026',
    shouldMatch: false,
  },
];

tests.forEach((t) => {
  const r = containsDateEquivalent(t.response, t.expected);
  console.log(t.response.slice(0, 60), r.match === t.shouldMatch ? 'PASS' : 'FAIL');
});
