// src/emotion-core/etv/invariants.ts

const DEV_MODE = process.env.NODE_ENV !== 'production';

/**
 * Lightweight runtime invariant checker.
 * Throws only in dev mode (NODE_ENV !== 'production').
 * No-op in production to avoid runtime cost.
 */
export function etvInvariant(condition: boolean, message: string): void {
  if (DEV_MODE && !condition) {
    throw new Error(`[ETV Invariant Violation] ${message}`);
  }
}

/**
 * Validate stored-state invariants: r > 0, s > 0.
 */
export function assertStoredValid(r: number, s: number): void {
  etvInvariant(r > 0, `r must be > 0, got ${r}`);
  etvInvariant(s > 0, `s must be > 0, got ${s}`);
}

/**
 * Validate derived-state invariants after computation.
 */
export function assertDerivedValid(mean: number, variance: number): void {
  etvInvariant(
    mean >= 0 && mean <= 1,
    `mean must be in [0, 1], got ${mean}`,
  );
  etvInvariant(
    variance >= 0,
    `variance must be >= 0, got ${variance}`,
  );
  etvInvariant(
    Number.isFinite(mean),
    `mean must be finite, got ${mean}`,
  );
  etvInvariant(
    Number.isFinite(variance),
    `variance must be finite, got ${variance}`,
  );
}

/**
 * Validate policy scalars: riskAdjusted and conf both in [0, 1].
 */
export function assertPolicyValid(riskAdjusted: number, conf: number): void {
  etvInvariant(
    riskAdjusted >= 0 && riskAdjusted <= 1,
    `riskAdjusted must be in [0, 1], got ${riskAdjusted}`,
  );
  etvInvariant(
    conf >= 0 && conf <= 1,
    `conf must be in [0, 1], got ${conf}`,
  );
}
