// src/server/routes/debug.memory.route.ts

import { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getFalkorClient, graphQuery } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { featureFlags } from '../../emotion-core/config/featureFlags';
import { computeMemorySummary } from '../debug/memorySummary';

const BOOTSTRAP_DIR = '.lora/bootstrap';

const ANCHOR_COUNT_QUERY = 'MATCH (n:Anchor) RETURN count(n)';
const GRAPH_NAME = 'lora_anchors';
const FACTS_RECENT_QUERY =
  'MATCH (a:Anchor { userId: $userId }) RETURN a.type AS type, a.slot AS slot, a.value AS value, a.createdAt AS createdAt ORDER BY a.createdAt DESC LIMIT 20';

function parseFactsResult(raw: unknown): Array<{ type: string; slot: string; value: string | number; createdAt: number }> {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const header = raw[0] as string[];
  const data = raw[1] as unknown[][];
  const typeIdx = header.indexOf('type');
  const slotIdx = header.indexOf('slot');
  const valueIdx = header.indexOf('value');
  const createdAtIdx = header.indexOf('createdAt');
  if (typeIdx < 0 || slotIdx < 0 || valueIdx < 0 || createdAtIdx < 0) return [];
  return data.map((row) => ({
    type: String(row[typeIdx] ?? ''),
    slot: String(row[slotIdx] ?? ''),
    value: row[valueIdx] as string | number,
    createdAt: Number(row[createdAtIdx]) || 0,
  }));
}

export function registerDebugMemoryRoute(app: Express) {
  app.get('/debug/memory', async (req: Request, res: Response) => {
    let anchorCount = 0;
    let schemaCount = 0;
    const bootstrapEntries: Array<{ themes?: string[] }> = [];
    const userId = (req.query.userId as string) || 'anonymous';

    const debugData: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      memorySummary: { anchorCount: 0, schemaCount: 0, bootstrapThemeCount: 0, lastFact: null },
      featureFlags,
      falkor: { status: 'unknown' },
      chroma: { status: 'unknown' },
      bootstrap: { status: 'unknown', users: [] },
      facts: { recent: [] as Array<{ type: string; slot: string; value: string | number; createdAt: number }> },
    };
    const d = debugData as Record<string, Record<string, unknown> & { recent?: unknown[]; samples?: unknown; ids?: string[] }>;

    // 1. Falkor Audit
    try {
      const falkor = getFalkorClient();
      await falkor.ping();
      d.falkor.status = 'OK';

      const graphsRaw: unknown = await falkor.call('GRAPH.LIST');
      d.falkor.graphs = graphsRaw;

      if (Array.isArray(graphsRaw) && graphsRaw.includes('lora_anchors')) {
        const countRaw: unknown = await falkor.call('GRAPH.QUERY', GRAPH_NAME, ANCHOR_COUNT_QUERY);
        const countRows = countRaw as [unknown, unknown[][]];
        anchorCount = Number(countRows[1]?.[0]?.[0] ?? 0);
        d.falkor.nodeCount = anchorCount;

        // Recent facts from Falkor only (type, slot, value, createdAt)
        try {
          const factsRaw = await graphQuery(GRAPH_NAME, FACTS_RECENT_QUERY, { userId });
          const recent = parseFactsResult(factsRaw);
          d.facts.recent = recent;
        } catch {
          d.facts.recent = [];
        }

        // Sample 10 nodes (sanitized)
        const sampleRaw: unknown = await falkor.call('GRAPH.QUERY', GRAPH_NAME, 'MATCH (a:Anchor) RETURN a.anchorId, a.payloadJson LIMIT 10');
        const data = (sampleRaw as unknown[][])[1] ?? [];

        d.falkor.samples = (data as unknown[][]).map((row: unknown) => {
          const r = row as unknown[];
          const anchorId = r[0];
          const payloadJson = r[1];
          let sanitizedPayload = {};
          try {
            const payload = JSON.parse(String(payloadJson ?? ''));
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
    } catch (err: unknown) {
      d.falkor.status = 'ERROR';
      d.falkor.error = err instanceof Error ? err.message : String(err);
    }

    // 2. Chroma Audit
    try {
      const chroma = getChromaClient();
      await chroma.heartbeat();
      d.chroma.status = 'OK';

      const collections = await chroma.listCollections();
      d.chroma.collections = collections.map((c: { name: string }) => c.name);

      if ((d.chroma.collections as string[]).includes('lora_schemas')) {
        const collection = await chroma.getCollection({ name: 'lora_schemas' });
        schemaCount = await collection.count();
        d.chroma.schemaCount = schemaCount;

        // Sample 10 ids + metadatas
        const samples = await collection.get({ limit: 10 });
        d.chroma.samples = (samples.ids ?? []).map((id: string, i: number) => ({
          id,
          metadata: samples.metadatas?.[i],
        }));
      }
    } catch (err: unknown) {
      d.chroma.status = 'ERROR';
      d.chroma.error = err instanceof Error ? err.message : String(err);
    }

    // 3. Bootstrap Audit
    try {
      if (fs.existsSync(BOOTSTRAP_DIR)) {
        d.bootstrap.status = 'OK';
        const files = fs.readdirSync(BOOTSTRAP_DIR).filter((f: string) => f.endsWith('.json'));

        d.bootstrap.users = files.map((file: string) => {
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
        d.bootstrap.status = 'NOT_FOUND';
        d.bootstrap.path = path.resolve(BOOTSTRAP_DIR);
      }
    } catch (err: unknown) {
      d.bootstrap.status = 'ERROR';
      d.bootstrap.error = err instanceof Error ? err.message : String(err);
    }

    const recent = d.facts.recent as Array<{ type: string; slot: string; value: string | number; createdAt: number }>;
    const lastFact = recent.length > 0
      ? { type: recent[0].type, slot: recent[0].slot, value: recent[0].value }
      : null;

    debugData.memorySummary = computeMemorySummary({
      anchorCount,
      schemaCount,
      bootstrapEntries,
      lastFact,
    });

    res.json(debugData);
  });
}
