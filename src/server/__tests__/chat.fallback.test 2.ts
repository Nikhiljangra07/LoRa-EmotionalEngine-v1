import http from 'http';

// ── Mocks (registered before adapter import) ───────────────────

process.env.OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || 'test-openai-key';

/**
 * Simulate LLM unavailability: the constructor throws exactly as
 * the real OpenAIResponder does when OPENAI_API_KEY is unset.
 * The engine's retry loop catches this, exhausts attempts, and
 * returns a fallback response — which is the path under test.
 */
jest.mock('../../emotion-core/llm/OpenAIResponder', () => ({
  OpenAIResponder: class {
    constructor() {
      throw new Error('OPENAI_API_KEY not set');
    }
    async generateResponse(): Promise<string> {
      throw new Error('unreachable');
    }
  },
}));

/** Prevent filesystem writes from session trace. */
jest.mock('../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

// ── Server lifecycle ───────────────────────────────────────────
//
// Same pattern as chat.contract.test.ts: intercept http.createServer
// to capture the server handle and bind on port 0 (OS-assigned).

let testServer: http.Server | null = null;
let testPort = 0;

beforeAll((done) => {
  const origCreateServer = http.createServer;

  (http as any).createServer = function (...csArgs: any[]) {
    const server = origCreateServer.apply(
      http,
      csArgs as any
    ) as http.Server;
    testServer = server;

    (http as any).createServer = origCreateServer;

    const origListen = server.listen;
    server.listen = function (...listenArgs: any[]) {
      listenArgs[0] = 0;
      server.listen = origListen;

      origListen.apply(server, listenArgs as any);

      server.once('listening', () => {
        const addr = server.address();
        testPort =
          typeof addr === 'object' && addr !== null ? addr.port : 0;
        done();
      });
      return server;
    } as any;

    return server;
  };

  require('../adapter');
});

afterAll((done) => {
  testServer ? testServer.close(done) : done();
});

// ── Helper ─────────────────────────────────────────────────────

function postChat(
  body: object
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: testPort,
        path: '/chat',
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
              status: res.statusCode!,
              headers: res.headers,
              body: JSON.parse(data),
            });
          } catch {
            reject(new Error(`Non-JSON response body: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Fallback contract ──────────────────────────────────────────

describe('POST /chat — LLM unavailable (fallback safety)', () => {
  test('returns 200 with valid { reply } even when LLM is unreachable', async () => {
    const res = await postChat({ message: 'test fallback' });

    // Must NOT crash — status is 200, not 500
    expect(res.status).toBe(200);

    // Must be parseable JSON
    expect(res.headers['content-type']).toMatch(/json/);

    // Must contain a "reply" field
    expect(res.body).toHaveProperty('reply');

    // reply must be a string
    expect(typeof res.body.reply).toBe('string');

    // reply must be non-empty (exact text is NOT asserted)
    expect((res.body.reply as string).trim().length).toBeGreaterThan(0);
  });
});
