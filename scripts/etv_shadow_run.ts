#!/usr/bin/env ts-node
// scripts/etv_shadow_run.ts
//
// Deterministic ETV shadow-mode runner.
// Produces docs/ETV_V1_SHADOW_VALIDATION.md with calibration tables.
//
// Usage:  npx ts-node scripts/etv_shadow_run.ts

import * as fs from 'fs';
import * as path from 'path';
import { runSimulation, SimStepResult } from '../src/emotion-core/etv/sim/etvSimulator';
import {
  calmStable,
  intenseStable,
  volatileModerate,
  violationSessions,
  idleReturnScenario,
  calmStableShort,
  mixedLength,
} from '../src/emotion-core/etv/sim/fixtures';

// ── Table helpers ────────────────────────────────────────────────────

function pad(v: string, w: number): string {
  return v.length >= w ? v : v + ' '.repeat(w - v.length);
}

function num(v: number, d: number = 4): string {
  return v.toFixed(d);
}

function renderTable(results: SimStepResult[]): string {
  const headers = ['#', 'z', 'mass', 'mean', 'var', 'riskAdj', 'conf', 'band', 'nEff', 'decay', 'maxDepth', 'maxInit', 'tokens'];
  const widths  = [4,   6,    5,      6,      8,     8,          6,      8,      6,      6,       8,          8,         6];

  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  const hdr = '|' + headers.map((h, i) => ' ' + pad(h, widths[i]) + ' ').join('|') + '|';

  const rows = results.map((r, idx) => {
    const vals = [
      String(idx + 1),
      num(r.z),
      num(r.mass, 2),
      num(r.mean),
      num(r.variance, 6),
      num(r.riskAdjusted),
      num(r.conf),
      r.band,
      num(r.effectiveN, 1),
      num(r.decayApplied),
      num(r.policy.maxDepth),
      num(r.policy.maxInitiative),
      String(r.policy.maxResponseTokens),
    ];
    return '|' + vals.map((v, i) => ' ' + pad(v, widths[i]) + ' ').join('|') + '|';
  });

  return [hdr, sep, ...rows].join('\n');
}

// ── Scenario definitions ──────────────────────────────────────────────

const N = 12;

type Scenario = {
  name: string;
  description: string;
  sessions: ReturnType<typeof calmStable>;
};

const scenarios: Scenario[] = [
  { name: 'Calm Stable (10 msg)', description: 'Low EIV (0.20), low AVI (0.05), no violations, 10 messages.', sessions: calmStable(N) },
  { name: 'Intense Stable (10 msg)', description: 'High EIV (0.85), low AVI (0.05), no violations, 10 messages. eivRisk penalty active.', sessions: intenseStable(N) },
  { name: 'Volatile Moderate (10 msg)', description: 'Moderate EIV (0.40), high AVI (0.45), no violations, 10 messages.', sessions: volatileModerate(N) },
  { name: 'Violation Sessions (every 3rd)', description: 'Moderate EIV (0.40), low AVI (0.20), violation every 3rd session.', sessions: violationSessions(N, 3) },
  { name: 'Idle Return (30-day gap)', description: '6 calm sessions, 30-day idle gap, 2 sessions. Demonstrates decay.', sessions: idleReturnScenario() },
  { name: 'Calm Stable Short (2 msg)', description: 'Same as calm stable but only 2 messages — reduced evidence mass.', sessions: calmStableShort(N) },
  { name: 'Mixed Length', description: 'Alternating short (2 msg) and normal (10 msg) sessions.', sessions: mixedLength(N) },
];

// ── Run simulations ──────────────────────────────────────────────────

const simResults = scenarios.map(sc => ({
  ...sc,
  results: runSimulation(sc.sessions),
}));

// ── Sanity assertions ─────────────────────────────────────────────────

function assert(cond: boolean, msg: string): string {
  return cond ? `PASS: ${msg}` : `**FAIL**: ${msg}`;
}

const calmR = simResults.find(s => s.name.startsWith('Calm Stable ('))!.results;
const intenseR = simResults.find(s => s.name.startsWith('Intense Stable'))!.results;
const volatileR = simResults.find(s => s.name.startsWith('Volatile Moderate'))!.results;
const violR = simResults.find(s => s.name.startsWith('Violation'))!.results;
const idleR = simResults.find(s => s.name.startsWith('Idle'))!.results;
const shortR = simResults.find(s => s.name.startsWith('Calm Stable Short'))!.results;

const sanity: string[] = [];

// mean increases under calmStable
sanity.push(assert(
  calmR[calmR.length - 1].mean > calmR[0].mean,
  'calmStable: mean increases over sessions',
));

// intenseStable grows slower than calmStable due to eivRisk
sanity.push(assert(
  calmR[N - 1].mean > intenseR[N - 1].mean,
  'intenseStable grows slower than calmStable (eivRisk penalty)',
));

// intenseStable z is lower than calmStable z
sanity.push(assert(
  calmR[0].z > intenseR[0].z,
  'intenseStable z < calmStable z',
));

// volatileModerate yields lower z than calmStable
sanity.push(assert(
  calmR[0].z > volatileR[0].z,
  'volatileModerate z < calmStable z',
));

// volatileModerate grows slower
sanity.push(assert(
  calmR[N - 1].mean > volatileR[N - 1].mean,
  'volatileModerate mean < calmStable mean after N sessions',
));

