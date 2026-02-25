/**
 * Lightweight observability trace formatters for emotional engine test runs.
 *
 * Produces human-readable and structured JSON representations of
 * per-message engine state using only high-level hints — never raw
 * appraisal internals.
 */

import type { CapturedStep } from '../../coherence/__tests__/coherenceHarness';

export function formatTrace(steps: CapturedStep[]): string {
  return steps
    .map((s) => {
      const gm = s.payload.promptProfile?.guidanceMode ?? '—';
      const hints = s.activeHints.length > 0 ? s.activeHints.join(', ') : 'none';
      const dwell = s.payload.guidanceDwellActive ? 'Y' : 'N';
      const drift = s.payload.driftDetected ? 'Y' : 'N';
      return `[${s.index}] guidance=${gm} | hints=[${hints}] | markers=${s.markerCount} | dwell=${dwell} | drift=${drift}`;
    })
    .join('\n');
}

export interface TraceEntry {
  index: number;
  guidanceMode: string | undefined;
  activeHints: string[];
  markerCount: number;
  dwellActive: boolean;
  driftDetected: boolean;
  cooldownActive: boolean;
}

export function exportTraceJSON(steps: CapturedStep[]): TraceEntry[] {
  return steps.map((s) => ({
    index: s.index,
    guidanceMode: s.payload.promptProfile?.guidanceMode,
    activeHints: s.activeHints,
    markerCount: s.markerCount,
    dwellActive: !!s.payload.guidanceDwellActive,
    driftDetected: !!s.payload.driftDetected,
    cooldownActive: !!s.payload.overrideCooldownActive,
  }));
}
