import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runScenario } from '../runtime';
import {
  calmStable,
  volatileModerate,
  intenseStable,
  violationSpike,
} from '../fixtures';
import type { RuntimeScenario } from '../runtimeTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-v1-runtime-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Deterministic logs for same scenario
// ---------------------------------------------------------------------------

describe('runtime – determinism', () => {
  it('produces identical logs for identical scenario runs', () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    const a = runScenario(calmStable, { baseDir: dirA });
    const b = runScenario(calmStable, { baseDir: dirB });
    expect(JSON.stringify(a.logs)).toBe(JSON.stringify(b.logs));
  });
});

// ---------------------------------------------------------------------------
// 2. Persistence round-trip
// ---------------------------------------------------------------------------

describe('runtime – persistence', () => {
  it('schema count persists across runs', () => {
    const r1 = runScenario(calmStable, { baseDir: tmpDir });
    const schemasAfterFirst = r1.finalState.schemas.schemas.length;
    expect(schemasAfterFirst).toBeGreaterThan(0);

    const r2 = runScenario(calmStable, { baseDir: tmpDir });
    expect(r2.finalState.schemas.schemas.length).toBeGreaterThanOrEqual(schemasAfterFirst);
  });

  it('savedPath points to an existing file', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir });
    expect(fs.existsSync(r.savedPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. calmStable produces >= 1 schema
// ---------------------------------------------------------------------------

describe('runtime – calmStable', () => {
  it('produces at least 1 schema after endSession', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir });
    expect(r.finalState.schemas.schemas.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. volatileModerate produces >= 2 schemas
// ---------------------------------------------------------------------------

describe('runtime – volatileModerate', () => {
  it('creates >= 2 schemas after endSession', () => {
    const r = runScenario(volatileModerate, { baseDir: tmpDir });
    expect(r.finalState.schemas.schemas.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 5. violationSpike forces episodic writes
// ---------------------------------------------------------------------------

describe('runtime – violationSpike', () => {
  it('forces at least 1 episodic write despite some below-floor messages', () => {
    const r = runScenario(violationSpike, { baseDir: tmpDir });
    const consolidateLog = r.logs.find((l) => l.tag === 'memory:consolidate');
    expect(consolidateLog).toBeDefined();
    expect((consolidateLog!.payload.totalEpisodes as number)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Logs contain only 3-decimal numbers
// ---------------------------------------------------------------------------

describe('runtime – log precision', () => {
  it('no numeric values beyond 3 decimal places in log JSON', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir });
    const json = JSON.stringify(r.logs);
    const overPrecision = json.match(/\d+\.\d{4,}/g);
    expect(overPrecision).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. No NaN / Infinity in logs
// ---------------------------------------------------------------------------

describe('runtime – NaN/Infinity safety', () => {
  it('no NaN or Infinity anywhere in log payloads', () => {
    const r = runScenario(intenseStable, { baseDir: tmpDir });
    const json = JSON.stringify(r.logs);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
  });

  it('no NaN or Infinity in volatileModerate logs', () => {
    const r = runScenario(volatileModerate, { baseDir: tmpDir });
    const json = JSON.stringify(r.logs);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
  });
});

// ---------------------------------------------------------------------------
// 8. memoryContexts null before schemas, non-null after consolidation+rerun
// ---------------------------------------------------------------------------

describe('runtime – memoryContext lifecycle', () => {
  it('contexts are null on first run (no schemas), non-null on second run', () => {
    const r1 = runScenario(calmStable, { baseDir: tmpDir });
    for (const mc of r1.memoryContexts) {
      expect(mc.ctx).toBeNull();
    }
    expect(r1.finalState.schemas.schemas.length).toBeGreaterThan(0);

    const r2 = runScenario(calmStable, { baseDir: tmpDir });
    const nonNull = r2.memoryContexts.filter((mc) => mc.ctx !== null);
    expect(nonNull.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 9. intenseStable produces schemas
// ---------------------------------------------------------------------------

describe('runtime – intenseStable', () => {
  it('produces at least 1 schema after endSession', () => {
    const r = runScenario(intenseStable, { baseDir: tmpDir });
    expect(r.finalState.schemas.schemas.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Log event counts
// ---------------------------------------------------------------------------

describe('runtime – log structure', () => {
  it('produces encode + retrieve logs per message, plus 1 consolidate', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir });
    const encodes = r.logs.filter((l) => l.tag === 'memory:encode');
    const retrieves = r.logs.filter((l) => l.tag === 'memory:retrieve');
    const consolidates = r.logs.filter((l) => l.tag === 'memory:consolidate');
    expect(encodes.length).toBe(8);
    expect(retrieves.length).toBe(8);
    expect(consolidates.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11. decisionLogEnabled=false suppresses logs
// ---------------------------------------------------------------------------

describe('runtime – log toggle', () => {
  it('no logs when decisionLogEnabled is false', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir, decisionLogEnabled: false });
    expect(r.logs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Episodic buffer is cleared after endSession
// ---------------------------------------------------------------------------

describe('runtime – episodic cleared', () => {
  it('finalState episodic is empty after endSession', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir });
    expect(r.finalState.episodic.events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. noveltyFlag in consolidation log
// ---------------------------------------------------------------------------

describe('runtime – noveltyFlag', () => {
  it('first run sets noveltyFlag true in consolidate log', () => {
    const r = runScenario(calmStable, { baseDir: tmpDir });
    const consolidateLog = r.logs.find((l) => l.tag === 'memory:consolidate');
    expect(consolidateLog!.payload.noveltyFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14. memoryContexts array has correct length
// ---------------------------------------------------------------------------

describe('runtime – memoryContexts shape', () => {
  it('has one entry per message', () => {
    const r = runScenario(volatileModerate, { baseDir: tmpDir });
    expect(r.memoryContexts.length).toBe(8);
    for (const mc of r.memoryContexts) {
      expect(typeof mc.messageId).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// 15. All schema centroids are length 21
// ---------------------------------------------------------------------------

describe('runtime – centroid integrity', () => {
  it('all schema centroids have length 21', () => {
    const r = runScenario(volatileModerate, { baseDir: tmpDir });
    for (const s of r.finalState.schemas.schemas) {
      expect(s.centroid.length).toBe(21);
    }
  });
});

// ---------------------------------------------------------------------------
// 16. Second-run retrieval non-empty
// ---------------------------------------------------------------------------

describe('runtime – retrieval after persistence', () => {
  it('second run retrieves schemas from first run', () => {
    runScenario(intenseStable, { baseDir: tmpDir });
    const r2 = runScenario(intenseStable, { baseDir: tmpDir });
    const retrieves = r2.logs.filter((l) => l.tag === 'memory:retrieve');
    const matched = retrieves.filter((l) => l.payload.noMatch === false);
    expect(matched.length).toBeGreaterThan(0);
  });
});
