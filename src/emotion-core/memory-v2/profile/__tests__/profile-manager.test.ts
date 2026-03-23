import type { SessionFingerprint, EmotionalFingerprint, UserProfile } from '../../types';
import {
  updateProfile,
  ewma,
  verbosityFromWords,
  computeTypicalPrimary,
  computeVolatility,
  updateLibrary,
  MAX_FINGERPRINT_LIBRARY,
} from '../profile-manager';

// ──────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────

function makeFP(overrides: Partial<{
  sessionId: string;
  userId: string;
  primary: EmotionalFingerprint['primary'];
  intensity: number;
  contextCategory: EmotionalFingerprint['contextCategory'];
  peakIntensity: number;
  avgWordsPerMessage: number;
  directness: number;
  importanceScore: number;
  timestamp: string;
}>): SessionFingerprint {
  return {
    sessionId: overrides.sessionId ?? 'session_001',
    userId: overrides.userId ?? 'user_001',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    eivCurve: [0.3, 0.5, overrides.peakIntensity ?? 0.7],
    peakIntensity: overrides.peakIntensity ?? 0.7,
    peakTurn: 2,
    resolution: true,
    emotionalFingerprint: {
      primary: overrides.primary ?? 'fear',
      undertones: ['tension', 'dread'],
      intensity: overrides.intensity ?? 0.7,
      contextCategory: overrides.contextCategory ?? 'career',
      relationalTone: 'collaborative',
    },
    decisionPattern: {
      topicRevisits: 1,
      decisionReached: true,
      avoidanceSignals: ['financial_risk'],
      primaryTension: 'security_vs_growth',
    },
    styleSnapshot: {
      avgWordsPerMessage: overrides.avgWordsPerMessage ?? 15,
      questionRatio: 0.2,
      directness: overrides.directness ?? 0.7,
    },
    importanceScore: overrides.importanceScore ?? 7,
    lastAccessed: new Date().toISOString(),
    accessCount: 0,
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('EWMA helper', () => {
  it('returns observation when applied to same value', () => {
    expect(ewma(0.5, 0.5)).toBe(0.5);
  });

  it('moves toward observation with alpha weight', () => {
    // alpha=0.3: new = 0.3*0.8 + 0.7*0.5 = 0.24 + 0.35 = 0.59
    expect(ewma(0.5, 0.8, 0.3)).toBeCloseTo(0.59, 5);
  });

  it('converges toward repeated observations', () => {
    let value = 0.5;
    for (let i = 0; i < 20; i++) {
      value = ewma(value, 0.9);
    }
    // After many iterations, should be close to 0.9
    expect(value).toBeGreaterThan(0.85);
  });
});

describe('verbosityFromWords', () => {
  it('returns 0 for 0 words', () => {
    expect(verbosityFromWords(0)).toBe(0);
  });

  it('returns 1 for 50+ words', () => {
    expect(verbosityFromWords(50)).toBe(1);
    expect(verbosityFromWords(100)).toBe(1);
  });

  it('returns 0.5 for 25 words', () => {
    expect(verbosityFromWords(25)).toBeCloseTo(0.5, 5);
  });
});

describe('computeTypicalPrimary', () => {
  it('returns the most frequent emotion', () => {
    const fps = [
      makeFP({ primary: 'fear' }),
      makeFP({ primary: 'fear' }),
      makeFP({ primary: 'sadness' }),
    ];
    expect(computeTypicalPrimary(fps)).toBe('fear');
  });

  it('handles single fingerprint', () => {
    expect(computeTypicalPrimary([makeFP({ primary: 'joy' })])).toBe('joy');
  });

  it('picks one when tied (deterministic — first max wins)', () => {
    const fps = [
      makeFP({ primary: 'fear' }),
      makeFP({ primary: 'sadness' }),
    ];
    const result = computeTypicalPrimary(fps);
    // Both have count 1, so whichever is iterated first wins
    expect(['fear', 'sadness']).toContain(result);
  });
});

describe('computeVolatility', () => {
  it('returns 0 for single fingerprint', () => {
    expect(computeVolatility([makeFP({ peakIntensity: 0.7 })])).toBe(0);
  });

  it('returns 0 for identical peak intensities', () => {
    const fps = [
      makeFP({ peakIntensity: 0.5 }),
      makeFP({ peakIntensity: 0.5 }),
      makeFP({ peakIntensity: 0.5 }),
    ];
    expect(computeVolatility(fps)).toBe(0);
  });

  it('returns positive value for varying intensities', () => {
    const fps = [
      makeFP({ peakIntensity: 0.3 }),
      makeFP({ peakIntensity: 0.7 }),
      makeFP({ peakIntensity: 0.5 }),
    ];
    const vol = computeVolatility(fps);
    expect(vol).toBeGreaterThan(0);
  });

  it('computes correct stddev', () => {
    // peaks: [0.2, 0.8] → mean=0.5, variance=0.09, stddev=0.3
    const fps = [
      makeFP({ peakIntensity: 0.2 }),
      makeFP({ peakIntensity: 0.8 }),
    ];
    expect(computeVolatility(fps)).toBeCloseTo(0.3, 2);
  });
});

describe('updateLibrary', () => {
  it('adds a fingerprint to an empty library', () => {
    const result = updateLibrary([], makeFP({ sessionId: 'new' }));
    expect(result).toHaveLength(1);
    expect(result[0]!.sessionId).toBe('new');
  });

  it('keeps max 5 fingerprints', () => {
    const existing = Array.from({ length: 5 }, (_, i) =>
      makeFP({ sessionId: `session_${i}`, importanceScore: 5 }),
    );
    const newFp = makeFP({ sessionId: 'session_new', importanceScore: 9 });

    const result = updateLibrary(existing, newFp);
    expect(result.length).toBeLessThanOrEqual(MAX_FINGERPRINT_LIBRARY);
  });

  it('evicts lowest-scored fingerprint when full', () => {
    // Create 5 existing with low importance + old timestamps
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const existing = Array.from({ length: 5 }, (_, i) =>
      makeFP({
        sessionId: `old_${i}`,
        importanceScore: 2,
        intensity: 0.3,
        timestamp: oneMonthAgo,
      }),
    );

    // New fingerprint with high importance + recent
    const newFp = makeFP({
      sessionId: 'new_important',
      importanceScore: 9,
      intensity: 0.9,
    });

    const result = updateLibrary(existing, newFp);

    // The new high-importance fingerprint should be in the library
    expect(result.some((fp) => fp.sessionId === 'new_important')).toBe(true);
    expect(result).toHaveLength(MAX_FINGERPRINT_LIBRARY);
  });
});

describe('updateProfile', () => {
  describe('new user creation (existing = null)', () => {
    it('creates a profile from the first fingerprint', () => {
      const fp = makeFP({
        userId: 'new_user',
        primary: 'fear',
        intensity: 0.7,
        avgWordsPerMessage: 20,
        directness: 0.8,
      });

      const profile = updateProfile(null, fp);

      expect(profile.userId).toBe('new_user');
      expect(profile.sessionsCompleted).toBe(1);
      expect(profile.firstSeen).toBeDefined();
      expect(profile.lastSeen).toBeDefined();
      expect(profile.fingerprintLibrary).toHaveLength(1);
      expect(profile.emotionalBaseline.typicalPrimary).toBe('fear');
      expect(profile.emotionalBaseline.avgEIV).toBe(fp.peakIntensity);
      expect(profile.communicationStyle.directness).toBe(0.8);
    });

    it('sets default response profile', () => {
      const profile = updateProfile(null, makeFP({}));
      expect(profile.responseProfile.bestStrategy).toBe('clarify');
      expect(profile.responseProfile.pushTolerance).toBe(0.5);
    });
  });

  describe('rolling average update', () => {
    it('updates communication style with EWMA after 3 sessions', () => {
      let profile: UserProfile | null = null;

      // Session 1: directness=0.3
      profile = updateProfile(profile, makeFP({ sessionId: 's1', directness: 0.3 }));
      expect(profile.communicationStyle.directness).toBe(0.3);

      // Session 2: directness=0.9
      // EWMA: 0.3*0.9 + 0.7*0.3 = 0.27 + 0.21 = 0.48
      profile = updateProfile(profile, makeFP({ sessionId: 's2', directness: 0.9 }));
      expect(profile.communicationStyle.directness).toBeCloseTo(0.48, 2);

      // Session 3: directness=0.9
      // EWMA: 0.3*0.9 + 0.7*0.48 = 0.27 + 0.336 = 0.606
      profile = updateProfile(profile, makeFP({ sessionId: 's3', directness: 0.9 }));
      expect(profile.communicationStyle.directness).toBeCloseTo(0.606, 2);
    });

    it('updates avgEIV with EWMA', () => {
      let profile: UserProfile | null = null;

      profile = updateProfile(profile, makeFP({ sessionId: 's1', peakIntensity: 0.4 }));
      expect(profile.emotionalBaseline.avgEIV).toBe(0.4);

      // EWMA: 0.3*0.8 + 0.7*0.4 = 0.24 + 0.28 = 0.52
      profile = updateProfile(profile, makeFP({ sessionId: 's2', peakIntensity: 0.8 }));
      expect(profile.emotionalBaseline.avgEIV).toBeCloseTo(0.52, 2);
    });

    it('increments sessionsCompleted', () => {
      let profile = updateProfile(null, makeFP({ sessionId: 's1' }));
      expect(profile.sessionsCompleted).toBe(1);

      profile = updateProfile(profile, makeFP({ sessionId: 's2' }));
      expect(profile.sessionsCompleted).toBe(2);

      profile = updateProfile(profile, makeFP({ sessionId: 's3' }));
      expect(profile.sessionsCompleted).toBe(3);
    });
  });

  describe('fingerprintLibrary eviction', () => {
    it('keeps max 5 fingerprints after many sessions', () => {
      let profile: UserProfile | null = null;

      for (let i = 0; i < 10; i++) {
        profile = updateProfile(profile, makeFP({
          sessionId: `session_${i}`,
          importanceScore: 3 + (i % 5),
        }));
      }

      expect(profile!.fingerprintLibrary.length).toBeLessThanOrEqual(5);
    });

    it('retains high-importance recent fingerprints over old low-importance ones', () => {
      let profile: UserProfile | null = null;
      const oldTimestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

      // Add 5 old, low-importance sessions
      for (let i = 0; i < 5; i++) {
        profile = updateProfile(profile, makeFP({
          sessionId: `old_${i}`,
          importanceScore: 2,
          intensity: 0.3,
          timestamp: oldTimestamp,
        }));
      }

      // Add 1 new, high-importance session
      profile = updateProfile(profile, makeFP({
        sessionId: 'new_important',
        importanceScore: 9,
        intensity: 0.9,
      }));

      const library = profile!.fingerprintLibrary;
      expect(library.some((fp) => fp.sessionId === 'new_important')).toBe(true);
    });
  });

  describe('volatility calculation', () => {
    it('returns 0 after first session', () => {
      const profile = updateProfile(null, makeFP({ peakIntensity: 0.5 }));
      expect(profile.emotionalBaseline.volatility).toBe(0);
    });

    it('returns positive volatility when peak intensities vary', () => {
      let profile: UserProfile | null = null;

      profile = updateProfile(profile, makeFP({ sessionId: 's1', peakIntensity: 0.3 }));
      profile = updateProfile(profile, makeFP({ sessionId: 's2', peakIntensity: 0.9 }));

      expect(profile.emotionalBaseline.volatility).toBeGreaterThan(0);
    });

    it('returns 0 volatility when peak intensities are identical', () => {
      let profile: UserProfile | null = null;

      profile = updateProfile(profile, makeFP({ sessionId: 's1', peakIntensity: 0.5 }));
      profile = updateProfile(profile, makeFP({ sessionId: 's2', peakIntensity: 0.5 }));
      profile = updateProfile(profile, makeFP({ sessionId: 's3', peakIntensity: 0.5 }));

      expect(profile.emotionalBaseline.volatility).toBe(0);
    });
  });

  describe('typicalPrimary tracking', () => {
    it('tracks most frequent emotion across sessions', () => {
      let profile: UserProfile | null = null;

      profile = updateProfile(profile, makeFP({ sessionId: 's1', primary: 'fear' }));
      profile = updateProfile(profile, makeFP({ sessionId: 's2', primary: 'sadness' }));
      profile = updateProfile(profile, makeFP({ sessionId: 's3', primary: 'fear' }));

      expect(profile.emotionalBaseline.typicalPrimary).toBe('fear');
    });
  });
});
