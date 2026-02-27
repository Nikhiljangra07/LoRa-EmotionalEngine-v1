export interface EmotionSignal {
  valence: number;
  arousal: number;
  expressionStrength: number;
  inferenceReliability: number;
}

export type EmotionBand = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';

export interface EmotionalMetrics {
  etv: number;
  eiv: number;
  band?: EmotionBand;
}

export interface MemorySaveInput {
  userId: string;
  messageId: string;
  content: string;
  timestamp: number;
  emotion: EmotionSignal;
  metrics: EmotionalMetrics;
}

export interface AnchorRecord {
  anchorId: string;
  contentSummary: string;
  timestamp: number;
  emotion: EmotionSignal;
  metrics: EmotionalMetrics;
}

export interface SemanticRecord {
  schemaId: string;
  salienceWeight: number;
  episodeCount: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface MemoryContextResult {
  anchors: AnchorRecord[];
  semantic: SemanticRecord[];
  degraded: { falkor: boolean; chroma: boolean };
}

const CONTENT_SUMMARY_MAX = 240;

export function contentSummary(content: string): string {
  return content.length <= CONTENT_SUMMARY_MAX
    ? content
    : content.slice(0, CONTENT_SUMMARY_MAX);
}

export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return val < min ? min : val > max ? max : val;
}

export function validateEmotionSignal(raw: EmotionSignal): EmotionSignal {
  return {
    valence: clamp(raw.valence, -1, 1),
    arousal: clamp(raw.arousal, 0, 1),
    expressionStrength: clamp(raw.expressionStrength, 0, 1),
    inferenceReliability: clamp(raw.inferenceReliability, 0, 1),
  };
}

export function validateMetrics(raw: EmotionalMetrics): EmotionalMetrics {
  const out: EmotionalMetrics = {
    etv: clamp(raw.etv, 0, 100),
    eiv: clamp(raw.eiv, 0, 100),
  };
  if (raw.band !== undefined) {
    out.band = raw.band;
  }
  return out;
}
