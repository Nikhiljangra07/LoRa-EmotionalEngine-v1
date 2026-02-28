import http from 'http';
import express from 'express';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

const GENERIC_REPLY = "I'm here to help, what's on your mind?";

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

describe('POST /api/chat — persona enforcer (LORA_PERSONA_ENFORCER=1)', () => {
  let server: http.Server | null = null;
  let port = 0;
  const origEnv = process.env.LORA_PERSONA_ENFORCER;

  beforeAll((done) => {
    process.env.LORA_PERSONA_ENFORCER = '1';
    jest.resetModules();

    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });

    const mockResponder = () => ({
      generateResponse: async () => GENERIC_REPLY,
    });

    const { registerChatRoute: freshRegister } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    freshRegister(app, { responderFactory: mockResponder, memoryService: createMockMemoryService() });

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    if (origEnv === undefined) delete process.env.LORA_PERSONA_ENFORCER;
    else process.env.LORA_PERSONA_ENFORCER = origEnv;
    if (server) server.close(done);
    else done();
  });

  test('"who created you?" returns identity override, not generic reply', async () => {
    const res = await postApiChat(port, {
      userId: 'pe-user-1',
      sessionId: 'pe-session-1',
      messageId: 'msg-pe-1',
      text: 'who created you?',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).not.toBe(GENERIC_REPLY);
    expect((res.body.reply as string)).toContain('LoRa');

    const debug = res.body.debug as Record<string, unknown>;
    expect(debug).toHaveProperty('personaEnforcer');
    const pe = debug.personaEnforcer as Record<string, unknown>;
    expect(pe.triggered).toBe(true);
    expect(pe.kind).toBe('identity_override');
    expect(pe.intent).toBe('origin_creator');
  });

  test('"what are you?" returns self_definition override', async () => {
    const res = await postApiChat(port, {
      userId: 'pe-user-2',
      sessionId: 'pe-session-2',
      messageId: 'msg-pe-2',
      text: 'what are you?',
    });
    expect(res.status).toBe(200);
    expect((res.body.reply as string)).toContain('LoRa');
    expect((res.body.reply as string)).toContain('Nikhil');

    const pe = (res.body.debug as any).personaEnforcer;
    expect(pe.kind).toBe('identity_override');
    expect(pe.intent).toBe('self_definition');
  });

  test('"are you OpenAI?" returns origin_openai override', async () => {
    const res = await postApiChat(port, {
      userId: 'pe-user-3',
      sessionId: 'pe-session-3',
      messageId: 'msg-pe-3',
      text: 'are you OpenAI?',
    });
    expect(res.status).toBe(200);
    const reply = res.body.reply as string;
    expect(reply).toContain('LoRa');
    expect(reply).not.toContain('I was created by OpenAI');

    const pe = (res.body.debug as any).personaEnforcer;
    expect(pe.kind).toBe('identity_override');
  });

  test('"I love you" returns relational override, not generic deflection', async () => {
    const res = await postApiChat(port, {
      userId: 'pe-user-4',
      sessionId: 'pe-session-4',
      messageId: 'msg-pe-4',
      text: 'I love you',
    });
    expect(res.status).toBe(200);
    const reply = res.body.reply as string;
    expect(reply).not.toBe(GENERIC_REPLY);
    expect(reply).toContain('?');

    const pe = (res.body.debug as any).personaEnforcer;
    expect(pe.triggered).toBe(true);
    expect(pe.kind).toBe('relational_override');
  });

  test('neutral message has no enforcement', async () => {
    const res = await postApiChat(port, {
      userId: 'pe-user-5',
      sessionId: 'pe-session-5',
      messageId: 'msg-pe-5',
      text: 'help me plan my week',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(GENERIC_REPLY);

    const pe = (res.body.debug as any).personaEnforcer;
    expect(pe.triggered).toBe(false);
    expect(pe.kind).toBe('none');
  });
});

describe('POST /api/chat — persona enforcer OFF by default', () => {
  let server: http.Server | null = null;
  let port = 0;
  const origEnv = process.env.LORA_PERSONA_ENFORCER;

  beforeAll((done) => {
    delete process.env.LORA_PERSONA_ENFORCER;
    jest.resetModules();

    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });

    const mockResponder = () => ({
      generateResponse: async () => GENERIC_REPLY,
    });

    const { registerChatRoute: freshRegister } = require('../routes/chat.route') as typeof import('../routes/chat.route');
    freshRegister(app, { responderFactory: mockResponder, memoryService: createMockMemoryService() });

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    if (origEnv === undefined) delete process.env.LORA_PERSONA_ENFORCER;
    else process.env.LORA_PERSONA_ENFORCER = origEnv;
    if (server) server.close(done);
    else done();
  });

  test('"who created you?" with enforcer off returns generic reply', async () => {
    const res = await postApiChat(port, {
      userId: 'off-user',
      sessionId: 'off-session',
      messageId: 'msg-off-1',
      text: 'who created you?',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(GENERIC_REPLY);
  });
});
