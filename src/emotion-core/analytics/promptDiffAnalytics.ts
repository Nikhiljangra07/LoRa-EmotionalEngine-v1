// src/emotion-core/analytics/promptDiffAnalytics.ts

import type { PromptProfileDiffPayload } from '../logging/DecisionLogger';

// ── Configurable thresholds ──────────────────────────────────────

export const DRIFT_THRESHOLDS = Object.freeze({
  allowedStyles: new Set(['PROFESSIONAL', 'FRIENDLY']) as ReadonlySet<string>,
  forbiddenSignatureToken: 'CASUAL',
  perUserMaxDiffs: 50,
  maxBandJump: 2,
});

// ── Output types ─────────────────────────────────────────────────

export type Severity = 'LOW' | 'MED' | 'HIGH';

export type DriftFlag = {
  severity: Severity;
  code: string;
  detail: string;
};

export type UserStats = {
  totalDiffs: number;
  signatures: Record<string, number>;
  transitions: Record<string, number>;
};

export type PromptDiffAnalyticsReport = {
  totalPayloads: number;
  countsBySignature: Record<string, number>;
  countsByBand: Record<string, number>;
  topTransitions: Array<{ from: string; to: string; count: number }>;
  perUser: Record<string, UserStats>;
  flags: DriftFlag[];
};

// ── Band ordering (for jump detection) ───────────────────────────

const BAND_ORDER: Record<string, number> = {
  BAND_0: 0,
  BAND_1: 1,
  BAND_2: 2,
  BAND_3: 3,
  BAND_4: 4,
};

function bandIndex(band: string): number | undefined {
  return BAND_ORDER[band];
}

// ── Helpers ──────────────────────────────────────────────────────

function transitionKey(from: string, to: string): string {
  return `${from} → ${to}`;
}

function extractStyleToken(relStyle: string): string {
  const upper = relStyle.toUpperCase();
  if (upper.includes('PROFESSIONAL')) return 'PROFESSIONAL';
  if (upper.includes('FRIENDLY')) return 'FRIENDLY';
  if (upper.includes('CASUAL')) return 'CASUAL';
  return relStyle;
}

// ── Main aggregation ─────────────────────────────────────────────

export function analyzePromptDiffs(
  payloads: readonly PromptProfileDiffPayload[],
): PromptDiffAnalyticsReport {
  const countsBySignature: Record<string, number> = {};
  const countsByBand: Record<string, number> = {};
  const transitionCounts: Record<string, number> = {};
  const perUser: Record<string, UserStats> = {};
  const flags: DriftFlag[] = [];

  const userLastBand: Record<string, string> = {};

  for (const p of payloads) {
    const sig = p.promptSignature ?? 'UNKNOWN';
    countsBySignature[sig] = (countsBySignature[sig] ?? 0) + 1;

    countsByBand[p.band] = (countsByBand[p.band] ?? 0) + 1;

    const oldToken = extractStyleToken(p.oldRelationshipStyle);
    const newToken = extractStyleToken(p.newRelationshipStyle);
    const tKey = transitionKey(oldToken, newToken);
    transitionCounts[tKey] = (transitionCounts[tKey] ?? 0) + 1;

    if (!perUser[p.userId]) {
      perUser[p.userId] = { totalDiffs: 0, signatures: {}, transitions: {} };
    }
    const u = perUser[p.userId];
    u.totalDiffs += 1;
    u.signatures[sig] = (u.signatures[sig] ?? 0) + 1;
    u.transitions[tKey] = (u.transitions[tKey] ?? 0) + 1;

    // ── Flag: style outside allowed set ──
    if (!DRIFT_THRESHOLDS.allowedStyles.has(newToken)) {
      flags.push({
        severity: 'HIGH',
        code: 'STYLE_OUTSIDE_ALLOWED',
        detail: `userId=${p.userId} messageId=${p.messageId} newStyle="${newToken}"`,
      });
    }

    // ── Flag: forbidden token in signature ──
    if (sig.includes(DRIFT_THRESHOLDS.forbiddenSignatureToken)) {
      flags.push({
        severity: 'HIGH',
        code: 'SIGNATURE_FORBIDDEN_TOKEN',
        detail: `userId=${p.userId} signature="${sig}" contains "${DRIFT_THRESHOLDS.forbiddenSignatureToken}"`,
      });
    }

    // ── Flag: band jump > threshold ──
    const prevBand = userLastBand[p.userId];
    if (prevBand !== undefined) {
      const prevIdx = bandIndex(prevBand);
      const currIdx = bandIndex(p.band);
      if (prevIdx !== undefined && currIdx !== undefined) {
        const jump = currIdx - prevIdx;
        if (jump > DRIFT_THRESHOLDS.maxBandJump) {
          flags.push({
            severity: 'MED',
            code: 'BAND_JUMP_TOO_LARGE',
            detail: `userId=${p.userId} jumped ${prevBand} → ${p.band} (delta=${jump})`,
          });
        }
      }
    }
    userLastBand[p.userId] = p.band;
  }

  // ── Flag: per-user excessive diffs ──
  for (const [userId, stats] of Object.entries(perUser)) {
    if (stats.totalDiffs > DRIFT_THRESHOLDS.perUserMaxDiffs) {
      flags.push({
        severity: 'MED',
        code: 'USER_EXCESSIVE_DIFFS',
        detail: `userId=${userId} totalDiffs=${stats.totalDiffs} exceeds threshold=${DRIFT_THRESHOLDS.perUserMaxDiffs}`,
      });
    }
  }

  // ── Sort transitions by count desc, then key asc ──
  const topTransitions = Object.entries(transitionCounts)
    .map(([key, count]) => {
      const [from, to] = key.split(' → ');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));

  return {
    totalPayloads: payloads.length,
    countsBySignature: sortRecord(countsBySignature),
    countsByBand: sortRecord(countsByBand),
    topTransitions,
    perUser,
    flags,
  };
}

