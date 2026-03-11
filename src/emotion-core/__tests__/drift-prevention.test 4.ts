import fs from "fs";
import path from "path";

const CORE_DIR = path.resolve(__dirname, "..");
const ANALYZER_DIR = path.resolve(CORE_DIR, "analyzers");
const SCORER_DIR = path.resolve(CORE_DIR, "scorers");
const LOGGING_DIR = path.resolve(CORE_DIR, "logging");
const CONFIG_DIR = path.resolve(CORE_DIR, "config");
const TYPES_DIR = path.resolve(CORE_DIR, "types");
const MATH_DIR = path.resolve(CORE_DIR, "math");
const RESOURCES_DIR = path.resolve(CORE_DIR, "resources");
const UTILS_DIR = path.resolve(CORE_DIR, "utils");

const isTestFile = (filePath: string): boolean =>
  filePath.includes(`${path.sep}__tests__${path.sep}`) ||
  filePath.endsWith(".test.ts");

const collectTypeScriptFiles = (
  dir: string,
  excludes: string[] = []
): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  entries.forEach((entry) => {
    const resolved = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludes.some((exclude) => resolved.startsWith(exclude))) {
        return;
      }
      files.push(...collectTypeScriptFiles(resolved, excludes));
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

const extractImportSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const importPattern = /\bfrom\s+['"]([^'"]+)['"]/g;
  const requirePattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = importPattern.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  while ((match = requirePattern.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
};

describe("Drift prevention fixtures", () => {
  test("DRIFT-001: Layer-1 analyzers do not import forbidden layers", () => {
    const analyzerFiles = collectTypeScriptFiles(ANALYZER_DIR);
    const forbiddenSegments = [
      "scorers",
      "engines",
      "prompt",
      "logging",
      "persistence",
      "memory",
      "llm",
    ];
    const allowedRoots = [
      ANALYZER_DIR,
      CONFIG_DIR,
      TYPES_DIR,
      MATH_DIR,
      RESOURCES_DIR,
      UTILS_DIR,
    ];
    const violations: string[] = [];

    analyzerFiles.forEach((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      const specifiers = extractImportSpecifiers(source);
      specifiers.forEach((specifier) => {
        if (forbiddenSegments.some((segment) => specifier.includes(segment))) {
          violations.push(`${filePath}: ${specifier}`);
          return;
        }
        if (!specifier.startsWith(".")) {
          violations.push(`${filePath}: ${specifier}`);
          return;
        }
        const resolved = path.resolve(path.dirname(filePath), specifier);
        const isAllowed = allowedRoots.some((root) =>
          resolved.startsWith(root)
        );
        if (!isAllowed) {
          violations.push(`${filePath}: ${specifier}`);
        }
      });
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
      "happy",
      "sad",
      "angry",
      "fearful",
      "minimal",
      "low",
      "moderate",
      "high",
      "extreme",
      "relationship",
      "relational",
      "bond",
      "attachment",
      "affection",
      "intimacy",
      "closeness",
      "rapport",
    ];
    const labelPattern = new RegExp(`\\b(${labels.join("|")})\\b`, "i");
    const violations: string[] = [];

    analyzerFiles.forEach((filePath) => {
      const source = stripStringsAndComments(
        fs.readFileSync(filePath, "utf8")
      )
        .replace(/\bNRCEmotion\.[A-Z_]+\b/g, "")
        .replace(/\bNRCEmotion\b/g, "");
      if (labelPattern.test(source)) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-003: Personalization forbidden in scorers", () => {
    const files = collectTypeScriptFiles(SCORER_DIR);
    const pattern =
      /\b(userId|user_id|sessionId|memory|history|personalization|personalized|personalised|profile|attachment|bond)\b/i;
    const violations: string[] = [];

    files.forEach((filePath) => {
      const source = stripStringsAndComments(
        fs.readFileSync(filePath, "utf8")
      );
      if (pattern.test(source)) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-004: Hidden persistence detection", () => {
    const ETV_DIR = path.resolve(CORE_DIR, "etv");
    const MEMORY_V1_DIR = path.resolve(CORE_DIR, "memory-v1");
    const TIER_DIR = path.resolve(CORE_DIR, "tier");
    const files = collectTypeScriptFiles(CORE_DIR, [LOGGING_DIR, ETV_DIR, MEMORY_V1_DIR, TIER_DIR]);
    const pattern =
      /\b(localStorage|sessionStorage|indexedDB|fs|writeFile|save|persist|cache)\b/i;
    const violations: string[] = [];

    files.forEach((filePath) => {
      const source = stripStringsAndComments(
        fs.readFileSync(filePath, "utf8")
      );
      if (
        pattern.test(source) &&
        !filePath.includes(`${path.sep}cache${path.sep}`)
      ) {
        violations.push(filePath);
      }
    });

    expect(violations).toEqual([]);
  });

  test("DRIFT-005: Prompt logic forbidden in analyzers", () => {
    const analyzerFiles = collectTypeScriptFiles(ANALYZER_DIR);
    const pattern =
      /\b(prompt|system|assistant|user|instruction|template|llm|gpt)\b/i;
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

  test("DRIFT-006: Magic numbers forbidden in scorers", () => {
    const scorerFiles = collectTypeScriptFiles(SCORER_DIR);
    const violations: string[] = [];
    const numericPattern = /\b\d+(\.\d+)?\b/g;
    const allowedLiterals = new Set(["0", "1"]);

    scorerFiles.forEach((filePath) => {
      const source = stripStringsAndComments(fs.readFileSync(filePath, "utf8"))
        .replace(/\.toFixed\(\s*\d+\s*\)/g, ".toFixed()");
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
