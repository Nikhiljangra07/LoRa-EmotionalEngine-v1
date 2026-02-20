// Numerical stability floor for robust scale denominators (MAD).
export const EPS = 1e-6;

// Baseline window size for slope/volatility robust statistics.
export const W_BASELINE = 30;

// Required sample count before any escalation decisions are allowed.
export const MIN_WARMUP = 15;

// Risk band thresholds.
export const Z_WARN = 2.0;
export const Z_ESC = 3.0;
export const Z_CRIT = 3.5;

// Exit hysteresis thresholds.
export const Z_WARN_EXIT = 1.5;
export const Z_ESC_EXIT = 2.5;
export const Z_CALM_MAX = 1.0;

// Volatility and shock risk weights.
export const ALPHA_V = 1.2;
export const BETA_H = 3.0;

// Hard cap for risk scalar to bound numeric behavior.
export const R_MAX = Z_CRIT * 3;

// K-of-M persistence for promotions.
export const RISE_ON_K = 3;
export const RISE_ON_M = 5;
export const ESC_ON_K = 2;
export const ESC_ON_M = 3;

// K-of-M persistence for demotions.
export const RISE_OFF_K = 4;
export const RISE_OFF_M = 5;
export const ESC_OFF_K = 4;
export const ESC_OFF_M = 5;
export const CRIT_OFF_K = 5;
export const CRIT_OFF_M = 6;

// Flapping detection over recent level transitions.
export const FLAP_WINDOW = 30;
export const FLAP_CHANGES_THRESHOLD = 8;
