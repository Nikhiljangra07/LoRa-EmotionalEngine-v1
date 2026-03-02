import http from 'http';
import express from 'express';
import { registerOnboardingRoute } from '../routes/onboarding.route';
import * as fs from 'fs';
import * as path from 'path';

const TIER_DIR = path.resolve(process.cwd(), '.lora', 'tier');

function cleanupTestUser(userId: string): void {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fp = path.join(TIER_DIR, `${safe}.json`);
  try { fs.unlinkSync(fp); } catch { /* noop */ }
}

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
  const origTier = process.env.LORA_TIER_MODEL;

  beforeAll((done) => {
    process.env.LORA_TIER_MODEL = '1';
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
    if (origTier === undefined) delete process.env.LORA_TIER_MODEL;
    else process.env.LORA_TIER_MODEL = origTier;
    if (server) server.close(done);
    else done();
  });

  afterEach(() => {
    cleanupTestUser('ob-test-user');
  });

  test('persists onboarding when LORA_TIER_MODEL=1', async () => {
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

    const { TierStorage } = require('../../emotion-core/tier/TierState');
    const loaded = TierStorage.load('ob-test-user');
    expect(loaded).not.toBeNull();
    expect(loaded!.onboardingComplete).toBe(true);
    expect(loaded!.onboardingPreferences).toEqual({
      name: 'Nikhil',
      preferredTone: 'direct',
      goalOrientation: 'clarity',
    });
  });

  test('returns 400 when userId missing', async () => {
    const res = await postOnboarding(port, { onboarding: {} });
    expect(res.status).toBe(400);
  });

  test('returns 200 when tier model OFF (no persist)', async () => {
    delete process.env.LORA_TIER_MODEL;
    const res = await postOnboarding(port, {
      userId: 'ob-off-user',
      onboarding: { name: 'Test', preferredTone: 'gentle', goalOrientation: 'support' },
    });
    expect(res.status).toBe(200);
    process.env.LORA_TIER_MODEL = '1';
  });
});
