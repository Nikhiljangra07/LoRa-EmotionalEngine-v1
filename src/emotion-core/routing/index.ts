/**
 * Adaptive Router V2 — public entry.
 *
 * Ported from ~/Desktop/lora-router-bench after iter_008 adversarial
 * validation. Self-contained: no imports from the rest of the backend.
 *
 * Integration: called unconditionally from chat.route.ts for every
 * incoming message. The decision flows into perspectiveMode selection
 * and the engine's Haiku-vs-Sonnet model choice.
 */

export { routeMessage } from './router';
export { extractSignals, LIFE_STAKES_CRISIS } from './signals/textSignals';
export { computeEIV, EIV_HIGH_THRESHOLD } from './signals/eiv';
export type {
  Tier,
  RouterInput,
  SessionContext,
  Signals,
  RouteDecision,
  RouteReason,
} from './types';
