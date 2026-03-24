// ──────────────────────────────────────────────────────
// Safe JSON parsing for LLM responses
//
// LLMs frequently wrap JSON in markdown code fences
// (```json ... ```) despite being told "output ONLY JSON."
// They also sometimes include explanatory text before or after
// the JSON object/array.
// This utility strips fences and extracts the JSON before parsing.
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
 * Try to extract a JSON object or array from text that may contain
 * surrounding prose. Finds the first `{` or `[` and the matching
 * closing `}` or `]` using a bracket-depth scan.
 */
function extractJsonFromText(text: string): string | null {
  const start = text.search(/[{\[]/);
  if (start === -1) return null;

  const openChar = text[start] as '{' | '[';
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse JSON from an LLM response, stripping code fences if present.
 * Falls back to extracting the JSON object/array from surrounding prose
 * if the initial parse fails (handles cases where the model adds
 * explanatory text before or after the JSON despite instructions).
 */
export function parseLLMJson(text: string): unknown {
  const cleaned = stripCodeFences(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    // First pass failed — try to extract just the JSON from the text
    const extracted = extractJsonFromText(cleaned);
    if (extracted !== null) {
      return JSON.parse(extracted);
    }
    // Re-throw the original error if we couldn't extract anything
    return JSON.parse(cleaned);
  }
}
