/**
 * Bootstrap Memory — ephemeral cold-start personalization bridge.
 *
 * Stores per-user summaries (NOT raw transcripts) to provide context
 * until structured memory (anchors + schemas) has enough data.
 * Auto-graduates and purges after a configurable session threshold.
 */

export const MAX_SUMMARY_LENGTH = 120;
export const MAX_BOOTSTRAP_ENTRIES = 150;
export const BOOTSTRAP_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface BootstrapMemoryEntry {
  summary: string;
  role: 'user' | 'assistant';
  emotionVec?: number[];
  eiv?: number;
  sessionIndex: number;
  timestamp: number;
}

export interface BootstrapMemoryState {
  version: 1;
  userId: string;
  entries: BootstrapMemoryEntry[];
  sessionCount: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface AnchorCandidate {
  summary: string;
  emotionVec: number[];
  sessionIndex: number;
  frequency: number;
}

export interface GraduationResult {
  graduated: boolean;
  anchorCandidates: AnchorCandidate[];
  purged: boolean;
}

export interface BootstrapStorage {
  load(userId: string): BootstrapMemoryState | null;
  save(state: BootstrapMemoryState): void;
  purge(userId: string): void;
  exists(userId: string): boolean;
}

export function truncateSummary(text: string): string {
  if (text.length <= MAX_SUMMARY_LENGTH) return text;
  return text.slice(0, MAX_SUMMARY_LENGTH - 1) + '\u2026';
}

export function createEmptyState(userId: string, nowMs: number): BootstrapMemoryState {
  return {
    version: 1,
    userId,
    entries: [],
    sessionCount: 0,
    createdAt: nowMs,
    lastUpdatedAt: nowMs,
  };
}

export interface BootstrapMemory {
  addMessage(
    userId: string,
    summary: string,
    role: 'user' | 'assistant',
    emotionVec: number[] | undefined,
    eiv: number | undefined,
    sessionIndex: number,
    nowMs: number,
  ): void;

  incrementSession(userId: string, nowMs: number): number;

  getState(userId: string): BootstrapMemoryState | null;

  shouldGraduate(userId: string, sessionThreshold: number): boolean;

  graduate(userId: string): GraduationResult;

  purge(userId: string): void;
}

/**
 * Extracts recurring themes from entries for graduation.
 * Uses simple keyword frequency — no heavy NLP.
 */
function extractThemeCandidates(entries: BootstrapMemoryEntry[]): AnchorCandidate[] {
  const userEntries = entries.filter(e => e.role === 'user');
  if (userEntries.length === 0) return [];

  const wordFreq = new Map<string, { count: number; entries: BootstrapMemoryEntry[] }>();
  const STOP_WORDS = new Set([
    'i', 'me', 'my', 'we', 'you', 'your', 'the', 'a', 'an', 'is', 'are',
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall',
    'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'it', 'its', 'this', 'that', 'and', 'or', 'but', 'not', 'so', 'if',
    'about', 'up', 'out', 'just', 'like', 'really', 'very', 'more', 'some',
    'what', 'when', 'how', 'who', 'which', 'there', 'here', 'all', 'each',
    'than', 'then', 'them', 'they', 'their', 'too', 'also', 'been', 'get',
    'got', 'know', 'think', 'feel', 'want', 'need', 'going', 'thing',
    'things', 'much', 'many', 'lot', 'make', 'way',
  ]);

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
      const existing = wordFreq.get(word);
      if (existing) {
        existing.count++;
        existing.entries.push(entry);
      } else {
        wordFreq.set(word, { count: 1, entries: [entry] });
      }
    }
  }

  const candidates: AnchorCandidate[] = [];
  for (const [, data] of wordFreq) {
    if (data.count < 2) continue;
    const representative = data.entries[data.entries.length - 1];
    candidates.push({
      summary: representative.summary,
      emotionVec: representative.emotionVec ?? [0, 0, 0, 0],
      sessionIndex: representative.sessionIndex,
      frequency: data.count,
    });
  }

  candidates.sort((a, b) => b.frequency - a.frequency);
  return candidates.slice(0, 10);
}

export function createBootstrapMemory(storage: BootstrapStorage): BootstrapMemory {
  return {
    addMessage(userId, summary, role, emotionVec, eiv, sessionIndex, nowMs) {
      let state = storage.load(userId);
      if (!state) {
        state = createEmptyState(userId, nowMs);
      }

      const truncated = truncateSummary(summary);

      state.entries.push({
        summary: truncated,
        role,
        emotionVec,
        eiv,
        sessionIndex,
        timestamp: nowMs,
      });

      if (state.entries.length > MAX_BOOTSTRAP_ENTRIES) {
        state.entries = state.entries.slice(-MAX_BOOTSTRAP_ENTRIES);
      }

      state.lastUpdatedAt = nowMs;
      storage.save(state);
    },

    incrementSession(userId, nowMs) {
      let state = storage.load(userId);
      if (!state) {
        state = createEmptyState(userId, nowMs);
      }
      state.sessionCount++;
      state.lastUpdatedAt = nowMs;
      storage.save(state);
      return state.sessionCount;
    },

    getState(userId) {
      return storage.load(userId);
    },

    shouldGraduate(userId, sessionThreshold) {
      const state = storage.load(userId);
      if (!state) return false;
      return state.sessionCount >= sessionThreshold;
    },

    graduate(userId) {
      const state = storage.load(userId);
      if (!state || state.entries.length === 0) {
        return { graduated: false, anchorCandidates: [], purged: false };
      }

      const anchorCandidates = extractThemeCandidates(state.entries);
      storage.purge(userId);

      return {
        graduated: true,
        anchorCandidates,
        purged: true,
      };
    },

    purge(userId) {
      storage.purge(userId);
    },
  };
}
