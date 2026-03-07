#!/usr/bin/env ts-node

/**
 * Memory V1 — Shadow Analytics Report Generator
 *
 * Reads JSON-lines logs from --in file or stdin, analyzes shadow/debug events,
 * and writes a markdown report to docs/MEMORY_V1_SHADOW_REPORT.md.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

function clearProjectCache(): void {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) {
      delete require.cache[key];
    }
  }
}

function parseArgs(): { inputPath: string | null } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in' && args[i + 1]) {
      return { inputPath: args[i + 1] };
    }
  }
  return { inputPath: null };
}

function readLines(inputPath: string | null): string[] {
  let raw: string;
  if (inputPath) {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    raw = fs.readFileSync(resolved, 'utf-8');
  } else {
    try {
      raw = fs.readFileSync('/dev/stdin', 'utf-8');
    } catch {
      raw = '';
    }
  }
  return raw.split('\n').filter((l) => l.trim().length > 0);
}

async function main(): Promise<void> {
  clearProjectCache();

  const analyticsPath = path.join(SRC_DIR, 'emotion-core', 'memory-v1', 'analytics');
  const { analyzeMemoryV1Logs, renderMemoryV1ShadowReportMd } = require(analyticsPath);

  const { inputPath } = parseArgs();
  const lines = readLines(inputPath);

  if (lines.length === 0) {
    console.error('No input lines. Provide --in file.jsonl or pipe to stdin.');
    process.exit(1);
  }

  const report = analyzeMemoryV1Logs(lines);
  const md = renderMemoryV1ShadowReportMd(report);

  const outPath = path.join(PROJECT_ROOT, 'docs', 'MEMORY_V1_SHADOW_REPORT.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf-8');

  const highFlags = report.flags.filter((f: { severity: string }) => f.severity === 'HIGH').length;
  const medFlags = report.flags.filter((f: { severity: string }) => f.severity === 'MED').length;

  console.log(
    `shadow_events=${report.totals.events} injected_rate=${(report.totals.injectedRate * 100).toFixed(1)}% flags_HIGH=${highFlags} flags_MED=${medFlags} → ${outPath}`,
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
