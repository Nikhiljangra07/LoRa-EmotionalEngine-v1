import type { StressRunResult, StressVerdict } from './stressTypes';

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export function computeVerdict(result: StressRunResult): StressVerdict {
  const injectionRate = result.totalMessages > 0
    ? result.totalInjections / result.totalMessages
    : 0;

  if (injectionRate > 0.85) return 'HIGH_DRIFT';
  if (result.maxSchemasObserved > 20) return 'HIGH_DRIFT';

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
  const injRate = result.totalMessages > 0
    ? result.totalInjections / result.totalMessages
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
  lines.push(`| Injection rate | ${fmt(injRate * 100, 1)}% |`);
  lines.push(`| Total oscillation spikes | ${result.totalOscillations} |`);
  lines.push(`| **Verdict** | **${verdict}** |`);
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
  lines.push('| Session | Messages | Schemas | Injected | Oscillations | Created | Merged | Pruned |');
  lines.push('|---------|----------|---------|----------|--------------|---------|--------|--------|');
  for (const s of result.sessionResults) {
    lines.push(
      `| ${s.sessionIndex} | ${s.messageCount} | ${s.schemasCount} | ${s.injectedCount} | ${s.oscillationCount} | ${s.createdSchemas} | ${s.mergedSchemas} | ${s.prunedSchemas} |`,
    );
  }
  lines.push('');

  // Consolidation churn
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
