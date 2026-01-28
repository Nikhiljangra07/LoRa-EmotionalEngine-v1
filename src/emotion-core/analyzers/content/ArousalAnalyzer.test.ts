import { ArousalAnalyzer } from "./ArousalAnalyzer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const AROUSAL = MASTER_CONSTANTS.arousalCalibrationConstants;

const analyzer = new ArousalAnalyzer();

const expectInRange = (value: number, min: number, max: number) => {
  expect(value).toBeGreaterThanOrEqual(min);
  expect(value).toBeLessThanOrEqual(max);
};

describe("ArousalAnalyzer V1", () => {
  test("neutral baseline stays within expected floor range", () => {
    const result = analyzer.analyze("The chair is blue.");
    expectInRange(result.arousal, AROUSAL.SCALE.MIN, AROUSAL.SCALE.MIN + 0.1);
  });

  test("orthogonality: arousal ignores valence direction", () => {
    const love = analyzer.analyze("I LOVE THIS!!!");
    const hate = analyzer.analyze("I HATE THIS!!!");
    expect(Math.abs(love.arousal - hate.arousal)).toBeLessThan(0.1);
  });

  test("punctuation increases arousal without polarity", () => {
    const calm = analyzer.analyze("Okay.");
    const excited = analyzer.analyze("Okay!!!");
    expect(excited.arousal).toBeGreaterThan(calm.arousal);
  });

  test("caps without sentiment increases arousal modestly", () => {
    const result = analyzer.analyze("THIS IS IMPORTANT");
    expect(result.arousal).toBeGreaterThan(AROUSAL.SCALE.MIN);
  });

  test("emoji activation increases arousal for both polarities", () => {
    const positive = analyzer.analyze("Great 🎉");
    const negative = analyzer.analyze("Awful 😱");
    expect(positive.arousal).toBeGreaterThan(AROUSAL.SCALE.MIN);
    expect(negative.arousal).toBeGreaterThan(AROUSAL.SCALE.MIN);
  });

  test("sarcasm cue lowers confidence under high arousal", () => {
    const result = analyzer.analyze("Oh BRILLIANT idea!!!");
    expect(result.arousal).toBeGreaterThan(AROUSAL.SCALE.MIN);
    expect(result.confidence).toBeLessThan(AROUSAL.CONFIDENCE.BASE);
    expect(result.flags).toContain("potential_sarcasm");
  });

  test("long text windowing normalizes clustered emphasis", () => {
    const clustered = analyzer.analyze(
      new Array(3).fill("WOW!!!").join(" ")
    );
    const distributed = analyzer.analyze(
      new Array(3).fill("WOW!!!").join(" ") + " " +
        new Array(100).fill("note").join(" ")
    );
    expect(Math.abs(clustered.arousal - distributed.arousal)).toBeLessThan(0.2);
  });
});
