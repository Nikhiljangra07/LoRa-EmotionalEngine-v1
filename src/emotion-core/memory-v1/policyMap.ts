import type { ETVBandHint, MemoryV1Policy } from './policyTypes';

const POLICY_TABLE: Record<ETVBandHint, MemoryV1Policy> = {
  B0: {
    band: 'B0',
    allowPromptInjection: false,
    maxSchemasInPrompt: 0,
    allowTendencyLabel: false,
    allowTrajectoryLabel: false,
    allowSessionPattern: false,
    forbidCompanionship: true,
  },
  B1: {
    band: 'B1',
    allowPromptInjection: false,
    maxSchemasInPrompt: 0,
    allowTendencyLabel: false,
    allowTrajectoryLabel: false,
    allowSessionPattern: false,
    forbidCompanionship: true,
  },
  B2: {
    band: 'B2',
    allowPromptInjection: true,
    maxSchemasInPrompt: 1,
    allowTendencyLabel: false,
    allowTrajectoryLabel: true,
    allowSessionPattern: false,
    forbidCompanionship: true,
  },
  B3: {
    band: 'B3',
    allowPromptInjection: true,
    maxSchemasInPrompt: 2,
    allowTendencyLabel: false,
    allowTrajectoryLabel: true,
    allowSessionPattern: true,
    forbidCompanionship: true,
  },
  B4: {
    band: 'B4',
    allowPromptInjection: true,
    maxSchemasInPrompt: 3,
    allowTendencyLabel: true,
    allowTrajectoryLabel: true,
    allowSessionPattern: true,
    forbidCompanionship: true,
  },
};

export function getMemoryV1Policy(band: ETVBandHint): MemoryV1Policy {
  return POLICY_TABLE[band];
}
