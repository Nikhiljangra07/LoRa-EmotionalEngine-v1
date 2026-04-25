/**
 * Coherence test harness.
 *
 * Provides deterministic multi-step message replay through EngineOrchestrator,
 * capturing per-message decision payloads and prompt strings for invariant
 * assertions. All capture is via DecisionLogger console output — the
 * EngineOrchestrator return type is NOT modified.
 */

// ── AppraisalResult factory ──────────────────────────────────────────

export interface MockAppraisalOverrides {
  collapseEvent?: boolean;
  collapseSeverity?: number;
  escalationLevel?: number;
  escalationScore?: number;
  pressureScalar?: number;
  pressureVolatility?: number;
  postClarityActive?: boolean;
  interruptionLevel?: 0 | 1 | 2 | 3;
  moodCategory?: string;
  toneMode?: string;
  pacingMode?: string;
  validationMode?: string;
  actionMode?: string;
}

export function makeAppraisalResult(o: MockAppraisalOverrides = {}): Readonly<Record<string, any>> {
  return Object.freeze({
    timestamp: 1_000_000,
    family: Object.freeze({
      dominantFamily: 'SADNESS',
      weights: Object.freeze({ JOY: 0.1, ANGER: 0.1, FEAR: 0.1, SADNESS: 0.4, SURPRISE: 0.1, DISGUST: 0.2 }),
      confidence: 0.7,
    }),
    pressure: Object.freeze({
      scalar: o.pressureScalar ?? 0.3,
      slope: 0.01,
      volatility: o.pressureVolatility ?? 0.05,
      isShock: false,
      byFamily: Object.freeze({}),
    }),
    mood: Object.freeze({ category: o.moodCategory ?? 'NEUTRAL', dominance: 0.5, confidence: 0.6 }),
    escalation: Object.freeze({
      level: o.escalationLevel ?? 0,
      score: o.escalationScore ?? 0.1,
      flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }),
    }),
    collapse: Object.freeze({ event: o.collapseEvent ?? false, severity: o.collapseSeverity ?? 0, direction: 'NONE' }),
    postClarity: Object.freeze({ active: o.postClarityActive ?? false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
    intervention: Object.freeze({
      toneMode: o.toneMode ?? 'NEUTRAL',
      pacingMode: o.pacingMode ?? 'NORMAL',
      validationMode: o.validationMode ?? 'STANDARD',
      actionMode: o.actionMode ?? 'NONE',
      interruptionLevel: (o.interruptionLevel ?? 0) as 0 | 1 | 2 | 3,
      guardrails: Object.freeze([]),
    }),
  });
}

// ── Environment flag presets ─────────────────────────────────────────

const ALL_FLAG_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_PACING_HINT',
  'LORA_VALIDATION_INTENSITY',
  'LORA_APPRAISAL_TONE_HINT',
  'LORA_ADAPTIVE_OVERRIDE_COOLDOWN',
  'LORA_DRIFT_MONITOR',
  'LORA_STRICT_GUIDANCE_MODE',
  'LORA_INTERVENTION_VALIDATION_HINT',
  'LORA_INTERVENTION_PACING_HINT',
  'LORA_INTERVENTION_TONE_HINT',
  'LORA_INTERVENTION_ACTION_HINT',
  'LORA_INTERVENTION_INTERRUPT_HINT',
  'LORA_INTERVENTION_STEP_HINT',
  'LORA_INTERVENTION_QUESTION_BUDGET',
  'LORA_HINT_RESOLVER',
  'LORA_HINT_STICKINESS',
  'LORA_GUIDANCE_DWELL_LOCK',
  'LORA_HINT_SEMANTIC_GUARD',
  'LORA_TEST_VERBOSE',
] as const;

export function clearFlags(): void {
  for (const k of ALL_FLAG_KEYS) delete process.env[k];
}

export function setBaseline(): void {
  clearFlags();
}

export function setAdaptiveOn(): void {
  clearFlags();
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_PACING_HINT = '1';
  process.env.LORA_VALIDATION_INTENSITY = '1';
  process.env.LORA_APPRAISAL_TONE_HINT = '1';
  process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
  process.env.LORA_DRIFT_MONITOR = '1';
  process.env.LORA_STRICT_GUIDANCE_MODE = '1';
}

