// src/emotion-core/narrative/NarrativeStateEngine.ts

/* ================================================================
 * Narrative State Engine (NSE)
 *
 * Gives LoRa conversational momentum, emotional trajectory awareness,
 * and strategy rotation. Deterministic, stateful per-session, ≤400 lines.
 *
 * Does NOT touch: ETV/EIV math, memory persistence, persona enforcement.
 * ================================================================ */

export type EmotionalTrajectory = 'rising' | 'stable' | 'decreasing';

export type ConversationPhase =
  | 'opening'
  | 'probing'
  | 'clarifying'
  | 'deepening';

export type NarrativeStrategy =
  | 'validation'
  | 'exploration'
  | 'synthesis'
  | 'grounding'
  | 'reframing'
  | 'clarification'
  | 'planning';

export interface NarrativeState {
  dominantTheme: string | null;
  emotionalTrajectory: EmotionalTrajectory;
  currentPhase: ConversationPhase;
  lastStrategy: NarrativeStrategy;
  turnsInPhase: number;
}

export interface NarrativeInput {
  userText: string;
  eiv: number;
}

export interface NarrativeMomentumBlock {
  dominantTheme: string | null;
  emotionalTrajectory: EmotionalTrajectory;
  currentPhase: ConversationPhase;
  suggestedStrategy: NarrativeStrategy;
}

/* ================================================================
 * Theme Extraction — keyword heuristic map
 *
 * Scans the most recent turns for thematic keywords.
 * Returns the theme with the highest hit count, or null.
 * ================================================================ */

const THEME_KEYWORDS: ReadonlyArray<{
  theme: string;
  keywords: ReadonlyArray<string>;
}> = [
  {
    theme: 'work',
    keywords: [
      'work', 'job', 'career', 'office', 'boss', 'coworker', 'colleague',
      'promotion', 'deadline', 'meeting', 'project', 'fired', 'hired',
      'salary', 'overwhelmed at work', 'manager', 'team', 'corporate',
      'commute', 'burnout', 'workload',
    ],
  },
  {
    theme: 'mistake',
    keywords: [
      'mistake', 'messed up', 'wrong', 'fault', 'regret', 'screwed up',
      'failed', 'failure', 'error', 'blew it', 'messed something up',
      'ruined', 'dropped the ball', 'let down',
    ],
  },
  {
    theme: 'relationship',
    keywords: [
      'relationship', 'partner', 'boyfriend', 'girlfriend', 'husband',
      'wife', 'spouse', 'dating', 'breakup', 'marriage', 'divorce',
      'ex', 'crush', 'cheated', 'argument', 'fight with',
    ],
  },
  {
    theme: 'health',
    keywords: [
      'health', 'sick', 'doctor', 'hospital', 'pain', 'medication',
      'therapy', 'anxious', 'anxiety', 'depressed', 'depression',
      'sleep', 'tired', 'exhausted', 'panic', 'insomnia', 'illness',
    ],
  },
  {
    theme: 'family',
    keywords: [
      'family', 'parent', 'mom', 'dad', 'mother', 'father', 'sibling',
      'brother', 'sister', 'child', 'kids', 'son', 'daughter',
      'grandparent', 'uncle', 'aunt',
    ],
  },
  {
    theme: 'identity',
    keywords: [
      'identity', 'purpose', 'meaning', 'who am i', 'lost', 'direction',
      'stuck', 'uncertain', 'confused', 'self-worth', 'confidence',
      'belong', 'not good enough',
    ],
  },
  {
    theme: 'loss',
    keywords: [
      'loss', 'grief', 'death', 'died', 'gone', 'mourning', 'funeral',
      'passed away', 'miss them',
    ],
  },
  {
    theme: 'change',
    keywords: [
      'change', 'transition', 'moving', 'starting over', 'ending',
      'new chapter', 'relocating', 'graduating', 'quitting',
    ],
  },
];

export function extractTheme(texts: string[]): string | null {
  if (texts.length === 0) return null;
  const combined = texts.map(t => t.toLowerCase()).join(' ');
  const scores = new Map<string, number>();

  for (const { theme, keywords } of THEME_KEYWORDS) {
    let count = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) count++;
    }
    if (count > 0) scores.set(theme, count);
  }

  if (scores.size === 0) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const [theme, score] of scores) {
    if (score > bestScore) {
      best = theme;
      bestScore = score;
    }
  }
  return best;
}

/* ================================================================
 * Emotional Trajectory — deterministic from EIV window
 *
 * Uses last 3 EIV values:
 *   strictly increasing → rising
 *   strictly decreasing → decreasing
 *   else → stable
 * ================================================================ */

export function computeTrajectory(eivHistory: number[]): EmotionalTrajectory {
  if (eivHistory.length < 2) return 'stable';

  const recent = eivHistory.slice(-3);
  if (recent.length < 2) return 'stable';

  let allRising = true;
  let allDecreasing = true;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i] <= recent[i - 1]) allRising = false;
    if (recent[i] >= recent[i - 1]) allDecreasing = false;
  }

  if (allRising) return 'rising';
  if (allDecreasing) return 'decreasing';
  return 'stable';
}

/* ================================================================
 * Concrete Event Detection — heuristic
 *
 * Checks for personal action verbs in past tense and
 * time references that indicate a specific event.
 * ================================================================ */

const EVENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bi\s+(?:told|said|went|did|had|made|met|found|lost|got|called|tried|quit|left|started|forgot|broke|missed)\b/i,
  /\b(?:yesterday|today|last week|this morning|this evening|last night|earlier|recently|just now|last month)\b/i,
  /\b(?:happened|occurred|realized|discovered|noticed)\b/i,
];

