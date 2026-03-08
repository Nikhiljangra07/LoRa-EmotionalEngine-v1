// src/emotion-core/etv/sessionSummary.ts

import type { SessionSummaryV1 } from './types';

/**
 * Pure function that builds a SessionSummaryV1 from raw session buffers.
 *
 * Handles empty/short buffers safely — callers need not guard against
 * zero-length arrays.
 */
export function buildSessionSummary(params: {
  sessionId: string;
  userId: string;
  startedAt: number;
  endedAt: number;
  messageCount: number;
  eivBuffer: readonly number[];
  aviBuffer: readonly number[];
  hasViolation: boolean;
}): SessionSummaryV1 {
  const { sessionId, userId, startedAt, endedAt, messageCount, eivBuffer, aviBuffer, hasViolation } = params;

  const eivMean = eivBuffer.length > 0
    ? eivBuffer.reduce((a, b) => a + b, 0) / eivBuffer.length
    : 0;
  const eivMax = eivBuffer.length > 0
    ? Math.max(...eivBuffer)
    : 0;
  const aviMean = aviBuffer.length > 0
    ? aviBuffer.reduce((a, b) => a + b, 0) / aviBuffer.length
    : 0;
  const aviMax = aviBuffer.length > 0
    ? Math.max(...aviBuffer)
    : 0;

  return {
    sessionId,
    userId,
    startedAt,
    endedAt,
    messageCount,
    eivMean,
    eivMax,
    aviMean,
    aviMax,
    hasViolation,
  };
}
