/**
 * Session continuity integration test.
 * Verifies that prior turns are passed to the LLM in the second call.
 */
import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';

type CapturedPayload = {
  systemPrompt: string;
  userMessage: string;
  sessionHistory?: Array<{ role: string; text: string }>;
};

let lastPayload: CapturedPayload | null = null;

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

describe('POST /api/chat — session continuity (in-session memory)', () => {
  let server: http.Server | null = null;
  let port = 0;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());

    const responderFactory = () => ({
      generateResponse: async (
        systemPrompt: string,
        userMessage: string,
        options?: { sessionHistory?: Array<{ role: string; text: string }> }
      ) => {
        const history = options?.sessionHistory ?? [];
        lastPayload = {
          systemPrompt,
          userMessage,
          sessionHistory: history.map((t) => ({
            role: t.role,
            text: (t as { text?: string }).text ?? '',
          })),
        };
        const priorTexts = history.map((t) => (t as { text?: string }).text ?? '').join(' ');
        if (priorTexts.includes('My name is Nikhil') && userMessage.includes('What is my name')) {
          return 'Your name is Nikhil.';
        }
        return 'I don\'t have that information.';
      },
    });

    registerChatRoute(app, {
      responderFactory,
      memoryService: createMockMemoryService(),
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

  beforeEach(() => {
    lastPayload = null;
  });

  test('second call receives prior user message in sessionHistory', async () => {
    const userId = 'continuity-user';
    const sessionId = 'continuity-sess';

    await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-1',
      text: 'My name is Nikhil.',
    });

    const res2 = await postApiChat(port, {
      userId,
      sessionId,
      messageId: 'msg-2',
      text: 'What is my name?',
    });

    expect(res2.status).toBe(200);
    expect(lastPayload).not.toBeNull();
    expect(lastPayload!.sessionHistory).toBeDefined();
    const historyTexts = (lastPayload!.sessionHistory ?? []).map((t) => t.text).join(' ');
    expect(historyTexts).toContain('My name is Nikhil');
    expect((res2.body.reply as string)).toContain('Nikhil');
  });
});
