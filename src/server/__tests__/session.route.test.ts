import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

const TIER_DIR = path.resolve(process.cwd(), '.lora', 'tier');

function tierFile(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TIER_DIR, `${safe}.json`);
}

function cleanupTier(userId: string): void {
  const fp = tierFile(userId);
  try { fs.unlinkSync(fp); } catch { /* noop */ }
  try { fs.unlinkSync(fp + '.tmp'); } catch { /* noop */ }
}

function readTierFile(userId: string): { sessionCount: number; currentTier: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(tierFile(userId), 'utf-8'));
    return { sessionCount: raw.sessionCount, currentTier: raw.currentTier };
  } catch {
    return null;
  }
}

function createMockMemoryService(): MemoryService {
  return {
    saveMessage: jest.fn().mockResolvedValue(true),
    retrieveContext: jest.fn().mockResolvedValue({
      anchors: [],
      semantic: [],
      degraded: { falkor: false, chroma: false },
    }),
    maintainAnchors: jest.fn().mockResolvedValue(null),
    purgeUser: jest.fn().mockResolvedValue(true),
    healthCheck: jest.fn().mockResolvedValue({ falkor: true, chroma: true }),
  } as unknown as MemoryService;
}

function postApiChat(port: number, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  return httpPost(port, '/api/chat', body);
}

function postSessionEnd(port: number, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  return httpPost(port, '/api/session/end', body);
}

