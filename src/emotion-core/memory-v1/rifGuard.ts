// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FLIP_WINDOW = 5;
export const FLIP_THRESHOLD = 0.60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RIFGuardState = {
  recentWinners: string[];
  cooldownRemaining: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createGuardState(): RIFGuardState {
  return { recentWinners: [], cooldownRemaining: 0 };
}

export function updateGuard(
  guardState: RIFGuardState,
  winnerId: string,
): {
  newGuard: RIFGuardState;
  effectiveAlpha: number;
  effectiveBeta: number;
} {
  const ring = [...guardState.recentWinners, winnerId];
  while (ring.length > FLIP_WINDOW) {
    ring.shift();
  }

  const flipRate = computeFlipRate(ring);

  let cooldown = guardState.cooldownRemaining;

  if (flipRate > FLIP_THRESHOLD && cooldown === 0 && ring.length >= FLIP_WINDOW) {
    cooldown = FLIP_WINDOW;
  }

  let alphaScale = 1;
  let betaScale = 1;

  if (cooldown > 0) {
    alphaScale = 0.5;
    betaScale = 0.5;
    cooldown = Math.max(0, cooldown - 1);
  }

  return {
    newGuard: { recentWinners: ring, cooldownRemaining: cooldown },
    effectiveAlpha: alphaScale,
    effectiveBeta: betaScale,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeFlipRate(winners: string[]): number {
  if (winners.length < 2) return 0;
  let flips = 0;
  for (let i = 1; i < winners.length; i++) {
    if (winners[i] !== winners[i - 1]) flips++;
  }
  return flips / (winners.length - 1);
}
