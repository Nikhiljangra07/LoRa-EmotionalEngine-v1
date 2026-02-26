import type { StressRunResult, StressVerdict } from './stressTypes';

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export function computeVerdict(result: StressRunResult): StressVerdict {
  const rawInjectionRate = result.totalMessages > 0
    ? result.totalInjections / result.totalMessages
    : 0;

  const governedInjectionRate = result.messagesPolicyAllowsInjection > 0
    ? result.totalInjections / result.messagesPolicyAllowsInjection
    : 0;

  if (result.maxSchemasObserved > 20) return 'HIGH_DRIFT';
  if (rawInjectionRate > 0.85) return 'HIGH_DRIFT';

  if (governedInjectionRate > 0.85) return 'MILD_DRIFT';

  const totalOscSessions = result.sessionResults.filter(
    (s) => s.oscillationCount > 0,
  ).length;
  if (totalOscSessions >= 10) return 'MILD_DRIFT';

  return 'STABLE';
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function fmt(n: number, decimals: number = 3): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : '0.000';
}

export function renderStressReportMd(result: StressRunResult): string {
  const verdict = computeVerdict(result);
  const rawRate = result.totalMessages > 0
    ? result.totalInjections / result.totalMessages
    : 0;
  const govRate = result.messagesPolicyAllowsInjection > 0
    ? result.totalInjections / result.messagesPolicyAllowsInjection
    : 0;

  const lines: string[] = [];

  lines.push('# Memory V1 — Long-Horizon Stress Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Sessions | ${result.totalSessions} |`);
  lines.push(`| Total messages | ${result.totalMessages} |`);
  lines.push(`| Max schemas observed | ${result.maxSchemasObserved} |`);
  lines.push(`| Total injections | ${result.totalInjections} |`);
  lines.push(`| Raw injection rate | ${fmt(rawRate * 100, 1)}% |`);
  lines.push(`| Messages policy allows injection | ${result.messagesPolicyAllowsInjection} |`);
  lines.push(`| Governed injection rate | ${fmt(govRate * 100, 1)}% |`);
  lines.push(`| Total oscillation spikes | ${result.totalOscillations} |`);
  lines.push(`| **Verdict** | **${verdict}** |`);
  lines.push('');

  // Band schedule table
  lines.push('## Band Schedule');
  lines.push('');
  lines.push('| Session | Band | Policy Signature |');
  lines.push('|---------|------|------------------|');
  for (const s of result.sessionResults) {
    lines.push(`| ${s.sessionIndex} | ${s.band} | \`${s.policySignature}\` |`);
  }
  lines.push('');

  // Policy signature counts
  const sigMap = new Map<string, number>();
  for (const s of result.sessionResults) {
    sigMap.set(s.policySignature, (sigMap.get(s.policySignature) || 0) + 1);
  }
  lines.push('## Policy Signature Counts');
  lines.push('');
  lines.push('| Signature | Sessions |');
  lines.push('|-----------|----------|');
  const sorted = [...sigMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [sig, count] of sorted) {
    lines.push(`| \`${sig}\` | ${count} |`);
  }
  lines.push('');

  lines.push('## Schema Growth Over Sessions');
  lines.push('');
  lines.push('| Session | Schemas |');
  lines.push('|---------|---------|');
  for (let i = 0; i < result.schemaGrowthOverTime.length; i++) {
    lines.push(`| ${i} | ${result.schemaGrowthOverTime[i]} |`);
  }
  lines.push('');

  lines.push('## Per-Session Detail');
  lines.push('');
  lines.push('| Session | Band | Messages | Schemas | Injected | Oscillations | Created | Merged | Pruned |');
  lines.push('|---------|------|----------|---------|----------|--------------|---------|--------|--------|');
  for (const s of result.sessionResults) {
    lines.push(
      `| ${s.sessionIndex} | ${s.band} | ${s.messageCount} | ${s.schemasCount} | ${s.injectedCount} | ${s.oscillationCount} | ${s.createdSchemas} | ${s.mergedSchemas} | ${s.prunedSchemas} |`,
    );
  }
  lines.push('');

  const totalMerged = result.sessionResults.reduce((s, r) => s + r.mergedSchemas, 0);
  const totalPruned = result.sessionResults.reduce((s, r) => s + r.prunedSchemas, 0);
  const totalCreated = result.sessionResults.reduce((s, r) => s + r.createdSchemas, 0);
  const avgChurn = result.totalSessions > 0
    ? (totalMerged + totalPruned) / result.totalSessions
    : 0;

  lines.push('## Consolidation Churn');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total created | ${totalCreated} |`);
  lines.push(`| Total merged | ${totalMerged} |`);
  lines.push(`| Total pruned | ${totalPruned} |`);
  lines.push(`| Avg churn/session | ${fmt(avgChurn, 2)} |`);
  lines.push('');

  return lines.join('\n');
}
