import * as fs from 'fs';
import * as path from 'path';

const TIER_DIR = path.resolve(process.cwd(), '.lora', 'tier');

function tierFile(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TIER_DIR, `${safe}.json`);
}

function cleanup(userId: string): void {
  const fp = tierFile(userId);
  try { fs.unlinkSync(fp); } catch { /* noop */ }
  try { fs.unlinkSync(fp + '.tmp'); } catch { /* noop */ }
}

const mockResponder = {
  generateResponse: jest.fn().mockResolvedValue('test reply'),
};
const responderFactory = () => mockResponder;

const baseAnalyzerOutputs = {
  expressionStrength: { score: 0.5, confidence: 0.7 },
  valence: { score: -0.3, confidence: 0.6 },
  arousal: { score: 0.5, confidence: 0.6 },
  enhanced: {
    semanticScore: -0.3,
    arousalScore: 0.5,
    repetitionWeight: 0.0,
    capsWeight: 0.0,
  },
};

const neutralState = {
  dominant: 'NEUTRAL' as const,
  arousal: 'LOW' as const,
  valence: 'NEUTRAL' as const,
  confidence: 0.7,
};

describe('Tier promotion persists across session boundaries', () => {
  const userId = '__tier_promo_test__';

  beforeAll(() => {
    process.env.LORA_TIER_MODEL = '1';
  });

  afterAll(() => {
    delete process.env.LORA_TIER_MODEL;
  });

  beforeEach(() => {
    cleanup(userId);
    mockResponder.generateResponse.mockClear();
  });

  afterEach(() => cleanup(userId));

  async function runSession(): Promise<void> {
    jest.resetModules();
    const { EngineOrchestrator: EO } = require('../EngineOrchestrator');
    const engine = new EO(0.5, {}, responderFactory, { userId });
    await engine.processMessage(baseAnalyzerOutputs, neutralState);
    engine.endSession();
  }

  function readTierFile(): { sessionCount: number; currentTier: string } | null {
    const fp = tierFile(userId);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      return { sessionCount: raw.sessionCount, currentTier: raw.currentTier };
    } catch {
      return null;
    }
  }

  it('sessionCount increments and persists after each endSession', async () => {
    await runSession();
    expect(readTierFile()).toEqual({ sessionCount: 1, currentTier: 'TIER_1' });

    await runSession();
    expect(readTierFile()).toEqual({ sessionCount: 2, currentTier: 'TIER_2' });
  });

  it('TIER_2 after 2 sessions, TIER_3 after 5', async () => {
    for (let i = 0; i < 5; i++) {
      await runSession();
    }
    const file = readTierFile();
    expect(file).toEqual({ sessionCount: 5, currentTier: 'TIER_3' });
  });

  it('new engine instance loads persisted tier (not init default)', async () => {
    await runSession();
    await runSession();

    jest.resetModules();
    const { EngineOrchestrator: EO } = require('../EngineOrchestrator');
    const engine = new EO(0.5, {}, responderFactory, { userId });

    const result = await engine.processMessage(baseAnalyzerOutputs, neutralState);
    expect(result.prompt).toContain('TIER_2');
  });

  it('two different userIds maintain independent tier state', async () => {
    const otherUser = '__tier_promo_other__';
    cleanup(otherUser);

    try {
      await runSession(); // userId session 1
      await runSession(); // userId session 2 → TIER_2

      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');
      const otherEngine = new EO(0.5, {}, responderFactory, { userId: otherUser });
      await otherEngine.processMessage(baseAnalyzerOutputs, neutralState);
      otherEngine.endSession();

      expect(readTierFile()).toEqual({ sessionCount: 2, currentTier: 'TIER_2' });

      const otherFile = tierFile(otherUser);
      const otherState = JSON.parse(fs.readFileSync(otherFile, 'utf-8'));
      expect(otherState.sessionCount).toBe(1);
      expect(otherState.currentTier).toBe('TIER_1');
    } finally {
      cleanup(otherUser);
    }
  });

  it('endSession on engine with zero messages does NOT increment sessionCount', async () => {
    jest.resetModules();
    const { EngineOrchestrator: EO } = require('../EngineOrchestrator');
    const engine = new EO(0.5, {}, responderFactory, { userId });
    engine.endSession();

    const file = readTierFile();
    expect(file).toBeNull();
  });

  it('tier update survives even when ETV guard would block (sessionOpen=false)', async () => {
    process.env.LORA_ETV_V1 = '1';
    try {
      await runSession();
      expect(readTierFile()?.sessionCount).toBe(1);

      await runSession();
      expect(readTierFile()).toEqual({ sessionCount: 2, currentTier: 'TIER_2' });
    } finally {
      delete process.env.LORA_ETV_V1;
    }
  });
});
