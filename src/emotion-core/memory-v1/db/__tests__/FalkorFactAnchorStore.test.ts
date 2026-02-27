import { FalkorFactAnchorStore } from '../FalkorFactAnchorStore';
import { getFalkorClient, getFalkorUrl, resetFalkorClient } from '../falkorClient';
import { createInMemoryFactAnchorStore } from '../../factAnchorStore';
import type { FactAnchor } from '../../factAnchorTypes';
import type { FactAnchorStoreState } from '../../factAnchorStoreTypes';

const DB_ON = process.env.LORA_TEST_DB === '1';

async function assertFalkorReachable(): Promise<void> {
  const url = getFalkorUrl();
  try {
    const client = getFalkorClient();
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error('No PONG');
  } catch {
    resetFalkorClient();
    throw new Error(
      `[FalkorFactAnchorStoreTest] FalkorDB not reachable at ${url}. Start it with: npm run falkor:start`,
    );
  }
}

function makeAnchor(overrides: Partial<FactAnchor> & { anchorId: string; userId: string }): FactAnchor {
  return {
    type: 'goal',
    summary: { template: 'goal_active', slot: 'exercise' },
    salience: 0.75,
    extractionConfidence: 0.75,
    status: 'confirmed',
    emotionVecAtCreation: [0.5, 0.3, 0.8, 0.9],
    sessionId: 'sess-1',
    createdAt: 1700000000000,
    reinforceCount: 1,
    appearsInSessions: 1,
    lastSeenSessionId: 'sess-1',
    ...overrides,
  };
}

