// src/debug/sessionTrace.ts

import fs from 'fs';
import path from 'path';

interface SessionTraceEntry {
  timestamp: number;
  etv: number;
  eiv: number;
  emotionalState: {
    arousal: string;
    valence: string;
  };
  prompt: string;
  llmOutput: string;
}

const TRACE_DIR = path.resolve(process.cwd(), 'debug', 'traces');

function ensureDir() {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }
}

export function writeSessionTrace(
  sessionId: string,
  entry: SessionTraceEntry
) {
  ensureDir();

  const filePath = path.join(
    TRACE_DIR,
    `${sessionId}.jsonl`
  );

  const line = JSON.stringify(entry) + '\n';

  fs.appendFileSync(filePath, line, { encoding: 'utf-8' });
}
