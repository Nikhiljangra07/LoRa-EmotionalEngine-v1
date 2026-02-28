#!/usr/bin/env ts-node
/**
 * A/B Appraisal Harness
 *
 * Runs the same scripted 10-turn conversation twice:
 *   A — Appraisal Lab ON  (all appraisal flags enabled)
 *   B — Appraisal Lab OFF (appraisal bridge disabled)
 *
 * Everything else is held constant: same model, same temperature (0),
 * same prompts, same feature flags, same user messages.
 *
 * Requires: ANTHROPIC_API_KEY in environment or .env.local.
 *
 * Usage: npm run ab:appraisal
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

import Anthropic from '@anthropic-ai/sdk';

const SCRIPT: readonly string[] = [
  "I'm behind and I'm wasting time.",
  "Stop asking questions. Just tell me what to do.",
  "I'm done with this. It's not fair.",
  "Nothing works. I'm useless.",
  "Actually I'm furious. Everyone else gets it easy.",
  "Don't give me therapy. Give me a plan.",
  "No. You're not listening.",
  "Whatever. I don't care anymore.",
  "Fine. What's the first step then?",
  "Make it small. One step.",
];

interface TurnResult {
  turn: number;
  userMessage: string;
  assistantResponse: string;
  guidanceMode: string;
  ekmanDominant: string | null;
  ekmanConfidence: number | null;
  volatilityState: string;
  escalationLevel: number | null;
  escalationState: string | null;
  escalationTrend: string | null;
  pacingHint: string | null;
  questionBudgetHint: string | null;
  validationIntensity: string | null;
  hints: string[];
  prompt: string;
  maskedPressure: boolean | null;
  volatilityTrend: string | null;
  ekmanInfluenceApplied: boolean | null;
  promptOverlays: string[];
}

interface RunResult {
  label: string;
  turns: TurnResult[];
}

interface TurnDiff {
  turn: number;
  fieldsChanged: number;
  responseChanged: boolean;
  changedFields: string[];
  signalWithNoOverlay: string[];
}

// ---------------------------------------------------------------------------
// Deterministic LLM responder (temperature = 0)
// ---------------------------------------------------------------------------
function makeHarnessResponder() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  return {
    async generateResponse(
      systemPrompt: string,
      userMessage: string,
      options?: { sessionHistory?: Array<{ role: string; text: string }> },
    ): Promise<string> {
      const history = options?.sessionHistory ?? [];
      const priorTurns =
        history.length > 0 && history[history.length - 1]?.role === 'user'
          ? history.slice(0, -1)
          : history;

      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...priorTurns.map((t) => ({
          role: t.role as 'user' | 'assistant',
          content: t.text,
        })),
        { role: 'user' as const, content: userMessage },
      ];

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        temperature: 0,
        system: systemPrompt,
        messages,
      });

      const block = response.content[0];
      return block && block.type === 'text' ? block.text.trim() : '';
    },
  };
}

// ---------------------------------------------------------------------------
// Extract categorical overlays from prompt (for compass proof)
// ---------------------------------------------------------------------------
function extractPromptOverlays(prompt: string): string[] {
  const overlays: string[] = [];
  if (prompt.includes('Dominant signal:')) overlays.push('ekmanDominant');
  if (prompt.includes('Volatility (recent turns):')) overlays.push('volatilityTier');
  if (prompt.includes('Volatility trend:')) overlays.push('volatilityTrend');
  if (prompt.includes('SIGNAL CONTEXT')) overlays.push('signalContext');
  if (prompt.includes('Masked pressure: DETECTED')) overlays.push('maskedPressure');
  if (prompt.includes('Escalation:')) overlays.push('escalation');
  if (prompt.includes('Escalation trend:')) overlays.push('escalationTrend');
  if (/\[PACING_HINT:\w+\]/.test(prompt)) overlays.push('pacingHint');
  if (/\[VALIDATION_INTENSITY:\w+\]/.test(prompt)) overlays.push('validationIntensity');
  if (/\[QUESTION_BUDGET:\w+\]/.test(prompt)) overlays.push('questionBudget');
  if (/\[TONE_HINT:\w+\]/.test(prompt)) overlays.push('toneHint');
  if (/\[VALIDATION_HINT:\w+\]/.test(prompt)) overlays.push('validationHint');
  if (/\[ACTION_HINT:\w+\]/.test(prompt)) overlays.push('actionHint');
  if (/\[INTERRUPT_HINT:\w+\]/.test(prompt)) overlays.push('interruptHint');
  if (/\[STEP_HINT:\w+\]/.test(prompt)) overlays.push('stepHint');
  return overlays;
}

// ---------------------------------------------------------------------------
// Single run: feed all messages, capture per-turn data
// ---------------------------------------------------------------------------
async function runConversation(label: string, appraisalOn: boolean, script?: readonly string[]): Promise<RunResult> {
  const messages = script ?? SCRIPT;
  // Set env vars BEFORE requiring modules so featureFlags freeze with correct values
  const envSnapshot: Record<string, string | undefined> = {};
  const flagVars: Record<string, string> = {
    LORA_APPRAISAL_BRIDGE: appraisalOn ? '1' : '',
    LORA_APPRAISAL_BRIDGE_MODE: appraisalOn ? '1' : '',
    LORA_APPRAISAL_PACING_HINT: appraisalOn ? '1' : '',
    LORA_APPRAISAL_TONE_HINT: appraisalOn ? '1' : '',
    LORA_VALIDATION_INTENSITY: appraisalOn ? '1' : '',
    LORA_ADAPTIVE_OVERRIDE_COOLDOWN: appraisalOn ? '1' : '',
    LORA_DRIFT_MONITOR: appraisalOn ? '1' : '',
    LORA_GUIDANCE_DWELL_LOCK: appraisalOn ? '1' : '',
    LORA_INTERVENTION_VALIDATION_HINT: appraisalOn ? '1' : '',
    LORA_INTERVENTION_PACING_HINT: appraisalOn ? '1' : '',
    LORA_INTERVENTION_TONE_HINT: appraisalOn ? '1' : '',
    LORA_INTERVENTION_ACTION_HINT: appraisalOn ? '1' : '',
    LORA_INTERVENTION_INTERRUPT_HINT: appraisalOn ? '1' : '',
    LORA_INTERVENTION_STEP_HINT: appraisalOn ? '1' : '',
    LORA_INTERVENTION_QUESTION_BUDGET: appraisalOn ? '1' : '',
    LORA_HINT_RESOLVER: appraisalOn ? '1' : '',
    LORA_HINT_STICKINESS: appraisalOn ? '1' : '',
    LORA_HINT_SEMANTIC_GUARD: appraisalOn ? '1' : '',
    // Always on (same in both runs)
    LORA_NSE: '1',
    LORA_RSC: '1',
    LORA_PERSONA_ENFORCER: '1',
    LORA_BOOTSTRAP_MEMORY: '1',
    LORA_STRICT_GUIDANCE_MODE: '1',
    // Debug signal for prompt signal logging
    LORA_DEBUG_PROMPT_SIGNALS: '1',
  };

  for (const [k, v] of Object.entries(flagVars)) {
    envSnapshot[k] = process.env[k];
    if (v) {
      process.env[k] = v;
    } else {
      delete process.env[k];
    }
  }

  // Clear module cache so featureFlags re-evaluate
  const keysToDelete = Object.keys(require.cache).filter(
    (k) =>
      k.includes('emotion-core') ||
      k.includes('appraisal-bridge') ||
      k.includes('appraisal-lab') ||
      k.includes('config/DevConfig') ||
      k.includes('config/featureFlags') ||
      k.includes('debug/debugGate') ||
      k.includes('debug/sessionTrace') ||
      k.includes('server/llmTelemetry'),
  );
  for (const k of keysToDelete) {
    delete require.cache[k];
  }

  // Dynamic require after env + cache reset
  const { EngineOrchestrator } = require('../../emotion-core/engines/EngineOrchestrator');
  const { InputProcessor } = require('../../emotion-core/processors/InputProcessor');

  const responder = makeHarnessResponder();
  const engine = new EngineOrchestrator(0.5, {}, () => responder, {
    userId: 'ab-harness-user',
  });

  // Intercept decision log
  const capturedDecisions: any[] = [];
  const origLog = console.log;
  const logInterceptor = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('[LoRa::MessageDecision]')) {
      try {
        capturedDecisions.push(JSON.parse(args[1]));
      } catch { /* ignore parse errors */ }
    }
    // Suppress other LoRa debug noise during harness run
    if (typeof args[0] === 'string' && args[0].startsWith('[LoRa::')) return;
    origLog.apply(console, args);
  };
  console.log = logInterceptor;

  // Also suppress console.warn for drift monitor
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('[DRIFT_MONITOR]')) return;
    origWarn.apply(console, args);
  };

  const turns: TurnResult[] = [];
  const sessionHistory: Array<{ role: 'user' | 'assistant'; text: string; ts: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const text = messages[i];
    const { analyzerOutputs, signalPacket } = InputProcessor.process(text);

    const result = await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket,
      sessionHistory.length > 0 ? [...sessionHistory] : undefined,
    );

    const decision = capturedDecisions[capturedDecisions.length - 1];

    const hints: string[] = [];
    if (decision?.pacingHint) hints.push(`pacing:${decision.pacingHint}`);
    if (decision?.toneHint) hints.push(`tone:${decision.toneHint}`);
    if (decision?.validationIntensity) hints.push(`validation:${decision.validationIntensity}`);
    if (decision?.validationHint) hints.push(`validationHint:${decision.validationHint}`);
    if (decision?.actionHint) hints.push(`action:${decision.actionHint}`);
    if (decision?.interruptHint) hints.push(`interrupt:${decision.interruptHint}`);
    if (decision?.stepHint) hints.push(`step:${decision.stepHint}`);
    if (decision?.questionBudgetHint) hints.push(`qBudget:${decision.questionBudgetHint}`);

    const maskedPressure = decision?.lpi?.maskedPressure ?? null;
    const volatilityTrend = decision?.volatilityTrend ?? null;
    const escalationState = decision?.gradientEscalation?.state ?? null;
    const escalationTrend = decision?.gradientEscalation?.trend ?? null;
    const ekmanInfluenceApplied = decision?.ekmanInfluenceApplied ?? null;

    turns.push({
      turn: i + 1,
      userMessage: text,
      assistantResponse: result.llmOutput ?? '(no response)',
      guidanceMode: decision?.promptProfile?.guidanceMode ?? 'unknown',
      ekmanDominant: decision?.ekman?.dominant ?? null,
      ekmanConfidence: decision?.ekman?.confidence ?? null,
      volatilityState: decision?.avi?.state ?? 'LOW',
      escalationLevel: decision?.appraisal?.escalationLevel ?? decision?.gradientEscalation?.numericLevel ?? null,
      escalationState,
      escalationTrend,
      pacingHint: decision?.pacingHint ?? null,
      questionBudgetHint: decision?.questionBudgetHint ?? null,
      validationIntensity: decision?.validationIntensity ?? null,
      hints,
      prompt: result.prompt ?? '',
      maskedPressure,
      volatilityTrend,
      ekmanInfluenceApplied,
      promptOverlays: extractPromptOverlays(result.prompt ?? ''),
    });

    sessionHistory.push({ role: 'user', text, ts: Date.now() });
    sessionHistory.push({
      role: 'assistant',
      text: result.llmOutput ?? '',
      ts: Date.now(),
    });
  }

  // Restore
  console.log = origLog;
  console.warn = origWarn;
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  return { label, turns };
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------
function computeDiffs(a: RunResult, b: RunResult): TurnDiff[] {
  const diffs: TurnDiff[] = [];
  for (let i = 0; i < a.turns.length; i++) {
    const ta = a.turns[i];
    const tb = b.turns[i];
    const changedFields: string[] = [];

    if (ta.guidanceMode !== tb.guidanceMode) changedFields.push('guidanceMode');
    if (ta.ekmanDominant !== tb.ekmanDominant) changedFields.push('ekmanDominant');
    if (ta.volatilityState !== tb.volatilityState) changedFields.push('volatilityState');
    if (ta.escalationLevel !== tb.escalationLevel) changedFields.push('escalationLevel');

    const aHints = ta.hints.join(',');
    const bHints = tb.hints.join(',');
    if (aHints !== bHints) changedFields.push('hints');

    const responseChanged = ta.assistantResponse !== tb.assistantResponse;

    // Check for signals present but producing no overlay/hint
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
      changedFields,
      signalWithNoOverlay,
    });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Report printer
