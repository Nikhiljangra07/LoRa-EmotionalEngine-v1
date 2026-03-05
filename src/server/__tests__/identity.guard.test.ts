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

// ── New therapist patterns ───────────────────────────────────────────

describe('IdentityGuard — expanded therapist patterns', () => {
  test('strips "It\'s understandable that"', () => {
    const input = "It's understandable that you're upset. The root cause is timing.";
    expect(enforceIdentity(input)).toBe('The root cause is timing.');
  });

  test('strips "It makes sense that you\'re"', () => {
    const input = "It makes sense that you're feeling this way. Two factors are at play.";
    expect(enforceIdentity(input)).toBe('Two factors are at play.');
  });

  test('strips "That must be difficult"', () => {
    const input = 'That must be difficult. The strategy needs restructuring.';
    expect(enforceIdentity(input)).toBe('The strategy needs restructuring.');
  });

  test('strips "That must be frustrating"', () => {
    const input = 'That must be frustrating. Here is what the data shows.';
    expect(enforceIdentity(input)).toBe('Here is what the data shows.');
  });
});

// ── New narrative patterns ───────────────────────────────────────────

describe('IdentityGuard — expanded narrative patterns', () => {
  test('strips "When something like this happens"', () => {
    const input = 'When something like this happens it can feel overwhelming. The actual issue is scope creep.';
    expect(enforceIdentity(input)).toBe('The actual issue is scope creep.');
  });

  test('strips "Situations like this"', () => {
    const input = 'Situations like this tend to feel heavy. The timeline was unrealistic.';
    expect(enforceIdentity(input)).toBe('The timeline was unrealistic.');
  });

  test('strips "In moments like these"', () => {
    const input = 'In moments like these, clarity matters most. The budget was the constraint.';
    expect(enforceIdentity(input)).toBe('The budget was the constraint.');
  });

  test('strips "There are times"', () => {
    const input = 'There are times when things fall apart. The root issue was alignment.';
    expect(enforceIdentity(input)).toBe('The root issue was alignment.');
  });
});

// ── Semantic therapist detection ─────────────────────────────────────

describe('IdentityGuard — semantic therapist detection', () => {
  test('replaces emotional-first sentence without factual nouns', () => {
    const input = "It's really difficult right now. The team needs a new approach.";
    const result = enforceIdentity(input);
    expect(result).toContain('The situation suggests a breakdown in the process.');
    expect(result).toContain('The team needs a new approach.');
  });

  test('replaces sentence with "feeling" and no factual context', () => {
    const input = 'You might be feeling overwhelmed. Three things are happening.';
    const result = enforceIdentity(input);
    expect(result).toContain('The situation suggests a breakdown in the process.');
    expect(result).toContain('Three things are happening.');
  });

  test('preserves sentence with emotional word AND factual noun', () => {
    const input = 'The difficult part of the process was the timeline. That caused delay.';
    expect(enforceIdentity(input)).toBe(input);
  });

  test('preserves sentence mentioning demo even with emotional word', () => {
    const input = 'The demo felt painful to watch. The pitch was unclear.';
    expect(enforceIdentity(input)).toBe(input);
  });
});

// ── Emotional question rewrite ───────────────────────────────────────

describe('IdentityGuard — emotional question rewrite', () => {
  test('rewrites "How do you feel about" questions', () => {
    const input = 'The demo failed. How do you feel about that?';
    const result = enforceIdentity(input);
    expect(result).not.toContain('feel');
    expect(result).toContain('What part of the situation caused that outcome?');
  });

  test('rewrites "What emotions" questions', () => {
    const input = 'The project stalled. What emotions are you experiencing?';
    const result = enforceIdentity(input);
    expect(result).toContain('What part of the situation caused that outcome?');
  });

  test('preserves structural diagnostic questions', () => {
    const input = 'What part of the process broke down?';
    expect(enforceIdentity(input)).toBe(input);
  });

  test('preserves analytical questions without emotional words', () => {
    const input = 'Which of the three factors was most relevant?';
    expect(enforceIdentity(input)).toBe(input);
  });
});

// ── Multi-pass and stability ─────────────────────────────────────────

describe('IdentityGuard — multi-pass and stability', () => {
  test('two-pass correction: therapist then narrative', () => {
    const input = 'That must feel hard. Sometimes in life things go wrong. The real issue is prioritization.';
    expect(enforceIdentity(input)).toBe('The real issue is prioritization.');
  });

  test('two-pass correction: two therapist sentences', () => {
    const input = "I understand how you're feeling. It's understandable that this is hard. The data is clear.";
    expect(enforceIdentity(input)).toBe('The data is clear.');
  });

  test('already-correct analytical response is unchanged', () => {
    const input = 'The strategy has three weaknesses:\n1. Market fit\n2. Pricing\n3. Distribution';
    expect(enforceIdentity(input)).toBe(input);
  });

  test('already-correct direct question is unchanged', () => {
    const input = 'What specifically caused the outcome?';
    expect(enforceIdentity(input)).toBe(input);
  });

  test('guard is stable on empty input', () => {
    expect(enforceIdentity('')).toBe('');
  });

  test('guard is stable on single analytical sentence', () => {
    const input = 'The pitch needs restructuring.';
    expect(enforceIdentity(input)).toBe(input);
  });

  test('guard does not over-process clean responses', () => {
    const input = 'The demo failed. That usually happens for one of three reasons:\n1) unclear value\n2) wrong audience\n3) weak advantage.\n\nWhich one was it?';
    expect(enforceIdentity(input)).toBe(input);
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
