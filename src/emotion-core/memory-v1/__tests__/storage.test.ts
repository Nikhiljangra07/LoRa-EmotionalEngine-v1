import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createJSONStorage, sanitizeUserId } from '../storage';
import type { StoredMemoryV1State } from '../storageTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-v1-storage-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function unitVec(dim: number = 0, len: number = 21): number[] {
  const v = new Array(len).fill(0);
  v[dim] = 1;
  return v;
}

function makeCleanState(userId: string = 'test-user'): StoredMemoryV1State {
  return {
    version: 1,
    userId,
    savedAtMs: 1_000_000,
    schemas: [
      {
        schemaId: 's1',
        centroid: unitVec(0),
        salienceWeight: 0.5,
        episodeCount: 3,
        retrievalBias: 0.05,
        createdAt: 900_000,
        lastUpdatedAt: 950_000,
      },
    ],
    episodic: [
      {
        mode: 'baseline',
        emotionVec: unitVec(1),
        dimSummary: { topDims: [{ dim: 1, name: 'valenceScore', value: 1 }] },
      },
    ],
    rifGuard: { recentWinners: ['s1'], cooldownRemaining: 0 },
  };
}

// ---------------------------------------------------------------------------
// 1–3. Path sanitization
// ---------------------------------------------------------------------------

describe('storage – sanitizeUserId', () => {
  it('replaces special characters with underscores', () => {
    expect(sanitizeUserId('user@email.com')).toBe('user_email_com');
  });

  it('blocks path traversal attempts', () => {
    const safe = sanitizeUserId('../../etc/passwd');
    expect(safe).not.toContain('..');
    expect(safe).not.toContain('/');
  });

  it('handles empty string', () => {
    expect(sanitizeUserId('')).toBe('_empty_');
  });

  it('truncates long userIds', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeUserId(long).length).toBeLessThanOrEqual(128);
  });
});

// ---------------------------------------------------------------------------
// 4. getPath returns expected format
// ---------------------------------------------------------------------------

describe('storage – getPath', () => {
  it('returns baseDir/safeUserId/state.json', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('alice');
    expect(p).toBe(path.join(tmpDir, 'alice', 'state.json'));
  });
});

// ---------------------------------------------------------------------------
// 5–6. Atomic write
// ---------------------------------------------------------------------------

