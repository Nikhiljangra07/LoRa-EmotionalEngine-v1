import http from 'http';
import express from 'express';
import { registerOnboardingRoute } from '../routes/onboarding.route';

function postOnboarding(port: number, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/onboarding',
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
            reject(new Error(`Non-JSON: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('POST /api/onboarding', () => {
  let server: http.Server | null = null;
  let port = 0;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    registerOnboardingRoute(app);
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

  test('returns 200 with ok:true for valid onboarding', async () => {
    const res = await postOnboarding(port, {
      userId: 'ob-test-user',
      onboarding: {
        name: 'Nikhil',
        preferredTone: 'direct',
        goalOrientation: 'clarity',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 400 when userId missing', async () => {
    const res = await postOnboarding(port, { onboarding: {} });
    expect(res.status).toBe(400);
  });

  test('returns 400 when onboarding missing', async () => {
    const res = await postOnboarding(port, { userId: 'u1' });
    expect(res.status).toBe(400);
  });
});
