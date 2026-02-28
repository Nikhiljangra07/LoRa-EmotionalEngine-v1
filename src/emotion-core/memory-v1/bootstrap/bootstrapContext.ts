/**
 * Builds the BOOTSTRAP CONTEXT string from bootstrap entries.
 * Output is deterministic and bounded: max ~200 tokens (~800 chars).
 */

import type { BootstrapMemoryState, BootstrapMemoryEntry } from './bootstrapMemory';

export const BOOTSTRAP_CONTEXT_MAX_CHARS = 800;

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'you', 'your', 'the', 'a', 'an', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall',
  'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'it', 'its', 'this', 'that', 'and', 'or', 'but', 'not', 'so', 'if',
  'about', 'up', 'out', 'just', 'like', 'really', 'very', 'more', 'some',
  'what', 'when', 'how', 'who', 'which', 'there', 'here', 'all', 'each',
  'than', 'then', 'them', 'they', 'their', 'too', 'also', 'get',
  'got', 'know', 'think', 'feel', 'want', 'need', 'going', 'thing',
  'things', 'much', 'many', 'lot', 'make', 'way',
]);

function extractThemes(entries: BootstrapMemoryEntry[], topN: number): string[] {
  const wordCounts = new Map<string, number>();
  const userEntries = entries.filter(e => e.role === 'user');

  for (const entry of userEntries) {
    const words = entry.summary
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    const seen = new Set<string>();
    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  return Array.from(wordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
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

  const themes = extractThemes(state.entries, 5);
  if (themes.length > 0) {
    lines.push(`Themes noticed so far: ${themes.join(', ')}.`);
  }

  const trend = deriveEmotionTrend(state.entries);
  lines.push(`Recent emotional pattern: ${TREND_LABELS[trend]}.`);

  const recentUserEntries = state.entries
    .filter(e => e.role === 'user')
    .slice(-4);

  if (recentUserEntries.length > 0) {
    lines.push('Recent topics:');
    for (const entry of recentUserEntries) {
      lines.push(`- ${entry.summary}`);
    }
  }

  let context = lines.join('\n');

  if (context.length > BOOTSTRAP_CONTEXT_MAX_CHARS) {
    context = context.slice(0, BOOTSTRAP_CONTEXT_MAX_CHARS - 1) + '\u2026';
  }

  return context;
}