describe('storage – save', () => {
  it('creates directory recursively and writes file', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    storage.save(state);
    const p = storage.getPath('test-user');
    expect(fs.existsSync(p)).toBe(true);
  });

  it('leaves no .tmp file after atomic write', () => {
    const storage = createJSONStorage(tmpDir);
    storage.save(makeCleanState());
    const p = storage.getPath('test-user');
    expect(fs.existsSync(`${p}.tmp`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Load missing returns null
// ---------------------------------------------------------------------------

describe('storage – load missing', () => {
  it('returns null when file does not exist', () => {
    const storage = createJSONStorage(tmpDir);
    expect(storage.load('nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Corrupt JSON returns null
// ---------------------------------------------------------------------------

describe('storage – corrupt JSON', () => {
  it('returns null for invalid JSON', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('bad');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{{{not json!!!', 'utf-8');
    expect(storage.load('bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Validation rejects wrong version / missing userId
// ---------------------------------------------------------------------------

describe('storage – validation', () => {
  it('returns null for wrong version', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('v2');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version: 2, userId: 'v2' }), 'utf-8');
    expect(storage.load('v2')).toBeNull();
  });

  it('returns null when userId is not a string', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('no-uid');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version: 1, userId: 123 }), 'utf-8');
    expect(storage.load('no-uid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10–12. Clamping and normalization on load
// ---------------------------------------------------------------------------

describe('storage – clamping on load', () => {
  it('clamps salienceWeight to [0,1]', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    state.schemas[0].salienceWeight = 5.0;
    storage.save(state);

    const loaded = storage.load('test-user')!;
    expect(loaded.schemas[0].salienceWeight).toBe(1);
  });

  it('clamps retrievalBias to [-0.2, 0.2]', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    state.schemas[0].retrievalBias = 0.99;
    storage.save(state);

    const loaded = storage.load('test-user')!;
    expect(loaded.schemas[0].retrievalBias).toBe(0.2);
  });

  it('L2-normalizes centroid on load', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    state.schemas[0].centroid = new Array(21).fill(3);
    storage.save(state);

    const loaded = storage.load('test-user')!;
    const norm = Math.sqrt(
      loaded.schemas[0].centroid.reduce((s, v) => s + v * v, 0),
    );
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// 13. Drops malformed episodic vectors
// ---------------------------------------------------------------------------

describe('storage – episodic validation', () => {
  it('drops events with wrong emotionVec length', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    state.episodic = [
      {
        mode: 'baseline',
        emotionVec: [1, 2, 3], // wrong length
        dimSummary: { topDims: [] },
      },
      {
        mode: 'baseline',
        emotionVec: unitVec(0),
        dimSummary: { topDims: [] },
      },
    ];
    storage.save(state);

    const loaded = storage.load('test-user')!;
    expect(loaded.episodic.length).toBe(1);
    expect(loaded.episodic[0].emotionVec.length).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// 14–15. Caps
// ---------------------------------------------------------------------------

describe('storage – capacity caps', () => {
  it('caps schemas to 20', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    state.schemas = Array.from({ length: 25 }, (_, i) => ({
      schemaId: `s${i}`,
      centroid: unitVec(i % 21),
      salienceWeight: 0.5,
      episodeCount: 1,
      retrievalBias: 0,
      createdAt: 0,
      lastUpdatedAt: 0,
    }));
    storage.save(state);

    const loaded = storage.load('test-user')!;
    expect(loaded.schemas.length).toBe(20);
  });

  it('caps episodic to 30', () => {
    const storage = createJSONStorage(tmpDir);
    const state = makeCleanState();
    state.episodic = Array.from({ length: 35 }, () => ({
      mode: 'baseline' as const,
      emotionVec: unitVec(0),
      dimSummary: { topDims: [] },
    }));
    storage.save(state);

    const loaded = storage.load('test-user')!;
    expect(loaded.episodic.length).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 16. Deep copy
// ---------------------------------------------------------------------------

describe('storage – deep copy', () => {
  it('modifying loaded object does not affect subsequent loads', () => {
    const storage = createJSONStorage(tmpDir);
    storage.save(makeCleanState());

    const a = storage.load('test-user')!;
    a.schemas[0].salienceWeight = 0.999;
    a.rifGuard.recentWinners.push('mutated');

    const b = storage.load('test-user')!;
    expect(b.schemas[0].salienceWeight).toBe(0.5);
    expect(b.rifGuard.recentWinners).not.toContain('mutated');
  });
});

// ---------------------------------------------------------------------------
// 17. Round-trip identity
// ---------------------------------------------------------------------------

describe('storage – round trip', () => {
  it('save then load returns equivalent state for clean data', () => {
    const storage = createJSONStorage(tmpDir);
    const original = makeCleanState();
    storage.save(original);
    const loaded = storage.load('test-user')!;

    expect(loaded.version).toBe(original.version);
    expect(loaded.userId).toBe(original.userId);
    expect(loaded.savedAtMs).toBe(original.savedAtMs);
    expect(loaded.schemas.length).toBe(original.schemas.length);
    expect(loaded.schemas[0].schemaId).toBe(original.schemas[0].schemaId);
    expect(loaded.schemas[0].salienceWeight).toBe(original.schemas[0].salienceWeight);
    expect(loaded.schemas[0].retrievalBias).toBe(original.schemas[0].retrievalBias);
    expect(loaded.episodic.length).toBe(original.episodic.length);
    expect(loaded.episodic[0].mode).toBe(original.episodic[0].mode);
    expect(loaded.rifGuard).toEqual(original.rifGuard);

    // centroid is L2-normalized; original is already unit vec so should match
    for (let i = 0; i < 21; i++) {
      expect(Math.abs(loaded.schemas[0].centroid[i] - original.schemas[0].centroid[i])).toBeLessThan(1e-10);
    }
  });
});

// ---------------------------------------------------------------------------
// 18–19. NaN / Infinity safety
// ---------------------------------------------------------------------------

describe('storage – NaN/Infinity safety', () => {
  it('replaces NaN in centroid with 0 and normalizes', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('nan-test');
    fs.mkdirSync(path.dirname(p), { recursive: true });

    const state = {
      version: 1,
      userId: 'nan-test',
      savedAtMs: 0,
      schemas: [
        {
          schemaId: 'sNaN',
          centroid: Array.from({ length: 21 }, (_, i) => (i === 0 ? NaN : 0.5)),
          salienceWeight: NaN,
          episodeCount: 1,
          retrievalBias: NaN,
          createdAt: 0,
          lastUpdatedAt: 0,
        },
      ],
      episodic: [],
      rifGuard: { recentWinners: [], cooldownRemaining: 0 },
    };
    fs.writeFileSync(p, JSON.stringify(state), 'utf-8');

    const loaded = storage.load('nan-test')!;
    for (const v of loaded.schemas[0].centroid) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(Number.isFinite(loaded.schemas[0].salienceWeight)).toBe(true);
    expect(Number.isFinite(loaded.schemas[0].retrievalBias)).toBe(true);
  });

  it('replaces Infinity in salienceWeight with clamped value', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('inf-test');
    fs.mkdirSync(path.dirname(p), { recursive: true });

    const state = {
      version: 1,
      userId: 'inf-test',
      savedAtMs: 0,
      schemas: [
        {
          schemaId: 'sInf',
          centroid: unitVec(0),
          salienceWeight: Infinity,
          episodeCount: 1,
          retrievalBias: -Infinity,
          createdAt: 0,
          lastUpdatedAt: 0,
        },
      ],
      episodic: [],
      rifGuard: { recentWinners: [], cooldownRemaining: 0 },
    };
    fs.writeFileSync(p, JSON.stringify(state), 'utf-8');

    const loaded = storage.load('inf-test')!;
    expect(loaded.schemas[0].salienceWeight).toBe(0);
    expect(loaded.schemas[0].retrievalBias).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 20. rifGuard sanitization
// ---------------------------------------------------------------------------

describe('storage – rifGuard sanitization', () => {
  it('provides defaults for missing/invalid rifGuard', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('guard');
    fs.mkdirSync(path.dirname(p), { recursive: true });

    const state = {
      version: 1,
      userId: 'guard',
      savedAtMs: 0,
      schemas: [],
      episodic: [],
      rifGuard: null,
    };
    fs.writeFileSync(p, JSON.stringify(state), 'utf-8');

    const loaded = storage.load('guard')!;
    expect(loaded.rifGuard).toEqual({ recentWinners: [], cooldownRemaining: 0 });
  });

  it('filters non-string entries from recentWinners', () => {
    const storage = createJSONStorage(tmpDir);
    const p = storage.getPath('guard2');
    fs.mkdirSync(path.dirname(p), { recursive: true });

    const state = {
      version: 1,
      userId: 'guard2',
      savedAtMs: 0,
      schemas: [],
      episodic: [],
      rifGuard: { recentWinners: ['a', 123, null, 'b'], cooldownRemaining: 2.7 },
    };
    fs.writeFileSync(p, JSON.stringify(state), 'utf-8');

    const loaded = storage.load('guard2')!;
    expect(loaded.rifGuard.recentWinners).toEqual(['a', 'b']);
    expect(loaded.rifGuard.cooldownRemaining).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 21. Episodic NaN sanitization
// ---------------------------------------------------------------------------

describe('storage – episodic NaN', () => {
  it('replaces NaN in emotionVec with 0', () => {
    const storage = createJSONStorage(tmpDir);
    const vec = new Array(21).fill(0);
    vec[0] = NaN;
    vec[5] = Infinity;
    const state: StoredMemoryV1State = {
      version: 1,
      userId: 'ev-nan',
      savedAtMs: 0,
      schemas: [],
      episodic: [
        { mode: 'baseline', emotionVec: vec, dimSummary: { topDims: [] } },
      ],
      rifGuard: { recentWinners: [], cooldownRemaining: 0 },
    };
    storage.save(state);

    const loaded = storage.load('ev-nan')!;
    for (const v of loaded.episodic[0].emotionVec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
