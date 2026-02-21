export const TAU_AGENCY_SECONDS = 21600; // 6 hours
export const POST_WINDOW_SECONDS = 2700; // 45 minutes
export const RELAPSE_EXTENSION_SECONDS = 900; // 15 minutes
export const MAX_POST_WINDOW_SECONDS = 7200; // 2 hours

export const ESC_CRIT_LEVEL = 3;
export const ESC_CRIT_SCORE = 0.92;

export const PRESSURE_CRIT = 12.0;
export const SLOPE_CRIT = 0.15;

export const EPS = 1e-6;

export const TAU_SPIRAL_SECONDS = 1200; // 20 minutes
export const SPIRAL_THRESHOLD = 0.65;
export const SPIRAL_GAP_MIN = 0.15; // future-proof
export const REPEAT_HIGH = 0.6;
export const URGENCY_GAIN_HIGH = 1.15;
export const RING_BUFFER_N = 8;

export const TAU_SUBSTITUTE_SECONDS = 1800; // 30 minutes (slower than spiral)
export const SUBSTITUTE_THRESHOLD = 0.6;

export const SEEK_HIGH = 0.6;
export const SHIFT_HIGH = 0.55;
export const REFRAME_HIGH = 0.55;

export const SUBSTITUTE_MUTEX_MARGIN = 0.12; // arbitration margin
export const RING_BUFFER_N_SUB = 8;
