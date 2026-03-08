const original = process.env.LORA_DECISION_LOG;

let DecisionLogger: typeof import("../DecisionLogger").DecisionLogger;

describe("DecisionLogger summary integrity", () => {
  beforeEach(() => {
    process.env.LORA_DECISION_LOG = "1";
    jest.resetModules();
    DecisionLogger = require("../DecisionLogger").DecisionLogger;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LORA_DECISION_LOG;
    } else {
      process.env.LORA_DECISION_LOG = original;
    }
    jest.restoreAllMocks();
  });

  test("logged JSON preserves analyzerSummary booleans", () => {
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    DecisionLogger.logMessageDecision({
      messageId: "msg-1",
      timestamp: Date.now(),
      analyzerSummary: {
        emojiUsed: true,
        capsUsed: true,
        punctuationUsed: true,
        repetitionDetected: true,
      },
      eiv: { value: 0.5, tier: "minimal" },
      emotionalState: { arousal: "LOW", valence: "NEUTRAL" },
      promptProfile: { relationshipStyle: "FRIENDLY", guidanceMode: "ENERGY_MATCH" },
      flags: { safetyTriggered: false, ambiguityDetected: false },
    });

    const logged = logSpy.mock.calls
      .map((call) => call.join(" "))
      .find((line) => line.includes("[LoRa::MessageDecision]"));
    expect(logged).toBeDefined();
    const payloadJson = logged?.split("[LoRa::MessageDecision] ")[1] ?? "";
    const parsed = JSON.parse(payloadJson);
    expect(parsed.analyzerSummary).toEqual({
      emojiUsed: true,
      capsUsed: true,
      punctuationUsed: true,
      repetitionDetected: true,
    });
  });
});
