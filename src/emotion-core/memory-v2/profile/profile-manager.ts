import type {
  UserProfile,
  SessionFingerprint,
  EkmanEmotion,
} from '../types';
import type { IGraphStore } from '../storage/interfaces';

// ──────────────────────────────────────────────────────
// User Profile Manager
//
// Evolves a user profile across sessions.
// Uses EWMA for communication style, rolling averages
// for emotional baseline, and a ranked library of
// top fingerprints.
// ──────────────────────────────────────────────────────

/** EWMA smoothing factor — 0.3 gives ~70% weight to history, 30% to new data */
const EWMA_ALPHA = 0.3;

/** Maximum fingerprints to keep in the library */
const MAX_FINGERPRINT_LIBRARY = 5;

// ── EWMA helper ──

/**
 * Exponentially Weighted Moving Average update.
 * new_value = alpha * observation + (1 - alpha) * old_value
 */
function ewma(oldValue: number, observation: number, alpha: number = EWMA_ALPHA): number {
  return alpha * observation + (1 - alpha) * oldValue;
}

// ── Verbosity / emotional density from style snapshot ──

/**
 * Estimate verbosity (0–1) from avgWordsPerMessage.
 * 0 words → 0.0, 50+ words → 1.0, linear between.
 */
function verbosityFromWords(avgWords: number): number {
  return Math.max(0, Math.min(1, avgWords / 50));
}

/**
 * Estimate emotional density (0–1) from fingerprint intensity.
 * This is a proxy — true density would require per-message emotion scoring.
 */
function emotionalDensityFromIntensity(intensity: number): number {
  return Math.max(0, Math.min(1, intensity));
}

// ── Typical primary (mode) ──

/**
 * Find the most frequent primary emotion across fingerprints.
 */
function computeTypicalPrimary(fingerprints: SessionFingerprint[]): EkmanEmotion {
  const counts = new Map<EkmanEmotion, number>();
  for (const fp of fingerprints) {
    const primary = fp.emotionalFingerprint.primary;
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
  }

  let best: EkmanEmotion = 'sadness';
  let bestCount = 0;
  for (const [emotion, count] of counts) {
    if (count > bestCount) {
      best = emotion;
      bestCount = count;
    }
  }
  return best;
}

// ── Volatility (standard deviation of EIV peaks) ──

/**
 * Compute standard deviation of peak EIV intensities across fingerprints.
 * Uses the last `n` fingerprints (up to 5).
 */
function computeVolatility(fingerprints: SessionFingerprint[]): number {
  if (fingerprints.length < 2) return 0;

  const peaks = fingerprints.map((fp) => fp.peakIntensity);
  const mean = peaks.reduce((sum, v) => sum + v, 0) / peaks.length;
  const variance = peaks.reduce((sum, v) => sum + (v - mean) ** 2, 0) / peaks.length;

  return Math.round(Math.sqrt(variance) * 1000) / 1000;
}

// ── Fingerprint library management ──

/**
 * Score a fingerprint for library ranking.
 * Higher = more worth keeping.
 * Formula: recency_score * intensity * importance_factor
 */
function libraryScore(fp: SessionFingerprint, nowMs: number): number {
  const ageMs = nowMs - new Date(fp.timestamp).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  // Recency: 1.0 at day 0, decays to 0.1 at 180 days
  const recency = Math.max(0.1, 1.0 - ageDays / 200);
  const importance = fp.importanceScore / 10;
  return recency * fp.emotionalFingerprint.intensity * importance;
}

/**
 * Update the fingerprint library: add new, keep top 5 by score, evict rest.
 */
