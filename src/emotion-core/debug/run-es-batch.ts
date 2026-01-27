import { ExpressionStrengthScorer } from "../scorers/ExpressionStrengthScorer";

const samples = [
  {
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
      messageCharLength: 2,
    },
  },
  {
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
      messageCharLength: 3,
    },
  },
  {
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
      messageCharLength: 5,
    },
  },
  {
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
      messageCharLength: 6,
    },
  },
  {
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
      messageCharLength: 9,
    },
  },
  {
    text: "I’m disappointed.",
    features: {
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
      messageCharLength: 15,
    },
  },
  {
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
      messageCharLength: 24,
    },
  },
  {
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
      messageCharLength: 6,
    },
  },
  {
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
      messageCharLength: 7,
    },
  },
  {
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
      messageCharLength: 8,
    },
  },
];

samples.forEach((sample) => {
  const result = ExpressionStrengthScorer.compute(sample.features);
  console.log(sample.text.padEnd(30), "→ ES:", result.es.toFixed(3));
});