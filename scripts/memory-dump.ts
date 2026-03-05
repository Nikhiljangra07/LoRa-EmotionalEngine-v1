// scripts/memory-dump.ts

import * as fs from 'fs';
import * as path from 'path';
import { getFalkorClient } from '../src/emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../src/emotion-core/memory-v1/db/chromaClient';
import { featureFlags } from '../src/emotion-core/config/featureFlags';

const BOOTSTRAP_DIR = '.lora/bootstrap';

async function dumpMemory() {
  console.log('=== LoRa Memory Dump ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  // 1. Feature Flags
  console.log('--- Feature Flags ---');
  Object.entries(featureFlags).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
  console.log('');

  // 2. Falkor
  console.log('--- FalkorDB (lora_anchors) ---');
  try {
    const falkor = getFalkorClient();
    await falkor.ping();
    console.log('Status: OK');
    
    const graphsRaw: any = await falkor.call('GRAPH.LIST');
    console.log(`Graphs: ${graphsRaw.join(', ')}`);

    if (graphsRaw.includes('lora_anchors')) {
      const countRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', 'MATCH (n) RETURN count(n)');
      console.log(`Node count: ${countRaw[1][0][0]}`);

      const sampleRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', 'MATCH (a:Anchor) RETURN a.anchorId, a.payloadJson LIMIT 10');
      const data = sampleRaw[1];
      
      console.log('Samples (sanitized):');
      data.forEach((row: any) => {
        const anchorId = row[0];
        const payloadJson = row[1];
        try {
          const payload = JSON.parse(payloadJson);
          console.log(`  - ID: ${anchorId}`);
          console.log(`    Type: ${payload.type}, Status: ${payload.status}`);
          console.log(`    Summary: ${JSON.stringify(payload.summary)}`);
        } catch (e) {
          console.log(`  - ID: ${anchorId} (Parse Error)`);
        }
      });
    }
  } catch (err: any) {
    console.log(`Status: ERROR (${err.message})`);
  }
  console.log('');

  // 3. Chroma
  console.log('--- ChromaDB (lora_schemas) ---');
  try {
    const chroma = getChromaClient();
    await chroma.heartbeat();
    console.log('Status: OK');

    const collections = await chroma.listCollections();
    console.log(`Collections: ${collections.map(c => c.name).join(', ')}`);

    if (collections.some(c => c.name === 'lora_schemas')) {
      const collection = await chroma.getCollection({ name: 'lora_schemas' });
      const count = await collection.count();
      console.log(`Schema count: ${count}`);

      const samples = await collection.get({ limit: 10 });
      console.log('Samples:');
      samples.ids.forEach((id, i) => {
        console.log(`  - ID: ${id}`);
        console.log(`    Metadata: ${JSON.stringify(samples.metadatas?.[i])}`);
      });
    }
  } catch (err: any) {
    console.log(`Status: ERROR (${err.message})`);
  }
  console.log('');

  // 4. Bootstrap
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
            console.log(`      [${e.role}] ${e.themes.join(', ')}`);
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
