import { InputProcessor } from "../processors/InputProcessor";
import { EIVComponentAssembler } from "../processors/EIVComponentAssembler";
import { EIVScorer } from "../scorers/EIVScorer";
import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import type { EmotionalState } from "../types/analysis.types";

/**
	•	FAILURE-MODE INVARIANTS
	•	
	•	This suite asserts that the LoRa v1 Emotion Core:
	•		•	Never crashes on malformed, empty, or extreme inputs
	•		•	Preserves numerical stability under stress
	•		•	Remains deterministic
	•	
	•	These tests validate production-safety, not semantic correctness.
*/

const DEFAULT_STATE: EmotionalState = {
  dominant: "NEUTRAL",
  arousal: "LOW",
  valence: "NEUTRAL",
  confidence: 0.5,
};

const runPipeline = (text: string) => {
  const outputs = InputProcessor.process(text);
  const components = EIVComponentAssembler.assemble(outputs);
  const eiv = EIVScorer.calculate(components);
  return { outputs, eiv };
};

const expectBoundedOutput = (value: number) => {
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
  expect(Number.isFinite(value)).toBe(true);
};

const expectBoundedAnalyzerOutputs = (
  outputs: ReturnType<typeof InputProcessor.process>
) => {
  expectBoundedOutput(outputs.expressionStrength.score);
  expectBoundedOutput(outputs.expressionStrength.confidence);
  expectBoundedOutput(outputs.valence.score);
  expectBoundedOutput(outputs.valence.confidence);
  expectBoundedOutput(outputs.arousal.score);
  expectBoundedOutput(outputs.arousal.confidence);
};

describe("Failure modes — Input safety and stability", () => {
  test("empty/minimal input does not throw and is deterministic", () => {
    const samples = ["", "   ", "a", "!?"];

    samples.forEach((text) => {
      expect(() => runPipeline(text)).not.toThrow();
      const first = runPipeline(text);
      const second = runPipeline(text);

      expect(first.eiv.value).toBeCloseTo(second.eiv.value, 12);
      expectBoundedOutput(first.eiv.value);
      expectBoundedAnalyzerOutputs(first.outputs);
    });
  });

  test("long input stability under repetitive patterns", () => {
    const longText = "WOW!!! 😀 ".repeat(2000);
    const start = Date.now();
    const result = runPipeline(longText);
    const durationMs = Date.now() - start;

    expectBoundedOutput(result.eiv.value);
    expectBoundedAnalyzerOutputs(result.outputs);
    expect(durationMs).toBeLessThan(2000);
  });

  test("pathological characters do not break analyzers", () => {
    const samples = [
      "😀😀😀😀😀",
      "?!?!?!?!",
      "∆≈ç√∫˜µ≤≥÷•¶§",
    ];

    samples.forEach((text) => {
      const { outputs, eiv } = runPipeline(text);
      expectBoundedAnalyzerOutputs(outputs);
      expectBoundedOutput(eiv.value);
    });
  });

  test("numerical extremes are clamped and confidence remains bounded", () => {
    const samples = [
      "THIS IS AMAZING!!! 😀😀😀",
      "....................................................",
      "NOOOOOOOOOOOOO!!!!",
    ];

    samples.forEach((text) => {
      const { outputs, eiv } = runPipeline(text);
      expectBoundedOutput(eiv.value);
      expectBoundedAnalyzerOutputs(outputs);
    });
  });

  test("determinism under stress is preserved", () => {
    const text = "!!! 😀 !!! 😀 !!!";
    const runs = Array.from({ length: 5 }, () => runPipeline(text));
    const values = runs.map((r) => r.eiv.value);
    values.forEach((value) =>
      expect(value).toBeCloseTo(values[0], 12)
    );
  });
});

describe("Failure modes — Orchestrator runtime robustness", () => {
  test("orchestrator does not crash on empty input", async () => {
    const engine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 1 },
      () => ({
        generateResponse: async () => "LOCAL",
      })
    );
    const outputs = InputProcessor.process("");

    const result = await engine.processMessage(
      outputs,
      DEFAULT_STATE
    );
    expectBoundedOutput(result.eiv.value);
  });

  test("orchestrator remains deterministic with identical inputs", async () => {
    const engine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 1 },
      () => ({
        generateResponse: async () => "LOCAL",
      })
    );
    const text = "???";
    const outputs = InputProcessor.process(text);

    const first = await engine.processMessage(
      outputs,
      DEFAULT_STATE
    );
    const second = await engine.processMessage(
      outputs,
      DEFAULT_STATE
    );

    expect(first.eiv.value).toBeCloseTo(second.eiv.value, 12);
  });
});
