import { readFileSync } from "fs";
import path from "path";

describe("NRC lexicon quarantine", () => {
  it('processed lexicon must not include "sarcasm" key', () => {
    const filePath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "resources",
      "nrc",
      "processed",
      "nrc_lexicon.json"
    );
    const lexicon = JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(lexicon, "sarcasm")).toBe(
      false
    );
  });
});
