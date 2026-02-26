export type EncoderMode = 'baseline' | 'enhanced';

export type DominantEmotion =
  | 'JOY'
  | 'SADNESS'
  | 'ANGER'
  | 'FEAR'
  | 'CONTENTMENT'
  | 'NEUTRAL';

export type DimSpec = {
  dim: number;
  name: string;
  rawRange: [number, number] | null;
  clamp: [number, number] | null;
  transform: 'identity' | 'valenceTo01' | 'tanh01' | 'tanhSignedTo01';
  tanhDivisor?: number;
  fallback: number;
};

export type BlockName = 'scalars' | 'onehot' | 'momentum' | 'appraisal';

export type BlockWeights = Record<BlockName, number>;

export type EncoderInput = {
  eivValue?: number;
  valenceScore?: number;
  arousalScore?: number;
  expressionStrength?: number;
  dominantEmotion?: DominantEmotion;
  avi?: number;
  valenceBias?: number;
  arousalBias?: number;
  momentumConfidence?: number;

  pressureScalar?: number;
  pressureSlope?: number;
  pressureVolatility?: number;
  moodDominance?: number;
  escalationScore?: number;
  collapseSeverity?: number;
  agencyDeficit?: number;

  appraisalBridgeEnabled?: boolean;
};

export type EncodedEvent = {
  mode: EncoderMode;
  emotionVec: number[];
  dimSummary: {
    topDims: Array<{ dim: number; name: string; value: number }>;
  };
};

export type SalienceInput = {
  eivValue: number;
  avi: number;
  escalationScore?: number;
  appraisalBridgeEnabled: boolean;
  hasViolation: boolean;
  collapseEvent: boolean;
};

export type SalienceResult = {
  salience: number;
  shouldWrite: boolean;
  overrideReason: 'NONE' | 'VIOLATION' | 'COLLAPSE';
};
