export type {
  EncoderMode,
  DominantEmotion,
  DimSpec,
  BlockName,
  BlockWeights,
  EncoderInput,
  EncodedEvent,
  SalienceInput,
  SalienceResult,
} from './types';

export { MEMORY_V1_CONFIG } from './constants';
export { encodeEvent } from './eventEncoder';
export { computeSalience } from './salience';
export {
  clamp,
  safeNumber,
  valenceTo01,
  tanh01,
  tanhSignedTo01,
  l2Normalize,
  applyDimSpec,
  cosineSimilarity,
} from './normalize';

export type {
  FactAnchorStore,
  FactAnchorStoreState,
  UpsertInput,
  UpsertResult,
  MaintainInput,
  MaintainReport,
  GetCandidatesInput,
} from './factAnchorStoreTypes';

export { createInMemoryFactAnchorStore } from './factAnchorStore';
