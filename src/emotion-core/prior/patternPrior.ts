/**
 * Pattern Prior — LoRa's prefrontal memory.
 *
 * Loads the 200 bootstrap patterns and matches them against
 * the current conversation context. Returns the top 2-3 most
 * relevant patterns as structural priming for the LLM.
 *
 * This is NOT the perspective engine (LoRaMaths). This is
 * faster, cheaper, and runs on every message — a keyword-based
 * pattern lookup that gives LoRa structural intuition before
 * the LLM even starts generating.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──

interface Pattern {
  situation_shape: string;
  framework: string;
  structural_dynamic: string;
  common_framing_error: string;
  tension: string;
  src: string;
}

interface FoundationalPattern {
  id: string;
  name: string;
  core_principle: string;
  application: string;
  blade: string;
}

interface PatternMatch {
  pattern: Pattern;
  score: number;
}

interface PriorContext {
  /** Top matching patterns (max 3) */
  patterns: Pattern[];
  /** The dominant framework across matches */
  likelyFramework: string | null;
  /** The dominant tension across matches */
  likelyTension: string | null;
}

// ── Singleton data ──

let allPatterns: Pattern[] | null = null;
let allFoundational: FoundationalPattern[] | null = null;

function loadPatterns(): { patterns: Pattern[]; foundational: FoundationalPattern[] } {
  if (allPatterns && allFoundational) {
    return { patterns: allPatterns, foundational: allFoundational };
  }

  try {
    const dataPath = path.resolve(__dirname, '../../../data/bootstrap_patterns.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw);

    allPatterns = [
      ...(data.organic_patterns || []),
      ...(data.reddit_patterns || []),
    ] as Pattern[];

    allFoundational = (data.foundational_reasoning || []) as FoundationalPattern[];

    return { patterns: allPatterns, foundational: allFoundational };
  } catch {
    // Data file missing or corrupt — fail silently, LoRa works without it
    allPatterns = [];
    allFoundational = [];
    return { patterns: [], foundational: [] };
  }
}

// ── Keyword extraction ──

/** Extract meaningful keywords from user text, lowercased */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'i', 'me', 'my', 'we', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
    'the', 'a', 'an', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'can', 'may', 'might', 'shall', 'must', 'to', 'of', 'in', 'for', 'on', 'with',
    'at', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
    'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'but', 'and',
    'or', 'if', 'because', 'as', 'until', 'while', 'that', 'this', 'what', 'which',
    'who', 'whom', 'these', 'those', 'its', 'also', 'really', 'like', 'know',
    'think', 'feel', 'want', 'need', 'get', 'got', 'going', 'thing', 'things',
    'dont', 'im', 'ive', 'cant',
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return new Set(words);
}

// ── Scoring ──

/** Score how well a pattern matches the user's keywords */
function scorePattern(pattern: Pattern, keywords: Set<string>): number {
  // Build searchable text from pattern fields
  const patternText = [
    pattern.situation_shape,
    pattern.structural_dynamic,
    pattern.common_framing_error,
    pattern.tension,
  ].join(' ').toLowerCase().replace(/_/g, ' ');

  const patternWords = new Set(patternText.split(/\s+/).filter(w => w.length > 2));

  // Jaccard-like overlap
  let hits = 0;
  for (const kw of keywords) {
    for (const pw of patternWords) {
      if (pw.includes(kw) || kw.includes(pw)) {
        hits++;
        break;
      }
    }
  }

  if (hits === 0) return 0;
  return hits / Math.max(keywords.size, 1);
}

// ── Public API ──

/**
 * Match the current conversation against the pattern prior.
 * Returns the top 2-3 most relevant structural patterns.
 *
 * This is fast (pure string matching, no LLM call) and runs
 * on every message to give LoRa structural priming.
 */
export function matchPrior(
  userMessage: string,
  recentHistory?: string[],
): PriorContext {
  const { patterns } = loadPatterns();

  if (patterns.length === 0) {
    return { patterns: [], likelyFramework: null, likelyTension: null };
  }

  // Build keyword set from current message + recent history
  const fullText = [userMessage, ...(recentHistory || [])].join(' ');
  const keywords = extractKeywords(fullText);

  if (keywords.size === 0) {
    return { patterns: [], likelyFramework: null, likelyTension: null };
  }

  // Score all patterns
  const scored: PatternMatch[] = patterns
    .map(p => ({ pattern: p, score: scorePattern(p, keywords) }))
    .filter(m => m.score > 0.15) // Minimum relevance threshold
    .sort((a, b) => b.score - a.score);

  const topPatterns = scored.slice(0, 3).map(m => m.pattern);

  // Determine dominant framework and tension from top matches
  let likelyFramework: string | null = null;
  let likelyTension: string | null = null;

  if (topPatterns.length > 0) {
    const fwCounts = new Map<string, number>();
    const tCounts = new Map<string, number>();
    for (const p of topPatterns) {
      fwCounts.set(p.framework, (fwCounts.get(p.framework) ?? 0) + 1);
      tCounts.set(p.tension, (tCounts.get(p.tension) ?? 0) + 1);
    }
    likelyFramework = [...fwCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    likelyTension = [...tCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  return { patterns: topPatterns, likelyFramework, likelyTension };
}

/**
 * Format the prior context into a prompt block for injection.
 * Returns empty string if no relevant patterns found.
 */
export function formatPriorBlock(prior: PriorContext): string {
  if (prior.patterns.length === 0) return '';

  const lines: string[] = [
    '',
    '',
    'STRUCTURAL PRIOR (your instinct, not your output)',
    '──────────────────────────────────────────────────',
    'Patterns similar to this situation:',
    '',
  ];

  for (const p of prior.patterns) {
    const dynamic = p.structural_dynamic.replace(/_/g, ' ');
    const error = p.common_framing_error;
    lines.push(`• ${dynamic} — common error: ${error}`);
  }

  if (prior.likelyFramework) {
    lines.push('');
    lines.push(`Likely structural lens: ${prior.likelyFramework.replace(/_/g, ' ')}`);
  }

  lines.push('');
  lines.push('Use this to orient your analysis. Do not mention patterns or frameworks to the user.');

  return lines.join('\n');
}

// Export for testing
export { extractKeywords, scorePattern, loadPatterns };
export type { Pattern, PriorContext, PatternMatch };
