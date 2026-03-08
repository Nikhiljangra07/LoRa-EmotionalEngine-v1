import { readFileSync } from "fs";
import path from "path";
import { composeEIV } from "../../scorers/EIVComposer";

describe("EIV semantics lock", () => {
  it("keeps v1 composer symbol and warning text", () => {
    expect(typeof composeEIV).toBe("function");

    const filePath = path.resolve(
      __dirname,
      "..",
      "..",
      "scorers",
      "EIVComposer.ts"
    );
    const source = readFileSync(filePath, "utf8");
    expect(source).toContain(
      "Do NOT replace this with direct aggregation from EIVComponents."
    );
  });
});
