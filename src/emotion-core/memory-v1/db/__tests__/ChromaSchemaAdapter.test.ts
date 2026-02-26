import { ChromaSchemaAdapter } from '../ChromaSchemaAdapter';
import { resetChromaClient } from '../chromaClient';
import type { SchemaRecord } from '../../schemaStore';

const DB_ON = process.env.LORA_TEST_DB === '1';

async function assertChromaReachable(url: string): Promise<void> {
  try {
    const res = await fetch(`${url}/api/v1/heartbeat`);
    if (!res.ok) throw new Error();
  } catch {
    throw new Error(
      `[ChromaSchemaAdapterTest] ChromaDB not reachable at ${url}.
Start it with:
  docker run -d -p 8000:8000 chromadb/chroma`,
    );
  }
}

function makeSchema(id: string, overrides?: Partial<SchemaRecord>): SchemaRecord {
  return {
    schemaId: id,
    centroid: [0.1, 0.2, 0.3, 0.4, 0.5],
    salienceWeight: 0.75,
    episodeCount: 3,
    retrievalBias: 0.0,
    createdAt: 1000,
    lastUpdatedAt: 2000,
    ...overrides,
  };
}

(DB_ON ? describe : describe.skip)('ChromaSchemaAdapter (DB)', () => {
  let adapter: ChromaSchemaAdapter;

  beforeAll(async () => {
    const url = process.env.LORA_CHROMA_URL;
    if (!url) {
      throw new Error(
        '[ChromaSchemaAdapterTest] ChromaDB not reachable at <url>. Start local Chroma (Docker or Python) before running DB tests.',
      );
    }
    await assertChromaReachable(url);
    adapter = new ChromaSchemaAdapter();
  });

  afterEach(async () => {
    if (!adapter) return;
    await adapter.purgeUser('test-user-1');
    await adapter.purgeUser('test-user-2');
  });

  // 1. Save → Load roundtrip equality
  it('save then load returns equivalent schemas', async () => {
    const schemas = [
      makeSchema('s-alpha', { centroid: [0.123456789, 0.987654321, 0.555555555, 0.111111111, 0.999999999] }),
      makeSchema('s-beta', { centroid: [0.5, 0.4, 0.3, 0.2, 0.1], episodeCount: 7 }),
    ];

    const saved = await adapter.saveSchemas('test-user-1', schemas);
    expect(saved).toBe(true);

    const loaded = await adapter.loadSchemas('test-user-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(2);

    for (const original of schemas) {
      const found = loaded!.find((s) => s.schemaId === original.schemaId);
      expect(found).toBeDefined();
      expect(found!.salienceWeight).toBeCloseTo(original.salienceWeight, 5);
      expect(found!.episodeCount).toBe(original.episodeCount);
      expect(found!.retrievalBias).toBeCloseTo(original.retrievalBias, 5);
      expect(found!.createdAt).toBe(original.createdAt);
      expect(found!.lastUpdatedAt).toBe(original.lastUpdatedAt);
      expect(found!.centroid.length).toBe(original.centroid.length);
      for (let d = 0; d < found!.centroid.length; d++) {
        expect(found!.centroid[d]).toBeCloseTo(original.centroid[d], 5);
      }
    }
  });

  // 2. Deterministic ordering by schemaId
  it('loadSchemas returns schemas sorted by schemaId ASC', async () => {
    const schemas = [
      makeSchema('z-last'),
      makeSchema('a-first'),
      makeSchema('m-middle'),
    ];
    await adapter.saveSchemas('test-user-1', schemas);

    const loaded = await adapter.loadSchemas('test-user-1');
    expect(loaded).not.toBeNull();
    const ids = loaded!.map((s) => s.schemaId);
    expect(ids).toEqual(['a-first', 'm-middle', 'z-last']);

    const loaded2 = await adapter.loadSchemas('test-user-1');
    const ids2 = loaded2!.map((s) => s.schemaId);
    expect(ids2).toEqual(ids);
  });

  // 3. Isolation across two userIds
  it('schemas for different users are isolated', async () => {
    await adapter.saveSchemas('test-user-1', [makeSchema('u1-schema')]);
    await adapter.saveSchemas('test-user-2', [makeSchema('u2-schema')]);

    const u1 = await adapter.loadSchemas('test-user-1');
    const u2 = await adapter.loadSchemas('test-user-2');

    expect(u1).not.toBeNull();
    expect(u1!.length).toBe(1);
    expect(u1![0].schemaId).toBe('u1-schema');

    expect(u2).not.toBeNull();
    expect(u2!.length).toBe(1);
    expect(u2![0].schemaId).toBe('u2-schema');
  });

  // 4. Purge removes only target user
  it('purgeUser removes only that user and leaves others', async () => {
    await adapter.saveSchemas('test-user-1', [makeSchema('u1-schema')]);
    await adapter.saveSchemas('test-user-2', [makeSchema('u2-schema')]);

    const purged = await adapter.purgeUser('test-user-1');
    expect(purged).toBe(true);

    const u1 = await adapter.loadSchemas('test-user-1');
    expect(u1).not.toBeNull();
    expect(u1!.length).toBe(0);

    const u2 = await adapter.loadSchemas('test-user-2');
    expect(u2).not.toBeNull();
    expect(u2!.length).toBe(1);
    expect(u2![0].schemaId).toBe('u2-schema');
  });

  // 5. Returns null if Chroma unreachable
  it('loadSchemas returns null when Chroma is unreachable', async () => {
    const origUrl = process.env.LORA_CHROMA_URL;
    process.env.LORA_CHROMA_URL = 'http://127.0.0.1:19999';
    resetChromaClient();

    const badAdapter = new ChromaSchemaAdapter();
    const result = await badAdapter.loadSchemas('test-user-1');
    expect(result).toBeNull();

    process.env.LORA_CHROMA_URL = origUrl;
    resetChromaClient();
  });

  // 6. saveSchemas returns false when Chroma is unreachable
  it('saveSchemas returns false when Chroma is unreachable', async () => {
    const origUrl = process.env.LORA_CHROMA_URL;
    process.env.LORA_CHROMA_URL = 'http://127.0.0.1:19999';
    resetChromaClient();

    const badAdapter = new ChromaSchemaAdapter();
    const result = await badAdapter.saveSchemas('test-user-1', [makeSchema('s1')]);
    expect(result).toBe(false);

    process.env.LORA_CHROMA_URL = origUrl;
    resetChromaClient();
  });

  // 7. Save empty array succeeds
  it('saveSchemas with empty array returns true', async () => {
    const result = await adapter.saveSchemas('test-user-1', []);
    expect(result).toBe(true);

    const loaded = await adapter.loadSchemas('test-user-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(0);
  });

  // 8. Upsert overwrites existing schema
  it('upsert overwrites schema with same schemaId', async () => {
    await adapter.saveSchemas('test-user-1', [makeSchema('s1', { episodeCount: 1 })]);
    await adapter.saveSchemas('test-user-1', [makeSchema('s1', { episodeCount: 99 })]);

    const loaded = await adapter.loadSchemas('test-user-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(1);
    expect(loaded![0].episodeCount).toBe(99);
  });

  // 9. Load for non-existent user returns empty array
  it('loadSchemas for unknown user returns empty array', async () => {
    const loaded = await adapter.loadSchemas('nonexistent-user');
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(0);
  });

  // 10. Purge non-existent user returns true
  it('purgeUser for unknown user returns true', async () => {
    const result = await adapter.purgeUser('nonexistent-user');
    expect(result).toBe(true);
  });
});
