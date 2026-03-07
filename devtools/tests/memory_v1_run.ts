#!/usr/bin/env ts-node

import { runScenario } from '../../src/emotion-core/memory-v1/runtime';
import {
  calmStable,
  volatileModerate,
  intenseStable,
  violationSpike,
} from '../../src/emotion-core/memory-v1/fixtures';
import type { RuntimeScenario } from '../../src/emotion-core/memory-v1/runtimeTypes';

const scenarioMap: Record<string, RuntimeScenario> = {
  calmStable,
  volatileModerate,
  intenseStable,
  violationSpike,
};

const args = process.argv.slice(2);
let scenarioName = 'calmStable';
let userId: string | undefined;
let baseDir: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scenario' && i + 1 < args.length) {
    scenarioName = args[++i];
  } else if (args[i] === '--userId' && i + 1 < args.length) {
    userId = args[++i];
  } else if (args[i] === '--baseDir' && i + 1 < args.length) {
    baseDir = args[++i];
  }
}

const scenario = scenarioMap[scenarioName];
if (!scenario) {
  process.stderr.write(
    `Unknown scenario: ${scenarioName}\nAvailable: ${Object.keys(scenarioMap).join(', ')}\n`,
  );
  process.exit(1);
}

const finalScenario: RuntimeScenario = userId
  ? { ...scenario, userId }
  : scenario;

const result = runScenario(finalScenario, { baseDir });

for (const log of result.logs) {
  process.stdout.write(JSON.stringify(log) + '\n');
}

process.stdout.write(
  JSON.stringify({
    schemas: result.finalState.schemas.schemas.length,
    episodic: result.finalState.episodic.events.length,
    savedPath: result.savedPath,
  }) + '\n',
);
