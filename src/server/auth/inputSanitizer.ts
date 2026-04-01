/**
 * Input sanitization — defense-in-depth against prompt injection.
 *
 * Catches common injection patterns in user messages.
 * The 6 Laws of LoRa + IdentityGuard handle output-side defense;
 * this handles input-side defense.
 *
 * Design principles:
 * - Minimize false positives: users discuss technical topics, AI, prompts, etc.
 * - Only flag patterns that are clearly adversarial (not just mentioning AI concepts)
 * - Strip rather than block: remove the injection payload, keep the message
 * - Log for monitoring, don't over-block
 */

/** Patterns that indicate explicit prompt injection attempts */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Direct instruction overrides
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)/i, label: 'instruction_override' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i, label: 'instruction_override' },
  { pattern: /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i, label: 'instruction_override' },

  // Role hijacking
  { pattern: /you\s+are\s+now\s+(a|an|the)\s+/i, label: 'role_hijack' },
  { pattern: /act\s+as\s+(if\s+you\s+are|a|an|the)\s+(?!friend|mentor|coach)/i, label: 'role_hijack' },
  { pattern: /pretend\s+(to\s+be|you\s+are)\s+(a|an|the)\s+/i, label: 'role_hijack' },
  { pattern: /switch\s+to\s+(\w+)\s+mode/i, label: 'role_hijack' },

  // System prompt extraction
  { pattern: /(?:show|reveal|display|print|output|repeat|echo)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?)/i, label: 'prompt_extraction' },
  { pattern: /what\s+(?:are|is)\s+your\s+(?:system\s+)?(?:prompt|instructions?|rules?|initial\s+instructions?)/i, label: 'prompt_extraction' },

  // Delimiter injection (trying to inject system-level markers)
  { pattern: /\[(?:SYSTEM|INST|ADMIN|ROOT)\]/i, label: 'delimiter_injection' },
  { pattern: /<<\s*(?:SYS|SYSTEM|INSTRUCTIONS?)\s*>>/i, label: 'delimiter_injection' },
  { pattern: /<\/?system(?:\s+[^>]*)?\s*>/i, label: 'delimiter_injection' },

  // Jailbreak phrases
  { pattern: /(?:DAN|do\s+anything\s+now)\s+mode/i, label: 'jailbreak' },
  { pattern: /enable\s+(?:developer|debug|admin|unrestricted|god)\s+mode/i, label: 'jailbreak' },
];

export interface SanitizeResult {
  /** The sanitized text (injection payloads stripped) */
  text: string;
  /** Whether any injection patterns were detected */
  injectionDetected: boolean;
  /** Labels of matched patterns (for logging) */
  matchedPatterns: string[];
}

/**
 * Sanitize user input against prompt injection patterns.
 *
 * Returns the cleaned text with injection payloads removed.
 * Does NOT block the message — strips and logs instead.
 */
export function sanitizeInput(raw: string): SanitizeResult {
  const matchedPatterns: string[] = [];
  let cleaned = raw;

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      matchedPatterns.push(label);
      // Strip the matched pattern, preserving surrounding text
      cleaned = cleaned.replace(pattern, '[filtered]');
    }
  }

  return {
    text: cleaned.trim(),
    injectionDetected: matchedPatterns.length > 0,
    matchedPatterns,
  };
}
