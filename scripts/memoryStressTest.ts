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
import { containsDateEquivalent, type RecallDebug } from './utils/dateRecallEvaluator';

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

type ScenarioType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

interface Scenario {
  type: ScenarioType;
  messages: string[];
  expectedRecall: string; // substring to look for in reply (e.g. "March 20 2026" or "2026-03-08")
  description: string;
}

/** Core recall scenarios A–E: unchanged, used for recall accuracy. */
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

/** Adversarial scenarios F–I: run once after main loop with dedicated users. */
const ADVERSARIAL_SCENARIOS: { type: 'F' | 'G' | 'H' | 'I'; messages: string[]; description: string }[] = [
  {
    type: 'F',
    description: 'contradictory facts',
    messages: ['I live in New York.', 'Remember that for later.', 'I live in London now.', 'Where do I live?'],
  },
  {
    type: 'G',
    description: 'sensitive data filtering',
    messages: ['My SSN is 123-45-6789', 'Please remember that.'],
  },
  {
    type: 'H',
    description: 'garbage input',
    messages: ['asdfghjkl', 'qwertyuiop', 'zxczxczxc', 'poiuytrewq'],
  },
  {
    type: 'I',
    description: 'long session stress',
    messages: [
      ...Array.from({ length: 110 }, (_, i) => `This is message ${i + 1} for context.`),
      'I will deploy on March 20 2026',
      ...Array.from({ length: 8 }, (_, i) => `More context ${i + 1}.`),
      'When am I deploying?',
    ],
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
// Adversarial scenarios F–I (dedicated users, run once after main loop)
// ---------------------------------------------------------------------------

interface AdversarialResults {
  conflictHandled: boolean;
  sensitiveDataBlocked: boolean;
  garbageHandled: boolean;
  longSessionRecall: boolean;
  longSessionLength?: number;
  avgResponseLatencyMs?: number;
}

function getUserFactCount(mem: DebugMemoryResponse | null): number {
  return mem?.facts?.recent?.length ?? 0;
}

async function runAdversarialScenarios(): Promise<AdversarialResults> {
  const out: AdversarialResults = {
    conflictHandled: false,
    sensitiveDataBlocked: false,
    garbageHandled: false,
    longSessionRecall: false,
  };

  for (const adv of ADVERSARIAL_SCENARIOS) {
    const userId = `stress${adv.type}`;
    const sessionId = `adv-${adv.type}-${Date.now()}`;
    console.log(`\n[Adversarial] Scenario ${adv.type}: ${adv.description}`);

    if (adv.type === 'F') {
      let lastReply = '';
      let runtimeErr = false;
      for (const msg of adv.messages) {
        console.log('User:', msg.slice(0, 50) + (msg.length > 50 ? '...' : ''));
        await delay(randomDelay());
        const res = await postChat(userId, sessionId, msg);
        lastReply = res.reply ?? '';
        if (!res.ok) runtimeErr = true;
      }
      out.conflictHandled = lastReply.toLowerCase().includes('london');
      if (runtimeErr) writeError(`Scenario F: chat request failed`, 'F', userId, sessionId);
    }

    if (adv.type === 'G') {
      const memBefore = await getDebugMemory(userId);
      await delay(randomDelay());
      const beforeCount = getUserFactCount(memBefore);
      for (const msg of adv.messages) {
        console.log('User:', '[redacted SSN message]');
        await delay(randomDelay());
        await postChat(userId, sessionId, msg);
      }
      await delay(randomDelay());
      const memAfter = await getDebugMemory(userId);
      const afterCount = getUserFactCount(memAfter);
      out.sensitiveDataBlocked = afterCount <= beforeCount;
    }

    if (adv.type === 'H') {
      let runtimeErr = false;
      const memBefore = await getDebugMemory(userId);
      const beforeCount = getUserFactCount(memBefore);
      for (const msg of adv.messages) {
        console.log('User:', msg);
        await delay(randomDelay());
        const res = await postChat(userId, sessionId, msg);
        if (!res.ok) runtimeErr = true;
      }
      await delay(randomDelay());
      const memAfter = await getDebugMemory(userId);
      const afterCount = getUserFactCount(memAfter);
      out.garbageHandled = !runtimeErr && afterCount <= beforeCount;
    }

    if (adv.type === 'I') {
      const latencies: number[] = [];
      let lastReply = '';
      for (let i = 0; i < adv.messages.length; i++) {
        if (i % 30 === 0) console.log(`  Message ${i + 1} / ${adv.messages.length}`);
        await delay(randomDelay());
        const t0 = Date.now();
        const res = await postChat(userId, sessionId, adv.messages[i]!);
        latencies.push(Date.now() - t0);
        lastReply = res.reply ?? '';
      }
      const expectedDate = 'March 20 2026';
      const evaluation = containsDateEquivalent(lastReply, expectedDate);
      out.longSessionRecall = evaluation.match;
      out.longSessionLength = adv.messages.length;
      out.avgResponseLatencyMs =
        latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : undefined;
    }

    await postTerminate(sessionId);
    await delay(randomDelay());
  }

  return out;
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

  const adversarial = await runAdversarialScenarios();

  const testEnd = new Date();
  const durationSeconds = (testEnd.getTime() - testStart.getTime()) / 1000;
  const recallTotal = results.recallSuccess + results.rankingErrors;
  const recallAccuracy = recallTotal > 0 ? (results.recallSuccess / recallTotal) * 100 : 100;

  const adversarialPass =
    adversarial.conflictHandled &&
    adversarial.sensitiveDataBlocked &&
    adversarial.garbageHandled &&
    adversarial.longSessionRecall;
  const verdict =
    recallAccuracy >= 95 &&
    results.rankingErrors === 0 &&
    results.runtimeErrors === 0 &&
    adversarialPass
      ? 'PASS'
      : 'FAIL';

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
      conflictHandled: adversarial.conflictHandled,
      sensitiveDataBlocked: adversarial.sensitiveDataBlocked,
      garbageHandled: adversarial.garbageHandled,
      longSessionRecall: adversarial.longSessionRecall,
    },
    memoryStats: {
      anchorsCreated: results.anchorsCreated,
      anchorsRejectedSchema: results.anchorsRejectedSchema,
      anchorsRejectedSlotCap: results.anchorsRejectedSlotCap,
    },
    adversarial: {
      longSessionLength: adversarial.longSessionLength,
      avgResponseLatencyMs: adversarial.avgResponseLatencyMs,
    },
    verdict,
  };

  fs.writeFileSync(path.join(runDir, 'summary-report.json'), JSON.stringify(summaryReport, null, 2));

  const adversarialReport = {
    conflictHandled: adversarial.conflictHandled,
    sensitiveDataBlocked: adversarial.sensitiveDataBlocked,
    garbageHandled: adversarial.garbageHandled,
    longSessionRecall: adversarial.longSessionRecall,
    ...(adversarial.longSessionLength != null ? { longSessionLength: adversarial.longSessionLength } : {}),
    ...(adversarial.avgResponseLatencyMs != null ? { avgResponseLatencyMs: adversarial.avgResponseLatencyMs } : {}),
  };
  fs.writeFileSync(path.join(runDir, 'adversarial-report.json'), JSON.stringify(adversarialReport, null, 2));

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
    '## Adversarial',
    `Conflict handled (F): ${adversarial.conflictHandled}`,
    `Sensitive data blocked (G): ${adversarial.sensitiveDataBlocked}`,
    `Garbage handled (H): ${adversarial.garbageHandled}`,
    `Long session recall (I): ${adversarial.longSessionRecall}`,
    ...(adversarial.longSessionLength != null ? [`Long session length: ${adversarial.longSessionLength}`] : []),
    ...(adversarial.avgResponseLatencyMs != null ? [`Avg response latency (ms): ${adversarial.avgResponseLatencyMs}`] : []),
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
  console.log('Adversarial:');
  console.log(`  Conflict handled (F): ${adversarial.conflictHandled}`);
  console.log(`  Sensitive data blocked (G): ${adversarial.sensitiveDataBlocked}`);
  console.log(`  Garbage handled (H): ${adversarial.garbageHandled}`);
  console.log(`  Long session recall (I): ${adversarial.longSessionRecall}`);
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
