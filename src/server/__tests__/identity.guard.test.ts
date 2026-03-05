import { enforceIdentity } from '../../emotion-core/policy/IdentityGuard';
import { formatPolicyBlock, getResponsePolicy } from '../../emotion-core/policy/ResponsePolicy';
import { LORA_IDENTITY } from '../../emotion-core/policy/LoRaIdentity';

describe('IdentityGuard — enforceIdentity', () => {
  test('strips therapist opener: "That must feel"', () => {
    const input = 'That must feel really frustrating. The real issue is structural.';
    const result = enforceIdentity(input);
    expect(result).toBe('The real issue is structural.');
  });

  test('strips therapist opener: "I understand how"', () => {
    const input = 'I understand how difficult this is. Let me analyze the situation.';
    const result = enforceIdentity(input);
    expect(result).toBe('Let me analyze the situation.');
  });

  test('strips therapist opener: "It sounds like you\'re feeling"', () => {
    const input = "It sounds like you're feeling overwhelmed. Three factors contribute to this.";
    const result = enforceIdentity(input);
    expect(result).toBe('Three factors contribute to this.');
  });

  test('strips therapist opener: "I can hold space for that"', () => {
    const input = 'I can hold space for that. The core problem is misalignment.';
    const result = enforceIdentity(input);
    expect(result).toBe('The core problem is misalignment.');
  });

  test('strips therapist opener: "I\'m here with you"', () => {
    const input = "I'm here with you. The data shows a clear pattern.";
    const result = enforceIdentity(input);
    expect(result).toBe('The data shows a clear pattern.');
  });

  test('strips narrative opener: "A quiet moment"', () => {
    const input = 'A quiet moment of reflection settles. The underlying cause is resource allocation.';
    const result = enforceIdentity(input);
    expect(result).toBe('The underlying cause is resource allocation.');
  });

  test('strips narrative opener: "Sometimes in life"', () => {
    const input = 'Sometimes in life we face hard choices. Here is the tradeoff analysis.';
    const result = enforceIdentity(input);
    expect(result).toBe('Here is the tradeoff analysis.');
  });

  test('strips narrative opener: "Imagine"', () => {
    const input = 'Imagine a world where this worked. The reality is different.';
    const result = enforceIdentity(input);
    expect(result).toBe('The reality is different.');
  });

  test('strips narrative opener: "This moment carries"', () => {
    const input = 'This moment carries weight. Two structural issues are present.';
    const result = enforceIdentity(input);
    expect(result).toBe('Two structural issues are present.');
  });

  test('strips two consecutive forbidden sentences', () => {
    const input = 'That must feel painful. I understand how hard this is. The root cause is timing.';
    const result = enforceIdentity(input);
    expect(result).toBe('The root cause is timing.');
  });

  test('preserves analytical response unchanged', () => {
    const input = 'The demo failed for one of three reasons: clarity, audience, or product fit.';
    const result = enforceIdentity(input);
    expect(result).toBe(input);
  });

  test('preserves diagnostic question unchanged', () => {
    const input = 'What part of the process broke down?';
    const result = enforceIdentity(input);
    expect(result).toBe(input);
  });

  test('preserves numbered reasoning unchanged', () => {
    const input = '1. The value proposition was unclear.\n2. The audience was wrong.';
    const result = enforceIdentity(input);
    expect(result).toBe(input);
  });

  test('handles empty string', () => {
    expect(enforceIdentity('')).toBe('');
  });

  test('handles whitespace-only string', () => {
    expect(enforceIdentity('   ')).toBe('');
  });
});

describe('LORA_IDENTITY contract', () => {
  test('identity block contains non-negotiable header', () => {
    expect(LORA_IDENTITY).toContain('[SYSTEM IDENTITY');
    expect(LORA_IDENTITY).toContain('NON-NEGOTIABLE');
  });

  test('identity block declares what LoRa is not', () => {
    expect(LORA_IDENTITY).toContain('NOT');
    expect(LORA_IDENTITY).toContain('therapist');
    expect(LORA_IDENTITY).toContain('cheerleader');
  });

  test('identity block contains all 10 rules', () => {
    for (let i = 1; i <= 10; i++) {
      expect(LORA_IDENTITY).toContain(`${i}.`);
    }
  });
});

describe('Prompt priority order', () => {
  test('formatPolicyBlock starts with SYSTEM IDENTITY before SYSTEM POLICY', () => {
    const block = formatPolicyBlock(getResponsePolicy('TIER_1', 'B0'));
    const identityIndex = block.indexOf('[SYSTEM IDENTITY');
    const policyIndex = block.indexOf('[SYSTEM POLICY]');
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(policyIndex).toBeGreaterThan(identityIndex);
  });

  test('identity is present for all tiers', () => {
    for (const tier of ['TIER_1', 'TIER_2', 'TIER_3']) {
      const block = formatPolicyBlock(getResponsePolicy(tier, 'B2'));
      expect(block).toContain('[SYSTEM IDENTITY');
      expect(block).toContain('[SYSTEM POLICY]');
    }
  });
});
