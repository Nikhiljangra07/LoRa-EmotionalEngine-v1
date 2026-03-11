#!/usr/bin/env ts-node

/**
 * Memory V1 — Debug Observability Smoke Test
 *
 * Runs 6 messages with LORA_MEMORY_V1=1 and LORA_MEMORY_V1_DEBUG=1,
 * collects [LoRa::MemoryV1Debug] log lines, and asserts:
 *   1. At least 3 debug events emitted.
 *   2. Zero float leaks in snapshots.
 *   3. topSchemaIds.length <= 3 for every snapshot.
 *   4. All snapshots have the correct tag.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const USER_ID = 'debug_smoke_user';
const STATE_DIR = path.join(PROJECT_ROOT, '.lora', 'memory-v1', USER_ID);

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

const MESSAGES: Msg[] = [
  { outputs: { expressionStrength: { score: 0.3, confidence: 0.7 }, valence: { score: 0.1, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } }, state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 } },
  { outputs: { expressionStrength: { score: 0.5, confidence: 0.7 }, valence: { score: 0.5, confidence: 0.7 }, arousal: { score: 0.4, confidence: 0.7 } }, state: { dominant: 'JOY', arousal: 'MEDIUM', valence: 'POSITIVE', confidence: 0.8 } },
  { outputs: { expressionStrength: { score: 0.85, confidence: 0.8 }, valence: { score: -0.6, confidence: 0.8 }, arousal: { score: 0.75, confidence: 0.8 } }, state: { dominant: 'SADNESS', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.9, confidence: 0.8 }, valence: { score: -0.8, confidence: 0.8 }, arousal: { score: 0.85, confidence: 0.8 } }, state: { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.4, confidence: 0.7 }, valence: { score: 0.1, confidence: 0.6 }, arousal: { score: 0.3, confidence: 0.6 } }, state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.6 } },
  { outputs: { expressionStrength: { score: 0.7, confidence: 0.7 }, valence: { score: -0.5, confidence: 0.7 }, arousal: { score: 0.6, confidence: 0.7 } }, state: { dominant: 'FEAR', arousal: 'MEDIUM', valence: 'NEGATIVE', confidence: 0.8 } },
];

const FLOAT_RE = /\d+\.\d+/;
const DEBUG_PREFIX = '[LoRa::MemoryV1Debug]';

function clearProjectCache(): void {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) {
      delete require.cache[key];
    }
  }
}

function cleanStateDir(): void {
  if (fs.existsSync(STATE_DIR)) {
    fs.rmSync(STATE_DIR, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const out = process.stdout;
  const failures: string[] = [];

  out.write('\n╔══════════════════════════════════════════╗\n');
  out.write('║  Memory V1 — Debug Observability Smoke   ║\n');
  out.write('╚══════════════════════════════════════════╝\n\n');

  cleanStateDir();

  process.env.LORA_MEMORY_V1 = '1';
  process.env.LORA_MEMORY_V1_SHADOW = '0';
  process.env.LORA_MEMORY_V1_DEBUG = '1';
  process.env.LORA_DECISION_LOG = '1';
  process.env.LORA_DEBUG = '0';
  clearProjectCache();

  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
  console.warn = (...args: unknown[]) => { capturedLogs.push('[WARN] ' + args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { capturedLogs.push('[ERROR] ' + args.map(String).join(' ')); };

  try {
    out.write('[1/3] Running 6 messages with memory + debug enabled...\n');
    const orchPath = path.join(SRC_DIR, 'emotion-core', 'engines', 'EngineOrchestrator');
    const { EngineOrchestrator } = require(orchPath);

    const responder = () => ({
      generateResponse: async () => 'Debug smoke deterministic response.',
    });
    const engine = new EngineOrchestrator(0.5, {}, responder, { userId: USER_ID });

    for (const msg of MESSAGES) {
      await engine.processMessage(msg.outputs, msg.state);
    }
    engine.endSession();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  // ── Collect debug lines ──
  out.write('[2/3] Collecting debug snapshots...\n');

  const debugLines = capturedLogs.filter((l) => l.includes(DEBUG_PREFIX));
  const snapshots: Array<Record<string, unknown>> = [];
  for (const line of debugLines) {
    const jsonStart = line.indexOf('{');
    if (jsonStart !== -1) {
      try {
        snapshots.push(JSON.parse(line.slice(jsonStart)));
      } catch { /* skip malformed */ }
    }
  }

  // ── Assertions ──
  out.write('[3/3] Validating...\n\n');

  // A) At least 3 debug events
  if (snapshots.length < 3) {
    failures.push(`Expected >= 3 debug snapshots, got ${snapshots.length}`);
  }

  // B) Zero float leaks
  let floatLeaks = 0;
  for (const snap of snapshots) {
    const json = JSON.stringify(snap);
    const sanitized = json
      .replace(/"userId":"[^"]*"/g, '')
      .replace(/"sessionId":"[^"]*"/g, '')
      .replace(/"messageId":"[^"]*"/g, '')
      .replace(/"winnerSchemaId":"[^"]*"/g, '')
      .replace(/"topSchemaIds":\[("[^"]*",?)*\]/g, '');
    if (FLOAT_RE.test(sanitized)) {
      floatLeaks++;
      failures.push(`Float leak in snapshot: ${json.slice(0, 200)}`);
    }
  }

  // C) topSchemaIds max 3
  let topSchemaViolations = 0;
  for (const snap of snapshots) {
    const ids = snap.topSchemaIds;
    if (Array.isArray(ids) && ids.length > 3) {
      topSchemaViolations++;
      failures.push(`topSchemaIds.length = ${ids.length} (max 3)`);
    }
  }

  // D) Correct tag
  let tagViolations = 0;
  for (const snap of snapshots) {
    if (snap.tag !== 'memory:v1:debug') {
      tagViolations++;
      failures.push(`Bad tag: ${snap.tag}`);
    }
  }

  // ── Summary ──
  out.write('──────────────────────────────────────────\n');
  out.write(`  debugSnapshotsEmitted: ${snapshots.length}\n`);
  out.write(`  floatLeakCount:        ${floatLeaks}\n`);
  out.write(`  topSchemaViolations:   ${topSchemaViolations}\n`);
  out.write(`  tagViolations:         ${tagViolations}\n`);
  out.write(`  totalLogLines:         ${capturedLogs.length}\n`);
  out.write('──────────────────────────────────────────\n\n');

  if (failures.length > 0) {
    out.write(`FAILED (${failures.length} issues):\n`);
    for (const f of failures) {
      out.write(`  ✗ ${f}\n`);
    }
    process.exit(1);
  } else {
    out.write('ALL CHECKS PASSED.\n');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
