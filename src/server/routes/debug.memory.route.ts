// src/server/routes/debug.memory.route.ts

import { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { featureFlags } from '../../emotion-core/config/featureFlags';

const BOOTSTRAP_DIR = '.lora/bootstrap';

export function registerDebugMemoryRoute(app: Express) {
  app.get('/debug/memory', async (req: Request, res: Response) => {
    const debugData: any = {
      timestamp: new Date().toISOString(),
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
      
      // Get all graphs
      const graphsRaw: any = await falkor.call('GRAPH.LIST');
      debugData.falkor.graphs = graphsRaw;

      if (graphsRaw.includes('lora_anchors')) {
        // Count nodes in lora_anchors
        const countRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', 'MATCH (n) RETURN count(n)');
        debugData.falkor.nodeCount = countRaw[1][0][0];

        // Sample 10 nodes (sanitized)
        const sampleRaw: any = await falkor.call('GRAPH.QUERY', 'lora_anchors', 'MATCH (a:Anchor) RETURN a.anchorId, a.payloadJson LIMIT 10');
        const header = sampleRaw[0];
        const data = sampleRaw[1];
        
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
        const count = await collection.count();
        debugData.chroma.schemaCount = count;

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
          
          return {
            userId,
            entryCount: content.entries?.length ?? 0,
            sessionCount: content.sessionCount,
            // Themes only, no raw text
            recentThemes: content.entries?.slice(-5).map((e: any) => ({
              themes: e.themes,
              role: e.role,
              timestamp: e.timestamp
            })) ?? []
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

    res.json(debugData);
  });
}