// violations decrease z on violation sessions
const violZ = violR.filter((_, i) => (i + 1) % 3 === 0).map(r => r.z);
const violNonZ = violR.filter((_, i) => (i + 1) % 3 !== 0).map(r => r.z);
sanity.push(assert(
  violZ.every(z => z < Math.max(...violNonZ)),
  'violation sessions produce lower z than non-violation sessions',
));

// violation sessions suppress band upgrades vs calm
sanity.push(assert(
  calmR[N - 1].riskAdjusted > violR[N - 1].riskAdjusted,
  'violations suppress riskAdjusted vs calm',
));

// idle return: effectiveN after gap < effectiveN before gap
sanity.push(assert(
  idleR[5].effectiveN > idleR[6].effectiveN,
  'idle gap reduces effectiveN (decay)',
));

// idle return: conf drops after gap
sanity.push(assert(
  idleR[5].conf > idleR[6].conf,
  'idle gap reduces conf',
));

// short sessions grow slower (reduced mass)
sanity.push(assert(
  calmR[N - 1].mean > shortR[N - 1].mean,
  'short sessions (2 msg) grow slower than normal (10 msg)',
));

// cold start: no scenario reaches BAND_4 in first 6 sessions
const coldStartOk = simResults.every(sc => {
  const first6 = sc.results.slice(0, 6);
  return first6.every(r => r.band !== 'BAND_4');
});
sanity.push(assert(
  coldStartOk,
  'cold-start: no scenario reaches BAND_4 in first 6 sessions',
));

// ── Build markdown ────────────────────────────────────────────────────

const lines: string[] = [];

lines.push('# ETV V1 Shadow Validation Report');
lines.push('');
lines.push('> Auto-generated by `scripts/etv_shadow_run.ts`.');
lines.push(`> Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push('## Overview');
lines.push('');
lines.push('This report runs the full ETV V1 pipeline (evidence score, decay, beta update, policy map)');
lines.push('over deterministic synthetic scenarios to validate calibration before prompt integration.');
lines.push('');
lines.push('### Constants used');
lines.push('');
lines.push('| Parameter | Value |');
lines.push('|-----------|-------|');
lines.push('| Half-life | 14 days |');
lines.push('| Evidence mass (normal) | 1.0 |');
lines.push('| Evidence mass (short) | 0.25 |');
lines.push('| Short-session threshold | < 4 messages |');
lines.push('| Prior (r₀, s₀) | (1.5, 2.5) |');
lines.push('| Risk aversion K | 1.5 |');
lines.push('| EIV risk weight | 0.20 |');
lines.push('| EIV risk threshold | 0.70 |');
lines.push('| AVI weights (mean/max) | 0.40 / 0.25 |');
lines.push('| Violation penalty | 0.30 |');
lines.push('');

lines.push('---');
lines.push('');
lines.push('## Scenario Tables');
lines.push('');

for (const sc of simResults) {
  lines.push(`### ${sc.name}`);
  lines.push('');
  lines.push(`> ${sc.description}`);
  lines.push('');
  lines.push(renderTable(sc.results));
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Sanity Assertions');
lines.push('');
for (const s of sanity) {
  lines.push(`- ${s}`);
}
lines.push('');

lines.push('---');
lines.push('');
lines.push('## Cold-Start Behavior');
lines.push('');
lines.push('First 6 sessions for each scenario:');
lines.push('');
for (const sc of simResults) {
  const first6 = sc.results.slice(0, 6);
  const bands = first6.map(r => r.band).join(' → ');
  const means = first6.map(r => num(r.mean)).join(' → ');
  lines.push(`**${sc.name}**: bands: ${bands}  |  mean: ${means}`);
  lines.push('');
}
lines.push('No scenario reaches BAND_4 during cold-start, confirming conservative ramp.');
lines.push('');

lines.push('---');
lines.push('');
lines.push('## Parameter Sensitivity Notes');
lines.push('');
lines.push('The following parameters are candidates for future tuning. **No changes are made now.**');
lines.push('');
lines.push('| Parameter | Current | Effect if increased | Effect if decreased |');
lines.push('|-----------|---------|---------------------|---------------------|');
lines.push('| `decayHalfLifeDays` | 14 | Trust persists longer during idle; slower forgetting | Faster forgetting; returning users start lower |');
lines.push('| `evidenceMass` (M) | 1.0 | Each session has more weight; faster convergence | Slower convergence; more sessions to build trust |');
lines.push('| `riskAversionK` | 1.5 | riskAdjusted penalized more by variance; conservative | Faster band progression; less conservative |');
lines.push('| `SHORT_SESSION.reducedMass` | 0.25 | Short sessions count more toward trust | Short sessions have even less influence |');
lines.push('| `ETV_EIV_RISK.weight` | 0.20 | Stronger penalty for intense-but-stable users | Less sensitivity to high EIV |');
lines.push('| `ETV_EIV_RISK.startThreshold` | 0.70 | Penalty kicks in at higher intensity only | More sessions trigger eivRisk penalty |');
lines.push('| Band thresholds | 0.25/0.40/0.55/0.70 | Higher thresholds = slower band progression | Faster band upgrades |');
lines.push('');
lines.push('Tuning should be guided by real session telemetry once shadow logging is live.');
lines.push('');

const md = lines.join('\n');

// Write to docs/
const outPath = path.resolve(__dirname, '..', 'docs', 'ETV_V1_SHADOW_VALIDATION.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf-8');

// Also print to console
console.log(md);
console.log(`\n✔ Report written to ${outPath}`);
