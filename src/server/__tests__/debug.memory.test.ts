// src/server/__tests__/debug.memory.test.ts

import http from 'http';
import express from 'express';
import { registerDebugMemoryRoute } from '../routes/debug.memory.route';
import * as fs from 'fs';

const FORBIDDEN_KEYS = ['content', 'message', 'text', 'transcript'];

function hasForbiddenKey(obj: any, seen = new Set<object>()): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  if (seen.has(obj)) return false;
  seen.add(obj);
  if (Array.isArray(obj)) {
    return obj.some((item) => hasForbiddenKey(item, seen));
  }
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.some((f) => lower === f)) return true;
    if (hasForbiddenKey(obj[key], seen)) return true;
  }
  return false;
}

// Mock: only MATCH (n:Anchor) returns anchor count (3); other nodes would be 5+ so total would be 8
const ANCHOR_COUNT_QUERY = 'MATCH (n:Anchor) RETURN count(n)';
jest.mock('../../emotion-core/memory-v1/db/falkorClient', () => ({
  getFalkorClient: () => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    call: jest.fn().mockImplementation((cmd: string, ...args: unknown[]) => {
      if (cmd === 'GRAPH.LIST') return ['lora_anchors'];
      if (cmd === 'GRAPH.QUERY' && args[1] === ANCHOR_COUNT_QUERY) return [[], [[3]]];
      if (cmd === 'GRAPH.QUERY' && typeof args[1] === 'string' && args[1].includes('MATCH (n) RETURN count(n)')) return [[], [[8]]];
      if (cmd === 'GRAPH.QUERY' && typeof args[1] === 'string' && args[1].includes('LIMIT 10')) {
        return [[], [['a-1', JSON.stringify({
          type: 'goal',
          status: 'confirmed',
          summary: { template: 'goal_active', slot: 'exercise' },
          createdAt: Date.now(),
          reinforceCount: 1,
          content: 'THIS SHOULD BE SANITIZED',
        })]]];
      }
      return [[], []];
    }),
  }),
}));

jest.mock('../../emotion-core/memory-v1/db/chromaClient', () => ({
  getChromaClient: () => ({
    heartbeat: jest.fn().mockResolvedValue(true),
    listCollections: jest.fn().mockResolvedValue([{ name: 'lora_schemas' }]),
    getCollection: jest.fn().mockResolvedValue({
      count: jest.fn().mockResolvedValue(8),
      get: jest.fn().mockResolvedValue({
        ids: ['s-1'],
        metadatas: [{ userId: 'u1', schemaId: 's-1' }],
      }),
    }),
  }),
}));

function getDebugMemory(port: number): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/debug/memory',
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(data),
            });
          } catch {
            reject(new Error(`Non-JSON response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /debug/memory', () => {
  let server: http.Server | null = null;
  let port = 0;

  beforeAll((done) => {
    const app = express();
    registerDebugMemoryRoute(app);

    if (!fs.existsSync('.lora/bootstrap')) {
      fs.mkdirSync('.lora/bootstrap', { recursive: true });
    }
    // Unique themes: discipline, focus (discipline repeated) -> bootstrapThemeCount = 2
    fs.writeFileSync(
      '.lora/bootstrap/test-user.json',
      JSON.stringify({
        userId: 'test-user',
        sessionCount: 1,
        entries: [
          { themes: ['discipline', 'focus'], role: 'user', timestamp: Date.now() },
          { themes: ['discipline'], role: 'assistant', timestamp: Date.now() },
        ],
      })
    );

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    if (fs.existsSync('.lora/bootstrap/test-user.json')) {
      fs.unlinkSync('.lora/bootstrap/test-user.json');
    }
    if (server) server.close(done);
    else done();
  });

  it('returns memorySummary with anchorCount, schemaCount, bootstrapThemeCount', async () => {
    const res = await getDebugMemory(port);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('memorySummary');
    expect(res.body.memorySummary).toMatchObject({
      anchorCount: 3,
      schemaCount: 8,
      bootstrapThemeCount: 2,
    });
  });

  it('anchor count uses label filtering (Anchor nodes only)', async () => {
    const res = await getDebugMemory(port);
    expect(res.status).toBe(200);
    expect(res.body.memorySummary.anchorCount).toBe(3);
  });

  it('bootstrap theme count is unique themes only', async () => {
    const res = await getDebugMemory(port);
    expect(res.status).toBe(200);
    expect(res.body.memorySummary.bootstrapThemeCount).toBe(2);
  });

  it('returns memory debug data with sanitized fields', async () => {
    const res = await getDebugMemory(port);

    expect(res.body).toHaveProperty('falkor');
    expect(res.body).toHaveProperty('chroma');
    expect(res.body).toHaveProperty('bootstrap');
    expect(res.body).toHaveProperty('featureFlags');

    if (res.body.falkor.samples?.length > 0) {
      const sample = res.body.falkor.samples[0].sanitizedPayload;
      expect(sample).not.toHaveProperty('content');
      expect(sample).toHaveProperty('summary');
    }

    const user = res.body.bootstrap.users?.find((u: any) => u.userId === 'test-user');
    expect(user).toBeDefined();
    expect(user.recentThemes[0]).toHaveProperty('themes');
    expect(user.recentThemes[0]).not.toHaveProperty('text');
  });

  it('never includes raw text fields (content, message, text, transcript)', async () => {
    const res = await getDebugMemory(port);
    expect(res.status).toBe(200);
    expect(hasForbiddenKey(res.body)).toBe(false);
  });
});

describe('ChromaSchemaAdapter (no embedding function)', () => {
  it('getOrCreateCollection is called without embeddingFunction', () => {
    const adapterSource = require('fs').readFileSync(
      require('path').join(__dirname, '../../emotion-core/memory-v1/db/ChromaSchemaAdapter.ts'),
      'utf-8'
    );
    expect(adapterSource).not.toMatch(/embeddingFunction/);
    expect(adapterSource).not.toMatch(/lora-schema-stub/);
    expect(adapterSource).not.toMatch(/registerEmbeddingFunction/);
  });
});
