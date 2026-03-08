import type {
  DriftSeverity,
  DriftFlagCode,
  MemoryV1ShadowEvent,
  MemoryV1DebugSnapshotEvent,
  MemoryV1ShadowReport,
} from './analyticsTypes';

// ---------------------------------------------------------------------------
// Forbidden tokens (centralized)
// ---------------------------------------------------------------------------

export const FORBIDDEN_PHRASES: readonly string[] = Object.freeze([
  'companion', 'companionship', 'intimacy', 'intimate', 'bond', 'bonding',
  'attachment', 'affection', 'closeness', 'rapport', 'love you', 'miss you',
  'need me', 'depend on me', 'always here for you', 'buddy', 'best friend',
  'soulmate', 'partner', 'casual',
]);

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_PHRASES.join('|')})\\b`, 'i');

// ---------------------------------------------------------------------------
// Drift thresholds
// ---------------------------------------------------------------------------

export const MEMORY_V1_DRIFT_THRESHOLDS = Object.freeze({
  excessiveInjectionRatePerUser: 0.85,
  oscillationSpikeCount: 5,
  confidenceHighAtLowBandRate: 0.30,
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const KNOWN_PREFIXES = [
  '[LoRa::MemoryV1Shadow]',
  '[LoRa::MemoryV1Debug]',
  '[LoRa::Memory]',
];

type ParsedEvent =
  | { kind: 'shadow'; event: MemoryV1ShadowEvent }
  | { kind: 'debug'; event: MemoryV1DebugSnapshotEvent };

function tryParseEvent(raw: unknown): ParsedEvent | null {
  if (raw === null || raw === undefined) return null;

  let obj: Record<string, unknown>;
  if (typeof raw === 'string') {
    let line = raw.trim();
    if (!line) return null;
    for (const prefix of KNOWN_PREFIXES) {
      if (line.startsWith(prefix)) {
        line = line.slice(prefix.length).trim();
        break;
      }
    }
    const jsonStart = line.indexOf('{');
    if (jsonStart === -1) return null;
    try {
      obj = JSON.parse(line.slice(jsonStart));
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  } else {
    return null;
  }

  if (obj.tag === 'memory:v1:shadow') return { kind: 'shadow', event: obj as unknown as MemoryV1ShadowEvent };
  if (obj.tag === 'memory:v1:debug') return { kind: 'debug', event: obj as unknown as MemoryV1DebugSnapshotEvent };
  return null;
}

// ---------------------------------------------------------------------------
// Policy signature parsing helpers
// ---------------------------------------------------------------------------

function parseSigField(sig: string, key: string): string | null {
  const prefix = `${key}=`;
  for (const part of sig.split(':')) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

function sigAllowsTendency(sig: string): boolean { return parseSigField(sig, 'tend') === 'Y'; }
function sigAllowsTrajectory(sig: string): boolean { return parseSigField(sig, 'traj') === 'Y'; }
function sigAllowsPattern(sig: string): boolean { return parseSigField(sig, 'pattern') === 'Y'; }
function sigMaxSchemas(sig: string): number {
  const v = parseSigField(sig, 'max');
  return v !== null ? parseInt(v, 10) || 0 : 3;
}

// ---------------------------------------------------------------------------
// Core analyzer
// ---------------------------------------------------------------------------

export function analyzeMemoryV1Logs(
  events: Array<unknown>,
): MemoryV1ShadowReport {
  const shadowEvents: MemoryV1ShadowEvent[] = [];
  const debugEvents: MemoryV1DebugSnapshotEvent[] = [];

  for (const raw of events) {
    const parsed = tryParseEvent(raw);
    if (!parsed) continue;
    if (parsed.kind === 'shadow') shadowEvents.push(parsed.event);
    else debugEvents.push(parsed.event);
  }

  const allEvents = shadowEvents.length + debugEvents.length;
  const userSet = new Set<string>();
  for (const e of shadowEvents) userSet.add(e.userId);
  for (const e of debugEvents) userSet.add(e.userId);

  const injectedCount = shadowEvents.filter((e) => e.injected).length;
  const injectedRate = shadowEvents.length > 0 ? injectedCount / shadowEvents.length : 0;

  // Counts by band
  const countsByBand: Record<string, number> = {};
  for (const e of shadowEvents) {
    countsByBand[e.band] = (countsByBand[e.band] || 0) + 1;
  }
  for (const e of debugEvents) {
    if (e.band) countsByBand[e.band] = (countsByBand[e.band] || 0) + 1;
  }

  // Counts by policy sig
  const sigMap = new Map<string, number>();
  for (const e of shadowEvents) {
    if (e.policySig) sigMap.set(e.policySig, (sigMap.get(e.policySig) || 0) + 1);
  }
  const countsByPolicySig = [...sigMap.entries()]
    .map(([sig, count]) => ({ sig, count }))
    .sort((a, b) => b.count - a.count || a.sig.localeCompare(b.sig));

  // Confidence counts
  const confidenceCounts: Record<string, number> = {};
  for (const e of shadowEvents) {
    const c = e.memoryContext?.confidenceLevel;
    if (c) confidenceCounts[c] = (confidenceCounts[c] || 0) + 1;
  }
  for (const e of debugEvents) {
    if (e.confidenceBucket) {
      confidenceCounts[e.confidenceBucket] = (confidenceCounts[e.confidenceBucket] || 0) + 1;
    }
  }

  // Top trajectories / tendencies
  const trajMap = new Map<string, number>();
  const tendMap = new Map<string, number>();
  for (const e of shadowEvents) {
    if (!e.memoryContext?.topSchemas) continue;
    for (const s of e.memoryContext.topSchemas) {
      if (s.emotionTrajectory && s.emotionTrajectory !== 'omitted') {
        trajMap.set(s.emotionTrajectory, (trajMap.get(s.emotionTrajectory) || 0) + 1);
      }
      if (s.behavioralTendency && s.behavioralTendency !== 'omitted') {
        tendMap.set(s.behavioralTendency, (tendMap.get(s.behavioralTendency) || 0) + 1);
      }
    }
  }
  const topTrajectories = [...trajMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const topTendencies = [...tendMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Drift flags
  const flags = computeDriftFlags(shadowEvents, debugEvents);

  return {
    totals: {
      events: allEvents,
      users: userSet.size,
      injectedCount,
      injectedRate: Math.round(injectedRate * 1000) / 1000,
    },
    countsByBand,
    countsByPolicySig,
    confidenceCounts,
    topTrajectories,
    topTendencies,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Drift flags
// ---------------------------------------------------------------------------

type DriftFlag = { severity: DriftSeverity; code: DriftFlagCode; detail: string };

function computeDriftFlags(
  shadow: MemoryV1ShadowEvent[],
  debug: MemoryV1DebugSnapshotEvent[],
): DriftFlag[] {
  const flags: DriftFlag[] = [];

  // HIGH: INJECTION_AT_LOW_BAND
  const lowBandInjections = shadow.filter(
    (e) => (e.band === 'B0' || e.band === 'B1') && e.injected,
  );
  if (lowBandInjections.length > 0) {
    flags.push({
      severity: 'HIGH',
      code: 'INJECTION_AT_LOW_BAND',
      detail: `${lowBandInjections.length} injection(s) at B0/B1`,
    });
  }

  // HIGH: OMITTED_FIELDS_VIOLATION
  for (const e of shadow) {
    if (!e.policySig || !e.memoryContext?.topSchemas) continue;
    const tendAllowed = sigAllowsTendency(e.policySig);
    const trajAllowed = sigAllowsTrajectory(e.policySig);
    const patternAllowed = sigAllowsPattern(e.policySig);

    for (const s of e.memoryContext.topSchemas) {
      if (!tendAllowed && s.behavioralTendency && s.behavioralTendency !== 'omitted') {
        flags.push({
          severity: 'HIGH',
          code: 'OMITTED_FIELDS_VIOLATION',
          detail: `tendency="${s.behavioralTendency}" shown when policy forbids (${e.policySig})`,
        });
      }
      if (!trajAllowed && s.emotionTrajectory && s.emotionTrajectory !== 'omitted') {
        flags.push({
          severity: 'HIGH',
          code: 'OMITTED_FIELDS_VIOLATION',
          detail: `trajectory="${s.emotionTrajectory}" shown when policy forbids (${e.policySig})`,
        });
      }
    }
    if (!patternAllowed && e.memoryContext.sessionPattern && e.memoryContext.sessionPattern !== 'omitted') {
      flags.push({
        severity: 'HIGH',
        code: 'OMITTED_FIELDS_VIOLATION',
        detail: `sessionPattern="${e.memoryContext.sessionPattern}" shown when policy forbids (${e.policySig})`,
      });
    }
  }

  // HIGH: SCHEMA_COUNT_OVER_CAP
  for (const e of shadow) {
    if (!e.policySig || !e.memoryContext?.topSchemas) continue;
    const max = sigMaxSchemas(e.policySig);
    if (e.memoryContext.topSchemas.length > max) {
      flags.push({
        severity: 'HIGH',
        code: 'SCHEMA_COUNT_OVER_CAP',
        detail: `${e.memoryContext.topSchemas.length} schemas vs max=${max} (${e.policySig})`,
      });
    }
  }

  // HIGH: FORBIDDEN_TOKEN
  for (const e of shadow) {
    if (!e.memoryContext) continue;
    const fields = collectTextFields(e.memoryContext);
    for (const f of fields) {
      const match = FORBIDDEN_RE.exec(f);
      if (match) {
        flags.push({
          severity: 'HIGH',
          code: 'FORBIDDEN_TOKEN',
          detail: `"${match[0]}" found in shadow event for user=${e.userId}`,
        });
        break;
      }
    }
  }

  // MED: EXCESSIVE_INJECTION_RATE per user
  const userInjMap = new Map<string, { total: number; injected: number }>();
  for (const e of shadow) {
    const rec = userInjMap.get(e.userId) || { total: 0, injected: 0 };
    rec.total++;
    if (e.injected) rec.injected++;
    userInjMap.set(e.userId, rec);
  }
  for (const [userId, rec] of userInjMap) {
    if (rec.total > 0 && rec.injected / rec.total > MEMORY_V1_DRIFT_THRESHOLDS.excessiveInjectionRatePerUser) {
      flags.push({
        severity: 'MED',
        code: 'EXCESSIVE_INJECTION_RATE',
        detail: `user=${userId} rate=${(rec.injected / rec.total).toFixed(2)} (${rec.injected}/${rec.total})`,
      });
    }
  }

  // MED: OSCILLATION_SPIKE from debug snapshots
  const debugByUser = new Map<string, MemoryV1DebugSnapshotEvent[]>();
  for (const e of debug) {
    const list = debugByUser.get(e.userId) || [];
    list.push(e);
    debugByUser.set(e.userId, list);
  }
  for (const [userId, events] of debugByUser) {
    let flips = 0;
    for (let i = 1; i < events.length; i++) {
      if (events[i].winnerId !== events[i - 1].winnerId) flips++;
    }
    if (flips > MEMORY_V1_DRIFT_THRESHOLDS.oscillationSpikeCount) {
      flags.push({
        severity: 'MED',
        code: 'OSCILLATION_SPIKE',
        detail: `user=${userId} winnerFlips=${flips}`,
      });
    }
  }

  // MED: CONFIDENCE_IMPLAUSIBLE
  const lowBandShadow = shadow.filter((e) => e.band === 'B0' || e.band === 'B1');
  if (lowBandShadow.length > 0) {
    const highConf = lowBandShadow.filter(
      (e) => e.memoryContext?.confidenceLevel === 'HIGH',
    ).length;
    if (highConf / lowBandShadow.length > MEMORY_V1_DRIFT_THRESHOLDS.confidenceHighAtLowBandRate) {
      flags.push({
        severity: 'MED',
        code: 'CONFIDENCE_IMPLAUSIBLE',
        detail: `${highConf}/${lowBandShadow.length} HIGH confidence at B0/B1`,
      });
    }
  }

  return flags;
}

function collectTextFields(ctx: NonNullable<MemoryV1ShadowEvent['memoryContext']>): string[] {
  const out: string[] = [];
  if (ctx.sessionPattern) out.push(ctx.sessionPattern);
  if (ctx.confidenceLevel) out.push(ctx.confidenceLevel);
  if (ctx.topSchemas) {
    for (const s of ctx.topSchemas) {
      if (s.emotionTrajectory) out.push(s.emotionTrajectory);
      if (s.behavioralTendency) out.push(s.behavioralTendency);
      if (s.relevance) out.push(s.relevance);
      if (s.schemaId) out.push(s.schemaId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function renderMemoryV1ShadowReportMd(
  report: MemoryV1ShadowReport,
): string {
  const lines: string[] = [];

  lines.push('# Memory V1 — Shadow Analytics Report');
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Events | ${report.totals.events} |`);
  lines.push(`| Users | ${report.totals.users} |`);
  lines.push(`| Injected | ${report.totals.injectedCount} |`);
  lines.push(`| Injection rate | ${(report.totals.injectedRate * 100).toFixed(1)}% |`);
  lines.push('');

  lines.push('## Counts by Band');
  lines.push('');
  lines.push(`| Band | Count |`);
  lines.push(`|------|-------|`);
  for (const band of ['B0', 'B1', 'B2', 'B3', 'B4']) {
    lines.push(`| ${band} | ${report.countsByBand[band] || 0} |`);
  }
  lines.push('');

  lines.push('## Counts by Policy Signature');
  lines.push('');
  if (report.countsByPolicySig.length === 0) {
    lines.push('No policy signatures recorded.');
  } else {
    lines.push(`| Signature | Count |`);
    lines.push(`|-----------|-------|`);
    for (const { sig, count } of report.countsByPolicySig) {
      lines.push(`| \`${sig}\` | ${count} |`);
    }
  }
  lines.push('');

  lines.push('## Confidence Distribution');
  lines.push('');
  lines.push(`| Level | Count |`);
  lines.push(`|-------|-------|`);
  for (const lvl of ['LOW', 'MED', 'HIGH']) {
    lines.push(`| ${lvl} | ${report.confidenceCounts[lvl] || 0} |`);
  }
  lines.push('');

  lines.push('## Top Trajectories');
  lines.push('');
  if (report.topTrajectories.length === 0) {
    lines.push('No trajectories recorded.');
  } else {
    lines.push(`| Label | Count |`);
    lines.push(`|-------|-------|`);
    for (const { label, count } of report.topTrajectories) {
      lines.push(`| ${label} | ${count} |`);
    }
  }
  lines.push('');

  lines.push('## Top Tendencies');
  lines.push('');
  if (report.topTendencies.length === 0) {
    lines.push('No tendencies recorded.');
  } else {
    lines.push(`| Label | Count |`);
    lines.push(`|-------|-------|`);
    for (const { label, count } of report.topTendencies) {
      lines.push(`| ${label} | ${count} |`);
    }
  }
  lines.push('');

  lines.push('## Flags');
  lines.push('');
  if (report.flags.length === 0) {
    lines.push('No flags raised.');
  } else {
    lines.push(`| Severity | Code | Detail |`);
    lines.push(`|----------|------|--------|`);
    for (const f of report.flags) {
      lines.push(`| ${f.severity} | ${f.code} | ${f.detail} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
