// import fs from 'fs';
// import path from 'path';

// const RAW_PATH = path.resolve(
//   'resources/nrc/raw/NRC-Emotion-Lexicon-Wordlevel-v0.92.txt'
// );

// const OUTPUT_PATH = path.resolve(
//   'resources/nrc/processed/nrc_lexicon.json'
// );

// const lexicon: Record<string, Record<string, number>> = {};

// const lines = fs.readFileSync(RAW_PATH, 'utf-8').split('\n');

// for (const line of lines) {
//   if (!line.trim()) continue;

//   const [word, emotion, value] = line.split('\t');
//   if (!word || !emotion) continue;

//   if (!lexicon[word]) {
//     lexicon[word] = {};
//   }

//   lexicon[word][emotion] = Number(value);
// }

// fs.writeFileSync(OUTPUT_PATH, JSON.stringify(lexicon, null, 2));

// console.log(
//   `✅ NRC lexicon converted: ${Object.keys(lexicon).length} words`
// );