export function setFullAdaptiveOn(): void {
  setAdaptiveOn();
  process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';
  process.env.LORA_INTERVENTION_PACING_HINT = '1';
  process.env.LORA_INTERVENTION_TONE_HINT = '1';
  process.env.LORA_INTERVENTION_ACTION_HINT = '1';
  process.env.LORA_INTERVENTION_INTERRUPT_HINT = '1';
  process.env.LORA_INTERVENTION_STEP_HINT = '1';
  process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
}

export function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ALL_FLAG_KEYS) saved[k] = process.env[k];
  return saved;
}

export function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const k of ALL_FLAG_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

// ── Step spec ────────────────────────────────────────────────────────

export interface StepSpec {
  text?: string;
  emotionalOverride?: { dominant: string; arousal: string; valence: string; confidence: number };
  appraisalOverrides?: MockAppraisalOverrides;
}

// ── Captured payload ─────────────────────────────────────────────────

export interface CapturedStep {
  index: number;
  prompt: string;
  payload: Record<string, any>;
  builderArgs?: Record<string, unknown>;
  activeHints: string[];
  markerCount: number;
}

// ── Module loader ────────────────────────────────────────────────────

export function loadModules(stepFn?: jest.Mock) {
  jest.resetModules();

  if (stepFn) {
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: stepFn,
        reset: jest.fn(),
      })),
    }));
  }
  jest.doMock('../../../debug/sessionTrace', () => ({
    writeSessionTrace: jest.fn(),
  }));

  const { EngineOrchestrator } = require('../../engines/EngineOrchestrator');
  const { InputProcessor } = require('../../processors/InputProcessor');
  const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');
  return { EngineOrchestrator, InputProcessor, PromptTemplateBuilder };
}

// ── Sequence runner ──────────────────────────────────────────────────

export async function runSequence(
  steps: StepSpec[],
  opts?: { stepFn?: jest.Mock; captureBuilderArgs?: boolean },
): Promise<CapturedStep[]> {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(opts?.stepFn);

  let buildSpy: jest.SpyInstance | undefined;
  if (opts?.captureBuilderArgs) {
    buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
  }

  // EngineOrchestrator's constructor throws when userId is missing
  // (memory-isolation invariant — see EngineOrchestrator.ts:325). The harness
  // is shared across scenario/contract tests, so passing a stable test
  // userId here unblocks every consumer at once.
  const engine = new EngineOrchestrator(
    0.5,
    {},
    () => ({ generateResponse: async () => 'ok' }),
    { userId: 'coherence-harness-user' },
  );

  const captured: CapturedStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const spec = steps[i];
    const { analyzerOutputs, signalPacket } = InputProcessor.process(spec.text ?? 'test message');
    const result = await engine.processMessage(
      analyzerOutputs,
      spec.emotionalOverride,
      false,
      {},
      undefined,
      signalPacket,
    );

    const logCalls = logSpy.mock.calls;
    let payload: Record<string, any> = {};
    for (let j = logCalls.length - 1; j >= 0; j--) {
      if (typeof logCalls[j][0] === 'string' && logCalls[j][0].includes('[LoRa::MessageDecision]')) {
        payload = JSON.parse(logCalls[j][1]);
        break;
      }
    }

    const builderArgs = buildSpy ? (buildSpy.mock.calls[i]?.[2] as Record<string, unknown> | undefined) : undefined;

    const activeHints = extractMarkers(result.prompt);
    captured.push({ index: i, prompt: result.prompt, payload, builderArgs, activeHints, markerCount: activeHints.length });
  }

  logSpy.mockRestore();
  return captured;
}

// ── Utilities ────────────────────────────────────────────────────────

export function lastN(steps: CapturedStep[], n: number): CapturedStep[] {
  return steps.slice(-n);
}

export function countTransitions<T>(arr: T[]): number {
  let count = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== arr[i - 1]) count++;
  }
  return count;
}

const MARKER_PATTERN = /\[([A-Z_]+):([A-Z_]+)\]/g;

export function extractMarkers(prompt: string): string[] {
  const markers: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = MARKER_PATTERN.exec(prompt)) !== null) {
    markers.push(m[0]);
  }
  return markers;
}

export const APPRAISAL_FORBIDDEN_KEYS = [
  'appraisal',
  'appraisalResult',
  'intervention',
  'policy',
  'appraisalHints',
];

export function countMarkers(prompt: string): number {
  return extractMarkers(prompt).length;
}

export {};
