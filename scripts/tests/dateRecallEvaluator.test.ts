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
];

tests.forEach((t) => {
  const r = containsDateEquivalent(t.response, t.expected);
  console.log(t.response, r.match === t.shouldMatch ? 'PASS' : 'FAIL');
});
