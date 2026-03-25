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
 * closing bracket using a bracket-depth scan that tracks ALL bracket types.
 */
function extractJsonFromText(text: string): string | null {
  const start = text.search(/[{\[]/);
  if (start === -1) return null;

  const openChar = text[start] as '{' | '[';
  const closeChar = openChar === '{' ? '}' : ']';

  let curlyDepth = 0;
  let squareDepth = 0;
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

    if (ch === '{') curlyDepth++;
    else if (ch === '}') curlyDepth--;
    else if (ch === '[') squareDepth++;
    else if (ch === ']') squareDepth--;

    // Top-level object/array closed when its specific depth returns to 0
    // and the other bracket type is also balanced
    if (ch === closeChar) {
      const relevantDepth = openChar === '{' ? curlyDepth : squareDepth;
      if (relevantDepth === 0 && curlyDepth === 0 && squareDepth === 0) {
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

  // Attempt 1: direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // continue to fallback
  }

  // Attempt 2: bracket-depth extraction from cleaned text
  const extracted = extractJsonFromText(cleaned);
  if (extracted !== null) {
    try {
      return JSON.parse(extracted);
    } catch {
      // continue to fallback
    }
  }

  // Attempt 3: bracket-depth on original (pre-fence-strip) text
  // Handles edge cases where fence stripping corrupts the JSON
  const rawExtracted = extractJsonFromText(text.trim());
  if (rawExtracted !== null && rawExtracted !== extracted) {
    try {
      return JSON.parse(rawExtracted);
    } catch {
      // continue to final throw
    }
  }

  // All attempts failed — throw with context
  throw new Error(
    `parseLLMJson: all parse attempts failed (input length=${text.length}, ` +
    `extracted length=${extracted?.length ?? 0})`
  );
}
