export type ETVBandHint = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';

export type MemoryV1Policy = {
  band: ETVBandHint;

  allowPromptInjection: boolean;

  maxSchemasInPrompt: 0 | 1 | 2 | 3;
  allowTendencyLabel: boolean;
  allowTrajectoryLabel: boolean;
  allowSessionPattern: boolean;

  forbidCompanionship: true;
};
