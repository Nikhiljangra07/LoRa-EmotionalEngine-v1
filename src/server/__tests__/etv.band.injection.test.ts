import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';
import { coarsenBand } from '../behavior/EtvBandBehaviorProfile';
import { getResponsePolicy, formatPolicyBlock } from '../../emotion-core/policy/ResponsePolicy';

const MOCK_REPLY = 'band-test-reply';

let mockBandValue: string | undefined = 'BAND_0';

jest.mock('../../emotion-core/etv', () => ({
  ETVEngineV1: {
    getPolicy: () => ({ band: mockBandValue }),
  },
}));

function createMockMemoryService(): MemoryService {
  return {
    saveMessage: jest.fn().mockResolvedValue({ ok: true, wroteFalkor: true, wroteChroma: true, degraded: { falkor: false, chroma: false } }),
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

describe('ResponsePolicy injection via responder wrapper', () => {
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

  test('B0: prompt starts with [SYSTEM IDENTITY] then contains [SYSTEM POLICY]', async () => {
    mockBandValue = 'BAND_0';
    const res = await postApiChat(port, { userId: 'pol-b0', sessionId: 'sess-b0', text: 'hello' });
    expect(res.status).toBe(200);
    expect(capturedPrompts.length).toBe(1);
    const prompt = capturedPrompts[0];
    expect(prompt.startsWith('[SYSTEM IDENTITY')).toBe(true);
    expect(prompt).toContain('[SYSTEM POLICY]');
    expect(prompt).toContain('Tone: guarded');
    expect(prompt).toContain('Maximum words: 60');
    expect(prompt).toContain('Maximum questions: 1');
  });

  test('B2: prompt contains neutral tone and 110 word limit', async () => {
    mockBandValue = 'BAND_2';
    const res = await postApiChat(port, { userId: 'pol-b2', sessionId: 'sess-b2', text: 'hello' });
    expect(res.status).toBe(200);
    const prompt = capturedPrompts[0];
    expect(prompt).toContain('Tone: neutral');
    expect(prompt).toContain('Maximum words: 110');
    expect(prompt).toContain('Maximum questions: 2');
  });

  test('B4: prompt contains collaborative tone and 170 word limit', async () => {
    mockBandValue = 'BAND_4';
    const res = await postApiChat(port, { userId: 'pol-b4', sessionId: 'sess-b4', text: 'hello' });
    expect(res.status).toBe(200);
    const prompt = capturedPrompts[0];
    expect(prompt).toContain('Tone: collaborative');
    expect(prompt).toContain('Maximum words: 170');
    expect(prompt).toContain('Maximum questions: 3');
  });

  test('prompt contains assistant principles block', async () => {
    mockBandValue = 'BAND_0';
    const res = await postApiChat(port, { userId: 'pol-princ', sessionId: 'sess-princ', text: 'hello' });
    expect(res.status).toBe(200);
    const prompt = capturedPrompts[0];
    expect(prompt).toContain('Prioritize diagnosis over empathy');
    expect(prompt).toContain('Do not encourage harm');
  });

  test('debug contains etvBand and policy', async () => {
    mockBandValue = 'BAND_3';
    const res = await postApiChat(port, { userId: 'pol-dbg', sessionId: 'sess-dbg', text: 'hello' });
    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;
    expect(debug.etvBand).toBe('B4');
    expect(debug).toHaveProperty('policy');
    const pol = debug.policy as Record<string, unknown>;
    expect(pol.maxWords).toBe(350);
    expect(pol.maxQuestions).toBe(3);
    expect(pol.tone).toBe('collaborative');
    expect(pol.reasoningDepth).toBe('clarify');
  });

  test('getResponsePolicy merges tier depth with band constraints', () => {
    const p1 = getResponsePolicy('TIER_1', 'B0');
    expect(p1).toMatchObject({ maxWords: 300, maxQuestions: 1, reasoningDepth: 'clarify', tone: 'guarded' });
    expect(p1.personality?.analytical).toBe(true);

    const p2 = getResponsePolicy('TIER_2', 'B2');
    expect(p2).toMatchObject({ maxWords: 250, maxQuestions: 2, reasoningDepth: 'contextual', tone: 'direct' });
    expect(p2.personality?.analytical).toBe(true);

    const p3 = getResponsePolicy('TIER_3', 'B4');
    expect(p3).toMatchObject({ maxWords: 350, maxQuestions: 3, reasoningDepth: 'interpretive', tone: 'direct' });
    expect(p3.personality?.blunt).toBe(true);
  });

  test('formatPolicyBlock produces deterministic output', () => {
    const block = formatPolicyBlock(getResponsePolicy('TIER_2', 'B2'));
    expect(block).toContain('[SYSTEM POLICY]');
    expect(block).toContain('Tone: direct');
    expect(block).toContain('Reasoning mode: contextual');
    expect(block).toContain('Maximum words: 110');
    expect(block).toContain('analytical reasoning partner');
  });
});
