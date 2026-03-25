/**
 * Types for Multi-Perspective Engine bridge.
 *
 * These mirror the Python FastAPI response models in LoRaMaths/src/server.py.
 * Any change to the Python response schema MUST be reflected here.
 */

// ---------------------------------------------------------------------------
// Request (sent TO LoRaMaths)
// ---------------------------------------------------------------------------

export interface PerspectiveConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PerspectiveAnalyzeRequest {
  text: string;
  conversation_context: PerspectiveConversationTurn[];
  known_variables: string[];
  domain: string | null;
  mode?: 'quick' | 'deep';
}

// ---------------------------------------------------------------------------
// Response (received FROM LoRaMaths)
// ---------------------------------------------------------------------------

export interface PerspectiveConsequence {
  timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
  description: string;
  likelihood: 'likely' | 'possible' | 'unlikely';
  reversible: boolean;
}

export type FrameworkType =
  | 'regression'
  | 'bayesian'
  | 'game_theory'
  | 'constraint'
  | 'causal_loop';

export interface PerspectiveResult {
  framework: FrameworkType;
  label: string;
  condensed: string;
  strength: number;
  consequences: PerspectiveConsequence[];
  blind_spots: string[];
}

export interface PerspectiveAnalyzeResponse {
  perspectives: PerspectiveResult[];
  tension: string;
  decision_point: string;
  frameworks_used: FrameworkType[];
  classification_reasoning: string;
  classification_confidence: number;
  anti_creep_passed: boolean;
  diversity_score: number;
  processing_time_ms: number;
}
