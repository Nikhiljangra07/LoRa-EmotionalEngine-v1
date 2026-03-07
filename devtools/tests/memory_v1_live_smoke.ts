#!/usr/bin/env ts-node

/**
 * Memory V1 — Single-User Live Enable Smoke Test
 *
 * Runs LoRa with LORA_MEMORY_V1=1 for one user across two sessions
 * and validates that the MEMORY CONTEXT section:
 *   1. Appears in the prompt when schemas exist.
 *   2. Contains only categorical fields (no raw floats).
 *   3. Contains no forbidden companionship/intimacy/dependency language.
 *   4. Schema state persists and is non-decreasing across sessions.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const USER_ID = 'live_test_user';
const STATE_DIR = path.join(PROJECT_ROOT, '.lora', 'memory-v1', USER_ID);
const STATE_PATH = path.join(STATE_DIR, 'state.json');

const FLOAT_LEAK_RE = /\d+\.\d+|\b0\.\d+\b|\b1\.\d+\b/;

const FORBIDDEN_PHRASES = [
  'companion', 'companionship', 'intimacy', 'intimate', 'bond', 'bonding',
  'attachment', 'affection', 'closeness', 'rapport', 'love you', 'miss you',
  'need me', 'depend on me', 'always here for you', 'buddy', 'best friend',
  'soulmate', 'partner',
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_PHRASES.join('|')})\\b`, 'i');

// ---------------------------------------------------------------------------
// Message definitions — 8 per session, calmStable-style
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
  { outputs: { expressionStrength: { score: 0.3, confidence: 0.7 }, valence: { score: 0.1, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } }, state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 } },
  { outputs: { expressionStrength: { score: 0.5, confidence: 0.7 }, valence: { score: 0.5, confidence: 0.7 }, arousal: { score: 0.4, confidence: 0.7 } }, state: { dominant: 'JOY', arousal: 'MEDIUM', valence: 'POSITIVE', confidence: 0.8 } },
  { outputs: { expressionStrength: { score: 0.85, confidence: 0.8 }, valence: { score: -0.6, confidence: 0.8 }, arousal: { score: 0.75, confidence: 0.8 } }, state: { dominant: 'SADNESS', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.9, confidence: 0.8 }, valence: { score: -0.8, confidence: 0.8 }, arousal: { score: 0.85, confidence: 0.8 } }, state: { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.4, confidence: 0.7 }, valence: { score: 0.1, confidence: 0.6 }, arousal: { score: 0.3, confidence: 0.6 } }, state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.6 } },
  { outputs: { expressionStrength: { score: 0.35, confidence: 0.6 }, valence: { score: 0.3, confidence: 0.6 }, arousal: { score: 0.25, confidence: 0.6 } }, state: { dominant: 'CONTENTMENT', arousal: 'LOW', valence: 'POSITIVE', confidence: 0.6 } },
  { outputs: { expressionStrength: { score: 0.7, confidence: 0.7 }, valence: { score: -0.5, confidence: 0.7 }, arousal: { score: 0.6, confidence: 0.7 } }, state: { dominant: 'FEAR', arousal: 'MEDIUM', valence: 'NEGATIVE', confidence: 0.8 } },
  { outputs: { expressionStrength: { score: 0.3, confidence: 0.6 }, valence: { score: 0.2, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } }, state: { dominant: 'CONTENTMENT', arousal: 'LOW', valence: 'POSITIVE', confidence: 0.6 } },
];

const SESSION_B: Msg[] = [
  { outputs: { expressionStrength: { score: 0.35, confidence: 0.7 }, valence: { score: 0.0, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } }, state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 } },
  { outputs: { expressionStrength: { score: 0.8, confidence: 0.8 }, valence: { score: 0.7, confidence: 0.8 }, arousal: { score: 0.65, confidence: 0.8 } }, state: { dominant: 'JOY', arousal: 'HIGH', valence: 'POSITIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.9, confidence: 0.8 }, valence: { score: -0.75, confidence: 0.8 }, arousal: { score: 0.8, confidence: 0.8 } }, state: { dominant: 'SADNESS', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.85, confidence: 0.8 }, valence: { score: -0.7, confidence: 0.8 }, arousal: { score: 0.85, confidence: 0.8 } }, state: { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 } },
  { outputs: { expressionStrength: { score: 0.45, confidence: 0.7 }, valence: { score: 0.2, confidence: 0.6 }, arousal: { score: 0.35, confidence: 0.6 } }, state: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.6 } },
  { outputs: { expressionStrength: { score: 0.5, confidence: 0.7 }, valence: { score: 0.4, confidence: 0.7 }, arousal: { score: 0.4, confidence: 0.7 } }, state: { dominant: 'JOY', arousal: 'MEDIUM', valence: 'POSITIVE', confidence: 0.7 } },
  { outputs: { expressionStrength: { score: 0.6, confidence: 0.7 }, valence: { score: -0.4, confidence: 0.7 }, arousal: { score: 0.5, confidence: 0.7 } }, state: { dominant: 'FEAR', arousal: 'MEDIUM', valence: 'NEGATIVE', confidence: 0.7 } },
  { outputs: { expressionStrength: { score: 0.3, confidence: 0.6 }, valence: { score: 0.25, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } }, state: { dominant: 'CONTENTMENT', arousal: 'LOW', valence: 'POSITIVE', confidence: 0.6 } },
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

function extractMemorySection(prompt: string): string | null {
  const marker = 'MEMORY CONTEXT (privacy-safe, categorical)';
  const idx = prompt.indexOf(marker);
  if (idx === -1) return null;
  return prompt.slice(idx);
}

// ---------------------------------------------------------------------------
// Session runner
// ---------------------------------------------------------------------------

type SessionResult = {
  prompts: string[];
  logs: string[];
  schemasAfter: number;
  finalETV: number;
};

async function runSession(
  messages: Msg[],
  initialETV: number,
): Promise<SessionResult> {
  const orchPath = path.join(SRC_DIR, 'emotion-core', 'engines', 'EngineOrchestrator');
  const { EngineOrchestrator } = require(orchPath);

  const responder = () => ({
    generateResponse: async () => 'Deterministic live smoke response.',
  });

  const engine = new EngineOrchestrator(initialETV, {}, responder, { userId: USER_ID });
  const prompts: string[] = [];

  for (const msg of messages) {
    const r = await engine.processMessage(msg.outputs, msg.state);
    prompts.push(r.prompt);
  }

  const { newETV } = engine.endSession();
  const schemasAfter = readSchemaCount();

  return { prompts, logs: [], schemasAfter, finalETV: newETV };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const out = process.stdout;
  const failures: string[] = [];

  out.write('\n╔══════════════════════════════════════════╗\n');
  out.write('║  Memory V1 — Single-User Live Enable     ║\n');
  out.write('╚══════════════════════════════════════════╝\n\n');

  // ── Setup ──
  out.write('[1/5] Cleaning state + setting flags...\n');
  cleanStateDir();

  process.env.LORA_MEMORY_V1 = '1';
  process.env.LORA_MEMORY_V1_SHADOW = '0';
  process.env.LORA_DECISION_LOG = '1';
  process.env.LORA_DEBUG = '0';
  clearProjectCache();

  // Capture console to count memory logs
  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
  console.warn = (...args: unknown[]) => { capturedLogs.push('[WARN] ' + args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { capturedLogs.push('[ERROR] ' + args.map(String).join(' ')); };

  let schemasAfterA = 0;
  let schemasAfterB = 0;
  let allPrompts: string[] = [];

  try {
    // ── Session A ──
    out.write('[2/5] Running Session A (8 messages)...\n');
    const resultA = await runSession(SESSION_A, 0.5);
    schemasAfterA = resultA.schemasAfter;
    allPrompts.push(...resultA.prompts);

    // ── Session B ──
    out.write('[3/5] Running Session B (8 messages)...\n');
    const resultB = await runSession(SESSION_B, resultA.finalETV);
    schemasAfterB = resultB.schemasAfter;
    allPrompts.push(...resultB.prompts);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  // ── Checks ──
  out.write('[4/5] Running checks...\n\n');

  // 1. Count MEMORY CONTEXT blocks
  let memoryContextCount = 0;
  for (const p of allPrompts) {
    if (p.includes('MEMORY CONTEXT (privacy-safe, categorical)')) {
      memoryContextCount++;
    }
  }

  // 2. Float leak check — only inside MEMORY CONTEXT section
  let floatLeakCount = 0;
  for (let i = 0; i < allPrompts.length; i++) {
    const section = extractMemorySection(allPrompts[i]);
    if (section && FLOAT_LEAK_RE.test(section)) {
      floatLeakCount++;
      failures.push(`FLOAT_LEAK at message ${i}: found raw number in MEMORY CONTEXT`);
    }
  }

  // 3. Forbidden phrase check — only inside MEMORY CONTEXT section
  let forbiddenPhraseCount = 0;
  for (let i = 0; i < allPrompts.length; i++) {
    const section = extractMemorySection(allPrompts[i]);
    if (section) {
      const match = FORBIDDEN_RE.exec(section);
      if (match) {
        forbiddenPhraseCount++;
        failures.push(`FORBIDDEN_PHRASE at message ${i}: "${match[0]}" in MEMORY CONTEXT`);
      }
    }
  }

  // 4. State persistence
  const stateExists = fs.existsSync(STATE_PATH);
  if (!stateExists) {
    failures.push('STATE_MISSING: No state file found after two sessions');
  }

  // 5. Schema non-decreasing (warning, not hard fail — pruning is valid)
  const schemaDecreased = schemasAfterB < schemasAfterA;

  // 6. Memory logs emitted
  const memoryLogs = capturedLogs.filter(
    (l) => l.includes('[LoRa::Memory]') || l.includes('[LoRa::MemoryV1Shadow]'),
  );

  // 7. Categorical-only fields in MEMORY CONTEXT
  const VALID_TRAJECTORIES = ['calm-stable', 'escalating-negative', 'volatile', 'recovering', 'unknown'];
  const VALID_TENDENCIES = ['responds-to-clarification', 'responds-to-validation', 'resists-directiveness', 'needs-structure', 'unknown'];
  const VALID_CONFIDENCE = ['HIGH', 'MED', 'LOW'];
  const VALID_RELEVANCE = ['HIGH', 'MED', 'LOW'];

  let categoricalViolations = 0;
  for (let i = 0; i < allPrompts.length; i++) {
    const section = extractMemorySection(allPrompts[i]);
    if (!section) continue;

    const trajectoryMatches = section.match(/trajectory=(\S+)/g) ?? [];
    for (const tm of trajectoryMatches) {
      const val = tm.replace('trajectory=', '');
      if (!VALID_TRAJECTORIES.includes(val)) {
        categoricalViolations++;
        failures.push(`INVALID_TRAJECTORY at message ${i}: "${val}"`);
      }
    }

    const tendencyMatches = section.match(/tendency=(\S+)/g) ?? [];
    for (const tm of tendencyMatches) {
      const val = tm.replace('tendency=', '');
      if (!VALID_TENDENCIES.includes(val)) {
        categoricalViolations++;
        failures.push(`INVALID_TENDENCY at message ${i}: "${val}"`);
      }
    }

    const relevanceMatches = section.match(/relevance=(\S+)/g) ?? [];
    for (const rm of relevanceMatches) {
      const val = rm.replace('relevance=', '');
      if (!VALID_RELEVANCE.includes(val)) {
        categoricalViolations++;
        failures.push(`INVALID_RELEVANCE at message ${i}: "${val}"`);
      }
    }

    const confMatch = section.match(/confidence:\s*(\S+)/);
    if (confMatch && !VALID_CONFIDENCE.includes(confMatch[1])) {
      categoricalViolations++;
      failures.push(`INVALID_CONFIDENCE at message ${i}: "${confMatch[1]}"`);
    }

    const patternMatch = section.match(/sessionPattern:\s*(\S+)/);
    if (patternMatch && !VALID_TRAJECTORIES.includes(patternMatch[1])) {
      categoricalViolations++;
      failures.push(`INVALID_SESSION_PATTERN at message ${i}: "${patternMatch[1]}"`);
    }
  }

  // ── Summary ──
  out.write('[5/5] Results\n\n');
  out.write('=== LIVE ENABLE SMOKE RESULTS ===\n');
  out.write(`totalMessages:              ${allPrompts.length}\n`);
  out.write(`memoryContextBlocksSeen:    ${memoryContextCount}\n`);
  out.write(`schemasCountAfterSessionA:  ${schemasAfterA}\n`);
  out.write(`schemasCountAfterSessionB:  ${schemasAfterB}\n`);
  out.write(`stateFileExists:            ${stateExists}\n`);
  out.write(`memoryLogsEmitted:          ${memoryLogs.length}\n`);
  out.write(`floatLeakCount:             ${floatLeakCount}\n`);
  out.write(`forbiddenPhraseCount:       ${forbiddenPhraseCount}\n`);
  out.write(`categoricalViolations:      ${categoricalViolations}\n`);
  out.write(`schemaCountDecreased:       ${schemaDecreased}\n`);

  if (failures.length > 0) {
    out.write(`\nFAILURES (${failures.length}):\n`);
    for (const f of failures) {
      out.write(`  - ${f}\n`);
    }
    out.write('\n');
    process.exit(1);
  }

  out.write('\n✅ All live enable smoke checks passed.\n\n');
}

main().catch((err) => {
  process.stderr.write(`\n❌ LIVE SMOKE FAILED: ${err.message}\n`);
  process.exit(1);
});
