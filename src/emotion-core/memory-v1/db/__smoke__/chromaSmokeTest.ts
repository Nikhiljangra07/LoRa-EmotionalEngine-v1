#!/usr/bin/env ts-node

/**
 * ChromaDB Smoke Test — Isolated Infrastructure Validation
 *
 * Validates:
 *   1. Metadata filtering via where: { userId }
 *   2. Delete via where clause
 *   3. No data leakage across userId partitions
 *   4. Deterministic query results
 *   5. Metadata preservation
 *   6. Graceful failure when server unreachable
 *
 * This file is fully isolated: no production imports, no side effects,
 * removable without impact.
 *
 * Usage:
 *   LORA_CHROMA_URL=http://localhost:8000 npm run chroma:smoke
 */

import { ChromaClient } from 'chromadb';

const COLLECTION_NAME = 'lora_schemas_smoke';

function log(tag: 'PASS' | 'FAIL' | 'WARN' | 'INFO', msg: string): void {
  const prefix = tag === 'PASS' || tag === 'FAIL' ? `[SMOKE ${tag}]` : `[SMOKE ${tag}]`;
  process.stdout.write(`${prefix} ${msg}\n`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed (${label}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main(): Promise<void> {
  // --- Step 5: Failure mode — missing URL ---
  const chromaUrl = process.env.LORA_CHROMA_URL;
  if (!chromaUrl) {
    log('FAIL', 'LORA_CHROMA_URL is not set. Export it before running.');
    process.exit(1);
  }

  let client: ChromaClient;
  try {
    client = new ChromaClient({ path: chromaUrl });
    await client.heartbeat();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log('FAIL', `Cannot connect to ChromaDB at ${chromaUrl}: ${msg}`);
    process.exit(1);
  }

  log('INFO', `Connected to ChromaDB at ${chromaUrl}`);

  // Clean up in case previous run left artifacts
  try {
    await client.deleteCollection({ name: COLLECTION_NAME });
  } catch {
    // Collection may not exist — ignore
  }

  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { 'hnsw:space': 'cosine' },
    embeddingFunction: null as any,
  });

  log('INFO', `Collection "${COLLECTION_NAME}" created.`);

  // --- Step 3: Insert 3 vectors (2 for u1, 1 for u2) ---
  const ids = ['u1-schema-a', 'u1-schema-b', 'u2-schema-c'];
  const embeddings = [
    [0.1, 0.2, 0.3, 0.4, 0.5],
    [0.5, 0.4, 0.3, 0.2, 0.1],
    [0.9, 0.8, 0.7, 0.6, 0.5],
  ];
  const metadatas = [
    { userId: 'u1', schemaId: 'schema-a', label: 'calm' },
    { userId: 'u1', schemaId: 'schema-b', label: 'volatile' },
    { userId: 'u2', schemaId: 'schema-c', label: 'stable' },
  ];

  await collection.add({ ids, embeddings, metadatas });
  log('INFO', `Inserted ${ids.length} vectors.`);

  // --- Step 3 & 4: Query where userId = u1 ---
  const queryU1First = await collection.get({
    where: { userId: 'u1' },
    include: ['metadatas', 'embeddings'],
  });

  assertEq(queryU1First.ids.length, 2, 'u1 count');

  const u1SchemaIds = (queryU1First.metadatas ?? [])
    .map((m) => (m as Record<string, unknown>)?.schemaId as string)
    .sort();
  assertEq(u1SchemaIds[0], 'schema-a', 'u1 first schema');
  assertEq(u1SchemaIds[1], 'schema-b', 'u1 second schema');

  // Verify no u2 data leaked
  for (const m of queryU1First.metadatas ?? []) {
    const meta = m as Record<string, unknown>;
    if (meta.userId !== 'u1') {
      throw new Error(`Data leak: u2 data appeared in u1 query. Got userId=${meta.userId}`);
    }
  }

  log('PASS', 'Metadata isolation confirmed.');

  // --- Step 5: Metadata preservation ---
  const u1Labels = (queryU1First.metadatas ?? [])
    .map((m) => (m as Record<string, unknown>)?.label as string)
    .sort();
  assertEq(u1Labels.includes('calm'), true, 'label calm preserved');
  assertEq(u1Labels.includes('volatile'), true, 'label volatile preserved');

  log('PASS', 'Metadata preservation confirmed.');

  // --- Step 4: Determinism check ---
  const queryU1Second = await collection.get({
    where: { userId: 'u1' },
    include: ['metadatas'],
  });

  const ids1 = (queryU1First.metadatas ?? [])
    .map((m) => (m as Record<string, unknown>)?.schemaId as string)
    .sort();
  const ids2 = (queryU1Second.metadatas ?? [])
    .map((m) => (m as Record<string, unknown>)?.schemaId as string)
    .sort();

  const deterministic = ids1.length === ids2.length && ids1.every((v, i) => v === ids2[i]);
  if (deterministic) {
    log('PASS', 'Determinism confirmed.');
  } else {
    log('WARN', 'Non-deterministic ordering detected across consecutive calls.');
  }

  // --- Step 3: Delete where userId = u1 ---
  await collection.delete({ where: { userId: 'u1' } });
  log('INFO', 'Deleted u1 entries.');

  // Verify u1 gone
  const queryU1After = await collection.get({ where: { userId: 'u1' } });
  assertEq(queryU1After.ids.length, 0, 'u1 deleted');

  // Verify u2 still exists
  const queryU2 = await collection.get({
    where: { userId: 'u2' },
    include: ['metadatas'],
  });
  assertEq(queryU2.ids.length, 1, 'u2 still present');
  const u2Meta = queryU2.metadatas?.[0] as Record<string, unknown> | undefined;
  assertEq(u2Meta?.schemaId, 'schema-c', 'u2 schema intact');
  assertEq(u2Meta?.userId, 'u2', 'u2 userId intact');

  log('PASS', 'Delete isolation confirmed.');

  // --- Cleanup ---
  await client.deleteCollection({ name: COLLECTION_NAME });
  log('INFO', `Collection "${COLLECTION_NAME}" deleted. Cleanup complete.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  log('FAIL', msg);
  process.exit(1);
});