// ---------------------------------------------------------------------------
function printReport(a: RunResult, b: RunResult, diffs: TurnDiff[]): void {
  const W = 90;
  const sep = '='.repeat(W);
  const thin = '-'.repeat(W);

  console.log('\n' + sep);
  console.log('  AB APPRAISAL HARNESS');
  console.log('  A = Appraisal Lab ON  |  B = Appraisal Lab OFF');
  console.log(sep + '\n');

  for (let i = 0; i < SCRIPT.length; i++) {
    const ta = a.turns[i];
    const tb = b.turns[i];
    const d = diffs[i];

    console.log(`Turn ${i + 1}: "${ta.userMessage}"`);
    console.log(thin);

    const fmtSignals = (t: TurnResult) => {
      const parts = [
        `guidanceMode=${t.guidanceMode}`,
        `ekman=${t.ekmanDominant ?? 'none'}`,
        `volatility=${t.volatilityState}`,
        `escalation=${t.escalationLevel ?? 'none'}`,
        `hints=[${t.hints.join(', ')}]`,
      ];
      return parts.join('  ');
    };

    console.log(`  A: ${fmtSignals(ta)}`);
    const respA = ta.assistantResponse.length > 200
      ? ta.assistantResponse.slice(0, 200) + '...'
      : ta.assistantResponse;
    console.log(`     Response: "${respA}"`);

    console.log(`  B: ${fmtSignals(tb)}`);
    const respB = tb.assistantResponse.length > 200
      ? tb.assistantResponse.slice(0, 200) + '...'
      : tb.assistantResponse;
    console.log(`     Response: "${respB}"`);

    console.log(
      `  Diff: fields_changed=${d.fieldsChanged} response_changed=${d.responseChanged}` +
      (d.changedFields.length > 0 ? ` [${d.changedFields.join(', ')}]` : ''),
    );
    if (d.signalWithNoOverlay.length > 0) {
      console.log(`  ⚠ Signal with no overlay: ${d.signalWithNoOverlay.join(', ')}`);
    }
    console.log('');
  }

  // Footer summary
  console.log(sep);
  const responsesChanged = diffs.filter((d) => d.responseChanged).length;
  const avgFieldsChanged =
    diffs.reduce((s, d) => s + d.fieldsChanged, 0) / diffs.length;
  const allGaps = diffs.flatMap((d) => d.signalWithNoOverlay);

  console.log(`  Turns with response_changed=true: ${responsesChanged}/${SCRIPT.length}`);
  console.log(`  Avg fields_changed: ${avgFieldsChanged.toFixed(2)}`);
  if (allGaps.length > 0) {
    console.log(`  Wiring gaps (signal computed but no overlay): ${allGaps.join(', ')}`);
  } else {
    console.log('  Wiring gaps: none detected');
  }
  console.log(sep + '\n');
}

