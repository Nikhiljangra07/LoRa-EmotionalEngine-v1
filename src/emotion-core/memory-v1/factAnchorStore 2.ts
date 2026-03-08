import type { FactAnchor } from './factAnchorTypes';
import {
  MAX_ANCHORS_CONFIRMED,
  MAX_ANCHORS_QUARANTINED,
  QUARANTINE_THRESHOLD,
} from './factAnchorTypes';
import { transitionAnchorStatus } from './anchorLifecycle';
import type {
  FactAnchorStore,
  FactAnchorStoreState,
  UpsertInput,
  UpsertResult,
  MaintainInput,
  MaintainReport,
  GetCandidatesInput,
} from './factAnchorStoreTypes';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anchorKey(a: FactAnchor): string {
  return `${a.type}|${a.summary.template}|${a.summary.slot}|${a.date ?? 'na'}`;
}

function isUpcomingWithin7Days(a: FactAnchor, nowMs: number): boolean {
  if (a.type !== 'date_event' || !a.date) return false;
  const dateMs = new Date(a.date).getTime();
  if (!Number.isFinite(dateMs)) return false;
  const diff = dateMs - nowMs;
  return diff >= 0 && diff <= SEVEN_DAYS_MS;
}

function priorityScore(a: FactAnchor, nowMs: number): number {
  return (
    a.reinforceCount * 10 +
    a.appearsInSessions * 5 +
    (isUpcomingWithin7Days(a, nowMs) ? 3 : 0)
  );
}

function deepCopyAnchor(a: FactAnchor): FactAnchor {
  return {
    ...a,
    summary: { ...a.summary },
    emotionVecAtCreation: [...a.emotionVecAtCreation],
  };
}

function deepCopyAnchors(arr: FactAnchor[]): FactAnchor[] {
  return arr.map(deepCopyAnchor);
}

function emptyState(): FactAnchorStoreState {
  return {
    confirmed: [],
    quarantined: [],
    sessionSeen: {},
    sessionAnchorCount: {},
    quarantineMeta: {},
  };
}

function enforceConfirmedCap(
  confirmed: FactAnchor[],
  nowMs: number,
): { kept: FactAnchor[]; evicted: number } {
  if (confirmed.length <= MAX_ANCHORS_CONFIRMED) {
    return { kept: confirmed, evicted: 0 };
  }
  const numToEvict = confirmed.length - MAX_ANCHORS_CONFIRMED;
  const entries = confirmed.map((a, i) => ({
    idx: i,
    priority: priorityScore(a, nowMs),
    id: a.anchorId,
  }));
  entries.sort((x, y) => {
    if (x.priority !== y.priority) return x.priority - y.priority;
    return x.id.localeCompare(y.id);
  });
  const evictSet = new Set(entries.slice(0, numToEvict).map((e) => e.idx));
  const kept = confirmed.filter((_, i) => !evictSet.has(i));
  return { kept, evicted: numToEvict };
}

function enforceQuarantinedCap(
  quarantined: FactAnchor[],
): { kept: FactAnchor[]; evicted: number; removedIds: string[] } {
  if (quarantined.length <= MAX_ANCHORS_QUARANTINED) {
    return { kept: quarantined, evicted: 0, removedIds: [] };
  }
  const numToEvict = quarantined.length - MAX_ANCHORS_QUARANTINED;
  const entries = quarantined.map((a, i) => ({
    idx: i,
    createdAt: a.createdAt,
    id: a.anchorId,
  }));
  entries.sort((x, y) => {
    if (x.createdAt !== y.createdAt) return x.createdAt - y.createdAt;
    return x.id.localeCompare(y.id);
  });
  const evictEntries = entries.slice(0, numToEvict);
  const evictSet = new Set(evictEntries.map((e) => e.idx));
  const kept = quarantined.filter((_, i) => !evictSet.has(i));
  return {
    kept,
    evicted: numToEvict,
    removedIds: evictEntries.map((e) =>
      quarantined[e.idx].anchorId,
    ),
  };
}

function buildKeyMap(anchors: FactAnchor[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < anchors.length; i++) {
    m.set(anchorKey(anchors[i]), i);
  }
  return m;
}

