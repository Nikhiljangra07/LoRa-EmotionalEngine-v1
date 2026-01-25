// src/emotion-core/utils/textCleaning.ts

export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/g, '');
}

export function stripAbbreviations(text: string): string {
  // Remove common abbreviations like "Dr.", "Mr.", "etc."
  return text.replace(/\b([A-Z][a-z]?\.)+/g, '');
}

export function isCodeBlock(text: string): boolean {
  // Check if text contains code block markers
  return /```/.test(text) || /^\s{4,}/m.test(text);
}