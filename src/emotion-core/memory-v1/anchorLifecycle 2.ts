import type { FactAnchor } from './factAnchorTypes';

export function shouldPromoteAnchor(anchor: FactAnchor): boolean {
  if (anchor.reinforceCount >= 2) return true;
  if (
    anchor.reinforceCount >= 1 &&
    anchor.extractionConfidence >= 0.80 &&
    anchor.appearsInSessions >= 2
  ) {
    return true;
  }
  return false;
}

export function shouldExpireQuarantinedAnchor(
  anchor: FactAnchor,
  currentSessionId: string,
): boolean {
  if (anchor.status !== 'quarantined') return false;
  if (anchor.appearsInSessions >= 3) return false;
  if (
    anchor.appearsInSessions < 3 &&
    anchor.lastSeenSessionId !== currentSessionId &&
    anchor.reinforceCount === 1
  ) {
    return true;
  }
  return false;
}

export function transitionAnchorStatus(anchor: FactAnchor): FactAnchor {
  if (anchor.status === 'quarantined' && shouldPromoteAnchor(anchor)) {
    return { ...anchor, status: 'confirmed' };
  }
  return anchor;
}
