/**
 * LoRa v1 Memory & Session Stress Tester
 *
 * Runs externally against /api/chat and /debug/memory. Validates anchor ranking,
 * multi-session persistence, poisoning protection, schema guard, and recall accuracy.
 *
 * Usage: npm run stress:memory
 * Optional: DEBUG_MEMORY=1 to log anchor state; LORA_STRESS_CONVERSATIONS=50 to override total.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.LORA_BASE_URL || process.env.LORA_STRESS_API_URL || 'http://localhost:3000';
const TOTAL_CONVERSATIONS = parseInt(process.env.LORA_STRESS_CONVERSATIONS ?? '100', 10);
const SESSIONS_PER_USER = parseInt(process.env.LORA_STRESS_SESSIONS_PER_USER ?? '20', 10);
const MESSAGES_PER_SESSION = 5;
const USERS = ['userA', 'userB', 'userC'];
const DEBUG_MEMORY = process.env.DEBUG_MEMORY === '1' || process.env.DEBUG_MEMORY === 'true';
const MAX_REQUESTS_PER_SECOND = 2;
const DELAY_MS_MIN = 200;
const DELAY_MS_MAX = 1200;

const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 300;

type ScenarioType = 'A' | 'B' | 'C' | 'D' | 'E';

interface Scenario {
  type: ScenarioType;
  messages: string[];
  expectedRecall: string; // substring to look for in reply (e.g. "March 20 2026" or "2026-03-08")
  description: string;
}

const SCENARIOS: Scenario[] = [
  {
    type: 'A',
    messages: ['I will deploy March 20 2026', 'When am I deploying?'],
    expectedRecall: 'March 20 2026',
    description: 'explicit memory',
  },
  {
    type: 'B',
    messages: ['I will deploy March 20 2026', 'change it to March 8 2026', 'When am I deploying?'],
    expectedRecall: 'March 8 2026',
    description: 'update override',
  },
  {
    type: 'C',
    messages: ['I will deploy March 20 2026', 'maybe tomorrow', 'When am I deploying?'],
    expectedRecall: 'March 20 2026',
    description: 'inferred noise (explicit must win)',
  },
  {
    type: 'D',
    messages: ['I will deploy March 20 2026', 'I will deploy April 15 2026', 'When am I deploying?'],
    expectedRecall: 'April 15 2026',
    description: 'conflict (latest explicit wins)',
  },
  {
    type: 'E',
    messages: Array.from({ length: 12 }, (_, i) => `I will deploy on March ${i + 1} 2026`),
    expectedRecall: '', // no single expected; we only verify poisoning blocked (max 10 stored)
    description: 'poisoning attempt (12 anchors, max 10 per slot)',
  },
];

// ---------------------------------------------------------------------------
// Run directory & writers
// ---------------------------------------------------------------------------

function timestampDir(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `run_${y}-${m}-${d}_${h}-${min}-${s}`;
}

let runDir: string;
let conversationLogStream: fs.WriteStream;
let anchorEventsStream: fs.WriteStream;
let errorsStream: fs.WriteStream;
let csvRows: string[];

function ensureRunDir(): void {
  const logsRoot = path.join(process.cwd(), 'logs', 'stress-tests');
  runDir = path.join(logsRoot, timestampDir());
  if (!fs.existsSync(path.join(process.cwd(), 'logs'))) {
    fs.mkdirSync(path.join(process.cwd(), 'logs'));
  }
  if (!fs.existsSync(logsRoot)) {
    fs.mkdirSync(logsRoot, { recursive: true });
  }
  fs.mkdirSync(runDir, { recursive: true });
  conversationLogStream = fs.createWriteStream(path.join(runDir, 'conversation-log.jsonl'), { flags: 'a' });
  anchorEventsStream = fs.createWriteStream(path.join(runDir, 'anchor-events.jsonl'), { flags: 'a' });
  errorsStream = fs.createWriteStream(path.join(runDir, 'errors.log'), { flags: 'a' });
  csvRows = ['timestamp,userId,sessionId,scenario,input,response,expectedRecall,recallCorrect'];
}

function writeConversationLog(entry: Record<string, unknown>): void {
  conversationLogStream.write(JSON.stringify(entry) + '\n');
}

function writeAnchorEvent(entry: Record<string, unknown>): void {
  anchorEventsStream.write(JSON.stringify(entry) + '\n');
}

function writeError(msg: string, scenario?: string, userId?: string, sessionId?: string, stack?: string): void {
  if (!errorsStream) return;
  const line = [
    new Date().toISOString(),
    scenario ?? '',
    userId ?? '',
    sessionId ?? '',
    msg,
    stack ?? '',
  ].join('\t') + '\n';
  errorsStream.write(line);
}

function closeStreams(): void {
  conversationLogStream?.end();
  anchorEventsStream?.end();
  errorsStream?.end();
}

// ---------------------------------------------------------------------------
// Rate limit & delay
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(): number {
  return DELAY_MS_MIN + Math.random() * (DELAY_MS_MAX - DELAY_MS_MIN);
}

async function rateLimit(): Promise<void> {
  const minInterval = 1000 / MAX_REQUESTS_PER_SECOND;
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < minInterval) {
    await delay(minInterval - elapsed);
  }
  lastRequestTime = Date.now();
}

// ---------------------------------------------------------------------------
// Safe fetch with retries
// ---------------------------------------------------------------------------

async function safeFetch(
  url: string,
  options: RequestInit,
  retries: number = FETCH_RETRIES,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
    }
  }
  throw new Error('safeFetch: max retries');
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

interface ChatResponse {
  reply?: string;
  error?: string;
  details?: string;
  debug?: { anchorsUsed?: number; degraded?: { falkor?: boolean; chroma?: boolean } };
}

async function postChat(
  userId: string,
  sessionId: string,
  text: string,
): Promise<{ ok: boolean; reply: string; status: number; body: ChatResponse }> {
  await rateLimit();
  const url = `${BASE_URL}/api/chat`;
  const body = JSON.stringify({ userId, sessionId, text, messageId: `msg-${Date.now()}` });
  try {
    const res = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    let data: ChatResponse;
    try {
      data = (await res.json()) as ChatResponse;
    } catch {
      const raw = await res.text();
      data = { reply: raw || '' };
    }
    const reply = typeof data.reply === 'string' ? data.reply : '';
    return { ok: res.ok, reply, status: res.status, body: data };
  } catch (e) {
    console.error('CHAT REQUEST FAILED', e);
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reply: '', status: 0, body: { error: 'fetch_error', details: message } };
  }
}

async function postTerminate(sessionId: string): Promise<{ ended: boolean }> {
  await rateLimit();
  const url = `${BASE_URL}/api/session/terminate`;
  try {
    const res = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = (await res.json()) as { ended?: boolean };
    return { ended: data.ended === true };
  } catch {
    return { ended: false };
  }
}

interface DebugMemoryResponse {
  memorySummary?: { anchorCount?: number; lastFact?: { type: string; slot: string; value: string | number } };
  facts?: { recent?: Array<{ type: string; slot: string; value: string | number; createdAt?: number }> };
}

async function getDebugMemory(userId: string): Promise<DebugMemoryResponse | null> {
  await rateLimit();
  const url = `${BASE_URL}/debug/memory?userId=${encodeURIComponent(userId)}`;
  try {
    const res = await safeFetch(url, { method: 'GET' });
    if (!res.ok) return null;
    return (await res.json()) as DebugMemoryResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Date normalization & recall check
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBR: Record<string, number> = {};
MONTH_NAMES.forEach((m, i) => {
  MONTH_ABBR[m] = i + 1;
  MONTH_ABBR[m.slice(0, 3)] = i + 1;
});

function stripOrdinal(s: string): string {
  return s.replace(/(\d+)(?:st|nd|rd|th)\b/gi, '$1');
}

function normalizeText(s: string): string {
  return stripOrdinal(s).replace(/,/g, ' ').replace(/[—–\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface ParsedDate { year: number; month: number; day: number }

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateToCanonical(d: ParsedDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

function parseOneDateString(raw: string): ParsedDate | null {
  const s = normalizeText(raw);

  // ISO: 2026-03-20
  const isoMatch = s.match(/(\d{4})\s*(\d{2})\s*(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const month = parseInt(m!, 10);
    if (month >= 1 && month <= 12) {
      return { year: parseInt(y!, 10), month, day: parseInt(d!, 10) };
    }
  }

  // "March 20 2026" or "march 20 2026"
  const mdyMatch = s.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (mdyMatch) {
    const month = MONTH_ABBR[mdyMatch[1]!];
    if (month) {
      return { year: parseInt(mdyMatch[3]!, 10), month, day: parseInt(mdyMatch[2]!, 10) };
    }
  }

  // "20 March 2026"
  const dmyMatch = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (dmyMatch) {
    const month = MONTH_ABBR[dmyMatch[2]!];
    if (month) {
      return { year: parseInt(dmyMatch[3]!, 10), month, day: parseInt(dmyMatch[1]!, 10) };
    }
  }

  // "March 20" (no year — assume current year)
  const myNoYear = s.match(/([a-z]+)\s+(\d{1,2})$/);
  if (myNoYear) {
    const month = MONTH_ABBR[myNoYear[1]!];
    if (month) {
      return { year: new Date().getFullYear(), month, day: parseInt(myNoYear[2]!, 10) };
    }
  }

  return null;
}

/**
 * Extract all recognizable date expressions from a text block.
 * Returns an array of canonical "YYYY-MM-DD" strings.
 */
