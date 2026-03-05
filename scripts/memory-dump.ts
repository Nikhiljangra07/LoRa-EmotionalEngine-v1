// scripts/memory-dump.ts

import * as fs from 'fs';
import * as path from 'path';
import { getFalkorClient } from '../src/emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../src/emotion-core/memory-v1/db/chromaClient';
import { featureFlags } from '../src/emotion-core/config/featureFlags';
import { computeMemorySummary } from '../src/server/debug/memorySummary';

const BOOTSTRAP_DIR = '.lora/bootstrap';
const ANCHOR_COUNT_QUERY = 'MATCH (n:Anchor) RETURN count(n)';

async function dumpMemory() {
  let anchorCount = 0;
  let schemaCount = 0;
  const bootstrapEntries: Array<{ themes?: string[] }> = [];

  // --- Falkor (anchor nodes only)
  try {
    const falkor = getFalkorClient();
    await falkor.ping();
    const graphsRaw: any = await falkor.call('GRAPH.LIST');
    if (graphsRaw.includes('lora_anchors')) {
      const countRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', ANCHOR_COUNT_QUERY);
      anchorCount = Number(countRaw[1]?.[0]?.[0] ?? 0);
    }
  } catch {
    // leave anchorCount 0
  }

  // --- Chroma
  try {
    const chroma = getChromaClient();
    await chroma.heartbeat();
    const collections = await chroma.listCollections();
    if (collections.some((c: { name: string }) => c.name === 'lora_schemas')) {
      const collection = await chroma.getCollection({ name: 'lora_schemas' });
      schemaCount = await collection.count();
    }
  } catch {
    // leave schemaCount 0
  }

  // --- Bootstrap (collect entries for unique theme count)
  try {
    if (fs.existsSync(BOOTSTRAP_DIR)) {
      const files = fs.readdirSync(BOOTSTRAP_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(BOOTSTRAP_DIR, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const entries = content.entries ?? [];
        for (const e of entries) bootstrapEntries.push({ themes: e.themes });
      }
    }
  } catch {
    // leave bootstrapEntries empty
  }

  const summary = computeMemorySummary({ anchorCount, schemaCount, bootstrapEntries });

  // Print summary at top
  console.log('=== LoRa Memory Dump ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');
  console.log('Summary');
  console.log(`anchors: ${summary.anchorCount}`);
  console.log(`schemas: ${summary.schemaCount}`);
  console.log(`themes: ${summary.bootstrapThemeCount}`);
  console.log('');

  // Feature Flags
  console.log('--- Feature Flags ---');
  Object.entries(featureFlags).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
  console.log('');

  // Falkor details
  console.log('--- FalkorDB (lora_anchors) ---');
  try {
    const falkor = getFalkorClient();
    await falkor.ping();
    console.log('Status: OK');
    const graphsRaw: any = await falkor.call('GRAPH.LIST');
    console.log(`Graphs: ${graphsRaw.join(', ')}`);
    if (graphsRaw.includes('lora_anchors')) {
      const countRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', ANCHOR_COUNT_QUERY);
      console.log(`Anchor count: ${countRaw[1]?.[0]?.[0] ?? 0}`);
      const sampleRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', 'MATCH (a:Anchor) RETURN a.anchorId, a.payloadJson LIMIT 10');
      const data = sampleRaw[1] ?? [];
      console.log('Samples (sanitized):');
      data.forEach((row: any) => {
        const anchorId = row[0];
        const payloadJson = row[1];
        try {
          const payload = JSON.parse(payloadJson);
          console.log(`  - ID: ${anchorId}`);
          console.log(`    Type: ${payload.type}, Status: ${payload.status}`);
          console.log(`    Summary: ${JSON.stringify(payload.summary)}`);
        } catch {
          console.log(`  - ID: ${anchorId} (Parse Error)`);
        }
      });
    }
  } catch (err: any) {
    console.log(`Status: ERROR (${err.message})`);
  }
  console.log('');

  // Chroma details
  console.log('--- ChromaDB (lora_schemas) ---');
  try {
    const chroma = getChromaClient();
    await chroma.heartbeat();
    console.log('Status: OK');
    const collections = await chroma.listCollections();
    console.log(`Collections: ${collections.map((c: { name: string }) => c.name).join(', ')}`);
    if (collections.some((c: { name: string }) => c.name === 'lora_schemas')) {
      const collection = await chroma.getCollection({ name: 'lora_schemas' });
      const count = await collection.count();
      console.log(`Schema count: ${count}`);
      const samples = await collection.get({ limit: 10 });
      console.log('Samples:');
      samples.ids.forEach((id: string, i: number) => {
        console.log(`  - ID: ${id}`);
        console.log(`    Metadata: ${JSON.stringify(samples.metadatas?.[i])}`);
      });
    }
  } catch (err: any) {
    console.log(`Status: ERROR (${err.message})`);
  }
  console.log('');

  // Bootstrap details
  console.log('--- Bootstrap Memory (.lora/bootstrap) ---');
  try {
    if (fs.existsSync(BOOTSTRAP_DIR)) {
      const files = fs.readdirSync(BOOTSTRAP_DIR).filter(f => f.endsWith('.json'));
      console.log(`User files: ${files.length}`);
      files.forEach(file => {
        const userId = file.replace('.json', '');
        const filePath = path.join(BOOTSTRAP_DIR, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        console.log(`  - User: ${userId}`);
        console.log(`    Entries: ${content.entries?.length ?? 0}, Sessions: ${content.sessionCount}`);
        const recent = content.entries?.slice(-3) ?? [];
        if (recent.length > 0) {
          console.log('    Recent Themes:');
          recent.forEach((e: any) => {
            console.log(`      [${e.role}] ${(e.themes ?? []).join(', ')}`);
          });
        }
      });
    } else {
      console.log('Status: NOT_FOUND');
    }
  } catch (err: any) {
    console.log(`Status: ERROR (${err.message})`);
  }

  process.exit(0);
}

dumpMemory().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
