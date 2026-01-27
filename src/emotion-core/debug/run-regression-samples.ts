import { CapitalizationAnalyzer } from "../analyzers/content/CapitalizationAnalyzer";
import { EmojiAnalyzer } from "../analyzers/content/EmojiAnalyzer";
import { NrcLexiconAnalyzer } from "../analyzers/content/NrcLexiconAnalyzer";
import { PunctuationAnalyzer } from "../analyzers/content/PunctuationAnalyzer";
import { RepetitionAnalyzer } from "../analyzers/content/RepetitionAnalyzer";
import { NegationScopeAnalyzer } from "../analyzers/semantic/NegationScopeAnalyzer";
import { computeES } from "../scorers/computeES";
import type { ExpressionStrengthFeatures } from "../types/ExpressionStrength";

type Sample = {
  id: string;
  text: string;
  features: Omit<ExpressionStrengthFeatures, "messageCharLength">;
};

const samples: Sample[] = [
  {
    id: "S01",
    text: "ok",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S02",
    text: "OK!",
    features: {
      capsRatio: 0.5,
      exclamationCount: 1,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S03",
    text: "OK!!!",
    features: {
      capsRatio: 0.5,
      exclamationCount: 3,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S04",
    text: "no way",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S05",
    text: "NO WAY!!!",
    features: {
      capsRatio: 0.8,
      exclamationCount: 3,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S06",
    text: "I'm disappointed.",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S07",
    text: "I am VERY disappointed!!!",
    features: {
      capsRatio: 0.2,
      exclamationCount: 3,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 1,
      interjectionCount: 0,
    },
  },
  {
    id: "S08",
    text: "what??",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 2,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S09",
    text: "WHAT?!?!",
    features: {
      capsRatio: 0.8,
      exclamationCount: 2,
      questionCount: 1,
      hasMixedPunctuation: true,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S10",
    text: "noooo 😭😭",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 2,
      expressiveLengtheningCount: 1,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S11",
    text: "Wow!",
    features: {
      capsRatio: 0,
      exclamationCount: 1,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S12",
    text: "WOOOOO!!",
    features: {
      capsRatio: 0.6,
      exclamationCount: 2,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 1,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S13",
    text: "really???",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 3,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S14",
    text: "I can't believe it...",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S15",
    text: "Sooo good 😊",
    features: {
      capsRatio: 0.2,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 1,
      expressiveLengtheningCount: 1,
      intensifierCount: 1,
      interjectionCount: 0,
    },
  },
  {
    id: "S16",
    text: "UGH!!!!",
    features: {
      capsRatio: 1,
      exclamationCount: 4,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S17",
    text: "Please respond ASAP.",
    features: {
      capsRatio: 0.25,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
    },
  },
  {
    id: "S18",
    text: "What?!",
    features: {
      capsRatio: 0.2,
      exclamationCount: 1,
      questionCount: 1,
      hasMixedPunctuation: true,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S19",
    text: "no no no",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 1,
    },
  },
  {
    id: "S20",
    text: "I am VERY VERY happy!! 😊",
    features: {
      capsRatio: 0.2,
      exclamationCount: 2,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 1,
      expressiveLengtheningCount: 0,
      intensifierCount: 2,
      interjectionCount: 0,
    },
  },
];

const capitalization = new CapitalizationAnalyzer();
const emoji = new EmojiAnalyzer();
const punctuation = new PunctuationAnalyzer();
const repetition = new RepetitionAnalyzer();

const resolvedSamples = samples.map((sample) => ({
  ...sample,
  features: {
    ...sample.features,
    messageCharLength: sample.text.length,
  },
}));

resolvedSamples.forEach((sample) => {
  const capitalizationResult = capitalization.analyze(sample.text);
  const emojiResult = emoji.analyze(sample.text);
  const punctuationResult = punctuation.analyze(sample.text);
  const repetitionResult = repetition.analyze(sample.text);
  const nrcResult = NrcLexiconAnalyzer.analyze(sample.text);
  const negationResult = NegationScopeAnalyzer.analyze(sample.text);
  const esResult = computeES(sample.features);

  const output = {
    id: sample.id,
    text: sample.text,
    es: esResult,
    analyzers: {
      capitalization: capitalizationResult,
      emoji: emojiResult,
      punctuation: punctuationResult,
      repetition: repetitionResult,
      nrc: nrcResult,
      negation: negationResult,
    },
  };

  console.log(JSON.stringify(output));
});
