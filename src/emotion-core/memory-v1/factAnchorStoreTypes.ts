import type { FactAnchor } from './factAnchorTypes';

export interface FactAnchorStoreState {
  confirmed: FactAnchor[];
  quarantined: FactAnchor[];
  sessionSeen: Record<string, true>;
  sessionAnchorCount: Record<string, number>;
  lastMaintenanceSessionId?: string;
  quarantineMeta: Record<string, { birthMaintainCount: number }>;
}

export interface UpsertInput {
  userId: string;
  sessionId: string;
  nowMs: number;
  extracted: FactAnchor[];
  maxAnchorsPerMessage?: number;
  maxAnchorsPerSession?: number;
}

export interface UpsertResult {
  createdConfirmed: number;
  createdQuarantined: number;
  reinforcedConfirmed: number;
  reinforcedQuarantined: number;
  promotedToConfirmed: number;
  evictedConfirmed: number;
  evictedQuarantined: number;
  rejectedByCap: number;
  rejectedByTemplate: number;
  rejectedByType: number;
}

export interface MaintainInput {
  sessionId: string;
  nowMs: number;
}

export interface MaintainReport {
  expiredConfirmed: number;
  expiredQuarantined: number;
  evictedConfirmed: number;
  evictedQuarantined: number;
  promotedToConfirmed: number;
}

export interface GetCandidatesInput {
  nowMs: number;
}

export interface FactAnchorStore {
  init(): FactAnchorStoreState;

  upsertFromExtraction(
    state: FactAnchorStoreState,
    input: UpsertInput,
  ): { nextState: FactAnchorStoreState; results: UpsertResult };

  getCandidates(
    state: FactAnchorStoreState,
    input: GetCandidatesInput,
  ): FactAnchor[];

  maintain(
    state: FactAnchorStoreState,
    input: MaintainInput,
  ): { nextState: FactAnchorStoreState; report: MaintainReport };

  purgeAll(): FactAnchorStoreState;

  exportAll(
    state: FactAnchorStoreState,
  ): { confirmed: FactAnchor[]; quarantined: FactAnchor[] };
}