function httpPost(
  port: number,
  path: string,
  body: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            reject(new Error(`Non-JSON response: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Shared server for basic lifecycle tests ────────────────────────────────

describe('POST /api/session/end — basic lifecycle', () => {
  let server: http.Server | null = null;
  let port = 0;
  let llmCallCount = 0;

  const origPersona = process.env.LORA_PERSONA_ENFORCER;
  const origRelational = process.env.LORA_RELATIONAL_ROUTER;

  beforeAll((done) => {
    delete process.env.LORA_PERSONA_ENFORCER;
    delete process.env.LORA_RELATIONAL_ROUTER;
    jest.resetModules();

    llmCallCount = 0;

    const app = express();
    app.use(express.json());

    const mockResponder = () => ({
      generateResponse: async () => {
        llmCallCount += 1;
        return 'mock reply';
      },
    });

    const {
      registerChatRoute,
    } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    const {
      registerSessionEndRoute,
    } = require('../routes/session.route') as typeof import('../routes/session.route');

    const sessions = registerChatRoute(app, {
      responderFactory: mockResponder,
      memoryService: createMockMemoryService(),
    });
    registerSessionEndRoute(app, sessions);

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    if (origPersona === undefined) delete process.env.LORA_PERSONA_ENFORCER;
    else process.env.LORA_PERSONA_ENFORCER = origPersona;
    if (origRelational === undefined) delete process.env.LORA_RELATIONAL_ROUTER;
    else process.env.LORA_RELATIONAL_ROUTER = origRelational;
    if (server) server.close(done);
    else done();
  });

  beforeEach(() => {
    llmCallCount = 0;
  });

  test('normal chat message reaches LLM and returns reply', async () => {
    const res = await postApiChat(port, {
      userId: 'basic-user',
      sessionId: 'basic-sess',
      messageId: 'm1',
      text: 'hello',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('mock reply');
    expect(llmCallCount).toBe(1);
  });

  test('POST /api/session/end returns ended:true, makes no LLM call', async () => {
    await postApiChat(port, { userId: 'end-user', sessionId: 'es1', messageId: 'm1', text: 'hi' });
    expect(llmCallCount).toBe(1);
    llmCallCount = 0;

    const res = await postSessionEnd(port, { userId: 'end-user', sessionId: 'es1' });
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(true);
    expect(llmCallCount).toBe(0);
  });

  test('response includes tier and sessionCount', async () => {
    await postApiChat(port, { userId: 'tier-resp-user', sessionId: 'tr1', messageId: 'm1', text: 'hi' });
    const res = await postSessionEnd(port, { userId: 'tier-resp-user', sessionId: 'tr1' });

    expect(res.body.ended).toBe(true);
    expect(typeof res.body.tier).toBe('string');
    expect(typeof res.body.sessionCount).toBe('number');
  });

  test('no active session returns ended:false with reason', async () => {
    const res = await postSessionEnd(port, { userId: 'ghost-user', sessionId: 'ghost-sess' });
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(false);
    expect(res.body.reason).toBe('no_active_session');
    expect(llmCallCount).toBe(0);
  });

  test('mismatched sessionId still ends the active session for that userId', async () => {
    await postApiChat(port, {
      userId: 'mismatch-user',
      sessionId: 'active-sess',
      messageId: 'm1',
      text: 'hello',
    });
    llmCallCount = 0;

    // End with a different sessionId — should still find and end active-sess
    const res = await postSessionEnd(port, { userId: 'mismatch-user', sessionId: 'other-sess' });
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(true);
    expect(llmCallCount).toBe(0);
  });

  test('next message after /api/session/end creates a fresh session', async () => {
    const userId = 'fresh-user';
    await postApiChat(port, { userId, sessionId: 'fs1', messageId: 'm1', text: 'remember this' });
    await postSessionEnd(port, { userId, sessionId: 'fs1' });

    llmCallCount = 0;
    const res = await postApiChat(port, { userId, sessionId: 'fs1', messageId: 'm2', text: 'who am I?' });
    expect(res.status).toBe(200);
    expect(llmCallCount).toBe(1);
  });

  test('missing userId returns 400', async () => {
    const res = await postSessionEnd(port, { sessionId: 'some-sess' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('missing sessionId returns 400', async () => {
    const res = await postSessionEnd(port, { userId: 'some-user' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});

// ─── Tier promotion tests (require LORA_TIER_MODEL=1) ───────────────────────

describe('POST /api/session/end — tier promotion', () => {
  let server: http.Server | null = null;
  let port = 0;

  const userId = '__session_end_tier_test__';

  const origTier = process.env.LORA_TIER_MODEL;
  const origPersona = process.env.LORA_PERSONA_ENFORCER;
  const origRelational = process.env.LORA_RELATIONAL_ROUTER;

  beforeAll((done) => {
    process.env.LORA_TIER_MODEL = '1';
    delete process.env.LORA_PERSONA_ENFORCER;
    delete process.env.LORA_RELATIONAL_ROUTER;
    jest.resetModules();

    cleanupTier(userId);

    const app = express();
    app.use(express.json());

    const mockResponder = () => ({
      generateResponse: async () => 'tier-test reply',
    });

    const {
      registerChatRoute,
    } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    const {
      registerSessionEndRoute,
    } = require('../routes/session.route') as typeof import('../routes/session.route');

    const sessions = registerChatRoute(app, {
      responderFactory: mockResponder,
      memoryService: createMockMemoryService(),
    });
    registerSessionEndRoute(app, sessions);

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    cleanupTier(userId);
    if (origTier === undefined) delete process.env.LORA_TIER_MODEL;
    else process.env.LORA_TIER_MODEL = origTier;
    if (origPersona === undefined) delete process.env.LORA_PERSONA_ENFORCER;
    else process.env.LORA_PERSONA_ENFORCER = origPersona;
    if (origRelational === undefined) delete process.env.LORA_RELATIONAL_ROUTER;
    else process.env.LORA_RELATIONAL_ROUTER = origRelational;
    if (server) server.close(done);
    else done();
  });

  test('tier promotes to TIER_2 after 2 completed sessions, no LLM call on end', async () => {
    let llmCalls = 0;
    // session 1
    await postApiChat(port, { userId, sessionId: 's1', messageId: 'm1', text: 'hello' });
    llmCalls += 1;
    const endRes1 = await postSessionEnd(port, { userId, sessionId: 's1' });
    expect(endRes1.body.ended).toBe(true);
    expect(endRes1.body.sessionCount).toBe(1);
    expect(endRes1.body.tier).toBe('TIER_1');

    const after1 = readTierFile(userId);
    expect(after1?.sessionCount).toBe(1);
    expect(after1?.currentTier).toBe('TIER_1');

    // session 2
    await postApiChat(port, { userId, sessionId: 's2', messageId: 'm2', text: 'world' });
    llmCalls += 1;
    const endRes2 = await postSessionEnd(port, { userId, sessionId: 's2' });
    expect(endRes2.body.ended).toBe(true);
    expect(endRes2.body.sessionCount).toBe(2);
    expect(endRes2.body.tier).toBe('TIER_2');

    const after2 = readTierFile(userId);
    expect(after2?.sessionCount).toBe(2);
    expect(after2?.currentTier).toBe('TIER_2');

    // LLM was called only for normal messages, never for session end
    expect(llmCalls).toBe(2);
  });

  test('ending a session with no messages does not increment sessionCount', async () => {
    cleanupTier(userId);

    // Build to TIER_2 first
    await postApiChat(port, { userId, sessionId: 'b1', messageId: 'm1', text: 'hi' });
    await postSessionEnd(port, { userId, sessionId: 'b1' });
    await postApiChat(port, { userId, sessionId: 'b2', messageId: 'm2', text: 'hi' });
    await postSessionEnd(port, { userId, sessionId: 'b2' });
    expect(readTierFile(userId)?.currentTier).toBe('TIER_2');

    // End a session that has no prior messages — no active entry in map
    const res = await postSessionEnd(port, { userId, sessionId: 'b3-phantom' });
    expect(res.body.ended).toBe(false);
    expect(res.body.reason).toBe('no_active_session');

    // Tier must be unchanged
    expect(readTierFile(userId)?.sessionCount).toBe(2);
    expect(readTierFile(userId)?.currentTier).toBe('TIER_2');
  });
});
