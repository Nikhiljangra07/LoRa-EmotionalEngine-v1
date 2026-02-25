export {};

import {
  saveEnv,
  restoreEnv,
  setScenarioAdaptiveOn,
  warmUp,
  phase,
  calmPhase,
  buildStepFn,
  runSequence,
  HIGH_NEGATIVE,
  LOW_NEUTRAL,
  type StepSpec,
} from './scenarioHarness';
import { formatTrace, exportTraceJSON } from './traceUtils';

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

const TRACE_ENABLED = process.env.LORA_TRACE_DEMO === '1';

(TRACE_ENABLED ? describe : describe.skip)('Trace Demo — 12-message mixed scenario', () => {
  test('trace output', async () => {
    console.log('\nTRACE DEMO STARTED\n');

    setScenarioAdaptiveOn();
    process.env.LORA_HINT_RESOLVER = '1';
    process.env.LORA_HINT_STICKINESS = '1';
    process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
    process.env.LORA_HINT_SEMANTIC_GUARD = '1';

    const steps: StepSpec[] = [
      ...warmUp(2),
      ...phase(2, { escalationLevel: 2, interruptionLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(2, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 1 }, HIGH_NEGATIVE),
      ...phase(2, { postClarityActive: true }, LOW_NEUTRAL),
      ...calmPhase(4),
    ];

    const results = await runSequence(steps, { stepFn: buildStepFn(steps) });

    process.stdout.write('\n— Trace Demo (formatted) —\n');
    process.stdout.write(formatTrace(results) + '\n');

    process.stdout.write('\n— Trace Demo (JSON) —\n');
    process.stdout.write(JSON.stringify(exportTraceJSON(results), null, 2) + '\n');
  });
});
