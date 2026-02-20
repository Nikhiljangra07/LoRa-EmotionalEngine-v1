import { updatePressureWithTime } from "../update-flow";

describe("update-flow", () => {
  test("no session boundary applies short decay and neutral gain", () => {
    const result = updatePressureWithTime(100, 60, 60, 90);

    expect(result.pressureAfterDecay).toBeLessThan(100);
    expect(result.gainModifier).toBe(1.0);
  });

  test("session boundary applies session decay before message decay", () => {
    const result = updatePressureWithTime(100, 10, 4000, 90);

    expect(result.pressureAfterDecay).toBeLessThan(90);
    expect(result.gainModifier).toBe(1.3);
  });

  test("burst case returns 1.3 gain modifier", () => {
    const result = updatePressureWithTime(100, 20, 20, 90);

    expect(result.gainModifier).toBe(1.3);
  });

  test("silence case returns 0.8 gain modifier", () => {
    const result = updatePressureWithTime(100, 500, 500, 90);

    expect(result.gainModifier).toBe(0.8);
  });

  test("zero deltas keep pressure and detect burst gain", () => {
    const result = updatePressureWithTime(100, 0, 0, 90);

    expect(result.pressureAfterDecay).toBe(100);
    expect(result.gainModifier).toBe(1.3);
  });
});