function cleanMeta(
  meta: Record<string, { birthMaintainCount: number }>,
  removedIds: string[],
): Record<string, { birthMaintainCount: number }> {
  if (removedIds.length === 0) return meta;
  const next = { ...meta };
  for (const id of removedIds) {
    delete next[id];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInMemoryFactAnchorStore(): FactAnchorStore {
  return {
    init: emptyState,
    purgeAll: emptyState,

    upsertFromExtraction(
      state: FactAnchorStoreState,
      input: UpsertInput,
    ): { nextState: FactAnchorStoreState; results: UpsertResult } {
      const {
        sessionId,
        nowMs,
        extracted,
        maxAnchorsPerMessage = 1,
        maxAnchorsPerSession = 3,
      } = input;

      const results: UpsertResult = {
        createdConfirmed: 0,
        createdQuarantined: 0,
        reinforcedConfirmed: 0,
        reinforcedQuarantined: 0,
        promotedToConfirmed: 0,
        evictedConfirmed: 0,
        evictedQuarantined: 0,
        rejectedByCap: 0,
        rejectedByTemplate: 0,
        rejectedByType: 0,
      };

      if (extracted.length === 0) {
        return { nextState: state, results };
      }

      const afterMessageCap = extracted.slice(0, maxAnchorsPerMessage);
      results.rejectedByCap += extracted.length - afterMessageCap.length;

      const currentSessionCount = state.sessionAnchorCount[sessionId] ?? 0;
      const sessionRemaining = maxAnchorsPerSession - currentSessionCount;

      if (sessionRemaining <= 0) {
        results.rejectedByCap += afterMessageCap.length;
        return { nextState: state, results };
      }

      const toProcess = afterMessageCap.slice(0, sessionRemaining);
      results.rejectedByCap += afterMessageCap.length - toProcess.length;

      let confirmed = [...state.confirmed];
      let quarantined = [...state.quarantined];
      let meta = { ...state.quarantineMeta };

      for (const ext of toProcess) {
        const key = anchorKey(ext);

        const cMap = buildKeyMap(confirmed);
        const qMap = buildKeyMap(quarantined);
        const cIdx = cMap.get(key);
        const qIdx = cIdx === undefined ? qMap.get(key) : undefined;

        if (cIdx !== undefined) {
          const old = confirmed[cIdx];
          const updated: FactAnchor = {
            ...old,
            reinforceCount: old.reinforceCount + 1,
          };
          if (sessionId !== old.lastSeenSessionId) {
            updated.appearsInSessions = old.appearsInSessions + 1;
            updated.lastSeenSessionId = sessionId;
          }
          confirmed = confirmed.map((a, i) => (i === cIdx ? updated : a));
          results.reinforcedConfirmed++;
        } else if (qIdx !== undefined) {
          const old = quarantined[qIdx];
          const updated: FactAnchor = {
            ...old,
            reinforceCount: old.reinforceCount + 1,
          };
          if (sessionId !== old.lastSeenSessionId) {
            updated.appearsInSessions = old.appearsInSessions + 1;
            updated.lastSeenSessionId = sessionId;
          }
          const transitioned = transitionAnchorStatus(updated);
          if (transitioned.status === 'confirmed') {
            quarantined = quarantined.filter((_, i) => i !== qIdx);
            confirmed = [...confirmed, transitioned];
            meta = cleanMeta(meta, [transitioned.anchorId]);
            results.reinforcedQuarantined++;
            results.promotedToConfirmed++;
          } else {
            quarantined = quarantined.map((a, i) =>
              i === qIdx ? updated : a,
            );
            results.reinforcedQuarantined++;
          }
        } else {
          const anchor = deepCopyAnchor(ext);
          if (anchor.extractionConfidence < QUARANTINE_THRESHOLD) {
            anchor.status = 'quarantined';
            quarantined = [...quarantined, anchor];
            meta = {
              ...meta,
              [anchor.anchorId]: {
                birthMaintainCount: Object.keys(state.sessionSeen).length,
              },
            };
            results.createdQuarantined++;
          } else {
            anchor.status = 'confirmed';
            confirmed = [...confirmed, anchor];
            results.createdConfirmed++;
          }
        }
      }

      const qCap = enforceQuarantinedCap(quarantined);
      quarantined = qCap.kept;
      results.evictedQuarantined += qCap.evicted;
      meta = cleanMeta(meta, qCap.removedIds);

      const cCap = enforceConfirmedCap(confirmed, nowMs);
      confirmed = cCap.kept;
      results.evictedConfirmed += cCap.evicted;

      return {
        nextState: {
          ...state,
          confirmed,
          quarantined,
          sessionAnchorCount: {
            ...state.sessionAnchorCount,
            [sessionId]: currentSessionCount + toProcess.length,
          },
          quarantineMeta: meta,
        },
        results,
      };
    },

    getCandidates(
      state: FactAnchorStoreState,
      input: GetCandidatesInput,
    ): FactAnchor[] {
      const { nowMs } = input;
      const candidates = deepCopyAnchors(state.confirmed);
      candidates.sort((a, b) => {
        const aUp = isUpcomingWithin7Days(a, nowMs) ? 1 : 0;
        const bUp = isUpcomingWithin7Days(b, nowMs) ? 1 : 0;
        if (bUp !== aUp) return bUp - aUp;
        if (b.reinforceCount !== a.reinforceCount)
          return b.reinforceCount - a.reinforceCount;
        if (b.appearsInSessions !== a.appearsInSessions)
          return b.appearsInSessions - a.appearsInSessions;
        if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
        return a.anchorId.localeCompare(b.anchorId);
      });
      return candidates;
    },

    maintain(
      state: FactAnchorStoreState,
      input: MaintainInput,
    ): { nextState: FactAnchorStoreState; report: MaintainReport } {
      const { sessionId, nowMs } = input;
      const report: MaintainReport = {
        expiredConfirmed: 0,
        expiredQuarantined: 0,
        evictedConfirmed: 0,
        evictedQuarantined: 0,
        promotedToConfirmed: 0,
      };

      const sessionSeen: Record<string, true> = {
        ...state.sessionSeen,
        [sessionId]: true,
      };
      const currentMaintainCount = Object.keys(sessionSeen).length;
      let meta = { ...state.quarantineMeta };

      // --- Quarantine expiry ---
      const surviving: FactAnchor[] = [];
      const expiredIds: string[] = [];
      for (const a of state.quarantined) {
        const m = meta[a.anchorId];
        const sinceBirth = m
          ? currentMaintainCount - m.birthMaintainCount
          : currentMaintainCount;
        if (
          sinceBirth >= 3 &&
          a.lastSeenSessionId !== sessionId &&
          a.reinforceCount === 1
        ) {
          report.expiredQuarantined++;
          expiredIds.push(a.anchorId);
        } else {
          surviving.push(a);
        }
      }
      meta = cleanMeta(meta, expiredIds);

      // --- Promotion pass ---
      let confirmed = [...state.confirmed];
      const afterPromotion: FactAnchor[] = [];
      const promotedIds: string[] = [];
      for (const a of surviving) {
        const t = transitionAnchorStatus(a);
        if (t.status === 'confirmed') {
          confirmed.push(t);
          report.promotedToConfirmed++;
          promotedIds.push(t.anchorId);
        } else {
          afterPromotion.push(a);
        }
      }
      let quarantined = afterPromotion;
      meta = cleanMeta(meta, promotedIds);

      // --- Enforce caps ---
      const qCap = enforceQuarantinedCap(quarantined);
      quarantined = qCap.kept;
      report.evictedQuarantined += qCap.evicted;
      meta = cleanMeta(meta, qCap.removedIds);

      const cCap = enforceConfirmedCap(confirmed, nowMs);
      confirmed = cCap.kept;
      report.evictedConfirmed += cCap.evicted;

      return {
        nextState: {
          ...state,
          confirmed,
          quarantined,
          sessionSeen,
          lastMaintenanceSessionId: sessionId,
          quarantineMeta: meta,
        },
        report,
      };
    },

    exportAll(state: FactAnchorStoreState) {
      return {
        confirmed: deepCopyAnchors(state.confirmed),
        quarantined: deepCopyAnchors(state.quarantined),
      };
    },
  };
}
