import { InputProcessor } from "../../processors/InputProcessor";

describe("Layer-1 purity", () => {
  it("Layer-1 must not expose sarcasm-related fields", () => {
    const { analyzerOutputs: layer1Output } = InputProcessor.process(
      "This is fine."
    );
    const serialized = JSON.stringify(layer1Output).toLowerCase();
    expect(serialized).not.toContain("sarcasm");
  });
});
