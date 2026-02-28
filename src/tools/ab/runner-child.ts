#!/usr/bin/env ts-node
/**
 * Runner child: runs a single A or B harness run in an isolated process.
 *
 * Ensures feature flags are frozen correctly (bridge ON or OFF) by loading
 * in a fresh Node process with env set before module load.
 *
 * Prints exactly one JSON blob to stdout: { runLabel: 'A'|'B', turns: TurnResult[] }
 * No other output. Parent harvests stdout and fails if invalid JSON.
 *
 * Env (set by parent):
 *   LORA_RUN_LABEL: 'A' | 'B'
 *   LORA_WAVE_SCRIPT: v1 | v2 | v3
 *   LORA_DECISION_LOG: '0' (quiet mode)
 *   ANTHROPIC_API_KEY: (from parent env or .env.local)
 */

const noop = () => {};
(global as any).console.log = noop;
(global as any).console.warn = noop;
(global as any).console.error = noop;
(global as any).console.info = noop;
(global as any).console.debug = noop;

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), quiet: true });

process.env.LORA_DECISION_LOG = '0';

const runLabel = process.env.LORA_RUN_LABEL === 'B' ? 'B' : 'A';
const appraisalOn = runLabel === 'A';
const scriptVersion = process.env.LORA_WAVE_SCRIPT ?? 'v1';

async function run(): Promise<void> {
  const { runConversation } = await import('./ab-appraisal-harness');
  const { getWaveScript } = await import('./waveScripts');

  const script = getWaveScript(scriptVersion);
  const result = await runConversation(
    runLabel === 'A' ? 'A (Appraisal ON)' : 'B (Appraisal OFF)',
    appraisalOn,
    script,
  );

  const output = JSON.stringify({ runLabel, turns: result.turns });
  process.stdout.write(output + '\n');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err));
    process.exit(1);
  });
