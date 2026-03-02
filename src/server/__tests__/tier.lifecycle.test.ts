import http from 'http';
import express from 'express';
import { registerSessionLifecycleRoute } from '../routes/session.lifecycle.route';

function httpPost(
  port: number,
  urlPath: string,
  body: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
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

async function startAndTerminate(port: number, userId: string): Promise<Record<string, unknown>> {
  const startRes = await httpPost(port, '/api/session/start', { userId });
  const sessionId = startRes.body.sessionId as string;
  const endRes = await httpPost(port, '/api/session/terminate', { sessionId });
  return endRes.body;
}

describe('Tier Promotion — via /api/session/terminate', () => {
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

  test('user starts at TIER_1 with sessionCount 0 (before any termination)', async () => {
    const startRes = await httpPost(port, '/api/session/start', { userId: 'tier-user-0' });
    const sessionId = startRes.body.sessionId as string;
    // First termination → sessionCount becomes 1
    const endRes = await httpPost(port, '/api/session/terminate', { sessionId });
    expect(endRes.body.ended).toBe(true);
    expect(endRes.body.tier).toBe('TIER_1');
    expect(endRes.body.sessionCount).toBe(1);
  });

  test('after 3 terminations → TIER_2', async () => {
    const userId = 'tier-user-3';
    let body: Record<string, unknown> = {};

    for (let i = 0; i < 3; i++) {
      body = await startAndTerminate(port, userId);
    }

    expect(body.ended).toBe(true);
    expect(body.tier).toBe('TIER_2');
    expect(body.sessionCount).toBe(3);
  });

  test('after 10 terminations → TIER_3', async () => {
    const userId = 'tier-user-10';
    let body: Record<string, unknown> = {};

    for (let i = 0; i < 10; i++) {
      body = await startAndTerminate(port, userId);
    }

    expect(body.ended).toBe(true);
    expect(body.tier).toBe('TIER_3');
    expect(body.sessionCount).toBe(10);
  });

  test('terminating non-existent session does NOT increment tier', async () => {
    const userId = 'tier-user-ghost';

    // One real session first
    await startAndTerminate(port, userId);

    // Try to terminate a fake session
    const fakeRes = await httpPost(port, '/api/session/terminate', { sessionId: 'does-not-exist' });
    expect(fakeRes.body.ended).toBe(false);
    expect(fakeRes.body).not.toHaveProperty('tier');
    expect(fakeRes.body).not.toHaveProperty('sessionCount');

    // Next real session should still be at sessionCount 2 (not 3)
    const body = await startAndTerminate(port, userId);
    expect(body.sessionCount).toBe(2);
    expect(body.tier).toBe('TIER_1');
  });

  test('different users have isolated tier state', async () => {
    const userA = 'tier-user-A';
    const userB = 'tier-user-B';

    // userA completes 3 sessions → TIER_2
    for (let i = 0; i < 3; i++) {
      await startAndTerminate(port, userA);
    }

    // userB completes 1 session → still TIER_1
    const bodyB = await startAndTerminate(port, userB);
    expect(bodyB.tier).toBe('TIER_1');
    expect(bodyB.sessionCount).toBe(1);

    // Verify userA is independently at TIER_2
    const bodyA = await startAndTerminate(port, userA);
    expect(bodyA.tier).toBe('TIER_2');
    expect(bodyA.sessionCount).toBe(4);
  });
});
