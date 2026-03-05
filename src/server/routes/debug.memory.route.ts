// src/server/routes/debug.memory.route.ts

import { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { featureFlags } from '../../emotion-core/config/featureFlags';
import { computeMemorySummary } from '../debug/memorySummary';

const BOOTSTRAP_DIR = '.lora/bootstrap';

const ANCHOR_COUNT_QUERY = 'MATCH (n:Anchor) RETURN count(n)';

export function registerDebugMemoryRoute(app: Express) {
  app.get('/debug/memory', async (req: Request, res: Response) => {
    let anchorCount = 0;
    let schemaCount = 0;
    const bootstrapEntries: Array<{ themes?: string[] }> = [];

    const debugData: any = {
      timestamp: new Date().toISOString(),
      memorySummary: { anchorCount: 0, schemaCount: 0, bootstrapThemeCount: 0 },
      featureFlags,
      falkor: { status: 'unknown' },
      chroma: { status: 'unknown' },
      bootstrap: { status: 'unknown', users: [] },
    };

    // 1. Falkor Audit
    try {
      const falkor = getFalkorClient();
      await falkor.ping();
      debugData.falkor.status = 'OK';

      const graphsRaw: any = await falkor.call('GRAPH.LIST');
      debugData.falkor.graphs = graphsRaw;

      if (graphsRaw.includes('lora_anchors')) {
        const countRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', ANCHOR_COUNT_QUERY);
        anchorCount = Number(countRaw[1]?.[0]?.[0] ?? 0);
        debugData.falkor.nodeCount = anchorCount;

        // Sample 10 nodes (sanitized)
        const sampleRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', 'MATCH (a:Anchor) RETURN a.anchorId, a.payloadJson LIMIT 10');
        const data = sampleRaw[1] ?? [];
        
        debugData.falkor.samples = data.map((row: any) => {
          const anchorId = row[0];
          const payloadJson = row[1];
          let sanitizedPayload = {};
          try {
            const payload = JSON.parse(payloadJson);
            // Sanitization: Only keep summary (template+slot) and metadata, no raw text
            sanitizedPayload = {
              type: payload.type,
              status: payload.status,
              summary: payload.summary,
              createdAt: payload.createdAt,
              reinforceCount: payload.reinforceCount,
            };
          } catch (e) {
            sanitizedPayload = { error: 'Failed to parse payloadJson' };
          }
          return { anchorId, sanitizedPayload };
        });
      }
    } catch (err: any) {
      debugData.falkor.status = 'ERROR';
      debugData.falkor.error = err.message;
    }

    // 2. Chroma Audit
    try {
      const chroma = getChromaClient();
      await chroma.heartbeat();
      debugData.chroma.status = 'OK';

      const collections = await chroma.listCollections();
      debugData.chroma.collections = collections.map(c => c.name);

      if (debugData.chroma.collections.includes('lora_schemas')) {
        const collection = await chroma.getCollection({ name: 'lora_schemas' });
        schemaCount = await collection.count();
        debugData.chroma.schemaCount = schemaCount;

        // Sample 10 ids + metadatas
        const samples = await collection.get({ limit: 10 });
        debugData.chroma.samples = samples.ids.map((id, i) => ({
          id,
          metadata: samples.metadatas?.[i]
        }));
      }
    } catch (err: any) {
      debugData.chroma.status = 'ERROR';
      debugData.chroma.error = err.message;
    }

    // 3. Bootstrap Audit
    try {
      if (fs.existsSync(BOOTSTRAP_DIR)) {
        debugData.bootstrap.status = 'OK';
        const files = fs.readdirSync(BOOTSTRAP_DIR).filter(f => f.endsWith('.json'));

        debugData.bootstrap.users = files.map(file => {
          const userId = file.replace('.json', '');
          const filePath = path.join(BOOTSTRAP_DIR, file);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const entries = content.entries ?? [];
          for (const e of entries) bootstrapEntries.push({ themes: e.themes });
          return {
            userId,
            entryCount: entries.length,
            sessionCount: content.sessionCount,
            recentThemes: entries.slice(-5).map((e: any) => ({
              themes: e.themes,
              role: e.role,
              timestamp: e.timestamp,
            })) ?? [],
          };
        });
      } else {
        debugData.bootstrap.status = 'NOT_FOUND';
        debugData.bootstrap.path = path.resolve(BOOTSTRAP_DIR);
      }
    } catch (err: any) {
      debugData.bootstrap.status = 'ERROR';
      debugData.bootstrap.error = err.message;
    }

    debugData.memorySummary = computeMemorySummary({
      anchorCount,
      schemaCount,
      bootstrapEntries,
    });

    res.json(debugData);
  });
}
