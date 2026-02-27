import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

const MOCK_REPLY = 'mock-llm-reply';

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

describe('POST /api/chat — smoke (mock LLM, no real DB)', () => {
  let server: http.Server | null = null;
  let port = 0;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    });

    const mockResponder = () => ({
      generateResponse: async () => MOCK_REPLY,
    });
    const mockMemoryService = createMockMemoryService();

    registerChatRoute(app, {
      responderFactory: mockResponder,
      memoryService: mockMemoryService,
    });

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    if (server) server.close(done);
    else done();
  });

  test('200, reply string exists, debug fields and degraded flags present', async () => {
    const res = await postApiChat(port, {
      userId: 'test-user',
      sessionId: 'test-session',
      messageId: 'msg-1',
      text: 'hello',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(typeof res.body.reply).toBe('string');
    expect((res.body.reply as string).length).toBeGreaterThan(0);
    expect(res.body.reply).toBe(MOCK_REPLY);

    expect(res.body).toHaveProperty('debug');
    const debug = res.body.debug as Record<string, unknown>;
    expect(debug).toHaveProperty('eiv');
    expect(debug).toHaveProperty('etv');
    expect(debug).toHaveProperty('band');
    expect(debug).toHaveProperty('anchorsUsed');
    expect(debug).toHaveProperty('schemasUsed');
    expect(debug).toHaveProperty('degraded');

    const degraded = debug.degraded as Record<string, boolean>;
    expect(degraded).toHaveProperty('falkor');
    expect(degraded).toHaveProperty('chroma');
    expect(typeof degraded.falkor).toBe('boolean');
    expect(typeof degraded.chroma).toBe('boolean');
  });
});
