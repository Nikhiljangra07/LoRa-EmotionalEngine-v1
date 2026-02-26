#!/usr/bin/env ts-node

/**
 * Memory V1 — Long-Horizon Stress Simulation
 *
 * Runs 20 sessions × 50 messages (1000 total) through the memory engine
 * with controlled emotional regimes, then generates a Markdown report.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');

import { generateStressSessions } from '../src/emotion-core/memory-v1/stress/stressScenarios';
import { runStress } from '../src/emotion-core/memory-v1/stress/stressRunner';
import { computeVerdict, renderStressReportMd } from '../src/emotion-core/memory-v1/stress/stressAnalyzer';

const SEED = 42;
const USER_ID = 'stress_test_user';

function main(): void {
  const out = process.stdout;

  out.write('\n╔══════════════════════════════════════════╗\n');
  out.write('║  Memory V1 — Long-Horizon Stress Test    ║\n');
  out.write('╚══════════════════════════════════════════╝\n\n');

  out.write('[1/3] Generating scenarios (seed=42)...\n');
  const sessions = generateStressSessions(SEED);

  out.write('[2/3] Running stress simulation...\n');
  const t0 = Date.now();
  const result = runStress(USER_ID, sessions);
  const elapsed = Date.now() - t0;

  out.write(`[3/3] Generating report (${elapsed}ms elapsed)...\n\n`);

  const verdict = computeVerdict(result);
  const injRate = result.totalMessages > 0
    ? (result.totalInjections / result.totalMessages * 100).toFixed(1)
    : '0.0';

  const md = renderStressReportMd(result);
  const outPath = path.join(PROJECT_ROOT, 'docs', 'MEMORY_V1_STRESS_REPORT.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf-8');

  out.write('=== MEMORY V1 STRESS TEST ===\n');
  out.write(`sessions: ${result.totalSessions}\n`);
  out.write(`totalMessages: ${result.totalMessages}\n`);
  out.write(`maxSchemasObserved: ${result.maxSchemasObserved}\n`);
  out.write(`injectionRate: ${injRate}%\n`);
  out.write(`oscillationSpikes: ${result.totalOscillations}\n`);
  out.write(`verdict: ${verdict}\n`);
  out.write(`elapsed: ${elapsed}ms\n`);
  out.write(`report: ${outPath}\n`);
}

main();
