import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';
import { EtvBandBehaviorProfiles, coarsenBand } from '../behavior/EtvBandBehaviorProfile';

const MOCK_REPLY = 'band-test-reply';

let mockBandValue: string | undefined = 'BAND_0';

jest.mock('../../emotion-core/etv', () => ({
  ETVEngineV1: {
    getPolicy: () => ({ band: mockBandValue }),
  },
}));

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
  body: object,
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
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
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

describe('ETV Band instruction injection', () => {
  let server: http.Server | null = null;
  let port = 0;
  let capturedPrompts: string[] = [];

  beforeAll((done) => {
    const app = express();
    app.use(express.json());

    const mockResponder = () => ({
      generateResponse: async (systemPrompt: string) => {
        capturedPrompts.push(systemPrompt);
        return MOCK_REPLY;
      },
    });

    registerChatRoute(app, {
      responderFactory: mockResponder,
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
    capturedPrompts = [];
  });

  test('coarsenBand maps raw bands to 3-bucket set', () => {
    expect(coarsenBand(undefined)).toBe('B0');
    expect(coarsenBand('BAND_0')).toBe('B0');
    expect(coarsenBand('BAND_1')).toBe('B0');
    expect(coarsenBand('B0')).toBe('B0');
    expect(coarsenBand('B1')).toBe('B0');
    expect(coarsenBand('BAND_2')).toBe('B2');
    expect(coarsenBand('B2')).toBe('B2');
    expect(coarsenBand('BAND_3')).toBe('B4');
    expect(coarsenBand('BAND_4')).toBe('B4');
    expect(coarsenBand('B3')).toBe('B4');
    expect(coarsenBand('B4')).toBe('B4');
    expect(coarsenBand('garbage')).toBe('B0');
  });

  test('B0: prompt starts with B0 instruction, then tier, then base', async () => {
    mockBandValue = 'BAND_0';
    const res = await postApiChat(port, {
      userId: 'band-b0',
      sessionId: 'sess-b0',
      text: 'hello',
    });
    expect(res.status).toBe(200);
    expect(capturedPrompts.length).toBe(1);
    const prompt = capturedPrompts[0];
    expect(prompt.startsWith(EtvBandBehaviorProfiles.B0.instruction)).toBe(true);
  });

  test('B2: prompt starts with B2 instruction header', async () => {
    mockBandValue = 'BAND_2';
    const res = await postApiChat(port, {
      userId: 'band-b2',
      sessionId: 'sess-b2',
      text: 'hello',
    });
    expect(res.status).toBe(200);
    expect(capturedPrompts.length).toBe(1);
    const prompt = capturedPrompts[0];
    expect(prompt.startsWith(EtvBandBehaviorProfiles.B2.instruction)).toBe(true);
  });

  test('B4: prompt starts with B4 instruction header', async () => {
    mockBandValue = 'BAND_4';
    const res = await postApiChat(port, {
      userId: 'band-b4',
      sessionId: 'sess-b4',
      text: 'hello',
    });
    expect(res.status).toBe(200);
    expect(capturedPrompts.length).toBe(1);
    const prompt = capturedPrompts[0];
    expect(prompt.startsWith(EtvBandBehaviorProfiles.B4.instruction)).toBe(true);
  });

  test('ordering: band instruction → tier instruction → base prompt', async () => {
    mockBandValue = 'BAND_2';
    const res = await postApiChat(port, {
      userId: 'band-order',
      sessionId: 'sess-order',
      text: 'hello',
    });
    expect(res.status).toBe(200);
    const prompt = capturedPrompts[0];
    const bandIdx = prompt.indexOf('[ETV BAND:');
    const tierIdx = prompt.indexOf('[BEHAVIORAL MODE');
    expect(bandIdx).toBeGreaterThanOrEqual(0);
    expect(tierIdx).toBeGreaterThan(bandIdx);
  });

  test('debug.etvBand is present in response', async () => {
    mockBandValue = 'BAND_3';
    const res = await postApiChat(port, {
      userId: 'band-debug',
      sessionId: 'sess-debug',
      text: 'hello',
    });
    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;
    expect(debug).toHaveProperty('etvBand');
    expect(debug.etvBand).toBe('B4');
  });
});
