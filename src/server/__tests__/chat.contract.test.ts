import http from 'http';

// ── Mocks (registered before adapter import) ───────────────────

/** Prevent real OpenAI API calls; return a deterministic non-empty string. */
jest.mock('../../emotion-core/llm/OpenAIResponder', () => ({
  OpenAIResponder: class {
    async generateResponse() {
      return 'mock-llm-reply';
    }
  },
}));

/** Prevent filesystem writes from session trace. */
jest.mock('../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

// ── Server lifecycle ───────────────────────────────────────────
//
// adapter.ts doesn't export `app` and calls app.listen(3000) at
// module load.  We intercept http.createServer (called by Express
// internally) to capture the server, then patch the instance's
// listen() to bind on port 0 (OS-assigned) instead of 3000.
// This avoids port conflicts and gives us a handle for cleanup.

let testServer: http.Server | null = null;
let testPort = 0;

beforeAll((done) => {
  const origCreateServer = http.createServer;

  (http as any).createServer = function (...csArgs: any[]) {
    // Create the real server
    const server = origCreateServer.apply(
      http,
      csArgs as any
    ) as http.Server;
    testServer = server;

    // Restore createServer immediately (one-shot intercept)
    (http as any).createServer = origCreateServer;

    // Patch THIS instance's listen to use port 0
    const origListen = server.listen;
    server.listen = function (...listenArgs: any[]) {
      listenArgs[0] = 0; // OS-assigned free port
      server.listen = origListen; // restore instance

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

  // Importing the adapter triggers Express app creation + listen.
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

// ── Contract ───────────────────────────────────────────────────

describe('POST /chat — HTTP contract', () => {
  test('{ message: "hello" } → 200, JSON, { reply: non-empty string }', async () => {
    const res = await postChat({ message: 'hello' });

    // 1. Status code
    expect(res.status).toBe(200);

    // 2. Content-Type is JSON
    expect(res.headers['content-type']).toMatch(/json/);

    // 3. Body contains "reply" key
    expect(res.body).toHaveProperty('reply');

    // 4. reply is a string
    expect(typeof res.body.reply).toBe('string');

    // 5. reply is non-empty (holds for both real LLM and fallback)
    expect((res.body.reply as string).trim().length).toBeGreaterThan(0);
  });
});
