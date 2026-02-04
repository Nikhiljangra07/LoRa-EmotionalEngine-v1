import fs from "fs";
import path from "path";

const ANALYZER_DIR = path.resolve(__dirname, "..", "analyzers");
const SCORER_DIR = path.resolve(__dirname, "..", "scorers");

const isTestFile = (filePath: string): boolean =>
  filePath.includes(`${path.sep}__tests__${path.sep}`) ||
  filePath.endsWith(".test.ts");

const collectTypeScriptFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  entries.forEach((entry) => {
    const resolved = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(resolved));
      return;
    }
    if (!entry.isFile()) {
      return;
    }
    if (!resolved.endsWith(".ts")) {
      return;
    }
    if (isTestFile(resolved)) {
      return;
    }
    files.push(resolved);
  });
  return files;
};

const stripStringsAndComments = (source: string): string => {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, " ");
  const withoutBackticks = withoutLineComments.replace(
    /`(?:\\`|\\[\s\S]|[^`])*`/g,
    " "
  );
  const withoutSingleQuotes = withoutBackticks.replace(
    /'(?:\\'|\\[\s\S]|[^'])*'/g,
    " "
  );
  const withoutDoubleQuotes = withoutSingleQuotes.replace(
    /"(?:\\"|\\[\s\S]|[^"])*"/g,
    " "
  );
  return withoutDoubleQuotes;
};

const findMatches = (source: string, regex: RegExp): string[] => {
  const matches: string[] = [];
  let match: RegExpExecArray | null = null;
  const next = new RegExp(regex.source, regex.flags);
  while ((match = next.exec(source)) !== null) {
    matches.push(match[0]);
  }
  return matches;
};

describe("Drift prevention fixtures", () => {
  test("DRIFT-001: Layer-1 analyzers do not import forbidden layers", () => {
    const analyzerFiles = collectTypeScriptFiles(ANALYZER_DIR);
    const importPattern =
      /^\s*(import|export)\s+.*from\s+['"][^'"]*(scorers|engines|processors|logging)\//gm;
    const requirePattern =
      /\brequire\(\s*['"][^'"]*(scorers|engines|processors|logging)\//g;
    const violations: string[] = [];

    analyzerFiles.forEach((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      const imports = findMatches(source, importPattern);
      const requires = findMatches(source, requirePattern);
      if (imports.length > 0 || requires.length > 0) {
        violations.push(
          `${filePath}: ${[...imports, ...requires].join(", ")}`
        );
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-002: Analyzer code contains no emotion labels", () => {
    const analyzerFiles = collectTypeScriptFiles(ANALYZER_DIR);
    const labels = [
      "joy",
      "anger",
      "fear",
      "sadness",
      "disgust",
      "surprise",
      "trust",
      "anticipation",
    ];
    const labelPattern = new RegExp(`\\b(${labels.join("|")})\\b`);
    const violations: string[] = [];

    analyzerFiles.forEach((filePath) => {
      const source = stripStringsAndComments(
        fs.readFileSync(filePath, "utf8")
      );
      if (labelPattern.test(source)) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-003: No userId or personalization logic in scorers/analyzers", () => {
    const files = [
      ...collectTypeScriptFiles(ANALYZER_DIR),
      ...collectTypeScriptFiles(SCORER_DIR),
    ];
    const pattern =
      /\b(userId|user_id|personalization|personalized|personalised)\b/i;
    const violations: string[] = [];

    files.forEach((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      if (pattern.test(source)) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-004: No persistence beyond ETV in scorers/analyzers", () => {
    const files = [
      ...collectTypeScriptFiles(ANALYZER_DIR),
      ...collectTypeScriptFiles(SCORER_DIR),
    ];
    const forbiddenImports = [
      "fs",
      "path",
      "sqlite",
      "sqlite3",
      "better-sqlite3",
      "mongoose",
      "mongo",
      "prisma",
      "knex",
      "redis",
      "level",
    ];
    const importPattern = new RegExp(
      `^\\s*(import|export)\\s+.*from\\s+['"](${forbiddenImports.join(
        "|"
      )})['"]`,
      "gm"
    );
    const requirePattern = new RegExp(
      `\\brequire\\(\\s*['"](${forbiddenImports.join("|")})['"]`,
      "g"
    );
    const statePattern =
      /\b(localStorage|sessionStorage|indexedDB|globalThis|global)\b/;
    const violations: string[] = [];

    files.forEach((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      const imports = findMatches(source, importPattern);
      const requires = findMatches(source, requirePattern);
      if (imports.length > 0 || requires.length > 0 || statePattern.test(source)) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-005: No prompt/LLM logic in analyzers", () => {
    const analyzerFiles = collectTypeScriptFiles(ANALYZER_DIR);
    const pattern = /\b(prompt|llm|openai|gpt)\b/i;
    const violations: string[] = [];

    analyzerFiles.forEach((filePath) => {
      const source = stripStringsAndComments(
        fs.readFileSync(filePath, "utf8")
      );
      if (pattern.test(source)) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-006: Scorers do not hardcode numeric thresholds", () => {
    const scorerFiles = collectTypeScriptFiles(SCORER_DIR);
    const violations: string[] = [];
    const numericPattern = /\b\d+(\.\d+)?\b/g;
    const allowedLiterals = new Set(["0", "1", "2", "3", "4", "5"]);

    scorerFiles.forEach((filePath) => {
      const source = stripStringsAndComments(
        fs.readFileSync(filePath, "utf8")
      );
      const matches = findMatches(source, numericPattern).filter(
        (value) => !allowedLiterals.has(value)
      );
      if (matches.length > 0) {
        violations.push(`${filePath}: ${matches.join(", ")}`);
      }
    });

    expect(violations).toEqual([]);
  });
});