// ---------------------------------------------------------------------------
// JSON export (for programmatic consumption)
// ---------------------------------------------------------------------------
interface HarnessReport {
  runA: RunResult;
  runB: RunResult;
  diffs: TurnDiff[];
  summary: {
    responsesChanged: number;
    avgFieldsChanged: number;
    wiringGaps: string[];
  };
}

function buildReportJSON(a: RunResult, b: RunResult, diffs: TurnDiff[]): HarnessReport {
  const strippedA = { ...a, turns: a.turns.map(({ prompt, ...rest }) => rest) } as any;
  const strippedB = { ...b, turns: b.turns.map(({ prompt, ...rest }) => rest) } as any;
  return {
    runA: strippedA,
    runB: strippedB,
    diffs,
    summary: {
      responsesChanged: diffs.filter((d) => d.responseChanged).length,
      avgFieldsChanged:
        diffs.reduce((s, d) => s + d.fieldsChanged, 0) / diffs.length,
      wiringGaps: diffs.flatMap((d) => d.signalWithNoOverlay),
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is required. Set it in your environment.');
    process.exit(1);
  }

  console.log('[AB Harness] Starting Run A (Appraisal Lab ON)...');
  const runA = await runConversation('A (Appraisal ON)', true);
  console.log('[AB Harness] Run A complete.\n');

  console.log('[AB Harness] Starting Run B (Appraisal Lab OFF)...');
  const runB = await runConversation('B (Appraisal OFF)', false);
  console.log('[AB Harness] Run B complete.\n');

  const diffs = computeDiffs(runA, runB);

  printReport(runA, runB, diffs);

  const report = buildReportJSON(runA, runB, diffs);
  const fs = require('fs');
  const outPath = 'ab-harness-report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[AB Harness] JSON report written to ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('AB Harness failed:', err);
    process.exit(1);
  });
}

export { runConversation, computeDiffs, buildReportJSON, makeHarnessResponder, SCRIPT };
export type { TurnResult, RunResult, TurnDiff, HarnessReport };
