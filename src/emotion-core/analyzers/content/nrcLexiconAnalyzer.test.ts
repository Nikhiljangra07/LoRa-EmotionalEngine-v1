// import { NrcLexiconAnalyzer } from './NrcLexiconAnalyzer';
// import { NRCEmotion } from '../../types/NRCEmotion';

// describe('NrcLexiconAnalyzer — Core Invariants (Production)', () => {

//   test('detects sadness and negative valence when sadness language is present', () => {
//     const result = NrcLexiconAnalyzer.analyze('I feel sad and hopeless today');

//     // Core invariant: sadness + negative must be present
//     expect(result.distribution[NRCEmotion.SADNESS]).toBeGreaterThan(0);
//     expect(result.distribution[NRCEmotion.NEGATIVE]).toBeGreaterThan(0);

//     // Sadness must outweigh unrelated emotions
//     expect(result.distribution[NRCEmotion.SADNESS])
//       .toBeGreaterThan(result.distribution[NRCEmotion.JOY]);
//   });

//   test('mixed emotional signals produce multiple active emotions', () => {
//     const result = NrcLexiconAnalyzer.analyze('I am happy but also nervous');

//     // Invariant: both signals must register
//     expect(result.distribution[NRCEmotion.JOY]).toBeGreaterThan(0);
//     expect(result.distribution[NRCEmotion.FEAR]).toBeGreaterThan(0);

//     // Invariant: both sentiment dimensions may coexist
//     expect(result.distribution[NRCEmotion.POSITIVE]).toBeGreaterThan(0);
//     expect(result.distribution[NRCEmotion.NEGATIVE]).toBeGreaterThan(0);
//   });

//   test('confidence gap equals max emotion minus second max emotion', () => {
//     const result = NrcLexiconAnalyzer.analyze('sad sad happy');

//     const scores = Object.values(result.distribution);
//     const sorted = [...scores].sort((a, b) => b - a);

//     const expectedGap = sorted[0] - sorted[1];
//     expect(result.confidenceGap).toBeCloseTo(expectedGap, 5);
//   });

//   test('neutral sentences return a zero emotion distribution', () => {
//     const result = NrcLexiconAnalyzer.analyze('The table is next to the door');

//     expect(
//       Object.values(result.distribution).every(v => v === 0)
//     ).toBe(true);

//     expect(result.dominantEmotion).toBeUndefined();
//     expect(result.confidenceGap).toBe(0);
//   });

// });