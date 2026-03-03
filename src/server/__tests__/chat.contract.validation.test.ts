import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import { registerSessionLifecycleRoute } from '../routes/session.lifecycle.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

const MOCK_REPLY = 'mock-reply';

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
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            reject(new Error(`Non-JSON response (${res.statusCode}): ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('POST /api/chat — contract & validation', () => {
  let server: http.Server | null = null;
  let port = 0;
  let engineSessions: Map<string, unknown>;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());

    const mockResponder = () => ({
      generateResponse: async () => MOCK_REPLY,
    });

    engineSessions = registerChatRoute(app, {
      responderFactory: mockResponder,
      memoryService: createMockMemoryService(),
    }) as Map<string, unknown>;

    registerSessionLifecycleRoute(app, engineSessions as any);

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

  // ── payload variants ────────────────────────────────────────

  test('200 with "text" field', async () => {
    const res = await httpPost(port, '/api/chat', {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'msg-1',
      text: 'hello via text',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(MOCK_REPLY);
    expect(res.body).toHaveProperty('debug');
  });

  test('200 with "message" field (alias for text)', async () => {
    const res = await httpPost(port, '/api/chat', {
      userId: 'u1',
      sessionId: 's1',
      message: 'hello via message',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(MOCK_REPLY);
  });

  test('200 with "message" field and no messageId (auto-generated)', async () => {
    const res = await httpPost(port, '/api/chat', {
      userId: 'u1',
      sessionId: 's1',
      message: 'no messageId needed',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(MOCK_REPLY);
  });

  test('text takes priority over message when both are present', async () => {
    const res = await httpPost(port, '/api/chat', {
      userId: 'u1',
      sessionId: 's1',
      text: 'from-text-field',
      message: 'from-message-field',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(MOCK_REPLY);
  });

  // ── 400 validation errors ──────────────────────────────────

  test('400 when body is empty', async () => {
    const res = await httpPost(port, '/api/chat', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(typeof res.body.details).toBe('string');
    expect((res.body.details as string).toLowerCase()).toContain('userid');
  });

  test('400 when sessionId is missing', async () => {
    const res = await httpPost(port, '/api/chat', { userId: 'u1', text: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect((res.body.details as string).toLowerCase()).toContain('sessionid');
  });

  test('400 when text and message both missing', async () => {
    const res = await httpPost(port, '/api/chat', { userId: 'u1', sessionId: 's1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect((res.body.details as string).toLowerCase()).toContain('text');
  });

  test('400 when userId is empty string', async () => {
    const res = await httpPost(port, '/api/chat', { userId: '  ', sessionId: 's1', text: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('400 when sessionId is empty string', async () => {
    const res = await httpPost(port, '/api/chat', { userId: 'u1', sessionId: '', text: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  // ── engine isolation ───────────────────────────────────────

  test('engine key is userId::sessionId (different sessions = different engines)', async () => {
    const keyA = 'iso-user::iso-session-A';
    const keyB = 'iso-user::iso-session-B';

    await httpPost(port, '/api/chat', { userId: 'iso-user', sessionId: 'iso-session-A', text: 'a' });
    await httpPost(port, '/api/chat', { userId: 'iso-user', sessionId: 'iso-session-B', text: 'b' });

    expect(engineSessions.has(keyA)).toBe(true);
    expect(engineSessions.has(keyB)).toBe(true);
  });

  test('terminate evicts engine; new chat creates fresh engine', async () => {
    const userId = 'evict-user';

    const startRes = await httpPost(port, '/api/session/start', { userId });
    expect(startRes.status).toBe(200);
    const sessionId = startRes.body.sessionId as string;
    const engineKey = `${userId}::${sessionId}`;

    await httpPost(port, '/api/chat', { userId, sessionId, text: 'first message' });
    expect(engineSessions.has(engineKey)).toBe(true);

    const termRes = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(termRes.status).toBe(200);
    expect(termRes.body.ended).toBe(true);
    expect(engineSessions.has(engineKey)).toBe(false);

    const newStart = await httpPost(port, '/api/session/start', { userId });
    const newSessionId = newStart.body.sessionId as string;
    const newKey = `${userId}::${newSessionId}`;

    await httpPost(port, '/api/chat', { userId, sessionId: newSessionId, text: 'fresh start' });
    expect(engineSessions.has(newKey)).toBe(true);
    expect(newKey).not.toBe(engineKey);
  });

  test('terminate does not disable chat globally', async () => {
    const startA = await httpPost(port, '/api/session/start', { userId: 'global-a' });
    const startB = await httpPost(port, '/api/session/start', { userId: 'global-b' });
    const sidA = startA.body.sessionId as string;
    const sidB = startB.body.sessionId as string;

    await httpPost(port, '/api/chat', { userId: 'global-a', sessionId: sidA, text: 'a' });
    await httpPost(port, '/api/chat', { userId: 'global-b', sessionId: sidB, text: 'b' });

    await httpPost(port, '/api/session/terminate', { sessionId: sidA });

    const resB = await httpPost(port, '/api/chat', { userId: 'global-b', sessionId: sidB, text: 'still works' });
    expect(resB.status).toBe(200);
    expect(resB.body.reply).toBe(MOCK_REPLY);
  });
});
