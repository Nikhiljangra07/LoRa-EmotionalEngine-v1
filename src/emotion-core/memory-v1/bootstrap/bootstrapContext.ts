/**
 * Builds the BOOTSTRAP CONTEXT string from bootstrap entries.
 * Output is deterministic and bounded: max ~200 tokens (~800 chars).
 * Uses only pre-extracted themes — no raw user text is accessed.
 */

import type { BootstrapMemoryState, BootstrapMemoryEntry } from './bootstrapMemory';

export const BOOTSTRAP_CONTEXT_MAX_CHARS = 800;

function aggregateThemes(entries: BootstrapMemoryEntry[], topN: number): string[] {
  const themeCounts = new Map<string, number>();
  const userEntries = entries.filter(e => e.role === 'user');

  for (const entry of userEntries) {
    const seen = new Set<string>();
    for (const theme of entry.themes) {
      if (seen.has(theme)) continue;
      seen.add(theme);
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
  }

  return Array.from(themeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([theme]) => theme);
}

type EmotionTrend = 'positive' | 'negative' | 'mixed' | 'neutral';

function deriveEmotionTrend(entries: BootstrapMemoryEntry[]): EmotionTrend {
  const vecs = entries
    .filter(e => e.emotionVec && e.emotionVec.length >= 2)
    .map(e => e.emotionVec!);

  if (vecs.length < 2) return 'neutral';

  const recentHalf = vecs.slice(-Math.ceil(vecs.length / 2));
  const avgValence = recentHalf.reduce((s, v) => s + v[0], 0) / recentHalf.length;
  const avgArousal = recentHalf.reduce((s, v) => s + v[1], 0) / recentHalf.length;

  const valenceSpread = Math.abs(
    recentHalf.reduce((max, v) => Math.max(max, v[0]), -Infinity) -
    recentHalf.reduce((min, v) => Math.min(min, v[0]), Infinity)
  );

  if (valenceSpread > 0.4) return 'mixed';
  if (avgValence > 0.2 && avgArousal > 0.3) return 'positive';
  if (avgValence < -0.2) return 'negative';
  return 'neutral';
}

const TREND_LABELS: Record<EmotionTrend, string> = {
  positive: 'generally upbeat',
  negative: 'tending toward low mood',
  mixed: 'fluctuating',
  neutral: 'steady and neutral',
};

export function buildBootstrapContext(state: BootstrapMemoryState | null): string {
  if (!state || state.entries.length === 0) return '';

  const lines: string[] = [];

  const themes = aggregateThemes(state.entries, 5);
  if (themes.length > 0) {
    lines.push(`Themes noticed so far: ${themes.join(', ')}.`);
  }

  const trend = deriveEmotionTrend(state.entries);
  lines.push(`Recent emotional pattern: ${TREND_LABELS[trend]}.`);

  const recentUserEntries = state.entries
    .filter(e => e.role === 'user')
    .slice(-4);

  if (recentUserEntries.length > 0) {
    const recentThemes = new Set<string>();
    for (const entry of recentUserEntries) {
      for (const t of entry.themes) recentThemes.add(t);
    }
    if (recentThemes.size > 0) {
      lines.push('Recent user themes:');
      for (const t of recentThemes) {
        lines.push(`- ${t}`);
      }
    }
  }

  let context = lines.join('\n');

  if (context.length > BOOTSTRAP_CONTEXT_MAX_CHARS) {
    context = context.slice(0, BOOTSTRAP_CONTEXT_MAX_CHARS - 1) + '\u2026';
  }

  return context;
}
