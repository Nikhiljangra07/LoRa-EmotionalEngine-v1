import http from 'http';
import express from 'express';
import { registerSessionLifecycleRoute } from '../routes/session.lifecycle.route';
import { sharedTierService } from '../tier/TierService';

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
    // No engineSessions provided — terminate can't find engine entries.
    // This tests the guard: 0-message sessions should NOT count toward tier.
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

  test('0-message session does NOT increment tier (MIN_MESSAGES guard)', async () => {
    const body = await startAndTerminate(port, 'tier-guard-user');
    expect(body.ended).toBe(true);
    expect(body.tier).toBe('TIER_1');
    // No engine entry → no messages → sessionCount stays 0
    expect(body.sessionCount).toBe(0);
  });

  test('terminating non-existent session returns ended:false', async () => {
    const fakeRes = await httpPost(port, '/api/session/terminate', { sessionId: 'does-not-exist' });
    expect(fakeRes.body.ended).toBe(false);
    expect(fakeRes.body).not.toHaveProperty('tier');
    expect(fakeRes.body).not.toHaveProperty('sessionCount');
  });

  test('different users have isolated tier state (via TierService directly)', async () => {
    const tierService = sharedTierService;
    const userA = 'tier-direct-A';
    const userB = 'tier-direct-B';

    // Simulate 3 completed sessions for userA via TierService
    for (let i = 0; i < 3; i++) {
      await tierService.recordSessionCompletionAsync(userA, `sess-a-${i}`);
    }

    // userB has 1 session
    await tierService.recordSessionCompletionAsync(userB, 'sess-b-0');

    const tierA = await tierService.getTierAsync(userA);
    const tierB = await tierService.getTierAsync(userB);

    expect(tierA.tier).toBe('TIER_2');
    expect(tierA.sessionCount).toBe(3);
    expect(tierB.tier).toBe('TIER_1');
    expect(tierB.sessionCount).toBe(1);
  });

  test('TIER_1 → TIER_2 at 3 sessions, TIER_3 at 10 (via TierService directly)', async () => {
    const tierService = sharedTierService;
    const userId = 'tier-direct-promo';

    for (let i = 0; i < 10; i++) {
      const result = await tierService.recordSessionCompletionAsync(userId, `sess-promo-${i}`);
      if (i < 2) expect(result.tier).toBe('TIER_1');
      else if (i < 9) expect(result.tier).toBe('TIER_2');
      else expect(result.tier).toBe('TIER_3');
    }
  });

  test('same sessionId is not double-counted (TierService dedup)', async () => {
    const tierService = sharedTierService;
    const userId = 'tier-dedup-user';

    const r1 = await tierService.recordSessionCompletionAsync(userId, 'sess-dedup-1');
    expect(r1.sessionCount).toBe(1);

    // Same sessionId again — should NOT increment
    const r2 = await tierService.recordSessionCompletionAsync(userId, 'sess-dedup-1');
    expect(r2.sessionCount).toBe(1);

    // Different sessionId — should increment
    const r3 = await tierService.recordSessionCompletionAsync(userId, 'sess-dedup-2');
    expect(r3.sessionCount).toBe(2);
  });
});
