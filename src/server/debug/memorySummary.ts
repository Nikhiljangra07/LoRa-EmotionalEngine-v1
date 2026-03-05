// src/server/debug/memorySummary.ts

/**
 * Shared memory summary calculation for debug endpoint and CLI.
 * Anchor count and schema count are produced by callers; this module
 * aggregates bootstrap entries into a unique theme count and returns
 * the full summary shape.
 */

export interface BootstrapEntryForSummary {
  themes?: string[];
}

export interface MemorySummary {
  anchorCount: number;
  schemaCount: number;
  bootstrapThemeCount: number;
}

export function computeMemorySummary(options: {
  anchorCount: number;
  schemaCount: number;
  bootstrapEntries: BootstrapEntryForSummary[];
}): MemorySummary {
  const uniqueThemes = new Set<string>();
  for (const entry of options.bootstrapEntries) {
    if (!entry.themes) continue;
    for (const theme of entry.themes) {
      uniqueThemes.add(theme);
    }
  }
  return {
    anchorCount: options.anchorCount,
    schemaCount: options.schemaCount,
    bootstrapThemeCount: uniqueThemes.size,
  };
}
