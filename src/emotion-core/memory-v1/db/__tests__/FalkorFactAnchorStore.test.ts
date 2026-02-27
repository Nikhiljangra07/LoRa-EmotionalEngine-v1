import { FalkorFactAnchorStore } from '../FalkorFactAnchorStore';
import { getFalkorClient, getFalkorUrl, resetFalkorClient } from '../falkorClient';
import type { FactAnchor } from '../../factAnchorTypes';

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
    resetFalkorClient();
  });

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
    expect(candidates.length).toBe(1);

    const c = candidates[0];
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

  it('stores both confirmed and quarantined anchors', async () => {
    if (!store) return;

    const confirmed = makeAnchor({
      anchorId: 'c-1',
      userId: 'test-user-1',
      status: 'confirmed',
      extractionConfidence: 0.80,
    });
    const quarantined = makeAnchor({
      anchorId: 'q-1',
      userId: 'test-user-1',
      status: 'quarantined',
      extractionConfidence: 0.50,
    });

    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [confirmed],
    });
    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: Date.now(),
      extracted: [quarantined],
    });

    const exported = await store.exportAll('test-user-1');
    expect(exported).not.toBeNull();
    expect(exported!.confirmed.length).toBeGreaterThanOrEqual(1);

    const allIds = [
      ...exported!.confirmed.map((a) => a.anchorId),
      ...exported!.quarantined.map((a) => a.anchorId),
    ];
    expect(allIds).toContain('c-1');
  });

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
      extracted: [makeAnchor({ anchorId: 'u2-a', userId: 'test-user-2' })],
    });

    const c1 = await store.getCandidates('test-user-1', { nowMs: Date.now() });
    const c2 = await store.getCandidates('test-user-2', { nowMs: Date.now() });

    expect(c1.length).toBe(1);
    expect(c1[0].anchorId).toBe('u1-a');
    expect(c2.length).toBe(1);
    expect(c2[0].anchorId).toBe('u2-a');
  });

  it('maintain deletes expired quarantined anchors and promotes eligible ones', async () => {
    if (!store) return;

    const weakQuarantined = makeAnchor({
      anchorId: 'q-weak',
      userId: 'test-user-1',
      status: 'quarantined',
      extractionConfidence: 0.50,
      reinforceCount: 1,
      appearsInSessions: 1,
      lastSeenSessionId: 'sess-1',
    });

    const strongQuarantined = makeAnchor({
      anchorId: 'q-strong',
      userId: 'test-user-1',
      status: 'quarantined',
      extractionConfidence: 0.80,
      reinforceCount: 2,
      appearsInSessions: 2,
      lastSeenSessionId: 'sess-2',
    });

    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: 1700000000000,
      extracted: [weakQuarantined],
    });
    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-2',
      nowMs: 1700000010000,
      extracted: [strongQuarantined],
    });

    await store.maintain('test-user-1', { sessionId: 'sess-2', nowMs: 1700000020000 });
    await store.maintain('test-user-1', { sessionId: 'sess-3', nowMs: 1700000030000 });
    const result = await store.maintain('test-user-1', { sessionId: 'sess-4', nowMs: 1700000040000 });

    expect(result).not.toBeNull();

    const exported = await store.exportAll('test-user-1');
    expect(exported).not.toBeNull();

    const confirmedIds = exported!.confirmed.map((a) => a.anchorId);
    expect(confirmedIds).toContain('q-strong');
  });

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
      extracted: [makeAnchor({ anchorId: 'u2-a', userId: 'test-user-2' })],
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

  it('loadState returns empty state for unknown user (not null)', async () => {
    if (!store) return;
    const state = await store.loadState('nonexistent-user');
    expect(state).not.toBeNull();
    expect(state!.confirmed).toEqual([]);
    expect(state!.quarantined).toEqual([]);
  });

  it('metadata persists across load/save cycles (sessionSeen, quarantineMeta)', async () => {
    if (!store) return;

    const anchor = makeAnchor({
      anchorId: 'meta-test',
      userId: 'test-user-1',
      status: 'quarantined',
      extractionConfidence: 0.50,
    });

    await store.upsertFromExtraction('test-user-1', {
      userId: 'test-user-1',
      sessionId: 'sess-1',
      nowMs: 1700000000000,
      extracted: [anchor],
    });

    await store.maintain('test-user-1', { sessionId: 'sess-2', nowMs: 1700000010000 });

    const state = await store.loadState('test-user-1');
    expect(state).not.toBeNull();
    expect(state!.sessionSeen).toHaveProperty('sess-2');
    expect(state!.lastMaintenanceSessionId).toBe('sess-2');
  });

  it('degraded mode: returns null/empty when Falkor unreachable', async () => {
    const origUrl = process.env.LORA_FALKOR_URL;
    process.env.LORA_FALKOR_URL = 'redis://127.0.0.1:19999';
    resetFalkorClient();

    const badStore = new FalkorFactAnchorStore();

    const state = await badStore.loadState('test-user-1');
    expect(state).toBeNull();

    const candidates = await badStore.getCandidates('test-user-1', { nowMs: Date.now() });
    expect(candidates).toEqual([]);

    const exported = await badStore.exportAll('test-user-1');
    expect(exported).toBeNull();

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
