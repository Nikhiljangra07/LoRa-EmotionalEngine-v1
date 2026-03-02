import http from 'http';
import express from 'express';
import { registerSessionLifecycleRoute } from '../routes/session.lifecycle.route';

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

describe('Session Lifecycle — /api/session/start + /api/session/terminate', () => {
  let server: http.Server | null = null;
  let port = 0;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    registerSessionLifecycleRoute(app);

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

  test('/api/session/start returns sessionId and startedAt', async () => {
    const res = await httpPost(port, '/api/session/start', { userId: 'u1' });
    expect(res.status).toBe(200);
    expect(typeof res.body.sessionId).toBe('string');
    expect((res.body.sessionId as string).length).toBeGreaterThan(0);
    expect(typeof res.body.startedAt).toBe('number');
  });

  test('/api/session/start rejects missing userId', async () => {
    const res = await httpPost(port, '/api/session/start', {});
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('/api/session/terminate returns ended:true for active session', async () => {
    const startRes = await httpPost(port, '/api/session/start', { userId: 'u2' });
    const sessionId = startRes.body.sessionId as string;

    const endRes = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(endRes.status).toBe(200);
    expect(endRes.body.ended).toBe(true);
  });

  test('/api/session/terminate returns ended:false for unknown session', async () => {
    const res = await httpPost(port, '/api/session/terminate', { sessionId: 'nonexistent' });
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(false);
  });

  test('/api/session/terminate returns ended:false when called twice', async () => {
    const startRes = await httpPost(port, '/api/session/start', { userId: 'u3' });
    const sessionId = startRes.body.sessionId as string;

    const end1 = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(end1.body.ended).toBe(true);

    const end2 = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(end2.body.ended).toBe(false);
  });

  test('/api/session/terminate rejects missing sessionId', async () => {
    const res = await httpPost(port, '/api/session/terminate', {});
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('no LLM or tier side effects — pure lifecycle', async () => {
    const startRes = await httpPost(port, '/api/session/start', { userId: 'u4' });
    expect(startRes.status).toBe(200);
    const sessionId = startRes.body.sessionId as string;

    const endRes = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(endRes.status).toBe(200);
    expect(endRes.body.ended).toBe(true);
    // Response contains only { ended: true } — no tier, no ETV, no LLM output
    expect(endRes.body).not.toHaveProperty('tier');
    expect(endRes.body).not.toHaveProperty('sessionCount');
    expect(endRes.body).not.toHaveProperty('reply');
  });
});