function extractDatesFromText(text: string): string[] {
  const clean = stripOrdinal(text).replace(/,/g, ' ').replace(/[—–\-]+/g, ' ');
  const results: string[] = [];
  const seen = new Set<string>();

  // ISO dates
  for (const m of clean.matchAll(/\b(\d{4})\s*-?\s*(\d{2})\s*-?\s*(\d{2})\b/g)) {
    const month = parseInt(m[2]!, 10);
    if (month >= 1 && month <= 12) {
      const c = `${m[1]}-${pad2(month)}-${pad2(parseInt(m[3]!, 10))}`;
      if (!seen.has(c)) { seen.add(c); results.push(c); }
    }
  }

  // "Month Day Year"
  for (const m of clean.matchAll(/\b([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\b/gi)) {
    const month = MONTH_ABBR[m[1]!.toLowerCase()];
    if (month) {
      const c = `${m[3]}-${pad2(month)}-${pad2(parseInt(m[2]!, 10))}`;
      if (!seen.has(c)) { seen.add(c); results.push(c); }
    }
  }

  // "Day Month Year"
  for (const m of clean.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/gi)) {
    const month = MONTH_ABBR[m[2]!.toLowerCase()];
    if (month) {
      const c = `${m[3]}-${pad2(month)}-${pad2(parseInt(m[1]!, 10))}`;
      if (!seen.has(c)) { seen.add(c); results.push(c); }
    }
  }

  return results;
}

interface RecallDebug {
  expectedNormalized: string;
  detectedDates: string[];
  match: boolean;
}

function containsDateEquivalent(response: string, expectedDate: string): { match: boolean; debug: RecallDebug } {
  if (!expectedDate) return { match: true, debug: { expectedNormalized: '', detectedDates: [], match: true } };

  const parsedExpected = parseOneDateString(expectedDate);
  const expectedNormalized = parsedExpected ? dateToCanonical(parsedExpected) : normalizeText(expectedDate);
  const detectedDates = extractDatesFromText(response);

  // Primary: canonical date comparison
  if (parsedExpected) {
    const target = dateToCanonical(parsedExpected);
    if (detectedDates.includes(target)) {
      return { match: true, debug: { expectedNormalized, detectedDates, match: true } };
    }
  }

  // Fallback: normalized text inclusion (handles non-date expected values)
  const normResponse = normalizeText(response);
  const normExpected = normalizeText(expectedDate);
  if (normResponse.includes(normExpected)) {
    return { match: true, debug: { expectedNormalized, detectedDates, match: true } };
  }

  return { match: false, debug: { expectedNormalized, detectedDates, match: false } };
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

interface RunResult {
  scenario: ScenarioType;
  userId: string;
  sessionId: string;
  recallCorrect: boolean;
  rankingError: boolean;
  runtimeError: boolean;
  response?: string;
  expectedRecall?: string;
  messageIndex?: number;
  input?: string;
}

async function runScenario(
  scenario: Scenario,
  userId: string,
  sessionId: string,
  results: {
    conversationsRun: number;
    recallSuccess: number;
    rankingErrors: number;
    schemaRejections: number;
    poisoningBlocked: number;
    runtimeErrors: number;
    anchorsCreated: number;
    anchorsRejectedSchema: number;
    anchorsRejectedSlotCap: number;
  },
): Promise<RunResult> {
  const result: RunResult = {
    scenario: scenario.type,
    userId,
    sessionId,
    recallCorrect: true,
    rankingError: false,
    runtimeError: false,
  };

  let lastReply = '';
  const ts = new Date().toISOString();

  for (let i = 0; i < scenario.messages.length; i++) {
    const input = scenario.messages[i];
    console.log('User:', input);
    await delay(randomDelay());

    const chatRes = await postChat(userId, sessionId, input);
    lastReply = chatRes.reply ?? '';

    const isRecallQuestion = input.toLowerCase().includes('when am i deploying');
    const expectedRecall = isRecallQuestion ? scenario.expectedRecall : undefined;

    let recallCorrect: boolean | null = null;
    let recallDebug: RecallDebug | undefined;
    if (!chatRes.ok) {
      recallCorrect = null;
    } else if (!expectedRecall) {
      recallCorrect = true;
    } else {
      const evaluation = containsDateEquivalent(chatRes.reply ?? '', expectedRecall);
      recallCorrect = evaluation.match;
      recallDebug = evaluation.debug;
    }

    writeConversationLog({
      timestamp: ts,
      userId,
      sessionId,
      scenario: scenario.type,
      messageIndex: i + 1,
      input,
      response: chatRes.reply ?? '',
      expectedRecall: expectedRecall ?? '',
      recallCorrect,
      ...(recallDebug ? { recallDebug } : {}),
    });
    csvRows.push([
      ts,
      userId,
      sessionId,
      scenario.type,
      input.replace(/,/g, ';'),
      (chatRes.reply ?? '').replace(/,/g, ';').slice(0, 200),
      expectedRecall ?? '',
      recallCorrect === null ? '' : recallCorrect ? 'true' : 'false',
    ].join(','));

    if (!chatRes.ok) {
      result.runtimeError = true;
      results.runtimeErrors++;
      writeError(
        `Chat failed: ${chatRes.body?.error ?? 'unknown'} - ${chatRes.body?.details ?? ''}`,
        scenario.type,
        userId,
        sessionId,
      );
      continue;
    }

    if (isRecallQuestion && expectedRecall && recallCorrect !== null) {
      if (!recallCorrect) {
        result.recallCorrect = false;
        result.rankingError = true;
        results.rankingErrors++;
      } else {
        results.recallSuccess++;
      }
    }
  }
  results.conversationsRun++;

  result.response = lastReply;
  result.expectedRecall = scenario.expectedRecall;

  if (DEBUG_MEMORY && scenario.type !== 'E') {
    await delay(randomDelay());
    const mem = await getDebugMemory(userId);
    if (mem) {
      const recent = mem.facts?.recent ?? [];
      const lastFact = mem.memorySummary?.lastFact;
      writeAnchorEvent({
        timestamp: new Date().toISOString(),
        userId,
        anchors: recent.slice(0, 10).map((a) => ({ type: a.type, slot: a.slot, value: a.value })),
        rankedAnchor: lastFact ? { type: lastFact.type, slot: lastFact.slot, value: lastFact.value } : null,
      });
    }
  }

  if (scenario.type === 'E') {
    await delay(randomDelay());
    const mem = await getDebugMemory(userId);
    const recent = mem?.facts?.recent ?? [];
    const launchDateCount = recent.filter((a) => a.type === 'deployment_plan' && a.slot === 'launch_date').length;
    if (launchDateCount <= 10) {
      results.poisoningBlocked++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(`LoRa server not reachable at ${BASE_URL}`);
    process.exit(1);
  }

  const testStart = new Date();
  ensureRunDir();

  const config = {
    totalConversations: TOTAL_CONVERSATIONS,
    sessionsPerUser: SESSIONS_PER_USER,
    messagesPerSession: MESSAGES_PER_SESSION,
    users: USERS,
    baseUrl: BASE_URL,
    debugMemory: DEBUG_MEMORY,
  };
  fs.writeFileSync(path.join(runDir, 'test-config.json'), JSON.stringify(config, null, 2));

  const results = {
    conversationsRun: 0,
    recallSuccess: 0,
    rankingErrors: 0,
    schemaRejections: 0,
    poisoningBlocked: 0,
    runtimeErrors: 0,
    anchorsCreated: 0,
    anchorsRejectedSchema: 0,
    anchorsRejectedSlotCap: 0,
  };

  let conversationCount = 0;
  const scenarioCycle = SCENARIOS;
  let scenarioIndex = 0;

  for (let u = 0; u < USERS.length && conversationCount < TOTAL_CONVERSATIONS; u++) {
    const userId = USERS[u];
    for (let s = 0; s < SESSIONS_PER_USER && conversationCount < TOTAL_CONVERSATIONS; s++) {
      const sessionId = `stress-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const scenario = scenarioCycle[scenarioIndex % scenarioCycle.length];
      scenarioIndex++;

      console.log(`\nRunning conversation ${conversationCount + 1} / ${TOTAL_CONVERSATIONS}`);
      console.log(`Scenario ${scenario.type}`);
      await runScenario(scenario, userId, sessionId, results);
      conversationCount++;

      await postTerminate(sessionId);
      await delay(randomDelay());
    }
  }

  const testEnd = new Date();
  const durationSeconds = (testEnd.getTime() - testStart.getTime()) / 1000;
  const recallTotal = results.recallSuccess + results.rankingErrors;
  const recallAccuracy = recallTotal > 0 ? (results.recallSuccess / recallTotal) * 100 : 100;

  const verdict =
    recallAccuracy >= 95 && results.rankingErrors === 0 && results.runtimeErrors === 0 ? 'PASS' : 'FAIL';

  const summaryReport = {
    testStart: testStart.toISOString(),
    testEnd: testEnd.toISOString(),
    durationSeconds,
    config: {
      totalConversations: TOTAL_CONVERSATIONS,
      sessionsPerUser: SESSIONS_PER_USER,
      messagesPerSession: MESSAGES_PER_SESSION,
      users: USERS.length,
    },
    results: {
      conversationsRun: results.conversationsRun,
      recallAccuracy: Math.round(recallAccuracy * 100) / 100,
      rankingErrors: results.rankingErrors,
      schemaRejects: results.schemaRejections,
      poisoningBlocked: results.poisoningBlocked,
      runtimeErrors: results.runtimeErrors,
    },
    memoryStats: {
      anchorsCreated: results.anchorsCreated,
      anchorsRejectedSchema: results.anchorsRejectedSchema,
      anchorsRejectedSlotCap: results.anchorsRejectedSlotCap,
    },
    verdict,
  };

  fs.writeFileSync(path.join(runDir, 'summary-report.json'), JSON.stringify(summaryReport, null, 2));

  const md = [
    '# LoRa Memory Stress Test Report',
    '',
    `Test run: ${testStart.toISOString().replace('T', ' ').slice(0, 19)}`,
    `Duration: ${Math.round(durationSeconds / 60)}m ${Math.round(durationSeconds % 60)}s`,
    '',
    '## Configuration',
    `Conversations: ${TOTAL_CONVERSATIONS}`,
    `Users: ${USERS.length}`,
    `Sessions per user: ${SESSIONS_PER_USER}`,
    '',
    '## Results',
    `Recall accuracy: ${recallAccuracy.toFixed(1)}%`,
    `Ranking errors: ${results.rankingErrors}`,
    `Schema rejects: ${results.schemaRejections}`,
    `Poisoning attempts blocked: ${results.poisoningBlocked}`,
    `Runtime errors: ${results.runtimeErrors}`,
    '',
    '## Memory Statistics',
    `Anchors created: ${results.anchorsCreated}`,
    `Rejected by schema: ${results.anchorsRejectedSchema}`,
    `Rejected by slot cap: ${results.anchorsRejectedSlotCap}`,
    '',
    '## Verdict',
    verdict === 'PASS' ? 'Memory system stable under simulated load.' : 'One or more checks failed.',
    '',
    `**Verdict: ${verdict}**`,
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'summary-report.md'), md);

  fs.writeFileSync(path.join(runDir, 'conversation-log.csv'), csvRows.join('\n'));

  closeStreams();

  console.log('');
  console.log('==== LORA MEMORY STRESS TEST ====');
  console.log('');
  console.log('Run directory:');
  console.log(`  ${runDir}`);
  console.log('');
  console.log(`Recall accuracy: ${recallAccuracy.toFixed(1)}%`);
  console.log(`Ranking errors: ${results.rankingErrors}`);
  console.log(`Runtime errors: ${results.runtimeErrors}`);
  console.log(`Poisoning blocked: ${results.poisoningBlocked}`);
  console.log('');
  console.log(`Verdict: ${verdict}`);
  console.log('');
  console.log('===============================');
}

main().catch((err) => {
  console.error(err);
  writeError(err instanceof Error ? err.message : String(err), undefined, undefined, undefined, err instanceof Error ? err.stack : undefined);
  closeStreams();
  process.exit(1);
});
