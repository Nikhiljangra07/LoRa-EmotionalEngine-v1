import { FalkorAnchorAdapter } from '../FalkorAnchorAdapter';
import { getFalkorClient, getFalkorUrl, resetFalkorClient } from '../falkorClient';

const DB_ON = process.env.LORA_TEST_DB === '1';

async function assertFalkorReachable(): Promise<void> {
  const url = getFalkorUrl();
  try {
    const client = getFalkorClient();
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error('Unexpected PING response');
  } catch {
    resetFalkorClient();
    throw new Error(
      `[FalkorAnchorAdapterTest] FalkorDB not reachable at ${url}. Start it with: npm run falkor:start`,
    );
  }
}

(DB_ON ? describe : describe.skip)('FalkorAnchorAdapter (DB)', () => {
  let adapter: FalkorAnchorAdapter;

  beforeAll(async () => {
    await assertFalkorReachable();
    adapter = new FalkorAnchorAdapter();
  });

  afterEach(async () => {
    if (!adapter) return;
    await adapter.purgeUser('test-user-1');
    await adapter.purgeUser('test-user-2');
  });

  it('upsert then getAnchors returns stored payload', async () => {
    const ok = await adapter.upsertAnchor('test-user-1', 'anchor-a', { x: 1, label: 'first' });
    expect(ok).toBe(true);

    const list = await adapter.getAnchors('test-user-1');
    expect(list).not.toBeNull();
    expect(list!.length).toBe(1);
    expect(list![0].anchorId).toBe('anchor-a');
    expect(list![0].payload).toEqual({ x: 1, label: 'first' });
  });

  it('anchors for different users are isolated', async () => {
    await adapter.upsertAnchor('test-user-1', 'u1-anchor', { user: 1 });
    await adapter.upsertAnchor('test-user-2', 'u2-anchor', { user: 2 });

    const u1 = await adapter.getAnchors('test-user-1');
    const u2 = await adapter.getAnchors('test-user-2');

    expect(u1).not.toBeNull();
    expect(u1!.length).toBe(1);
    expect(u1![0].anchorId).toBe('u1-anchor');
    expect(u1![0].payload).toEqual({ user: 1 });

    expect(u2).not.toBeNull();
    expect(u2!.length).toBe(1);
    expect(u2![0].anchorId).toBe('u2-anchor');
    expect(u2![0].payload).toEqual({ user: 2 });
  });

  it('getAnchors sorted by anchorId ASC', async () => {
    await adapter.upsertAnchor('test-user-1', 'z-last', {});
    await adapter.upsertAnchor('test-user-1', 'a-first', {});
    await adapter.upsertAnchor('test-user-1', 'm-mid', {});

    const list = await adapter.getAnchors('test-user-1');
    expect(list).not.toBeNull();
    expect(list!.map((a) => a.anchorId)).toEqual(['a-first', 'm-mid', 'z-last']);
  });

  it('purgeUser removes only that user anchors', async () => {
    await adapter.upsertAnchor('test-user-1', 'u1-a', {});
    await adapter.upsertAnchor('test-user-2', 'u2-a', {});

    const purged = await adapter.purgeUser('test-user-1');
    expect(purged).toBe(true);

    const u1 = await adapter.getAnchors('test-user-1');
    expect(u1).not.toBeNull();
    expect(u1!.length).toBe(0);

    const u2 = await adapter.getAnchors('test-user-2');
    expect(u2).not.toBeNull();
    expect(u2!.length).toBe(1);
    expect(u2![0].anchorId).toBe('u2-a');
  });

  it('getAnchors for unknown user returns empty array when DB reachable', async () => {
    const list = await adapter.getAnchors('nonexistent-user');
    expect(list).not.toBeNull();
    expect(list).toEqual([]);
  });

  it('purgeUser for unknown user returns true (idempotent)', async () => {
    const result = await adapter.purgeUser('nonexistent-user');
    expect(result).toBe(true);
  });

  it('when DB unreachable getAnchors returns null and upsert returns false', async () => {
    const origUrl = process.env.LORA_FALKOR_URL;
    process.env.LORA_FALKOR_URL = 'redis://127.0.0.1:19999';
    resetFalkorClient();

    const badAdapter = new FalkorAnchorAdapter();
    const list = await badAdapter.getAnchors('any-user');
    expect(list).toBeNull();

    const ok = await badAdapter.upsertAnchor('any-user', 'a', {});
    expect(ok).toBe(false);

    process.env.LORA_FALKOR_URL = origUrl;
    resetFalkorClient();
  });
});