function sortRecord(rec: Record<string, number>): Record<string, number> {
  const entries = Object.entries(rec).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const sorted: Record<string, number> = {};
  for (const [k, v] of entries) sorted[k] = v;
  return sorted;
}

// ── Markdown renderer ────────────────────────────────────────────

export function renderReport(report: PromptDiffAnalyticsReport): string {
  const lines: string[] = [];

  lines.push('# Prompt Diff Shadow Report');
  lines.push('');
  lines.push(`> Total payloads analyzed: ${report.totalPayloads}`);
  lines.push('');

  // Flags
  lines.push('## Drift Flags');
  lines.push('');
  if (report.flags.length === 0) {
    lines.push('No flags raised.');
  } else {
    lines.push('| Severity | Code | Detail |');
    lines.push('|----------|------|--------|');
    for (const f of report.flags) {
      lines.push(`| ${f.severity} | ${f.code} | ${f.detail} |`);
    }
  }
  lines.push('');

  // Counts by signature
  lines.push('## Counts by Signature');
  lines.push('');
  lines.push('| Signature | Count |');
  lines.push('|-----------|-------|');
  for (const [sig, cnt] of Object.entries(report.countsBySignature)) {
    lines.push(`| \`${sig}\` | ${cnt} |`);
  }
  lines.push('');

  // Counts by band
  lines.push('## Counts by Band');
  lines.push('');
  lines.push('| Band | Count |');
  lines.push('|------|-------|');
  for (const [band, cnt] of Object.entries(report.countsByBand)) {
    lines.push(`| ${band} | ${cnt} |`);
  }
  lines.push('');

  // Top transitions
  lines.push('## Top Transitions');
  lines.push('');
  lines.push('| From | To | Count |');
  lines.push('|------|----|-------|');
  for (const t of report.topTransitions) {
    lines.push(`| ${t.from} | ${t.to} | ${t.count} |`);
  }
  lines.push('');

  // Per user
  lines.push('## Per-User Summary');
  lines.push('');
  const userEntries = Object.entries(report.perUser).sort(
    (a, b) => b[1].totalDiffs - a[1].totalDiffs || a[0].localeCompare(b[0]),
  );
  for (const [uid, stats] of userEntries) {
    lines.push(`### ${uid} (${stats.totalDiffs} diffs)`);
    lines.push('');
    const sigEntries = Object.entries(stats.signatures).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    if (sigEntries.length > 0) {
      lines.push('| Signature | Count |');
      lines.push('|-----------|-------|');
      for (const [s, c] of sigEntries) {
        lines.push(`| \`${s}\` | ${c} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
