/**
 * Bootstrap Memory — public API surface.
 *
 * Usage:
 *   import { createBootstrapMemory, createBootstrapFileStorage, buildBootstrapContext } from './bootstrap';
 *
 * Purge hook:
 *   When purging a user's data (e.g., MemoryService.purgeUser), also call
 *   bootstrapMemory.purge(userId) to remove bootstrap state.
 */

export { createBootstrapMemory, extractMessageThemes } from './bootstrapMemory';
export type {
  BootstrapMemory,
  BootstrapMemoryEntry,
  BootstrapMemoryState,
  BootstrapStorage,
  GraduationResult,
  AnchorCandidate,
} from './bootstrapMemory';
export {
  MAX_THEMES_PER_MESSAGE,
  MAX_BOOTSTRAP_ENTRIES,
  BOOTSTRAP_TTL_MS,
} from './bootstrapMemory';

export { createBootstrapFileStorage, createInMemoryBootstrapStorage } from './bootstrapStorage';
export { buildBootstrapContext, BOOTSTRAP_CONTEXT_MAX_CHARS } from './bootstrapContext';
