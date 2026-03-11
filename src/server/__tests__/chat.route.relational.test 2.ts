import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

const GENERIC_REPLY = "I'm here to help, what's on your mind?";
const RELATIONAL_REPLY = 'Thanks for saying that — your warmth is appreciated.';

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

function postApiChat(
  port: number,
  body: object,
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
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('POST /api/chat — relational intent (LORA_RELATIONAL_ROUTER=1)', () => {
  let server: http.Server | null = null;
  let port = 0;
  const originalEnv = process.env.LORA_RELATIONAL_ROUTER;

  beforeAll((done) => {
    process.env.LORA_RELATIONAL_ROUTER = '1';

    jest.resetModules();

    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    });

    const contextAwareResponder = () => ({
      generateResponse: async (prompt: string) => {
        if (prompt.includes('Relational Response Policy')) {
          return RELATIONAL_REPLY;
        }
        return GENERIC_REPLY;
      },
    });

    const { registerChatRoute: freshRegister } = require('../routes/chat.route') as typeof import('../routes/chat.route');

    freshRegister(app, {
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
    if (originalEnv === undefined) {
      delete process.env.LORA_RELATIONAL_ROUTER;
    } else {
      process.env.LORA_RELATIONAL_ROUTER = originalEnv;
    }
    if (server) server.close(done);
    else done();
  });

  test('"I love you" returns relational debug + non-generic reply', async () => {
    const res = await postApiChat(port, {
      userId: 'rel-user',
      sessionId: 'rel-session',
      messageId: 'msg-rel-1',
      text: 'I love you',
    });

    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;

    expect(debug).toHaveProperty('relational');
    const rel = debug.relational as Record<string, unknown>;
    expect(rel.intent).toBe('affection');
    expect(typeof rel.confidence).toBe('number');
    expect(rel.confidence as number).toBeGreaterThanOrEqual(0.6);

    expect(res.body.reply).toBe(RELATIONAL_REPLY);
    expect(res.body.reply).not.toBe(GENERIC_REPLY);
  });

  test('neutral message has no relational debug + generic reply', async () => {
    const res = await postApiChat(port, {
      userId: 'rel-user-2',
      sessionId: 'rel-session-2',
      messageId: 'msg-rel-2',
      text: 'What is the weather today?',
    });

    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;

    expect(debug.relational).toBeUndefined();

    expect(res.body.reply).toBe(GENERIC_REPLY);
  });

  test('"don\'t leave me" returns attachment_seek intent', async () => {
    const res = await postApiChat(port, {
      userId: 'rel-user-3',
      sessionId: 'rel-session-3',
      messageId: 'msg-rel-3',
      text: "don't leave me please",
    });

    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;
    expect(debug).toHaveProperty('relational');
    const rel = debug.relational as Record<string, unknown>;
    expect(rel.intent).toBe('attachment_seek');
    expect(res.body.reply).toBe(RELATIONAL_REPLY);
  });
});

describe('POST /api/chat — relational router OFF by default', () => {
  let server: http.Server | null = null;
  let port = 0;
  const originalEnv = process.env.LORA_RELATIONAL_ROUTER;

  beforeAll((done) => {
    delete process.env.LORA_RELATIONAL_ROUTER;

    jest.resetModules();

    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    });

    const contextAwareResponder = () => ({
      generateResponse: async (prompt: string) => {
        if (prompt.includes('Relational Response Policy')) {
          return RELATIONAL_REPLY;
        }
        return GENERIC_REPLY;
      },
    });

    const { registerChatRoute: freshRegister } = require('../routes/chat.route') as typeof import('../routes/chat.route');

    freshRegister(app, {
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
    if (originalEnv === undefined) {
      delete process.env.LORA_RELATIONAL_ROUTER;
    } else {
      process.env.LORA_RELATIONAL_ROUTER = originalEnv;
    }
    if (server) server.close(done);
    else done();
  });

  test('"I love you" with feature off => no relational debug, generic reply', async () => {
    const res = await postApiChat(port, {
      userId: 'off-user',
      sessionId: 'off-session',
      messageId: 'msg-off-1',
      text: 'I love you',
    });

    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;
    expect(debug.relational).toBeUndefined();
    expect(res.body.reply).toBe(GENERIC_REPLY);
  });
});
