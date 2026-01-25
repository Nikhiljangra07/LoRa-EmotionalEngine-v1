// src/debug/runPunctuation.ts
import { PunctuationAnalyzer } from '../emotion-core/analyzers/content/PunctuationAnalyzer.ts';

const analyzer = new PunctuationAnalyzer();

const samples = [
  'I don’t know...',
  'WHAT ARE YOU DOING???',
  'Okay!!',
  'fine.',
  'Really?!',
];

for (const text of samples) {
  console.log('\nINPUT:', text);
  console.log(JSON.stringify(analyzer.analyze(text), null, 2));
}
