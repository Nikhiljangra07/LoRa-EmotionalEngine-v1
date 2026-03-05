import http from 'http';
import express from 'express';
import { registerChatRoute } from '../routes/chat.route';
import type { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';
import { TierService } from '../tier/TierService';
import {
  getResponsePolicy,
  enforceWordLimit,
  enforceQuestionLimit,
} from '../../emotion-core/policy/ResponsePolicy';

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

// ── Unit tests: policy resolution + post-gen guards ────────────────

describe('ResponsePolicy — unit tests', () => {
  test('Tier1/Band0 → clarify, guarded, 60 words, 1 question', () => {
    const p = getResponsePolicy('TIER_1', 'B0');
    expect(p.reasoningDepth).toBe('clarify');
    expect(p.tone).toBe('guarded');
    expect(p.maxWords).toBe(60);
    expect(p.maxQuestions).toBe(1);
  });

  test('Tier2/Band2 → contextual, direct, 110 words, 2 questions, analytical personality', () => {
    const p = getResponsePolicy('TIER_2', 'B2');
    expect(p.reasoningDepth).toBe('contextual');
    expect(p.tone).toBe('direct');
    expect(p.maxWords).toBe(110);
    expect(p.maxQuestions).toBe(2);
    expect(p.personality?.analytical).toBe(true);
    expect(p.personality?.factualFraming).toBe(true);
  });

  test('Tier3/Band4 → interpretive, direct tone, 170 words, 3 questions', () => {
    const p = getResponsePolicy('TIER_3', 'B4');
    expect(p.reasoningDepth).toBe('interpretive');
    expect(p.tone).toBe('direct');
    expect(p.maxWords).toBe(170);
    expect(p.maxQuestions).toBe(3);
    expect(p.personality).toEqual({
      analytical: true,
      blunt: true,
      clarityFirst: true,
      avoidOverValidation: true,
      avoidTherapyTone: true,
      avoidNarrativeFiller: true,
      challengeAssumptions: true,
      factualFraming: true,
    });
  });

  test('cross-product: Tier3 + Band0 → interpretive reasoning, direct tone', () => {
    const p = getResponsePolicy('TIER_3', 'B0');
    expect(p.reasoningDepth).toBe('interpretive');
    expect(p.tone).toBe('direct');
    expect(p.maxWords).toBe(60);
    expect(p.personality?.blunt).toBe(true);
    expect(p.personality?.analytical).toBe(true);
  });

  test('unknown tier/band falls back to TIER_1/B0 defaults', () => {
    const p = getResponsePolicy('TIER_99', 'B99');
    expect(p.reasoningDepth).toBe('clarify');
    expect(p.tone).toBe('guarded');
    expect(p.maxWords).toBe(60);
    expect(p.maxQuestions).toBe(1);
  });

  test('enforceWordLimit: under limit → unchanged', () => {
    expect(enforceWordLimit('hello world', 10)).toBe('hello world');
  });

  test('enforceWordLimit: over limit → truncated', () => {
    const text = 'one two three four five six seven eight nine ten eleven';
    const result = enforceWordLimit(text, 5);
    expect(result.split(/\s+/).length).toBe(5);
    expect(result).toBe('one two three four five');
  });

  test('enforceWordLimit: exact limit → unchanged', () => {
    expect(enforceWordLimit('a b c', 3)).toBe('a b c');
  });

  test('enforceQuestionLimit: under limit → unchanged', () => {
    expect(enforceQuestionLimit('How are you? Fine.', 2)).toBe('How are you? Fine.');
  });

  test('enforceQuestionLimit: over limit → truncated at last allowed ?', () => {
    const text = 'Q1? Q2? Q3? Extra.';
    expect(enforceQuestionLimit(text, 2)).toBe('Q1? Q2?');
  });

  test('enforceQuestionLimit: exact limit → unchanged', () => {
    expect(enforceQuestionLimit('Q1? Q2?', 2)).toBe('Q1? Q2?');
  });

  test('enforceQuestionLimit: no questions → unchanged', () => {
    expect(enforceQuestionLimit('No questions here.', 1)).toBe('No questions here.');
  });
});

// ── Integration tests: structural constraints through HTTP ─────────

describe('ResponsePolicy — integration (mock LLM)', () => {
  let server: http.Server | null = null;
  let port = 0;
  let mockReply = '';
  let capturedPrompt = '';

  beforeAll((done) => {
    const app = express();
    app.use(express.json());

    const mockResponder = () => ({
      generateResponse: async (systemPrompt: string) => {
        capturedPrompt = systemPrompt;
        return mockReply;
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

  test('T1/B0: reply is truncated to 60 words by post-gen guard', async () => {
    mockBandValue = 'BAND_0';
    mockReply = Array(100).fill('word').join(' ');
    const res = await postApiChat(port, { userId: 'trunc-u', sessionId: 'trunc-s', text: 'hi' });
    expect(res.status).toBe(200);
    const reply = res.body.reply as string;
    expect(reply.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(60);
  });

  test('T1/B0: reply with 3 questions is truncated to 1', async () => {
    mockBandValue = 'BAND_0';
    mockReply = 'Are you ok? Is this right? Maybe?';
    const res = await postApiChat(port, { userId: 'qtrunc-u', sessionId: 'qtrunc-s', text: 'hi' });
    expect(res.status).toBe(200);
    const reply = res.body.reply as string;
    const qCount = (reply.match(/\?/g) || []).length;
    expect(qCount).toBeLessThanOrEqual(1);
  });

  test('B4: reply under 170 words is not truncated', async () => {
    mockBandValue = 'BAND_4';
    mockReply = Array(150).fill('word').join(' ');
    const res = await postApiChat(port, { userId: 'b4-u', sessionId: 'b4-s', text: 'hi' });
    expect(res.status).toBe(200);
    const reply = res.body.reply as string;
    expect(reply.split(/\s+/).filter(Boolean).length).toBe(150);
  });

  test('debug.policy reflects T1/B0 constraints', async () => {
    mockBandValue = 'BAND_0';
    mockReply = 'ok';
    const res = await postApiChat(port, { userId: 'dbg-u', sessionId: 'dbg-s', text: 'hi' });
    expect(res.status).toBe(200);
    const debug = res.body.debug as Record<string, unknown>;
    expect(debug.policy).toEqual({
      maxWords: 60,
      maxQuestions: 1,
      reasoningDepth: 'clarify',
      tone: 'guarded',
    });
  });

  test('prompt starts with [SYSTEM IDENTITY] and contains [SYSTEM POLICY]', async () => {
    mockBandValue = 'BAND_2';
    mockReply = 'ok';
    const res = await postApiChat(port, { userId: 'hdr-u', sessionId: 'hdr-s', text: 'hi' });
    expect(res.status).toBe(200);
    expect(capturedPrompt.startsWith('[SYSTEM IDENTITY')).toBe(true);
    expect(capturedPrompt).toContain('[SYSTEM POLICY]');
    expect(capturedPrompt).toContain('Reasoning mode: clarify');
    expect(capturedPrompt).toContain('Tone: neutral');
  });
});
