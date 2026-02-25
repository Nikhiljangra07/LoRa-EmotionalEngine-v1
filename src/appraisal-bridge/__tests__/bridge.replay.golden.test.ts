export {};

import * as path from 'path';
import { runReplayFromFile, runReplay } from '../replay/runReplay';
import type { LayerASnapshot } from '../types';

const FIXTURES_DIR = path.join(__dirname, '..', 'replay', 'fixtures');

// Golden hashes — update ONLY when intentionally changing engine behavior.
const GOLDEN: Record<string, { file: string; count: number; hash: string }> = {
  calm_baseline_50: {
    file: 'calm_baseline_50.json',
    count: 50,
    hash: '48225cb02b2b85c891ad515c5dfebe14363f27beaa472f853bd595413a4486ee',
  },
  escalation_burst_30: {
    file: 'escalation_burst_30.json',
    count: 30,
    hash: '7527ad065d2839d652b55e919f1a841b326f23a4b9b5de1b3307cbdf32bf850f',
  },
  oscillation_100: {
    file: 'oscillation_100.json',
    count: 100,
    hash: '12ad623e950e28f0cbaf726641e8345f5278164bb85fd7a39b6123f8cc85afb3',
  },
  recovery_80: {
    file: 'recovery_80.json',
    count: 80,
    hash: 'b1a665d175ad9d7d6bd7fd1707a9dd0e7765e35cdb9157ed7559c0272162c31e',
  },
};

describe('AppraisalBridge replay golden-hash drift locks', () => {
  for (const [name, spec] of Object.entries(GOLDEN)) {
    test(`${name}: hash matches golden (${spec.count} steps)`, () => {
      const result = runReplayFromFile(path.join(FIXTURES_DIR, spec.file));

      expect(result.outputsCount).toBe(spec.count);

      if (result.hash !== spec.hash) {
        throw new Error(
          `[DRIFT] ${name}: golden hash changed!\n` +
          `  expected: ${spec.hash}\n` +
          `  actual:   ${result.hash}\n` +
          `  Update the golden hash ONLY if the behavior change was intentional.`,
        );
      }
    });
  }

  test('perturbed input produces a different hash (negative test)', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'calm_baseline_50.json');
    const original = runReplayFromFile(fixturePath);

    const raw = require(fixturePath) as LayerASnapshot[];
    const perturbed = raw.map((snap, i) => {
      if (i === 10) {
        return { ...snap, arousalScore: snap.arousalScore + 0.2 };
      }
      return snap;
    });
    const modified = runReplay(perturbed);

    expect(modified.hash).not.toBe(original.hash);
  });
});
