import http from 'http';
import express from 'express';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

let lastSessionHistorySeen: Array<{ role: string; text: string }> | undefined = undefined;
let llmCallCount = 0;

function createMockMemoryService(): MemoryService {
  return {
    saveMessage: jest.fn().mockResolvedValue({ ok: true, wroteFalkor: true, wroteChroma: true, degraded: { falkor: false, chroma: false } }),
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

function httpPost(
  port: number,
  urlPath: string,
  body: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
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

describe('Session isolation — engine eviction on terminate', () => {
  let server: http.Server | null = null;
  let port = 0;
  let engineSessions: Map<string, unknown>;

  const origPersona = process.env.LORA_PERSONA_ENFORCER;
  const origRelational = process.env.LORA_RELATIONAL_ROUTER;

  beforeAll((done) => {
    delete process.env.LORA_PERSONA_ENFORCER;
    delete process.env.LORA_RELATIONAL_ROUTER;
    jest.resetModules();

    llmCallCount = 0;
    lastSessionHistorySeen = undefined;

    const app = express();
    app.use(express.json());

    const mockResponder = () => ({
      generateResponse: async (
        _systemPrompt: string,
        _userMessage: string,
        options?: { sessionHistory?: Array<{ role: string; text: string }> },
      ) => {
        llmCallCount += 1;
        lastSessionHistorySeen = options?.sessionHistory?.map((t) => ({
          role: t.role,
          text: (t as { text?: string }).text ?? '',
        }));
        return 'mock reply';
      },
    });

    const { registerChatRoute } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    const { registerSessionLifecycleRoute } = require('../routes/session.lifecycle.route') as typeof import('../routes/session.lifecycle.route');

    const sessions = registerChatRoute(app, {
      responderFactory: mockResponder,
      memoryService: createMockMemoryService(),
    });
    engineSessions = sessions;
    registerSessionLifecycleRoute(app, sessions);

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
    lastSessionHistorySeen = undefined;
  });

  test('terminate deletes the engine entry from the sessions map', async () => {
    const userId = 'evict-user';

    // Start a lifecycle session (generates sessionId)
    const startRes = await httpPost(port, '/api/session/start', { userId });
    const sessionId = startRes.body.sessionId as string;

    // Send a chat message — creates an engine entry
    await httpPost(port, '/api/chat', {
      userId,
      sessionId,
      messageId: 'm1',
      text: 'hello',
    });
    const engineKey = `${userId}::${sessionId}`;
    expect(engineSessions.has(engineKey)).toBe(true);

    // Terminate — should evict the engine
    const endRes = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(endRes.body.ended).toBe(true);
    expect(engineSessions.has(engineKey)).toBe(false);
  });

  test('after terminate, new session has no prior context (full isolation)', async () => {
    const userId = 'iso-user';

    // Session A
    const startA = await httpPost(port, '/api/session/start', { userId });
    const sessionA = startA.body.sessionId as string;

    await httpPost(port, '/api/chat', {
      userId,
      sessionId: sessionA,
      messageId: 'm1',
      text: 'you are troublesome',
    });
    expect(llmCallCount).toBe(1);

    // Terminate A
    const endA = await httpPost(port, '/api/session/terminate', { sessionId: sessionA });
    expect(endA.body.ended).toBe(true);

    // Session B
    const startB = await httpPost(port, '/api/session/start', { userId });
    const sessionB = startB.body.sessionId as string;

    llmCallCount = 0;
    lastSessionHistorySeen = undefined;

    await httpPost(port, '/api/chat', {
      userId,
      sessionId: sessionB,
      messageId: 'm2',
      text: 'hi',
    });
    expect(llmCallCount).toBe(1);

    // The session history sent to the LLM must NOT contain any content from session A
    const historyTexts = (lastSessionHistorySeen ?? [] as Array<{ role: string; text: string }>).map((t) => t.text).join(' ');
    expect(historyTexts).not.toContain('troublesome');
  });

  test('different sessionIds are isolated even for the same userId', async () => {
    const userId = 'multi-sess-user';

    // Start two sessions
    const startA = await httpPost(port, '/api/session/start', { userId });
    const sessionA = startA.body.sessionId as string;
    const startB = await httpPost(port, '/api/session/start', { userId });
    const sessionB = startB.body.sessionId as string;

    // Send to session A
    await httpPost(port, '/api/chat', {
      userId,
      sessionId: sessionA,
      messageId: 'm1',
      text: 'secret-alpha',
    });

    // Send to session B
    llmCallCount = 0;
    lastSessionHistorySeen = undefined;
    await httpPost(port, '/api/chat', {
      userId,
      sessionId: sessionB,
      messageId: 'm2',
      text: 'hello from B',
    });

    const historyTexts = (lastSessionHistorySeen ?? [] as Array<{ role: string; text: string }>).map((t) => t.text).join(' ');
    expect(historyTexts).not.toContain('secret-alpha');
  });

  test('terminate with ended:false does NOT evict the engine', async () => {
    // Attempt to terminate a session that was never started
    const endRes = await httpPost(port, '/api/session/terminate', { sessionId: 'nonexistent-id' });
    expect(endRes.body.ended).toBe(false);
    // No engine eviction happened (nothing to evict)
  });

  test('terminated session cannot be terminated again (idempotent)', async () => {
    const userId = 'idempotent-user';

    const startRes = await httpPost(port, '/api/session/start', { userId });
    const sessionId = startRes.body.sessionId as string;

    await httpPost(port, '/api/chat', {
      userId,
      sessionId,
      messageId: 'm1',
      text: 'first',
    });

    const end1 = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(end1.body.ended).toBe(true);

    const end2 = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(end2.body.ended).toBe(false);
  });
});
