// src/emotion-core/etv/sim/__tests__/etvSimulator.test.ts

import { runSimulation } from '../etvSimulator';
import {
  calmStable,
  intenseStable,
  volatileModerate,
  violationSessions,
  idleReturnScenario,
  calmStableShort,
} from '../fixtures';

describe('ETV Simulator', () => {
  const N = 12;

  describe('calmStable scenario', () => {
    const results = runSimulation(calmStable(N));

    it('produces correct number of steps', () => {
      expect(results).toHaveLength(N);
    });

    it('mean increases monotonically', () => {
      for (let i = 1; i < results.length; i++) {
        expect(results[i].mean).toBeGreaterThanOrEqual(results[i - 1].mean);
      }
    });

    it('riskAdjusted increases over sessions', () => {
      expect(results[N - 1].riskAdjusted).toBeGreaterThan(results[0].riskAdjusted);
    });

    it('all z values are high (>= 0.9)', () => {
      for (const r of results) {
        expect(r.z).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('effectiveN grows', () => {
      expect(results[N - 1].effectiveN).toBeGreaterThan(results[0].effectiveN);
    });

    it('is deterministic (re-run produces identical results)', () => {
      const results2 = runSimulation(calmStable(N));
      expect(results2).toEqual(results);
    });
  });

  describe('intenseStable grows slower than calmStable due to eivRisk', () => {
    const calmR = runSimulation(calmStable(N));
    const intenseR = runSimulation(intenseStable(N));

    it('intenseStable z < calmStable z', () => {
      expect(intenseR[0].z).toBeLessThan(calmR[0].z);
    });

    it('intenseStable final mean < calmStable final mean', () => {
      expect(intenseR[N - 1].mean).toBeLessThan(calmR[N - 1].mean);
    });

    it('intenseStable final riskAdjusted < calmStable final riskAdjusted', () => {
      expect(intenseR[N - 1].riskAdjusted).toBeLessThan(calmR[N - 1].riskAdjusted);
    });
  });

  describe('volatileModerate scenario', () => {
    const calmR = runSimulation(calmStable(N));
    const volR = runSimulation(volatileModerate(N));

    it('volatile z < calm z', () => {
      expect(volR[0].z).toBeLessThan(calmR[0].z);
    });

    it('volatile grows slower', () => {
      expect(volR[N - 1].mean).toBeLessThan(calmR[N - 1].mean);
    });
  });

  describe('violation scenario', () => {
    const violR = runSimulation(violationSessions(N, 3));

    it('violation sessions have lower z', () => {
      const violZ = violR.filter((_, i) => (i + 1) % 3 === 0).map(r => r.z);
      const nonViolZ = violR.filter((_, i) => (i + 1) % 3 !== 0).map(r => r.z);
      const maxNon = Math.max(...nonViolZ);
      for (const z of violZ) {
        expect(z).toBeLessThan(maxNon);
      }
    });

    it('violations suppress riskAdjusted vs calm', () => {
      const calmR = runSimulation(calmStable(N));
      expect(violR[N - 1].riskAdjusted).toBeLessThan(calmR[N - 1].riskAdjusted);
    });
  });

  describe('idleReturn scenario', () => {
    const results = runSimulation(idleReturnScenario());

    it('effectiveN drops after idle gap', () => {
      expect(results[5].effectiveN).toBeGreaterThan(results[6].effectiveN);
    });

    it('conf drops after idle gap', () => {
      expect(results[5].conf).toBeGreaterThan(results[6].conf);
    });

    it('decay factor < 1 after idle gap', () => {
      expect(results[6].decayApplied).toBeLessThan(1);
    });
  });

  describe('short sessions use reduced mass', () => {
    const calmR = runSimulation(calmStable(N));
    const shortR = runSimulation(calmStableShort(N));

    it('short sessions all use mass=0.25', () => {
      for (const r of shortR) {
        expect(r.mass).toBe(0.25);
      }
    });

    it('normal sessions all use mass=1.0', () => {
      for (const r of calmR) {
        expect(r.mass).toBe(1.0);
      }
    });

    it('short sessions grow slower', () => {
      expect(shortR[N - 1].mean).toBeLessThan(calmR[N - 1].mean);
    });
  });

  describe('cold-start safety', () => {
    it('no scenario reaches BAND_4 in first 2 sessions', () => {
      const allScenarios = [
        calmStable(12),
        intenseStable(12),
        volatileModerate(12),
        violationSessions(12),
        idleReturnScenario(),
        calmStableShort(12),
      ];
      for (const sessions of allScenarios) {
        const results = runSimulation(sessions);
        const first2 = results.slice(0, 2);
        for (const r of first2) {
          expect(r.band).not.toBe('BAND_4');
        }
      }
    });
  });

  describe('bounds invariants', () => {
    it('all values stay in valid ranges', () => {
      const allScenarios = [
        calmStable(12),
        intenseStable(12),
        volatileModerate(12),
        violationSessions(12),
        idleReturnScenario(),
        calmStableShort(12),
      ];
      for (const sessions of allScenarios) {
        const results = runSimulation(sessions);
        for (const r of results) {
          expect(r.z).toBeGreaterThanOrEqual(0);
          expect(r.z).toBeLessThanOrEqual(1);
          expect(r.mean).toBeGreaterThanOrEqual(0);
          expect(r.mean).toBeLessThanOrEqual(1);
          expect(r.variance).toBeGreaterThanOrEqual(0);
          expect(r.riskAdjusted).toBeGreaterThanOrEqual(0);
          expect(r.riskAdjusted).toBeLessThanOrEqual(1);
          expect(r.conf).toBeGreaterThanOrEqual(0);
          expect(r.conf).toBeLessThanOrEqual(1);
          expect(r.r).toBeGreaterThan(0);
          expect(r.s).toBeGreaterThan(0);
          expect(r.effectiveN).toBeGreaterThan(0);
        }
      }
    });
  });
});
