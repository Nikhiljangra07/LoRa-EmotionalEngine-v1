import { AppraisalBridgeRunner } from '../AppraisalBridgeRunner';
import { makeSnapshot } from './helpers';
import type { AppraisalResult, LayerASnapshot } from '../types';

// Deterministic FNV-1a hash (same as cross-module-stability uses)
const HASH_OFFSET = 0x811c9dc5;
const HASH_PRIME = 0x01000193;
function fnv1a(input: string): string {
  let hash = HASH_OFFSET >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, HASH_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function buildFixture(): LayerASnapshot[] {
  const snapshots: LayerASnapshot[] = [];
  for (let i = 0; i < 50; i++) {
    // Deterministic pseudo-variation (no randomness)
    const phase = i / 50;
    snapshots.push(
      makeSnapshot({
        messageIndex: i,
        timestampMs: 1_000_000 + i * 5_000,
        deltaMessageSeconds: 5 + (i % 7) * 3,
        valenceScore: -0.4 + phase * 0.8,
        arousalScore: 0.2 + phase * 0.5,
        expressionStrength: 0.15 + phase * 0.4,
        eivValue: 0.1 + phase * 0.6,
        capsRatio: 0.02 + phase * 0.15,
        punctuationHits: i % 3,
        emojiHits: i % 2,
        repetitionScore: 0.05 + phase * 0.2,
        questionMarks: i % 2,
      })
    );
  }
  return snapshots;
}

function runAndHash(fixture: LayerASnapshot[]): string {
  const runner = new AppraisalBridgeRunner();
  const results: AppraisalResult[] = [];
  for (const snap of fixture) {
    results.push(runner.step(snap));
  }
  return fnv1a(JSON.stringify(results));
}

describe('AppraisalBridgeRunner — determinism', () => {
  test('identical input sequences produce identical output hashes', () => {
    const fixture = buildFixture();

    const hash1 = runAndHash(fixture);
    const hash2 = runAndHash(fixture);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(8);
  });

  test('different input sequences produce different hashes', () => {
    const fixtureA = buildFixture();
    const fixtureB = fixtureA.map((snap, i) =>
      makeSnapshot({
        messageIndex: i,
        timestampMs: snap.timestampMs,
        deltaMessageSeconds: snap.deltaMessageSeconds,
        valenceScore: -snap.valenceScore,
        arousalScore: 1 - snap.arousalScore,
        expressionStrength: snap.expressionStrength,
        eivValue: 1 - snap.eivValue,
      })
    );

    const hashA = runAndHash(fixtureA);
    const hashB = runAndHash(fixtureB);

    expect(hashA).not.toBe(hashB);
  });
});
