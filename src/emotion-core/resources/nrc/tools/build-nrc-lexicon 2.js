const fs = require("fs");
const path = require("path");

const RAW_PATH = path.resolve(
  __dirname,
  "..",
  "raw",
  "NRC-Emotion-Lexicon-Wordlevel-v0.92.txt"
);
const OUT_PATH = path.resolve(__dirname, "..", "processed", "nrc_lexicon.json");

const EMOTIONS = [
  "anger",
  "anticipation",
  "disgust",
  "fear",
  "joy",
  "negative",
  "positive",
  "sadness",
  "surprise",
  "trust",
];

const EXCLUDED_TOKENS = new Set(["sarcasm"]);

const buildEmptyEntry = () =>
  EMOTIONS.reduce((acc, emotion) => {
    acc[emotion] = 0;
    return acc;
  }, {});

const raw = fs.readFileSync(RAW_PATH, "utf8");
const lexicon = Object.create(null);

raw.split(/\r?\n/).forEach((line) => {
  if (!line) return;
  const [word, emotion, value] = line.split("\t");
  if (!word || !emotion || typeof value === "undefined") return;
  if (EXCLUDED_TOKENS.has(word)) return;
  if (!EMOTIONS.includes(emotion)) return;

  if (!lexicon[word]) {
    lexicon[word] = buildEmptyEntry();
  }
  lexicon[word][emotion] = Number(value);
});

const sorted = Object.keys(lexicon)
  .sort()
  .reduce((acc, word) => {
    const entry = {};
    EMOTIONS.forEach((emotion) => {
      entry[emotion] = lexicon[word][emotion] ?? 0;
    });
    acc[word] = entry;
    return acc;
  }, {});

fs.writeFileSync(OUT_PATH, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

console.log(`Wrote ${Object.keys(sorted).length} entries to ${OUT_PATH}`);
