#!/usr/bin/env ts-node
/**
 * A/B Emotional Waveform Stress Test
 *
 * 20-turn scripted conversation designed to oscillate through emotional
 * peaks and troughs. Runs twice: A (Appraisal Lab ON), B (Appraisal Lab OFF).
 * Compares navigation behavior: guidance transitions, escalation tracking,
 * pacing changes, scope narrowing, and intensity reduction.
 *
 * Requires: ANTHROPIC_API_KEY in environment or .env.local.
 *
 * Usage: npm run ab:wave
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

import { runConversation } from './ab-appraisal-harness';
import type { TurnResult, RunResult } from './ab-appraisal-harness';
import { getWaveScript, WAVE_SCRIPT_V1, WAVE_SCRIPT_V2 } from './waveScripts';

const scriptVersion = process.env.LORA_WAVE_SCRIPT ?? 'v1';
const WAVE_SCRIPT = getWaveScript(scriptVersion);

// ---------------------------------------------------------------------------
// Escalation label mapping (numeric level → categorical)
// ---------------------------------------------------------------------------
function escalationLabel(level: number | null): string {
  if (level === null) return 'none';
  if (level === 0) return 'CALM';
  if (level === 1) return 'RISING';
  if (level === 2) return 'ESCALATED';
  return 'CRITICAL';
}

// ---------------------------------------------------------------------------
// Escalation trend: compare current to previous
// ---------------------------------------------------------------------------
function escalationTrend(prev: number | null, cur: number | null): 'UP' | 'DOWN' | 'FLAT' {
  const p = prev ?? 0;
  const c = cur ?? 0;
  if (c > p) return 'UP';
  if (c < p) return 'DOWN';
  return 'FLAT';
}

// ---------------------------------------------------------------------------
// Extended diff per turn
// ---------------------------------------------------------------------------
interface WaveTurnDiff {
  turn: number;
  fieldsChanged: number;
  responseChanged: boolean;
  guidanceChanged: boolean;
  escalationChanged: boolean;
  pacingChanged: boolean;
  changedFields: string[];
  signalWithNoOverlay: string[];
  escalationTrendA: 'UP' | 'DOWN' | 'FLAT';
  escalationTrendB: 'UP' | 'DOWN' | 'FLAT';
  guidanceModeChangedFromPrevA: boolean;
  guidanceModeChangedFromPrevB: boolean;
  volatilityTierA: string;
  volatilityTierB: string;
  questionBudgetChangedA: boolean;
  questionBudgetChangedB: boolean;
  pacingChangedFromPrevA: boolean;
  pacingChangedFromPrevB: boolean;
}

function computeWaveDiffs(a: RunResult, b: RunResult): WaveTurnDiff[] {
  const diffs: WaveTurnDiff[] = [];
  for (let i = 0; i < a.turns.length; i++) {
    const ta = a.turns[i];
    const tb = b.turns[i];
    const prevA = i > 0 ? a.turns[i - 1] : null;
    const prevB = i > 0 ? b.turns[i - 1] : null;

    const changedFields: string[] = [];
    if (ta.guidanceMode !== tb.guidanceMode) changedFields.push('guidanceMode');
    if (ta.ekmanDominant !== tb.ekmanDominant) changedFields.push('ekmanDominant');
    if (ta.volatilityState !== tb.volatilityState) changedFields.push('volatilityState');
    if (ta.escalationLevel !== tb.escalationLevel) changedFields.push('escalationLevel');
    if (ta.pacingHint !== tb.pacingHint) changedFields.push('pacingHint');
    if (ta.questionBudgetHint !== tb.questionBudgetHint) changedFields.push('questionBudgetHint');

    const aHints = ta.hints.join(',');
    const bHints = tb.hints.join(',');
    if (aHints !== bHints) changedFields.push('hints');

    const responseChanged = ta.assistantResponse !== tb.assistantResponse;

    const signalWithNoOverlay: string[] = [];
    if (ta.ekmanDominant && !ta.prompt.includes('Dominant signal:')) {
      signalWithNoOverlay.push(`turn${ta.turn}:ekman_no_prompt`);
    }
    if (ta.escalationLevel !== null && ta.escalationLevel >= 1 && !ta.prompt.includes('SIGNAL CONTEXT')) {
      signalWithNoOverlay.push(`turn${ta.turn}:escalation_no_signal_block`);
    }

    diffs.push({
      turn: i + 1,
      fieldsChanged: changedFields.length,
      responseChanged,
      guidanceChanged: ta.guidanceMode !== tb.guidanceMode,
      escalationChanged: ta.escalationLevel !== tb.escalationLevel,
      pacingChanged: ta.pacingHint !== tb.pacingHint,
      changedFields,
      signalWithNoOverlay,
      escalationTrendA: escalationTrend(prevA?.escalationLevel ?? null, ta.escalationLevel),
      escalationTrendB: escalationTrend(prevB?.escalationLevel ?? null, tb.escalationLevel),
      guidanceModeChangedFromPrevA: prevA ? ta.guidanceMode !== prevA.guidanceMode : false,
      guidanceModeChangedFromPrevB: prevB ? tb.guidanceMode !== prevB.guidanceMode : false,
      volatilityTierA: ta.volatilityState,
      volatilityTierB: tb.volatilityState,
      questionBudgetChangedA: prevA ? ta.questionBudgetHint !== prevA.questionBudgetHint : false,
      questionBudgetChangedB: prevB ? tb.questionBudgetHint !== prevB.questionBudgetHint : false,
      pacingChangedFromPrevA: prevA ? ta.pacingHint !== prevA.pacingHint : false,
      pacingChangedFromPrevB: prevB ? tb.pacingHint !== prevB.pacingHint : false,
    });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Scope / intensity heuristics
// ---------------------------------------------------------------------------
const NARROWING_MODES = new Set(['STABILIZING', 'CONTAINMENT', 'DE_ESCALATE']);
const BROADENING_MODES = new Set(['CALM_NEUTRAL', 'ENERGY_MATCH']);

function isNarrowing(t: TurnResult): boolean {
  return NARROWING_MODES.has(t.guidanceMode);
}

function isBroadening(t: TurnResult): boolean {
  return BROADENING_MODES.has(t.guidanceMode);
}

function intensityScore(t: TurnResult): number {
  let score = 0;
  if (t.escalationLevel !== null) score += t.escalationLevel;
  if (t.volatilityState === 'HIGH') score += 2;
  else if (t.volatilityState === 'MEDIUM') score += 1;
  score += t.hints.length;
  return score;
}

// ---------------------------------------------------------------------------
// Report printer
// ---------------------------------------------------------------------------
function printWaveReport(a: RunResult, b: RunResult, diffs: WaveTurnDiff[]): void {
  const W = 100;
  const sep = '='.repeat(W);
  const thin = '-'.repeat(W);
  const totalTurns = a.turns.length;

  console.log('\n' + sep);
  console.log(`  AB EMOTIONAL WAVEFORM STRESS TEST (${scriptVersion.toUpperCase()})`);
  console.log('  A = Appraisal Lab ON  |  B = Appraisal Lab OFF');
  console.log('  Turns: ' + totalTurns);
  console.log(sep + '\n');

  for (let i = 0; i < totalTurns; i++) {
    const ta = a.turns[i];
    const tb = b.turns[i];
    const d = diffs[i];

    console.log(thin);
    console.log(`Turn ${i + 1}`);
    console.log(`User: "${ta.userMessage}"`);
    console.log('');

    const fmtBlock = (label: string, t: TurnResult, d: WaveTurnDiff, isA: boolean) => {
      const escLabel = escalationLabel(t.escalationLevel);
      const trend = isA ? d.escalationTrendA : d.escalationTrendB;
      const gmChanged = isA ? d.guidanceModeChangedFromPrevA : d.guidanceModeChangedFromPrevB;
      const pacChanged = isA ? d.pacingChangedFromPrevA : d.pacingChangedFromPrevB;
      const qbChanged = isA ? d.questionBudgetChangedA : d.questionBudgetChangedB;

      console.log(`${label}:`);
      console.log(`  guidanceMode=${t.guidanceMode}${gmChanged ? ' [CHANGED]' : ''}`);
      console.log(`  ekman=${t.ekmanDominant ?? 'none'}`);
      console.log(`  volatility=${t.volatilityState}`);
      console.log(`  escalation=${escLabel} (trend: ${trend})`);
      console.log(`  pacing=${t.pacingHint ?? 'none'}${pacChanged ? ' [CHANGED]' : ''}`);
      console.log(`  questionBudget=${t.questionBudgetHint ?? 'none'}${qbChanged ? ' [CHANGED]' : ''}`);
      console.log(`  hints=[${t.hints.join(', ')}]`);

      const resp = t.assistantResponse.length > 250
        ? t.assistantResponse.slice(0, 250) + '...'
        : t.assistantResponse;
      console.log('');
      console.log(`  Response: "${resp}"`);
    };

    fmtBlock('A', ta, d, true);
    console.log('');
    fmtBlock('B', tb, d, false);
    console.log('');

    console.log('Diff:');
    console.log(
      `  fields_changed=${d.fieldsChanged}  response_changed=${d.responseChanged}  ` +
      `guidance_changed=${d.guidanceChanged}  escalation_changed=${d.escalationChanged}  ` +
      `pacing_changed=${d.pacingChanged}`,
    );
    if (d.changedFields.length > 0) {
      console.log(`  changed: [${d.changedFields.join(', ')}]`);
    }
    if (d.signalWithNoOverlay.length > 0) {
      console.log(`  ⚠ Signal with no overlay: ${d.signalWithNoOverlay.join(', ')}`);
    }
    console.log('');
  }

  // ── Final summary ──
  console.log(sep);
  console.log('  FINAL SUMMARY');
  console.log(sep);

  const responsesChanged = diffs.filter((d) => d.responseChanged).length;
  const avgFieldsChanged = diffs.reduce((s, d) => s + d.fieldsChanged, 0) / totalTurns;

  const guidanceTransitionsA = diffs.filter((d) => d.guidanceModeChangedFromPrevA).length;
  const guidanceTransitionsB = diffs.filter((d) => d.guidanceModeChangedFromPrevB).length;

  const pacingChangesA = diffs.filter((d) => d.pacingChangedFromPrevA).length;
  const pacingChangesB = diffs.filter((d) => d.pacingChangedFromPrevB).length;

  const escalationTransitionsA = diffs.filter((d, i) =>
    i > 0 && a.turns[i].escalationLevel !== a.turns[i - 1].escalationLevel,
  ).length;
  const escalationTransitionsB = diffs.filter((d, i) =>
    i > 0 && b.turns[i].escalationLevel !== b.turns[i - 1].escalationLevel,
  ).length;

  const volSpikesA = a.turns
    .filter((t) => t.volatilityState === 'HIGH')
    .map((t) => t.turn);
  const volSpikesB = b.turns
    .filter((t) => t.volatilityState === 'HIGH')
    .map((t) => t.turn);

  const turnsADeescBEsc: number[] = [];
  const turnsANarrowBBroad: number[] = [];
  const turnsAReducedIntensity: number[] = [];

  for (let i = 1; i < totalTurns; i++) {
    const currA = a.turns[i];
    const prevAT = a.turns[i - 1];
    const currB = b.turns[i];
    const prevBT = b.turns[i - 1];

    const aEscDown = (currA.escalationLevel ?? 0) < (prevAT.escalationLevel ?? 0);
    const bEscUp = (currB.escalationLevel ?? 0) > (prevBT.escalationLevel ?? 0);
    if (aEscDown && bEscUp) turnsADeescBEsc.push(i + 1);

    if (isNarrowing(currA) && isBroadening(currB)) turnsANarrowBBroad.push(i + 1);

    if (intensityScore(currA) < intensityScore(currB)) turnsAReducedIntensity.push(i + 1);
  }

  const allGaps = diffs.flatMap((d) => d.signalWithNoOverlay);

  console.log(`  Total response differences: ${responsesChanged} / ${totalTurns}`);
  console.log(`  Avg fields_changed: ${avgFieldsChanged.toFixed(2)}`);
  console.log(`  Total guidance transitions — A: ${guidanceTransitionsA}  B: ${guidanceTransitionsB}`);
  console.log(`  Total pacing changes        — A: ${pacingChangesA}  B: ${pacingChangesB}`);
  console.log(`  Total escalation transitions — A: ${escalationTransitionsA}  B: ${escalationTransitionsB}`);
  console.log(`  Volatility spikes in A: ${volSpikesA.length > 0 ? `turns [${volSpikesA.join(', ')}]` : 'none'}`);
  console.log(`  Volatility spikes in B: ${volSpikesB.length > 0 ? `turns [${volSpikesB.join(', ')}]` : 'none'}`);
  console.log(`  Turns A de-escalated but B escalated: ${turnsADeescBEsc.length > 0 ? `[${turnsADeescBEsc.join(', ')}]` : 'none'}`);
  console.log(`  Turns A narrowed scope but B broadened: ${turnsANarrowBBroad.length > 0 ? `[${turnsANarrowBBroad.join(', ')}]` : 'none'}`);
  console.log(`  Turns A reduced intensity vs B: ${turnsAReducedIntensity.length > 0 ? `[${turnsAReducedIntensity.join(', ')}]` : 'none'}`);

  if (allGaps.length > 0) {
    console.log(`  Wiring gaps: ${allGaps.join(', ')}`);
  } else {
    console.log('  Wiring gaps: none detected');
  }

  // ── EARLY NAVIGATION (turns 1–8) ──
  console.log('');
  console.log(sep);
  console.log('  EARLY NAVIGATION (turns 1–8)');
  console.log(sep);

  const earlyDiffs = diffs.slice(0, 8); // turns 1–8
  const earlyA = a.turns.slice(0, 8);

  const earlyGuidanceA = earlyDiffs.filter((d) => d.guidanceModeChangedFromPrevA).length;
  const earlyGuidanceB = earlyDiffs.filter((d) => d.guidanceModeChangedFromPrevB).length;
  const earlyQBudgetA = earlyDiffs.filter((d) => d.questionBudgetChangedA).length;
  const earlyQBudgetB = earlyDiffs.filter((d) => d.questionBudgetChangedB).length;
  const earlyPacingA = earlyDiffs.filter((d) => d.pacingChangedFromPrevA).length;
  const earlyPacingB = earlyDiffs.filter((d) => d.pacingChangedFromPrevB).length;

  const firstEscalatedA = earlyA.findIndex(
    (t) => t.escalationLevel !== null && t.escalationLevel > 0,
  );
  const firstEscalatedTurnA = firstEscalatedA >= 0 ? firstEscalatedA + 1 : null;

  console.log(`  Guidance transitions  — A: ${earlyGuidanceA}  B: ${earlyGuidanceB}`);
  console.log(`  qBudget changes       — A: ${earlyQBudgetA}  B: ${earlyQBudgetB}`);
  console.log(`  Pacing changes        — A: ${earlyPacingA}  B: ${earlyPacingB}`);
  console.log(`  First escalation != CALM (A): ${firstEscalatedTurnA !== null ? `turn ${firstEscalatedTurnA}` : 'none in turns 1–8'}`);

  const earlyNavEngaged = earlyGuidanceA > 0 || earlyQBudgetA > 0 || earlyPacingA > 0;
  if (!earlyNavEngaged) {
    console.log('');
    console.log('  ⚠️ Early navigation not engaging — thresholds too high or signals too weak.');
  }

  // ── Navigation weakness check (wave segments 3–8 and 12–18) ──
  console.log('');
  console.log(sep);
  console.log('  WAVE SEGMENT ANALYSIS');
  console.log(sep);

  const waveSegment1 = diffs.slice(2, 8);   // turns 3–8 (0-indexed 2..7)
  const waveSegment2 = diffs.slice(11, 18);  // turns 12–18 (0-indexed 11..17)
  const segDiffs = [...waveSegment1, ...waveSegment2];
  const structuralDiffs = segDiffs.filter(
    (d) => d.guidanceChanged || d.escalationChanged || d.pacingChanged,
  );
  if (structuralDiffs.length === 0) {
    console.log('  ⚠️ Navigation Weak – emotional oscillation not materially affecting behavior.');
  } else {
    console.log(`  Structural diffs in wave segments: ${structuralDiffs.length}`);
  }

  console.log(sep + '\n');
}

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------
interface EarlyNavigation {
  guidanceTransitions: { a: number; b: number };
  qBudgetChanges: { a: number; b: number };
  pacingChanges: { a: number; b: number };
  firstEscalatedTurnA: number | null;
  earlyNavEngaged: boolean;
}

interface WaveReport {
  scriptVersion: string;
  runA: Omit<RunResult, 'turns'> & { turns: Omit<TurnResult, 'prompt'>[] };
  runB: Omit<RunResult, 'turns'> & { turns: Omit<TurnResult, 'prompt'>[] };
  diffs: WaveTurnDiff[];
  earlyNavigation: EarlyNavigation;
  summary: {
    responsesChanged: number;
    avgFieldsChanged: number;
    guidanceTransitions: { a: number; b: number };
    pacingChanges: { a: number; b: number };
    escalationTransitions: { a: number; b: number };
    volatilitySpikes: { a: number[]; b: number[] };
    turnsADeescBEsc: number[];
    turnsANarrowBBroad: number[];
    turnsAReducedIntensity: number[];
    wiringGaps: string[];
    navigationWeak: boolean;
  };
}

function computeEarlyNavigation(a: RunResult, diffs: WaveTurnDiff[]): EarlyNavigation {
  const earlyDiffs = diffs.slice(0, 8);
  const earlyA = a.turns.slice(0, 8);

  const guidanceA = earlyDiffs.filter((d) => d.guidanceModeChangedFromPrevA).length;
  const guidanceB = earlyDiffs.filter((d) => d.guidanceModeChangedFromPrevB).length;
  const qbA = earlyDiffs.filter((d) => d.questionBudgetChangedA).length;
  const qbB = earlyDiffs.filter((d) => d.questionBudgetChangedB).length;
  const pacA = earlyDiffs.filter((d) => d.pacingChangedFromPrevA).length;
  const pacB = earlyDiffs.filter((d) => d.pacingChangedFromPrevB).length;

  const firstEsc = earlyA.findIndex(
    (t) => t.escalationLevel !== null && t.escalationLevel > 0,
  );

  return {
    guidanceTransitions: { a: guidanceA, b: guidanceB },
    qBudgetChanges: { a: qbA, b: qbB },
    pacingChanges: { a: pacA, b: pacB },
    firstEscalatedTurnA: firstEsc >= 0 ? firstEsc + 1 : null,
    earlyNavEngaged: guidanceA > 0 || qbA > 0 || pacA > 0,
  };
}

function buildWaveReportJSON(a: RunResult, b: RunResult, diffs: WaveTurnDiff[]): WaveReport {
  const strip = (r: RunResult) => ({
    ...r,
    turns: r.turns.map(({ prompt, ...rest }) => rest),
  });

  const totalTurns = a.turns.length;

  const guidanceTransitionsA = diffs.filter((d) => d.guidanceModeChangedFromPrevA).length;
  const guidanceTransitionsB = diffs.filter((d) => d.guidanceModeChangedFromPrevB).length;

  const pacingChangesA = diffs.filter((d) => d.pacingChangedFromPrevA).length;
  const pacingChangesB = diffs.filter((d) => d.pacingChangedFromPrevB).length;

  const escalationTransitionsA = diffs.filter((_, i) =>
    i > 0 && a.turns[i].escalationLevel !== a.turns[i - 1].escalationLevel,
  ).length;
  const escalationTransitionsB = diffs.filter((_, i) =>
    i > 0 && b.turns[i].escalationLevel !== b.turns[i - 1].escalationLevel,
  ).length;

  const volSpikesA = a.turns.filter((t) => t.volatilityState === 'HIGH').map((t) => t.turn);
  const volSpikesB = b.turns.filter((t) => t.volatilityState === 'HIGH').map((t) => t.turn);

  const turnsADeescBEsc: number[] = [];
  const turnsANarrowBBroad: number[] = [];
  const turnsAReducedIntensity: number[] = [];

  for (let i = 1; i < totalTurns; i++) {
    const aDown = (a.turns[i].escalationLevel ?? 0) < (a.turns[i - 1].escalationLevel ?? 0);
    const bUp = (b.turns[i].escalationLevel ?? 0) > (b.turns[i - 1].escalationLevel ?? 0);
    if (aDown && bUp) turnsADeescBEsc.push(i + 1);
    if (isNarrowing(a.turns[i]) && isBroadening(b.turns[i])) turnsANarrowBBroad.push(i + 1);
    if (intensityScore(a.turns[i]) < intensityScore(b.turns[i])) turnsAReducedIntensity.push(i + 1);
  }

  const waveSegment1 = diffs.slice(2, 8);
  const waveSegment2 = diffs.slice(11, 18);
  const structuralDiffs = [...waveSegment1, ...waveSegment2].filter(
    (d) => d.guidanceChanged || d.escalationChanged || d.pacingChanged,
  );

  return {
    scriptVersion,
    runA: strip(a),
    runB: strip(b),
    diffs,
    earlyNavigation: computeEarlyNavigation(a, diffs),
    summary: {
      responsesChanged: diffs.filter((d) => d.responseChanged).length,
      avgFieldsChanged: diffs.reduce((s, d) => s + d.fieldsChanged, 0) / totalTurns,
      guidanceTransitions: { a: guidanceTransitionsA, b: guidanceTransitionsB },
      pacingChanges: { a: pacingChangesA, b: pacingChangesB },
      escalationTransitions: { a: escalationTransitionsA, b: escalationTransitionsB },
      volatilitySpikes: { a: volSpikesA, b: volSpikesB },
      turnsADeescBEsc,
      turnsANarrowBBroad,
      turnsAReducedIntensity,
      wiringGaps: diffs.flatMap((d) => d.signalWithNoOverlay),
      navigationWeak: structuralDiffs.length === 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is required. Set it in your environment or .env.local.');
    process.exit(1);
  }

  console.log(`[Wave Harness] Script: ${scriptVersion.toUpperCase()} (${WAVE_SCRIPT.length} turns)`);

  console.log('[Wave Harness] Starting Run A (Appraisal Lab ON)...');
  const runA = await runConversation('A (Appraisal ON)', true, WAVE_SCRIPT);
  console.log('[Wave Harness] Run A complete.\n');

  console.log('[Wave Harness] Starting Run B (Appraisal Lab OFF)...');
  const runB = await runConversation('B (Appraisal OFF)', false, WAVE_SCRIPT);
  console.log('[Wave Harness] Run B complete.\n');

  const diffs = computeWaveDiffs(runA, runB);

  printWaveReport(runA, runB, diffs);

  const report = buildWaveReportJSON(runA, runB, diffs);
  const fs = require('fs');
  const outPath = `ab-wave-report-${scriptVersion}.json`;
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[Wave Harness] JSON report written to ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Wave Harness failed:', err);
    process.exit(1);
  });
}

export { WAVE_SCRIPT, computeWaveDiffs, buildWaveReportJSON, computeEarlyNavigation, scriptVersion };
export type { WaveTurnDiff, WaveReport, EarlyNavigation };
