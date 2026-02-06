import http from 'http';

// Run: npm test

// Ensure bootstrap invariant passes in test environment
process.env.OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || 'test-openai-key';

// ── Server lifecycle ───────────────────────────────────────────
// adapter.ts doesn't export `app` and calls app.listen(3000) at
// module load. We intercept http.createServer to capture the
// server, then patch listen() to bind on port 0 (OS-assigned).

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

function getHealth(): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: testPort,
        path: '/health/llm',
        method: 'GET',
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
    req.end();
  });
}

// ── Contract ───────────────────────────────────────────────────

describe('GET /health/llm — HTTP contract', () => {
  test('returns 200 with { openai: string, lastSuccess: number|null }', async () => {
    const res = await getHealth();

    // 1. Status code
    expect(res.status).toBe(200);

    // 2. Body shape
    expect(res.body).toHaveProperty('openai');
    expect(res.body).toHaveProperty('lastSuccess');

    // 3. Types
    expect(typeof res.body.openai).toBe('string');
    const last = res.body.lastSuccess;
    expect(
      last === null || typeof last === 'number'
    ).toBe(true);
  });
});
