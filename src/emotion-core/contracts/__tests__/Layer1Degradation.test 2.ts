import { evaluateLayer1Health } from "../../utils/evaluateLayer1Health";

describe("Layer1Degradation routing signal", () => {
  test("single low confidence triggers degradation", () => {
    const result = evaluateLayer1Health({ es: 0.2 });
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("low_layer1_confidence");
    expect(result.failingAnalyzer).toBe("es");
  });

  test("multiple failures still produce one degraded flag", () => {
    const result = evaluateLayer1Health({ es: 0.2, valence: 0.1 });
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("low_layer1_confidence");
  });

  test("degradation is deterministic", () => {
    const a = evaluateLayer1Health({ arousal: 0.2 });
    const b = evaluateLayer1Health({ arousal: 0.2 });
    expect(a).toEqual(b);
  });

  test("no confidence mutation occurs", () => {
    const confidences = { es: 0.4, valence: 0.5 };
    const result = evaluateLayer1Health(confidences);
    expect(result.degraded).toBe(false);
    expect(confidences).toEqual({ es: 0.4, valence: 0.5 });
  });
});
