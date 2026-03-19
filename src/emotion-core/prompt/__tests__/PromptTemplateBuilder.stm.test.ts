import { EmotionalState } from '../../types/analysis.types';
import { ETVState } from '../../types/etv.types';

const mockFlags: Record<string, boolean> = {
  appraisalBridgeEnabled: false,
  appraisalBridgeModeEnabled: false,
  appraisalPacingHintEnabled: false,
  strictGuidanceModeEnabled: false,
  driftMonitorEnabled: false,
  validationIntensityEnabled: false,
  adaptiveOverrideCooldownEnabled: false,
  appraisalToneHintEnabled: false,
  interventionValidationHintEnabled: false,
  interventionPacingHintEnabled: false,
  interventionToneHintEnabled: false,
  interventionActionHintEnabled: false,
  interventionInterruptHintEnabled: false,
  interventionStepHintEnabled: false,
  interventionQuestionBudgetEnabled: false,
  hintResolverEnabled: false,
  hintStickinessEnabled: false,
  guidanceDwellLockEnabled: false,
  hintSemanticGuardEnabled: false,
  etvV1Enabled: false,
  etvPolicyPromptEnabled: false,
  etvPolicyPromptShadowEnabled: false,
  memoryV1Enabled: false,
  memoryV1ShadowEnabled: false,
  memoryV1DebugEnabled: false,
  memoryV1ChromaEnabled: false,
  factAnchorEnabled: false,
  memoryServiceEnabled: false,
};

jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

jest.mock('../../debug/debugGate', () => ({
  debugEnabled: false,
}));

jest.mock('../etvPolicyPromptMap', () => ({
  mapETVPolicyToPrompt: jest.fn(),
  renderConstraintOverlay: jest.fn(() => ''),
  computePromptSignature: jest.fn(() => 'sig'),
}));

jest.mock('../../logging/DecisionLogger', () => ({
  DecisionLogger: {
    logPromptProfileDiff: jest.fn(),
    logMessageDecision: jest.fn(),
    logSessionEnd: jest.fn(),
    resetDiffLimiter: jest.fn(),
  },
}));

import {
  PromptTemplateBuilder,
  truncateTurnText,
  STM_MAX_TURNS,
  STM_MAX_TEXT_LENGTH,
} from '../PromptTemplateBuilder';
import type { ChatTurn } from '../PromptTemplateBuilder';

function makeEmotionalState(): EmotionalState {
  return { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 1 };
}

function makeETVState(value = 0.3): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

describe('PromptTemplateBuilder — Session Transcript Memory', () => {
  describe('truncateTurnText', () => {
    it('returns text unchanged if under limit', () => {
      expect(truncateTurnText('hello')).toBe('hello');
    });

    it('truncates at limit with ellipsis', () => {
      const long = 'x'.repeat(STM_MAX_TEXT_LENGTH + 100);
      const result = truncateTurnText(long);
      expect(result.length).toBe(STM_MAX_TEXT_LENGTH);
      expect(result.endsWith('\u2026')).toBe(true);
    });

    it('does not truncate at exactly the limit', () => {
      const exact = 'y'.repeat(STM_MAX_TEXT_LENGTH);
      expect(truncateTurnText(exact)).toBe(exact);
    });
  });

  describe('getSessionContextBlock', () => {
    it('returns empty string for undefined/empty history', () => {
      expect(PromptTemplateBuilder.getSessionContextBlock(undefined)).toBe('');
      expect(PromptTemplateBuilder.getSessionContextBlock([])).toBe('');
    });

    it('renders turns with correct role labels', () => {
      const turns: ChatTurn[] = [
        { role: 'user', text: 'Hello LoRa', ts: 1000 },
        { role: 'assistant', text: 'Hi there!', ts: 1001 },
      ];
      const block = PromptTemplateBuilder.getSessionContextBlock(turns);
      expect(block).toContain('SESSION CONTEXT (this chat only)');
      expect(block).toContain('User: Hello LoRa');
      expect(block).toContain('LoRa: Hi there!');
    });

    it('caps output to STM_MAX_TURNS most recent turns', () => {
      const turns: ChatTurn[] = [];
      for (let i = 0; i < 20; i++) {
        turns.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          text: `Turn ${i}`,
          ts: 1000 + i,
        });
      }
      const block = PromptTemplateBuilder.getSessionContextBlock(turns);
      expect(block).not.toContain('Turn 0');
      expect(block).not.toContain(`Turn ${20 - STM_MAX_TURNS - 1}`);
      expect(block).toContain(`Turn ${20 - 1}`);

      const lines = block.split('\n').filter(l => l.startsWith('User:') || l.startsWith('LoRa:'));
      expect(lines.length).toBe(STM_MAX_TURNS);
    });
  });

  describe('build() integration', () => {
    it('includes SESSION CONTEXT in prompt when history is provided', () => {
      const history: ChatTurn[] = [
        { role: 'user', text: 'My name is Nikhil', ts: 1000 },
        { role: 'assistant', text: 'Nice to meet you, Nikhil.', ts: 1001 },
      ];
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { sessionHistory: history },
      );
      expect(prompt).toContain('SESSION CONTEXT (this chat only)');
      expect(prompt).toContain('User: My name is Nikhil');
      expect(prompt).toContain('LoRa: Nice to meet you, Nikhil.');
    });

    it('does not include SESSION CONTEXT when no history', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
      );
      expect(prompt).not.toContain('SESSION CONTEXT');
    });

    it('SESSION CONTEXT appears before GLOBAL SAFETY CONSTRAINTS', () => {
      const history: ChatTurn[] = [
        { role: 'user', text: 'hi', ts: 1000 },
      ];
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { sessionHistory: history },
      );
      const scIdx = prompt.indexOf('SESSION CONTEXT');
      const gcIdx = prompt.indexOf('GLOBAL SAFETY CONSTRAINTS');
      expect(scIdx).toBeGreaterThan(-1);
      expect(gcIdx).toBeGreaterThan(-1);
      expect(scIdx).toBeLessThan(gcIdx);
    });

    it('SESSION CONTEXT does not contain forbidden phrases', () => {
      const history: ChatTurn[] = [
        { role: 'user', text: 'Remember this.', ts: 1000 },
        { role: 'assistant', text: 'Noted.', ts: 1001 },
      ];
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { sessionHistory: history },
      );
      const forbidden = PromptTemplateBuilder.containsForbiddenPhrases(prompt);
      expect(forbidden).toEqual([]);
    });
  });
});
