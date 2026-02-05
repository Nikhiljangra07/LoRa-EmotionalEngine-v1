import { DecisionLogger } from "../DecisionLogger";

describe("DecisionLogger summary integrity", () => {
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

    logSpy.mockRestore();
  });
});
