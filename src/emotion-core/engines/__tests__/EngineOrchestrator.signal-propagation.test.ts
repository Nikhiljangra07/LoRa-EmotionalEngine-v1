import { EngineOrchestrator } from "../EngineOrchestrator";
import { InputProcessor } from "../../processors/InputProcessor";
import { EIVComponentAssembler } from "../../processors/EIVComponentAssembler";
import { EIVScorer } from "../../scorers/EIVScorer";
import { EmotionalStateInterpreter } from "../../processors/EmotionalStateInterpreter";
import { MASTER_CONSTANTS } from "../../config/master.constants";
import { DecisionLogger } from "../../logging/DecisionLogger";
import type { EmotionalState } from "../../types/analysis.types";

describe("EngineOrchestrator signal propagation", () => {
  test("valence/arousal propagate and analyzerSummary reflects signals", async () => {
    const text = "I’m PISSED. SERIOUSLY!!! 😤😤";
    const { analyzerOutputs, signalPacket } = InputProcessor.process(text);
    const components = EIVComponentAssembler.assemble(analyzerOutputs);
    const eiv = EIVScorer.calculate(components).value;
    const interpreted = EmotionalStateInterpreter.interpret(analyzerOutputs, eiv);

    const emotionalState: EmotionalState = {
      dominant: "NEUTRAL",
      arousal: interpreted.arousal,
      valence: interpreted.valence,
      confidence: analyzerOutputs.valence.confidence,
    };

    const logSpy = jest.spyOn(DecisionLogger, "logMessageDecision");
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({
        generateResponse: async () => "ok",
      })
    );

    await engine.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined,
      signalPacket
    );

    const payload = logSpy.mock.calls[0]?.[0] as {
      analyzerSummary: {
        emojiUsed: boolean;
        capsUsed: boolean;
        punctuationUsed: boolean;
        repetitionDetected: boolean;
      };
    };

    expect(payload.analyzerSummary).toEqual({
      emojiUsed: true,
      capsUsed: true,
      punctuationUsed: true,
      repetitionDetected: false,
    });

    if (interpreted.valence === "NEUTRAL") {
      expect(analyzerOutputs.valence.confidence).toBeLessThanOrEqual(
        MASTER_CONSTANTS.valenceAnalyzer.confidence.lowEvidenceMultiplier
      );
    } else {
      expect(interpreted.valence).not.toBe("NEUTRAL");
    }

    const arousalEpsilon = MASTER_CONSTANTS.bounds.zero;
    expect(analyzerOutputs.arousal.score).toBeGreaterThan(arousalEpsilon);
    expect(analyzerOutputs.arousal.confidence).toBeGreaterThanOrEqual(
      MASTER_CONSTANTS.arousalCalibrationConstants.confidence.min
    );
  });
});
