#!/usr/bin/env ts-node

/**
 * Memory V1 — Long-Horizon Stress Simulation
 *
 * Runs 20 sessions × 50 messages (1000 total) through the memory engine
 * with controlled emotional regimes, then generates a Markdown report.
 *
 * Usage:
 *   npm run memory:v1:stress -- --seed 1337 --governed
 *   npm run memory:v1:stress -- --seed 42 --ungoverned
 */

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');

import { generateStressSessions, defaultBandSchedule } from '../src/emotion-core/memory-v1/stress/stressScenarios';
import { runStress } from '../src/emotion-core/memory-v1/stress/stressRunner';
import { computeVerdict, renderStressReportMd } from '../src/emotion-core/memory-v1/stress/stressAnalyzer';

function parseArgs(): { seed: number; governed: boolean } {
  const args = process.argv.slice(2);
  let seed = 1337;
  let governed = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      seed = parseInt(args[i + 1], 10) || 1337;
      i++;
    } else if (args[i] === '--governed') {
      governed = true;
    } else if (args[i] === '--ungoverned') {
      governed = false;
    }
  }
  return { seed, governed };
}

const USER_ID = 'stress_test_user';

function main(): void {
  const { seed, governed } = parseArgs();
  const out = process.stdout;
  const mode = governed ? 'GOVERNED' : 'UNGOVERNED';

  out.write('\n╔══════════════════════════════════════════╗\n');
  out.write(`║  Memory V1 — Stress Test (${mode.padEnd(10)})   ║\n`);
  out.write('╚══════════════════════════════════════════╝\n\n');

  out.write(`[1/3] Generating scenarios (seed=${seed})...\n`);
  const sessions = generateStressSessions(seed);
  const schedule = governed ? defaultBandSchedule() : undefined;

  out.write(`[2/3] Running stress simulation (${mode})...\n`);
  const t0 = Date.now();
  const result = runStress(USER_ID, sessions, schedule);
  const elapsed = Date.now() - t0;

  out.write(`[3/3] Generating report (${elapsed}ms elapsed)...\n\n`);

  const verdict = computeVerdict(result);
  const rawRate = result.totalMessages > 0
    ? (result.totalInjections / result.totalMessages * 100).toFixed(1)
    : '0.0';
  const govRate = result.messagesPolicyAllowsInjection > 0
    ? (result.totalInjections / result.messagesPolicyAllowsInjection * 100).toFixed(1)
    : '0.0';

  const md = renderStressReportMd(result);
  const outPath = path.join(PROJECT_ROOT, 'docs', 'MEMORY_V1_STRESS_REPORT.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf-8');

  out.write(`=== MEMORY V1 STRESS TEST (${mode}) ===\n`);
  out.write(`sessions: ${result.totalSessions}\n`);
  out.write(`totalMessages: ${result.totalMessages}\n`);
  out.write(`maxSchemasObserved: ${result.maxSchemasObserved}\n`);
  out.write(`rawInjectionRate: ${rawRate}%\n`);
  out.write(`messagesPolicyAllowsInjection: ${result.messagesPolicyAllowsInjection}\n`);
  out.write(`governedInjectionRate: ${govRate}%\n`);
  out.write(`oscillationSpikes: ${result.totalOscillations}\n`);
  out.write(`verdict: ${verdict}\n`);
  out.write(`elapsed: ${elapsed}ms\n`);
  out.write(`report: ${outPath}\n`);
}

main();
