import http from 'http';
import express from 'express';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

let llmCallCount = 0;

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
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('POST /api/chat — manual session termination ("end session")', () => {
  let server: http.Server | null = null;
  let port = 0;
  let lastSessionHistorySeen: Array<{ role: string; text: string }> | undefined;

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
        return 'Normal reply from LLM';
      },
    });

    const { registerChatRoute } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    registerChatRoute(app, {
      responderFactory: mockResponder,
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
    llmCallCount = 0;
    lastSessionHistorySeen = undefined;
  });

  test('normal message triggers LLM and returns reply', async () => {
    const res = await postApiChat(port, {
      userId: 'end-user',
      sessionId: 'end-sess',
      messageId: 'msg-1',
      text: 'Hello there',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Normal reply from LLM');
    expect(res.body.ended).toBeUndefined();
    expect(llmCallCount).toBe(1);
  });

  test('"end session" returns confirmation, no LLM call, session cleared', async () => {
    await postApiChat(port, {
      userId: 'end-user',
      sessionId: 'end-sess',
      messageId: 'msg-1',
      text: 'First message',
    });
    expect(llmCallCount).toBe(1);

    const res = await postApiChat(port, {
      userId: 'end-user',
      sessionId: 'end-sess',
      messageId: 'msg-2',
      text: 'end session',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Session ended. You can start a new conversation.');
    expect(res.body.ended).toBe(true);
    expect(llmCallCount).toBe(1);
  });

  test('next message after "end session" starts fresh session (no prior context)', async () => {
    await postApiChat(port, {
      userId: 'end-user-2',
      sessionId: 'end-sess-2',
      messageId: 'msg-1',
      text: 'My name is Alice',
    });
    await postApiChat(port, {
      userId: 'end-user-2',
      sessionId: 'end-sess-2',
      messageId: 'msg-2',
      text: 'end session',
    });

    const res3 = await postApiChat(port, {
      userId: 'end-user-2',
      sessionId: 'end-sess-2',
      messageId: 'msg-3',
      text: 'Who am I?',
    });
    expect(res3.status).toBe(200);
    expect(llmCallCount).toBe(2);
    const historyTexts = (lastSessionHistorySeen ?? []).map((t) => t.text).join(' ');
    expect(historyTexts).not.toContain('My name is Alice');
    expect(historyTexts).not.toContain('end session');
  });

  test('"End Session" (mixed case) triggers termination', async () => {
    const res = await postApiChat(port, {
      userId: 'end-user-3',
      sessionId: 'end-sess-3',
      messageId: 'msg-1',
      text: 'End Session',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Session ended. You can start a new conversation.');
    expect(res.body.ended).toBe(true);
    expect(llmCallCount).toBe(0);
  });

  test('other messages are unaffected', async () => {
    const res = await postApiChat(port, {
      userId: 'end-user-4',
      sessionId: 'end-sess-4',
      messageId: 'msg-1',
      text: 'end session please',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Normal reply from LLM');
    expect(res.body.ended).toBeUndefined();
    expect(llmCallCount).toBe(1);
  });
});
