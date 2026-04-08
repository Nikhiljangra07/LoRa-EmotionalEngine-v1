import http from 'http';
import express from 'express';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

let lastPayloadSeen: {
  systemPrompt: string;
  userMessage: string;
  sessionHistory?: Array<{ role: string; text: string }>;
  payloadKeys?: string[];
} = { systemPrompt: '', userMessage: '' };

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

function postApiChat(
  port: number,
  body: object
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/chat',
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
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(data) as Record<string, unknown>,
            });
          } catch {
            reject(new Error(`Non-JSON response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('POST /api/chat — Session Transcript Memory (STM)', () => {
  let server: http.Server | null = null;
  let port = 0;
  const origPersona = process.env.LORA_PERSONA_ENFORCER;
  const origRelational = process.env.LORA_RELATIONAL_ROUTER;

  beforeAll((done) => {
    delete process.env.LORA_PERSONA_ENFORCER;
    delete process.env.LORA_RELATIONAL_ROUTER;
    jest.resetModules();

    const app = express();
    app.use(express.json());

    const { registerChatRoute } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    const contextAwareResponder = () => ({
      generateResponse: async (
        systemPrompt: string,
        userMessage: string,
        options?: { sessionHistory?: Array<{ role: string; text: string }> }
      ) => {
        lastPayloadSeen = {
          systemPrompt,
          userMessage,
          sessionHistory: options?.sessionHistory?.map((t) => ({
            role: t.role,
            text: (t as { text?: string }).text ?? (t as { content?: string }).content ?? '',
          })),
          payloadKeys: options ? Object.keys(options) : [],
        };
        const history = options?.sessionHistory ?? [];
        const priorTexts = history.map((t) => ((t as { text?: string }).text ?? (t as { content?: string }).content ?? '')).join(' ');
        const hasNameContext = priorTexts.includes('My name is Nikhil') || userMessage.includes('My name is Nikhil');
        const isCreatorQuery = userMessage.includes('Who created you') || priorTexts.includes('Who created you');
        if (hasNameContext && isCreatorQuery) {
          return 'In this chat, you mentioned that your name is Nikhil and you created me.';
        }
        if (isCreatorQuery) {
          return "I don't have that information in this conversation.";
        }
        return 'Acknowledged.';
      },
    });

    registerChatRoute(app, {
      responderFactory: contextAwareResponder,
      memoryService: createMockMemoryService(),
    });

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
    lastPayloadSeen = { systemPrompt: '', userMessage: '' };
  });

  test('payload contains sessionHistory key before LLM send', async () => {
    const userId = 'stm-keys';
    const sessionId = 'stm-keys-sess';
    await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-keys',
      text: 'Hello',
    });
    expect(lastPayloadSeen.payloadKeys).toBeDefined();
    expect(lastPayloadSeen.payloadKeys).toContain('sessionHistory');
    expect(lastPayloadSeen.sessionHistory).toBeDefined();
  });

  test('Test A: same-session continuity — earlier turns visible in payload', async () => {
    const userId = 'stm-user-a';
    const sessionId = 'stm-sess-a';

    await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-1',
      text: 'My name is Nikhil. I created you.',
    });

    const res2 = await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-2',
      text: 'Who created you?',
    });

    expect(res2.status).toBe(200);
    expect(lastPayloadSeen.sessionHistory).toBeDefined();
    const historyTexts = (lastPayloadSeen.sessionHistory ?? []).map((t) => t.text).join(' ');
    expect(historyTexts).toContain('My name is Nikhil');
    expect((res2.body.reply as string)).toContain('Nikhil');
  });

  test('Test B: history cap — only last N turns included in payload', async () => {
    const userId = 'stm-user-b';
    const sessionId = 'stm-sess-b';

    // Send enough messages to exceed STM_MAX_TURNS (16). Each call adds 2
    // turns (user + assistant) AFTER the LLM is invoked, but the slice sent
    // TO the LLM uses the current history at call-time. So 11 calls produces
    // ~21 turns at the moment of the 11th LLM payload — comfortably past 16.
    //
    // We deliberately keep this under MAX_REQUESTS_PER_WINDOW * WINDOW_MS
    // (5 req / sec) by spacing calls with a small delay; otherwise the
    // sliding-window rate limiter returns 429 on the 6th request and the
    // loop never reaches the cap.
    for (let i = 1; i <= 11; i++) {
      await postApiChat(port, {
        userId,
        sessionId,
        messageId: `msg-${i}`,
        text: `Message number ${i}`,
      });
      // ~250ms spacing keeps us under 5 req/sec.
      await new Promise((r) => setTimeout(r, 250));
    }

    const history = lastPayloadSeen.sessionHistory ?? [];
    // STM_MAX_TURNS = 16. Cap was doubled from 8 → 16 in commit a23de43
    // (Mar 19) to fix topic regression on long sessions; this test was
    // never updated to match.
    expect(history.length).toBeLessThanOrEqual(16);
    const texts = history.map((t) => t.text).join(' ');
    expect(texts).not.toMatch(/\bMessage number 1\b/);
    expect(texts).not.toMatch(/\bMessage number 2\b/);
  });

  test('Test C: different sessionId has no prior context (session isolation)', async () => {
    const userId = 'stm-user-c';
    const sessionId1 = 'stm-sess-c1';
    const sessionId2 = 'stm-sess-c2';

    await postApiChat(port, {
      userId,
      sessionId: sessionId1,
      messageId: 'msg-c1',
      text: 'My name is Nikhil. I created you.',
    });

    const res = await postApiChat(port, {
      userId,
      sessionId: sessionId2,
      messageId: 'msg-c3',
      text: 'Who created you?',
    });

    expect(res.status).toBe(200);
    const historyTexts = (lastPayloadSeen.sessionHistory ?? []).map((t) => t.text).join(' ');
    expect(historyTexts).not.toContain('My name is Nikhil');
    expect((res.body.reply as string)).not.toContain('Nikhil');
  });

  test('stmTurns count is present in debug response', async () => {
    const userId = 'stm-user-d';
    const sessionId = 'stm-sess-d';

    const res1 = await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-d1',
      text: 'first message',
    });
    expect(res1.status).toBe(200);
    const debug1 = res1.body.debug as Record<string, unknown>;
    expect(debug1.stmTurns).toBe(1);

    const res2 = await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-d2',
      text: 'second message',
    });
    const debug2 = res2.body.debug as Record<string, unknown>;
    expect(debug2.stmTurns).toBe(3);
  });

  test('no forbidden recall phrases in SESSION CONTEXT block', async () => {
    const userId = 'stm-user-e';
    const sessionId = 'stm-sess-e';

    await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-e1',
      text: 'Tell me something.',
    });

    await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-e2',
      text: 'What was that?',
    });

    const historyTexts = (lastPayloadSeen.sessionHistory ?? []).map((t) => t.text).join(' ').toLowerCase();
    expect(historyTexts).not.toContain('i remember');
    expect(historyTexts).not.toContain('you told me');
    expect(historyTexts).not.toContain('you said earlier');
  });
});
