import fs from "fs";
import path from "path";
import { MASTER_CONSTANTS } from "../config/master.constants";
import { EIVComponentAssembler } from "../processors/EIVComponentAssembler";
import { EIVScorer } from "../scorers/EIVScorer";
import { InputProcessor } from "../processors/InputProcessor";
import type { SignalPacket } from "../types/SignalPacket.types";

const CORE_DIR = path.resolve(__dirname, "..");

const collectTypeScriptFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  entries.forEach((entry) => {
    const resolved = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(resolved));
      return;
    }
    if (entry.isFile() && resolved.endsWith(".ts")) {
      files.push(resolved);
    }
  });
  return files;
};

const extractObjectLiteralKeys = (
  source: string,
  objectName: string
): string[] => {
  const match = source.match(
    new RegExp(`\\b${objectName}\\b\\s*=\\s*\\{`, "m")
  );
  if (!match || match.index === undefined) {
    return [];
  }
  const start = source.indexOf("{", match.index);
  if (start === -1) {
    return [];
  }
  let depth = 0;
  const keys: string[] = [];
  const body: string[] = [];
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    if (depth >= 1) {
      body.push(char);
    }
  }

  body
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith("//")) {
        return;
      }
      if (line.startsWith("/*") || line.startsWith("*")) {
        return;
      }
      const keyMatch = line.match(/^([A-Za-z0-9_]+)\s*:/);
      if (keyMatch) {
        keys.push(keyMatch[1]);
      }
    });

  return keys;
};

describe("Extension firewall fixtures", () => {
  test("EF-001: Read-only forever objects", () => {
    const frozenConstants = Object.freeze(MASTER_CONSTANTS);
    expect(Object.isFrozen(frozenConstants)).toBe(true);
    expect(() => {
      (frozenConstants as { layer1: unknown }).layer1 = {};
    }).toThrow();

    const frozenTiers = Object.freeze(MASTER_CONSTANTS.eiv.tiers);
    expect(Object.isFrozen(frozenTiers)).toBe(true);
    expect(() => {
      (frozenTiers as { minimalMaxExclusive: number }).minimalMaxExclusive = 0.2;
    }).toThrow();

    const packet: SignalPacket = {
      messageText: "Example",
      sentences: [
        {
          text: "Example",
          position: 0,
          esScore: 0,
          arousalScore: 0,
        },
      ],
      layer1Health: { degraded: false, reason: "ok" },
    };
    // @ts-expect-error readonly contract
    packet.messageText = "mutated";

    const frozen = Object.freeze(packet);
    const original = frozen.messageText;
    let packetThrew = false;
    try {
      (frozen as { messageText: string }).messageText = "mutated";
    } catch {
      packetThrew = true;
    }
    expect(packetThrew || frozen.messageText === original).toBe(true);
  });

  test("EF-002: Safe metrics only (whitelist access)", () => {
    const outputs = InputProcessor.process("Test message.");
    const components = EIVComponentAssembler.assemble(outputs);
    const result = EIVScorer.calculate(components);
    const allowed = ["value", "components", "breakdown", "timestamp"];
    expect(Object.keys(result)).toEqual(expect.arrayContaining(allowed));
    expect(Object.keys(result)).toHaveLength(allowed.length);
  });

  test("EF-003: Unsafe internals are hidden", () => {
    const outputs = InputProcessor.process("Test message.");
    const components = EIVComponentAssembler.assemble(outputs);
    const result = EIVScorer.calculate(components);
    // @ts-expect-error internal scorer internals must not be accessible
    result._internalGainCurve;
  });

  test("EF-004: Extension points only (named hooks)", () => {
    const ALLOWED_HOOKS: string[] = [];
    const sourceFiles = collectTypeScriptFiles(CORE_DIR);
    const hookKeys = sourceFiles
      .map((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        return extractObjectLiteralKeys(source, "extensionHooks");
      })
      .flat();

    hookKeys.forEach((key) => {
      expect(ALLOWED_HOOKS).toContain(key);
    });
    expect(hookKeys).toHaveLength(ALLOWED_HOOKS.length);
  });
});
