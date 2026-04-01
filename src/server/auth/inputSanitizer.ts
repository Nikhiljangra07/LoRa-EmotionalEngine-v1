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
 * - Normalize before matching: collapse whitespace, strip zero-width chars
 * - Log for monitoring, don't over-block
 */

/**
 * Normalize text for pattern matching:
 * - Collapse multiple whitespace to single space
 * - Remove zero-width and invisible unicode characters
 * - Trim
 */
function normalize(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '') // zero-width / invisible chars
    .replace(/\s+/g, ' ')                                  // collapse whitespace
    .trim();
}

/** Patterns that indicate explicit prompt injection attempts */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Direct instruction overrides
  { pattern: /\bignore\b.{0,20}\b(previous|prior|above|earlier)\b.{0,20}\b(instructions?|prompts?|rules?|directives?)\b/i, label: 'instruction_override' },
  { pattern: /\bdisregard\b.{0,20}\b(previous|prior|above|earlier)\b.{0,20}\b(instructions?|prompts?|rules?)\b/i, label: 'instruction_override' },
  { pattern: /\bforget\b.{0,20}\b(previous|prior|above|earlier)\b.{0,20}\b(instructions?|prompts?|rules?)\b/i, label: 'instruction_override' },
  { pattern: /\boverride\b.{0,20}\b(instructions?|prompts?|rules?|system)\b/i, label: 'instruction_override' },

  // Role hijacking
  { pattern: /\byou are now\b.{0,10}\b(a|an|the)\b/i, label: 'role_hijack' },
  { pattern: /\bact as\b.{0,15}\b(if you are|a|an|the)\b/i, label: 'role_hijack' },
  { pattern: /\bpretend\b.{0,10}\b(to be|you are|you're)\b/i, label: 'role_hijack' },
  { pattern: /\bswitch to\b.{0,15}\bmode\b/i, label: 'role_hijack' },
  { pattern: /\byou must\b.{0,20}\b(obey|comply|follow)\b/i, label: 'role_hijack' },
  { pattern: /\bnew (instructions?|persona|identity|character)\b/i, label: 'role_hijack' },

  // System prompt extraction
  { pattern: /\b(show|reveal|display|print|output|repeat|echo|dump)\b.{0,20}\b(system|initial|original)?\s*(prompt|instructions?|rules?|guidelines?)\b/i, label: 'prompt_extraction' },
  { pattern: /\bwhat (are|is|were) your\b.{0,15}\b(system\s*)?(prompt|instructions?|rules?)\b/i, label: 'prompt_extraction' },
  { pattern: /\brepeat\b.{0,15}\b(everything|all|word for word)\b.{0,15}\b(above|before|earlier)\b/i, label: 'prompt_extraction' },

  // Delimiter injection (trying to inject system-level markers)
  { pattern: /\[\s*(?:SYSTEM|INST|ADMIN|ROOT|OVERRIDE)\s*\]/i, label: 'delimiter_injection' },
  { pattern: /<<\s*(?:SYS|SYSTEM|INSTRUCTIONS?)\s*>>/i, label: 'delimiter_injection' },
  { pattern: /<\/?system(?:\s+[^>]*)?\s*>/i, label: 'delimiter_injection' },
  { pattern: /```\s*system\b/i, label: 'delimiter_injection' },

  // Jailbreak phrases
  { pattern: /\b(?:DAN|do anything now)\b.{0,10}\bmode\b/i, label: 'jailbreak' },
  { pattern: /\benable\b.{0,10}\b(developer|debug|admin|unrestricted|god|jailbreak)\b.{0,5}\bmode\b/i, label: 'jailbreak' },
  { pattern: /\bjailbreak\b/i, label: 'jailbreak' },
  { pattern: /\bno restrictions?\b.{0,15}\b(mode|apply|from now)\b/i, label: 'jailbreak' },
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
 * Normalizes whitespace before matching to defeat obfuscation.
 * Returns the cleaned text with injection payloads removed.
 * Does NOT block the message — strips and logs instead.
 */
export function sanitizeInput(raw: string): SanitizeResult {
  const matchedPatterns: string[] = [];

  // Normalize for pattern matching (collapse whitespace, strip invisible chars)
  let cleaned = normalize(raw);

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      if (!matchedPatterns.includes(label)) {
        matchedPatterns.push(label);
      }
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
