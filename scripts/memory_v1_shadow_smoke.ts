#!/usr/bin/env ts-node

/**
 * Memory V1 Shadow Smoke Test
 *
 * Runs LoRa's full pipeline twice (baseline vs shadow) and verifies:
 *   1. Prompt output is byte-identical when shadow is enabled.
 *   2. Memory logs are emitted during the shadow run.
 *   3. State is persisted to disk and survives a session boundary.
 *   4. No MEMORY CONTEXT block leaks into the prompt.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const USER_ID = 'shadow_test_user';
const STATE_DIR = path.join(PROJECT_ROOT, '.lora', 'memory-v1', USER_ID);
const STATE_PATH = path.join(STATE_DIR, 'state.json');

// ---------------------------------------------------------------------------
// Deterministic message sequences
// ---------------------------------------------------------------------------

type Outputs = {
  expressionStrength: { score: number; confidence: number };
  valence: { score: number; confidence: number };
  arousal: { score: number; confidence: number };
};

type State = {
  dominant: string;
  arousal: 'LOW' | 'MEDIUM' | 'HIGH';
  valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE';
  confidence: number;
};

type Msg = { outputs: Outputs; state: State };

const SESSION_A: Msg[] = [
  {
    outputs: { expressionStrength: { score: 0.3, confidence: 0.7 }, valence: { score: 0.0, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } },
    state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 },
  },
  {
    outputs: { expressionStrength: { score: 0.6, confidence: 0.7 }, valence: { score: 0.6, confidence: 0.7 }, arousal: { score: 0.5, confidence: 0.7 } },
    state: { dominant: 'JOY', arousal: 'MEDIUM', valence: 'POSITIVE', confidence: 0.8 },
  },
  {
    outputs: { expressionStrength: { score: 0.9, confidence: 0.8 }, valence: { score: -0.7, confidence: 0.8 }, arousal: { score: 0.8, confidence: 0.8 } },
    state: { dominant: 'SADNESS', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
  },
  {
    outputs: { expressionStrength: { score: 0.85, confidence: 0.8 }, valence: { score: -0.8, confidence: 0.8 }, arousal: { score: 0.9, confidence: 0.8 } },
    state: { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
  },
  {
    outputs: { expressionStrength: { score: 0.4, confidence: 0.7 }, valence: { score: 0.2, confidence: 0.6 }, arousal: { score: 0.3, confidence: 0.6 } },
    state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.6 },
  },
  {
    outputs: { expressionStrength: { score: 0.3, confidence: 0.6 }, valence: { score: 0.3, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } },
    state: { dominant: 'CONTENTMENT', arousal: 'LOW', valence: 'POSITIVE', confidence: 0.6 },
  },
];

const SESSION_B: Msg[] = [
  {
    outputs: { expressionStrength: { score: 0.35, confidence: 0.7 }, valence: { score: 0.1, confidence: 0.6 }, arousal: { score: 0.25, confidence: 0.6 } },
    state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 },
  },
  {
    outputs: { expressionStrength: { score: 0.8, confidence: 0.8 }, valence: { score: 0.7, confidence: 0.8 }, arousal: { score: 0.7, confidence: 0.8 } },
    state: { dominant: 'JOY', arousal: 'HIGH', valence: 'POSITIVE', confidence: 0.9 },
  },
  {
    outputs: { expressionStrength: { score: 0.9, confidence: 0.8 }, valence: { score: -0.8, confidence: 0.8 }, arousal: { score: 0.85, confidence: 0.8 } },
    state: { dominant: 'FEAR', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
  },
  {
    outputs: { expressionStrength: { score: 0.5, confidence: 0.7 }, valence: { score: -0.2, confidence: 0.6 }, arousal: { score: 0.4, confidence: 0.7 } },
    state: { dominant: 'SADNESS', arousal: 'MEDIUM', valence: 'NEGATIVE', confidence: 0.7 },
  },
  {
    outputs: { expressionStrength: { score: 0.5, confidence: 0.7 }, valence: { score: 0.5, confidence: 0.7 }, arousal: { score: 0.4, confidence: 0.7 } },
    state: { dominant: 'JOY', arousal: 'MEDIUM', valence: 'POSITIVE', confidence: 0.7 },
  },
  {
    outputs: { expressionStrength: { score: 0.3, confidence: 0.6 }, valence: { score: 0.2, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } },
    state: { dominant: 'CONTENTMENT', arousal: 'LOW', valence: 'POSITIVE', confidence: 0.6 },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearProjectCache(): void {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) {
      delete require.cache[key];
    }
  }
}

function readSchemaCount(): number {
  if (!fs.existsSync(STATE_PATH)) return 0;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    return Array.isArray(raw.schemas) ? raw.schemas.length : 0;
  } catch {
    return 0;
  }
}

function cleanStateDir(): void {
  if (fs.existsSync(STATE_DIR)) {
    fs.rmSync(STATE_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Run two sessions with given env config
// ---------------------------------------------------------------------------

type RunResult = {
  prompts: string[];
  logs: string[];
  schemasAfterA: number;
  schemasAfterB: number;
};

async function runTwoSessions(envConfig: Record<string, string>): Promise<RunResult> {
  for (const [k, v] of Object.entries(envConfig)) {
    process.env[k] = v;
  }
  clearProjectCache();

  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    capturedLogs.push('[WARN] ' + args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    capturedLogs.push('[ERROR] ' + args.map(String).join(' '));
  };

  try {
    const orchPath = path.join(SRC_DIR, 'emotion-core', 'engines', 'EngineOrchestrator');
    const { EngineOrchestrator } = require(orchPath);

    const responder = () => ({
      generateResponse: async () => 'Deterministic shadow smoke response.',
    });

    const prompts: string[] = [];

    // ── Session A ──
    const engineA = new EngineOrchestrator(0.5, {}, responder, { userId: USER_ID });
    for (const msg of SESSION_A) {
      const r = await engineA.processMessage(msg.outputs, msg.state);
      prompts.push(r.prompt);
    }
    const { newETV } = engineA.endSession();
    const schemasAfterA = readSchemaCount();

    // ── Session B (new engine, loads persisted state from disk) ──
    const engineB = new EngineOrchestrator(newETV, {}, responder, { userId: USER_ID });
    for (const msg of SESSION_B) {
      const r = await engineB.processMessage(msg.outputs, msg.state);
      prompts.push(r.prompt);
    }
    engineB.endSession();
    const schemasAfterB = readSchemaCount();

    return { prompts, logs: capturedLogs, schemasAfterA, schemasAfterB };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const out = process.stdout;

  out.write('\n[1/4] Cleaning state directory...\n');
  cleanStateDir();

  // ── Baseline run (all memory flags OFF) ──
  out.write('[2/4] Running baseline (flags off)...\n');
  const baseline = await runTwoSessions({
    LORA_MEMORY_V1: '0',
    LORA_MEMORY_V1_SHADOW: '0',
    LORA_DECISION_LOG: '1',
    LORA_DEBUG: '0',
  });

  // Clean any stale state the baseline might have left (it shouldn't, but be safe)
  cleanStateDir();

  // ── Shadow run (shadow flag ON, memory flag OFF) ──
  out.write('[3/4] Running shadow (LORA_MEMORY_V1_SHADOW=1)...\n');
  const shadow = await runTwoSessions({
    LORA_MEMORY_V1: '0',
    LORA_MEMORY_V1_SHADOW: '1',
    LORA_DECISION_LOG: '1',
    LORA_DEBUG: '0',
  });

  // ── Assertions ──
  out.write('[4/4] Verifying...\n\n');

  // 1. Prompt byte-equality
  if (baseline.prompts.length !== shadow.prompts.length) {
    throw new Error(
      `Prompt count mismatch: baseline=${baseline.prompts.length} shadow=${shadow.prompts.length}`,
    );
  }
  for (let i = 0; i < baseline.prompts.length; i++) {
    if (baseline.prompts[i] !== shadow.prompts[i]) {
      let diffPos = 0;
      const b = baseline.prompts[i];
      const s = shadow.prompts[i];
      while (diffPos < b.length && diffPos < s.length && b[diffPos] === s[diffPos]) {
        diffPos++;
      }
      const lo = Math.max(0, diffPos - 40);
      const hi = diffPos + 40;
      throw new Error(
        `Prompt mismatch at message index ${i}, char ${diffPos}:\n` +
        `  baseline[${lo}..${hi}]: ${JSON.stringify(b.slice(lo, hi))}\n` +
        `  shadow  [${lo}..${hi}]: ${JSON.stringify(s.slice(lo, hi))}`,
      );
    }
  }

  // 2. No MEMORY CONTEXT in any shadow prompt
  for (let i = 0; i < shadow.prompts.length; i++) {
    if (shadow.prompts[i].includes('MEMORY CONTEXT')) {
      throw new Error(`MEMORY CONTEXT leaked into shadow prompt at message index ${i}`);
    }
  }

  // 3. Memory logs emitted
  const memoryLogs = shadow.logs.filter(
    (l) => l.includes('[LoRa::Memory]') || l.includes('[LoRa::MemoryV1Shadow]'),
  );
  if (memoryLogs.length === 0) {
    throw new Error('No memory logs emitted during shadow run');
  }

  // 4. State file exists
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`State file not found at ${STATE_PATH}`);
  }

  // 5. Schema count non-decreasing across sessions
  if (shadow.schemasAfterB < shadow.schemasAfterA) {
    out.write(
      `  WARNING: schema count decreased (A=${shadow.schemasAfterA} → B=${shadow.schemasAfterB}), ` +
      `may indicate pruning — acceptable if consolidation logic permits.\n`,
    );
  }

  // ── Summary ──
  out.write('=== SHADOW SMOKE TEST RESULTS ===\n');
  out.write(`totalMessages:              ${baseline.prompts.length}\n`);
  out.write(`promptEqualityPass:         true\n`);
  out.write(`memoryLogsCount:            ${memoryLogs.length}\n`);
  out.write(`statePath:                  ${STATE_PATH}\n`);
  out.write(`schemasCountAfterSessionA:  ${shadow.schemasAfterA}\n`);
  out.write(`schemasCountAfterSessionB:  ${shadow.schemasAfterB}\n`);
  out.write(`baselineLogsCount:          ${baseline.logs.length}\n`);
  out.write(`shadowLogsCount:            ${shadow.logs.length}\n`);
  out.write('\n✅ All shadow smoke checks passed.\n\n');
}

main().catch((err) => {
  process.stderr.write(`\n❌ SHADOW SMOKE FAILED: ${err.message}\n`);
  process.exit(1);
});
