// ──────────────────────────────────────────────────────
// Safe JSON parsing for LLM responses
//
// LLMs frequently wrap JSON in markdown code fences
// (```json ... ```) despite being told "output ONLY JSON."
// This utility strips fences before parsing.
// ──────────────────────────────────────────────────────

/**
 * Strip markdown code fences from a string if present.
 * Handles: ```json\n...\n```, ```\n...\n```, and bare JSON.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();

  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1].trim();
  }

  return trimmed;
}

/**
 * Parse JSON from an LLM response, stripping code fences if present.
 */
export function parseLLMJson(text: string): unknown {
  return JSON.parse(stripCodeFences(text));
}
