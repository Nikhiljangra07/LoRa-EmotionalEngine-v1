import { readFileSync } from 'fs';
import { AppraisalBridgeRunner } from '../AppraisalBridgeRunner';
import { normalizeAppraisalResult } from './normalize';
import { stableHash } from './hash';
import type { LayerASnapshot } from '../types';

export interface ReplayResult {
  hash: string;
  outputsCount: number;
}

export function runReplay(snapshots: LayerASnapshot[]): ReplayResult {
  const runner = new AppraisalBridgeRunner();
  const normalized: unknown[] = [];

  for (const snap of snapshots) {
    const result = runner.step(snap);
    normalized.push(normalizeAppraisalResult(result));
  }

  return {
    hash: stableHash(normalized),
    outputsCount: normalized.length,
  };
}

export function runReplayFromFile(filePath: string): ReplayResult {
  const raw = readFileSync(filePath, 'utf-8');
  const snapshots: LayerASnapshot[] = JSON.parse(raw);
  return runReplay(snapshots);
}