(DB_ON ? describe : describe.skip)('FalkorFactAnchorStore (DB)', () => {
  let store: FalkorFactAnchorStore;

  beforeAll(async () => {
    const url = getFalkorUrl();
    if (url.includes('19999')) return;
    await assertFalkorReachable();
    store = new FalkorFactAnchorStore();
  });

  afterEach(async () => {
    if (store) {
      await store.purgeAll('test-user-1');
      await store.purgeAll('test-user-2');
    }
  });

  afterAll(async () => {
    try {
      const c = getFalkorClient();
      if (c.status === 'ready') {
        await c.quit();
      }
    } catch { /* already closed */ }
    resetFalkorClient();
    await new Promise((r) => setTimeout(r, 50));
  });

  // ── roundtrip ──

  it('upsert + getCandidates roundtrip preserves template, slot, status, and counters', async () => {
    if (!store) return;

    const anchor = makeAnchor({
      anchorId: 'a-1',
      userId: 'test-user-1',
      type: 'date_event',
      summary: { template: 'upcoming_event', slot: 'job_interview' },
      date: '2025-07-15',
      reinforceCount: 3,
      appearsInSessions: 2,
    });

    const result = await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [anchor],
    });

    expect(result).not.toBeNull();
    expect(result!.results.createdConfirmed).toBe(1);

    const candidates = await store.getCandidates('test-user-1', { nowMs: Date.now() });
    expect(candidates).not.toBeNull();
    expect(candidates!.length).toBe(1);

    const c = candidates![0];
    expect(c.anchorId).toBe('a-1');
    expect(c.summary.template).toBe('upcoming_event');
    expect(c.summary.slot).toBe('job_interview');
    expect(c.status).toBe('confirmed');
    expect(c.type).toBe('date_event');
    expect(c.date).toBe('2025-07-15');
    expect(c.reinforceCount).toBe(3);
    expect(c.appearsInSessions).toBe(2);
    expect(c.emotionVecAtCreation).toEqual([0.5, 0.3, 0.8, 0.9]);
  });

  // ── both statuses stored ──

  it('stores both confirmed and quarantined anchors', async () => {
    if (!store) return;

    const seedState: FactAnchorStoreState = {
      confirmed: [
        makeAnchor({ anchorId: 'c-1', userId: 'test-user-1', status: 'confirmed' }),
      ],
      quarantined: [
        makeAnchor({
          anchorId: 'q-1',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.50,
          type: 'preference',
          summary: { template: 'preference_negative', slot: 'general_negative' },
        }),
      ],
      sessionSeen: {},
      sessionAnchorCount: {},
      quarantineMeta: {},
    };

    const ok = await store.saveState('test-user-1', seedState);
    expect(ok).toBe(true);

    const exported = await store.exportAll('test-user-1');
    expect(exported).not.toBeNull();
    expect(exported!.confirmed.length).toBe(1);
    expect(exported!.quarantined.length).toBe(1);
    expect(exported!.confirmed[0].anchorId).toBe('c-1');
    expect(exported!.quarantined[0].anchorId).toBe('q-1');
  });

  // ── user isolation ──

  it('different users are isolated', async () => {
    if (!store) return;

    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [makeAnchor({ anchorId: 'u1-a', userId: 'test-user-1' })],
    });

    await store.upsertFromExtraction('test-user-2', {
      userId: 'test-user-2',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [
        makeAnchor({
          anchorId: 'u2-a',
          userId: 'test-user-2',
          type: 'preference',
          summary: { template: 'preference_positive', slot: 'general_positive' },
        }),
      ],
    });

    const c1 = await store.getCandidates('test-user-1', { nowMs: Date.now() });
    const c2 = await store.getCandidates('test-user-2', { nowMs: Date.now() });

    expect(c1).not.toBeNull();
    expect(c1!.length).toBe(1);
    expect(c1![0].anchorId).toBe('u1-a');

    expect(c2).not.toBeNull();
    expect(c2!.length).toBe(1);
    expect(c2![0].anchorId).toBe('u2-a');
  });

  // ── maintain: promotion + expiry via saveState seed ──

  it('maintain promotes eligible quarantined and expires weak ones', async () => {
    if (!store) return;

    const seedState: FactAnchorStoreState = {
      confirmed: [],
      quarantined: [
        makeAnchor({
          anchorId: 'q-strong',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.55,
          reinforceCount: 2,
          appearsInSessions: 2,
          lastSeenSessionId: 'sess-2',
          type: 'goal',
          summary: { template: 'goal_active', slot: 'exercise' },
        }),
        makeAnchor({
          anchorId: 'q-weak',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.50,
          reinforceCount: 1,
          appearsInSessions: 1,
          lastSeenSessionId: 'sess-1',
          type: 'preference',
          summary: { template: 'preference_negative', slot: 'general_negative' },
        }),
      ],
      sessionSeen: { 'sess-1': true, 'sess-2': true, 'sess-3': true },
      sessionAnchorCount: {},
      quarantineMeta: {
        'q-strong': { birthMaintainCount: 0 },
        'q-weak': { birthMaintainCount: 0 },
      },
    };

    const ok = await store.saveState('test-user-1', seedState);
    expect(ok).toBe(true);

    const result = await store.maintain('test-user-1', {
      sessionId: 'sess-4',
      nowMs: 1700000040000,
    });

    expect(result).not.toBeNull();
    expect(result!.report.promotedToConfirmed).toBe(1);
    expect(result!.report.expiredQuarantined).toBe(1);

    const exported = await store.exportAll('test-user-1');
    expect(exported).not.toBeNull();

    const confirmedIds = exported!.confirmed.map((a) => a.anchorId);
    expect(confirmedIds).toContain('q-strong');
    expect(exported!.confirmed.find((a) => a.anchorId === 'q-strong')!.status).toBe('confirmed');

    const quarantinedIds = exported!.quarantined.map((a) => a.anchorId);
    expect(quarantinedIds).not.toContain('q-weak');
  });

  // ── InMemory vs DB maintain parity ──

  it('DB maintain matches InMemory maintain on identical seed state', async () => {
    if (!store) return;

    const seedState: FactAnchorStoreState = {
      confirmed: [
        makeAnchor({
          anchorId: 'c-existing',
          userId: 'test-user-1',
          status: 'confirmed',
          reinforceCount: 3,
        }),
      ],
      quarantined: [
        makeAnchor({
          anchorId: 'q-promote',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.55,
          reinforceCount: 2,
          appearsInSessions: 2,
          lastSeenSessionId: 'sess-2',
          type: 'goal',
          summary: { template: 'goal_active', slot: 'learning' },
        }),
        makeAnchor({
          anchorId: 'q-expire',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.50,
          reinforceCount: 1,
          appearsInSessions: 1,
          lastSeenSessionId: 'sess-1',
          type: 'preference',
          summary: { template: 'preference_positive', slot: 'general_positive' },
        }),
        makeAnchor({
          anchorId: 'q-survive',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.55,
          reinforceCount: 1,
          appearsInSessions: 1,
          lastSeenSessionId: 'sess-4',
          type: 'date_event',
          summary: { template: 'upcoming_event', slot: 'meeting' },
        }),
      ],
      sessionSeen: { 'sess-1': true, 'sess-2': true, 'sess-3': true },
      sessionAnchorCount: {},
      quarantineMeta: {
        'q-promote': { birthMaintainCount: 0 },
        'q-expire': { birthMaintainCount: 0 },
        'q-survive': { birthMaintainCount: 0 },
      },
    };

    const maintainInput = { sessionId: 'sess-4', nowMs: 1700000040000 };

    const inMemStore = createInMemoryFactAnchorStore();
    const inMemResult = inMemStore.maintain(seedState, maintainInput);
    const inMemExport = inMemStore.exportAll(inMemResult.nextState);

    const saved = await store.saveState('test-user-1', seedState);
    expect(saved).toBe(true);

    const dbResult = await store.maintain('test-user-1', maintainInput);
    expect(dbResult).not.toBeNull();

    const dbExport = await store.exportAll('test-user-1');
    expect(dbExport).not.toBeNull();

    expect(dbResult!.report).toEqual(inMemResult.report);

    expect(dbExport!.confirmed.map((a) => a.anchorId).sort()).toEqual(
      inMemExport.confirmed.map((a) => a.anchorId).sort(),
    );
    expect(dbExport!.quarantined.map((a) => a.anchorId).sort()).toEqual(
      inMemExport.quarantined.map((a) => a.anchorId).sort(),
    );
  });

  // ── purge ──

  it('purgeAll is idempotent and scoped', async () => {
    if (!store) return;

    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [makeAnchor({ anchorId: 'u1-a', userId: 'test-user-1' })],
    });
    await store.upsertFromExtraction('test-user-2', {
      userId: 'test-user-2',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [
        makeAnchor({
          anchorId: 'u2-a',
          userId: 'test-user-2',
          type: 'preference',
          summary: { template: 'preference_positive', slot: 'general_positive' },
        }),
      ],
    });

    const ok = await store.purgeAll('test-user-1');
    expect(ok).toBe(true);

    const e1 = await store.exportAll('test-user-1');
    expect(e1).not.toBeNull();
    expect(e1!.confirmed.length + e1!.quarantined.length).toBe(0);

    const e2 = await store.exportAll('test-user-2');
    expect(e2).not.toBeNull();
    expect(e2!.confirmed.length + e2!.quarantined.length).toBe(1);

    const ok2 = await store.purgeAll('test-user-1');
    expect(ok2).toBe(true);
  });

  // ── loadState for unknown user ──

  it('loadState returns empty state for unknown user (not null)', async () => {
    if (!store) return;
    const state = await store.loadState('nonexistent-user');
    expect(state).not.toBeNull();
    expect(state!.confirmed).toEqual([]);
    expect(state!.quarantined).toEqual([]);
  });

  // ── metadata persistence ──

  it('metadata persists across load/save cycles (sessionSeen, quarantineMeta)', async () => {
    if (!store) return;

    const seedState: FactAnchorStoreState = {
      confirmed: [],
      quarantined: [
        makeAnchor({
          anchorId: 'meta-test',
          userId: 'test-user-1',
          status: 'quarantined',
          extractionConfidence: 0.50,
          type: 'preference',
          summary: { template: 'preference_negative', slot: 'general_negative' },
        }),
      ],
      sessionSeen: { 'sess-1': true },
      sessionAnchorCount: { 'sess-1': 1 },
      quarantineMeta: {
        'meta-test': { birthMaintainCount: 1 },
      },
    };

    await store.saveState('test-user-1', seedState);
    await store.maintain('test-user-1', { sessionId: 'sess-2', nowMs: 1700000010000 });

    const state = await store.loadState('test-user-1');
    expect(state).not.toBeNull();
    expect(state!.sessionSeen).toHaveProperty('sess-2');
    expect(state!.lastMaintenanceSessionId).toBe('sess-2');
  });

  // ── degraded mode ──

  it('degraded mode: returns null on DB failure for all methods', async () => {
    const origUrl = process.env.LORA_FALKOR_URL;
    process.env.LORA_FALKOR_URL = 'redis://127.0.0.1:19999';
    resetFalkorClient();

    const badStore = new FalkorFactAnchorStore();

    const state = await badStore.loadState('test-user-1');
    expect(state).toBeNull();

    const candidates = await badStore.getCandidates('test-user-1', { nowMs: Date.now() });
    expect(candidates).toBeNull();

    const exported = await badStore.exportAll('test-user-1');
    expect(exported).toBeNull();

    const maintained = await badStore.maintain('test-user-1', {
      sessionId: 'sess-1',
      nowMs: Date.now(),
    });
    expect(maintained).toBeNull();

    const upserted = await badStore.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [makeAnchor({ anchorId: 'fail', userId: 'test-user-1' })],
    });
    expect(upserted).toBeNull();

    process.env.LORA_FALKOR_URL = origUrl;
    resetFalkorClient();
  });
});
