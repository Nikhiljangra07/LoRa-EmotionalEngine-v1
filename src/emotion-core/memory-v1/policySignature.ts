import type { MemoryV1Policy } from './policyTypes';

export function computeMemoryV1PolicySignature(policy: MemoryV1Policy): string {
  return [
    policy.band,
    `inject=${policy.allowPromptInjection ? 'Y' : 'N'}`,
    `max=${policy.maxSchemasInPrompt}`,
    `traj=${policy.allowTrajectoryLabel ? 'Y' : 'N'}`,
    `tend=${policy.allowTendencyLabel ? 'Y' : 'N'}`,
    `pattern=${policy.allowSessionPattern ? 'Y' : 'N'}`,
  ].join(':');
}
