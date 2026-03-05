// src/server/__tests__/debug.memory.test.ts

import http from 'http';
import express from 'express';
import { registerDebugMemoryRoute } from '../routes/debug.memory.route';
import * as fs from 'fs';
import * as path from 'path';

// Mock the DB clients to avoid actual connections during tests
jest.mock('../../emotion-core/memory-v1/db/falkorClient', () => ({
  getFalkorClient: () => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    call: jest.fn().mockImplementation((cmd, ...args) => {
      if (cmd === 'GRAPH.LIST') return ['lora_anchors'];
      if (cmd === 'GRAPH.QUERY' && args[1] === 'MATCH (n) RETURN count(n)') return [[], [[1]]];
      if (cmd === 'GRAPH.QUERY' && args[1].includes('LIMIT 10')) {
        return [[], [['a-1', JSON.stringify({
          type: 'goal',
          status: 'confirmed',
          summary: { template: 'goal_active', slot: 'exercise' },
          createdAt: Date.now(),
          reinforceCount: 1,
          content: 'THIS SHOULD BE SANITIZED' // Raw text that should be removed
        })]]];
      }
      return [[], []];
    })
  })
}));

jest.mock('../../emotion-core/memory-v1/db/chromaClient', () => ({
  getChromaClient: () => ({
    heartbeat: jest.fn().mockResolvedValue(true),
    listCollections: jest.fn().mockResolvedValue([{ name: 'lora_schemas' }]),
    getCollection: jest.fn().mockResolvedValue({
      count: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue({
        ids: ['s-1'],
        metadatas: [{ userId: 'u1', schemaId: 's-1' }]
      })
    })
  })
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
    
    // Ensure bootstrap dir exists for test
    if (!fs.existsSync('.lora/bootstrap')) {
      fs.mkdirSync('.lora/bootstrap', { recursive: true });
    }
    fs.writeFileSync('.lora/bootstrap/test-user.json', JSON.stringify({
      userId: 'test-user',
      sessionCount: 1,
      entries: [
        { themes: ['test'], role: 'user', timestamp: Date.now() }
      ]
    }));

    server = app.listen(0, () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    // Cleanup test data
    if (fs.existsSync('.lora/bootstrap/test-user.json')) {
      fs.unlinkSync('.lora/bootstrap/test-user.json');
    }
    if (server) server.close(done);
    else done();
  });

  it('returns memory debug data with sanitized fields', async () => {
    const res = await getDebugMemory(port);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('falkor');
    expect(res.body).toHaveProperty('chroma');
    expect(res.body).toHaveProperty('bootstrap');
    expect(res.body).toHaveProperty('featureFlags');

    // Privacy check: Falkor samples should be sanitized
    if (res.body.falkor.samples && res.body.falkor.samples.length > 0) {
      const sample = res.body.falkor.samples[0].sanitizedPayload;
      expect(sample).not.toHaveProperty('content');
      expect(sample).toHaveProperty('summary');
    }

    // Privacy check: Bootstrap should only show themes
    const user = res.body.bootstrap.users.find((u: any) => u.userId === 'test-user');
    expect(user).toBeDefined();
    expect(user.recentThemes[0]).toHaveProperty('themes');
    expect(user.recentThemes[0]).not.toHaveProperty('summary');
    expect(user.recentThemes[0]).not.toHaveProperty('text');
  });
});
