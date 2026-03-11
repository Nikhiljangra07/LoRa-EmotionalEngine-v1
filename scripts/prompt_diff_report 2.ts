#!/usr/bin/env ts-node
// scripts/prompt_diff_report.ts
//
// Reads a JSON-lines file of PromptProfileDiffPayload entries and
// produces docs/PROMPT_DIFF_SHADOW_REPORT.md.
//
// Usage:
//   npx ts-node scripts/prompt_diff_report.ts <path-to-jsonl>
//
// If no path is given, reads from stdin (pipe-friendly).

import * as fs from 'fs';
import * as path from 'path';
import type { PromptProfileDiffPayload } from '../src/emotion-core/logging/DecisionLogger';
import { analyzePromptDiffs, renderReport } from '../src/emotion-core/analytics/promptDiffAnalytics';

function parseJsonLines(text: string): PromptProfileDiffPayload[] {
  const payloads: PromptProfileDiffPayload[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    let json = line;
    const prefixIdx = line.indexOf('{');
    if (prefixIdx > 0) json = line.slice(prefixIdx);

    try {
      payloads.push(JSON.parse(json));
    } catch {
      // skip malformed lines
    }
  }
  return payloads;
}

const inputPath = process.argv[2];
let text: string;

if (inputPath) {
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }
  text = fs.readFileSync(inputPath, 'utf-8');
} else {
  text = fs.readFileSync(0, 'utf-8');
}

const payloads = parseJsonLines(text);
if (payloads.length === 0) {
  console.error('No valid payloads found.');
  process.exit(1);
}

const report = analyzePromptDiffs(payloads);
const md = renderReport(report);

const outPath = path.resolve(__dirname, '..', 'docs', 'PROMPT_DIFF_SHADOW_REPORT.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf-8');

console.log(md);
console.log(`\n✔ Report written to ${outPath}`);
console.log(`  Payloads: ${report.totalPayloads}  Flags: ${report.flags.length}`);