function updateLibrary(
  existing: SessionFingerprint[],
  newFp: SessionFingerprint,
): SessionFingerprint[] {
  const nowMs = Date.now();
  const all = [...existing, newFp];

  // Score and sort descending
  const scored = all.map((fp) => ({ fp, score: libraryScore(fp, nowMs) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_FINGERPRINT_LIBRARY).map((s) => s.fp);
}

// ── Main functions ──

/**
 * Create a new user profile from the first session fingerprint.
 */
function createProfile(userId: string, fingerprint: SessionFingerprint): UserProfile {
  const now = new Date().toISOString();

  return {
    userId,
    sessionsCompleted: 1,
    firstSeen: now,
    lastSeen: now,

    communicationStyle: {
      verbosity: verbosityFromWords(fingerprint.styleSnapshot.avgWordsPerMessage),
      emotionalDensity: emotionalDensityFromIntensity(fingerprint.emotionalFingerprint.intensity),
      directness: fingerprint.styleSnapshot.directness,
      resistancePattern: 'deflect', // Default until we have enough data
    },

    emotionalBaseline: {
      avgEIV: fingerprint.peakIntensity,
      avgValence: 0.5, // Neutral default — valence isn't in fingerprint yet
      typicalPrimary: fingerprint.emotionalFingerprint.primary,
      volatility: 0,
    },

    fingerprintLibrary: [fingerprint],

    responseProfile: {
      bestStrategy: 'clarify', // Defaults until InterventionRecords are aggregated
      worstStrategy: 'challenge',
      pushTolerance: 0.5,
    },
  };
}

/**
 * Update an existing user profile with a new session fingerprint.
 *
 * - Communication style: EWMA (alpha=0.3) on verbosity, emotionalDensity, directness
 * - Emotional baseline: rolling avgEIV, typicalPrimary (mode), volatility (stddev)
 * - Fingerprint library: keep top 5 by (recency × intensity × importance)
 * - Increment sessionsCompleted, update lastSeen
 */
export function updateProfile(
  existing: UserProfile | null,
  newFingerprint: SessionFingerprint,
): UserProfile {
  if (existing === null) {
    return createProfile(newFingerprint.userId, newFingerprint);
  }

  const now = new Date().toISOString();

  // Update fingerprint library first (needed for typicalPrimary and volatility)
  const updatedLibrary = updateLibrary(existing.fingerprintLibrary, newFingerprint);

  // EWMA updates for communication style
  const newVerbosity = verbosityFromWords(newFingerprint.styleSnapshot.avgWordsPerMessage);
  const newDensity = emotionalDensityFromIntensity(newFingerprint.emotionalFingerprint.intensity);

  const communicationStyle = {
    verbosity: round3(ewma(existing.communicationStyle.verbosity, newVerbosity)),
    emotionalDensity: round3(ewma(existing.communicationStyle.emotionalDensity, newDensity)),
    directness: round3(ewma(existing.communicationStyle.directness, newFingerprint.styleSnapshot.directness)),
    resistancePattern: existing.communicationStyle.resistancePattern, // Updated from InterventionRecords, not fingerprints
  };

  // Emotional baseline updates
  const emotionalBaseline = {
    avgEIV: round3(ewma(existing.emotionalBaseline.avgEIV, newFingerprint.peakIntensity)),
    avgValence: existing.emotionalBaseline.avgValence, // Not yet computable from fingerprints
    typicalPrimary: computeTypicalPrimary(updatedLibrary),
    volatility: computeVolatility(updatedLibrary),
  };

  return {
    ...existing,
    sessionsCompleted: existing.sessionsCompleted + 1,
    lastSeen: now,
    communicationStyle,
    emotionalBaseline,
    fingerprintLibrary: updatedLibrary,
  };
}

/**
 * Retrieve a user profile from the graph store.
 * Returns null if the user has no profile yet.
 *
 * NOTE: In the current implementation, profiles are computed in-memory
 * from fingerprint data. This function provides the interface for
 * when profiles are persisted to the graph store.
 */
export async function getProfile(
  _userId: string,
  _store: IGraphStore,
): Promise<UserProfile | null> {
  // TODO: Implement profile persistence in graph store
  // For now, profiles are built in-memory by the pipeline
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Export for testing
export {
  ewma,
  verbosityFromWords,
  emotionalDensityFromIntensity,
  computeTypicalPrimary,
  computeVolatility,
  updateLibrary,
  libraryScore,
  createProfile,
  EWMA_ALPHA,
  MAX_FINGERPRINT_LIBRARY,
};