export function containsConcreteEvent(text: string): boolean {
  return EVENT_PATTERNS.some(p => p.test(text));
}

/* ================================================================
 * Strategy Matrix (deterministic)
 *
 *  Phase       | rising      | stable        | decreasing
 *  ------------|-------------|---------------|------------
 *  opening     | validation  | validation    | validation
 *  probing     | synthesis   | exploration   | reframing
 *  clarifying  | synthesis   | clarification | grounding
 *  deepening   | grounding   | reframing     | planning
 * ================================================================ */

export const STRATEGY_MATRIX: Record<
  ConversationPhase,
  Record<EmotionalTrajectory, NarrativeStrategy>
> = {
  opening:    { rising: 'validation',  stable: 'validation',    decreasing: 'validation' },
  probing:    { rising: 'synthesis',   stable: 'exploration',   decreasing: 'reframing' },
  clarifying: { rising: 'synthesis',   stable: 'clarification', decreasing: 'grounding' },
  deepening:  { rising: 'grounding',   stable: 'reframing',     decreasing: 'planning' },
};

const STRATEGY_FALLBACK_ORDER: ReadonlyArray<NarrativeStrategy> = [
  'exploration',
  'synthesis',
  'grounding',
  'reframing',
  'clarification',
  'planning',
  'validation',
];

export function selectStrategy(
  phase: ConversationPhase,
  trajectory: EmotionalTrajectory,
  lastStrategy: NarrativeStrategy,
): NarrativeStrategy {
  const primary = STRATEGY_MATRIX[phase][trajectory];
  if (primary !== lastStrategy) return primary;

  for (const fallback of STRATEGY_FALLBACK_ORDER) {
    if (fallback !== lastStrategy) return fallback;
  }
  return primary;
}

/* ================================================================
 * Phase Progression (deterministic, no backward unless theme changes)
 *
 *  - New conversation → opening
 *  - After 2 turns same theme → probing
 *  - User reveals concrete event → clarifying
 *  - Intensity rising + specific event → deepening
 *  - Theme change → reset to opening
 * ================================================================ */

export const PHASE_TURN_THRESHOLD = 2;

export function advancePhase(
  current: ConversationPhase,
  turnsInPhase: number,
  themeChanged: boolean,
  hasConcreteEvent: boolean,
  trajectory: EmotionalTrajectory,
): ConversationPhase {
  if (themeChanged) return 'opening';

  switch (current) {
    case 'opening':
      if (turnsInPhase >= PHASE_TURN_THRESHOLD) return 'probing';
      return current;
    case 'probing':
      if (hasConcreteEvent) return 'clarifying';
      return current;
    case 'clarifying':
      if (trajectory === 'rising' && hasConcreteEvent) return 'deepening';
      if (turnsInPhase >= PHASE_TURN_THRESHOLD + 1) return 'deepening';
      return current;
    case 'deepening':
      return current;
    default:
      return current;
  }
}

/* ================================================================
 * NarrativeStateEngine — main class
 *
 * Stateful per-session. Call advance() once per user message.
 * Call reset() on session boundary.
 * ================================================================ */

const EIV_WINDOW = 3;
const TEXT_WINDOW = 3;

export class NarrativeStateEngine {
  private state: NarrativeState;
  private recentTexts: string[] = [];
  private eivHistory: number[] = [];

  constructor() {
    this.state = {
      dominantTheme: null,
      emotionalTrajectory: 'stable',
      currentPhase: 'opening',
      lastStrategy: 'validation',
      turnsInPhase: 0,
    };
  }

  advance(input: NarrativeInput): Readonly<NarrativeState> {
    const { userText, eiv } = input;

    this.recentTexts.push(userText);
    while (this.recentTexts.length > TEXT_WINDOW) this.recentTexts.shift();
    this.eivHistory.push(eiv);
    while (this.eivHistory.length > EIV_WINDOW) this.eivHistory.shift();

    const previousTheme = this.state.dominantTheme;
    const dominantTheme = extractTheme(this.recentTexts);

    const emotionalTrajectory = computeTrajectory(this.eivHistory);

    const themeChanged =
      dominantTheme !== null &&
      previousTheme !== null &&
      dominantTheme !== previousTheme;

    const hasConcreteEvent = containsConcreteEvent(userText);

    const newPhase = advancePhase(
      this.state.currentPhase,
      this.state.turnsInPhase,
      themeChanged,
      hasConcreteEvent,
      emotionalTrajectory,
    );

    const turnsInPhase =
      newPhase === this.state.currentPhase
        ? this.state.turnsInPhase + 1
        : 1;

    const lastStrategy = selectStrategy(
      newPhase,
      emotionalTrajectory,
      this.state.lastStrategy,
    );

    this.state = {
      dominantTheme,
      emotionalTrajectory,
      currentPhase: newPhase,
      lastStrategy,
      turnsInPhase,
    };

    return this.state;
  }

  toMomentumBlock(): NarrativeMomentumBlock {
    return {
      dominantTheme: this.state.dominantTheme,
      emotionalTrajectory: this.state.emotionalTrajectory,
      currentPhase: this.state.currentPhase,
      suggestedStrategy: this.state.lastStrategy,
    };
  }

  getState(): Readonly<NarrativeState> {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      dominantTheme: null,
      emotionalTrajectory: 'stable',
      currentPhase: 'opening',
      lastStrategy: 'validation',
      turnsInPhase: 0,
    };
    this.recentTexts = [];
    this.eivHistory = [];
  }
}
