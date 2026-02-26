import { analyzeMemoryV1Logs, renderMemoryV1ShadowReportMd, MEMORY_V1_DRIFT_THRESHOLDS } from '../analytics';
import type { MemoryV1ShadowEvent, MemoryV1DebugSnapshotEvent } from '../analyticsTypes';
import { computeMemoryV1PolicySignature } from '../policySignature';
import { getMemoryV1Policy } from '../policyMap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShadowEvent(overrides: Partial<MemoryV1ShadowEvent> = {}): MemoryV1ShadowEvent {
  return {
    tag: 'memory:v1:shadow',
    tsMs: 1000,
    userId: 'user-a',
    band: 'B3',
    policySig: computeMemoryV1PolicySignature(getMemoryV1Policy('B3')),
    injected: true,
    memoryContext: {
      sessionPattern: 'calm-stable',
      confidenceLevel: 'MED',
      topSchemas: [
        {
          schemaId: 's1',
          emotionTrajectory: 'calm-stable',
          behavioralTendency: 'omitted',
          relevance: 'HIGH',
        },
      ],
    },
    ...overrides,
  };
}

function makeDebugEvent(overrides: Partial<MemoryV1DebugSnapshotEvent> = {}): MemoryV1DebugSnapshotEvent {
  return {
    tag: 'memory:v1:debug',
    tsMs: 1000,
    userId: 'user-a',
    band: 'B3',
    topSchemaIds: ['s1'],
    confidenceBucket: 'MED',
    winnerId: 's1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Aggregation totals
// ---------------------------------------------------------------------------

describe('analytics — aggregation totals', () => {
  it('counts events, users, injections correctly', () => {
    const events = [
      makeShadowEvent({ userId: 'u1', injected: true }),
      makeShadowEvent({ userId: 'u1', injected: false }),
      makeShadowEvent({ userId: 'u2', injected: true }),
      makeDebugEvent({ userId: 'u3' }),
    ];
    const report = analyzeMemoryV1Logs(events);

    expect(report.totals.events).toBe(4);
    expect(report.totals.users).toBe(3);
    expect(report.totals.injectedCount).toBe(2);
    expect(report.totals.injectedRate).toBeCloseTo(2 / 3, 3);
  });

  it('handles empty input', () => {
    const report = analyzeMemoryV1Logs([]);
    expect(report.totals.events).toBe(0);
    expect(report.totals.users).toBe(0);
    expect(report.totals.injectedRate).toBe(0);
  });

  it('ignores non-parseable entries', () => {
    const report = analyzeMemoryV1Logs([
      'garbage line',
      42,
      null,
      makeShadowEvent(),
    ]);
    expect(report.totals.events).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic ordering for countsByPolicySig
// ---------------------------------------------------------------------------

describe('analytics — countsByPolicySig ordering', () => {
  it('sorted by count desc then sig asc', () => {
    const sigB2 = computeMemoryV1PolicySignature(getMemoryV1Policy('B2'));
    const sigB3 = computeMemoryV1PolicySignature(getMemoryV1Policy('B3'));
    const sigB4 = computeMemoryV1PolicySignature(getMemoryV1Policy('B4'));

    const events = [
      makeShadowEvent({ policySig: sigB3 }),
      makeShadowEvent({ policySig: sigB3 }),
      makeShadowEvent({ policySig: sigB4 }),
      makeShadowEvent({ policySig: sigB4 }),
      makeShadowEvent({ policySig: sigB2 }),
    ];
    const report = analyzeMemoryV1Logs(events);

    expect(report.countsByPolicySig.length).toBe(3);
    // B3 and B4 both have count 2, B2 has count 1
    // Count desc, then sig asc for ties
    expect(report.countsByPolicySig[0].count).toBe(2);
    expect(report.countsByPolicySig[1].count).toBe(2);
    expect(report.countsByPolicySig[0].sig.localeCompare(report.countsByPolicySig[1].sig)).toBeLessThan(0);
    expect(report.countsByPolicySig[2].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. HIGH flag: INJECTION_AT_LOW_BAND
// ---------------------------------------------------------------------------

describe('analytics — HIGH: INJECTION_AT_LOW_BAND', () => {
  it('flags when injection at B0', () => {
    const events = [
      makeShadowEvent({ band: 'B0', injected: true }),
    ];
    const report = analyzeMemoryV1Logs(events);
    const flag = report.flags.find((f) => f.code === 'INJECTION_AT_LOW_BAND');
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe('HIGH');
  });

  it('flags when injection at B1', () => {
    const events = [
      makeShadowEvent({ band: 'B1', injected: true }),
    ];
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'INJECTION_AT_LOW_BAND')).toBe(true);
  });

  it('does not flag B0/B1 when not injected', () => {
    const events = [
      makeShadowEvent({ band: 'B0', injected: false }),
      makeShadowEvent({ band: 'B1', injected: false }),
    ];
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'INJECTION_AT_LOW_BAND')).toBe(false);
  });

  it('does not flag B2+ injections', () => {
    const events = [
      makeShadowEvent({ band: 'B2', injected: true }),
      makeShadowEvent({ band: 'B4', injected: true }),
    ];
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'INJECTION_AT_LOW_BAND')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. HIGH flag: FORBIDDEN_TOKEN
// ---------------------------------------------------------------------------

describe('analytics — HIGH: FORBIDDEN_TOKEN', () => {
  it('flags when companionship token in trajectory', () => {
    const events = [
      makeShadowEvent({
        memoryContext: {
          sessionPattern: 'calm-stable',
          confidenceLevel: 'MED',
          topSchemas: [{
            schemaId: 's1',
            emotionTrajectory: 'companion',
            relevance: 'HIGH',
          }],
        },
      }),
    ];
    const report = analyzeMemoryV1Logs(events);
    const flag = report.flags.find((f) => f.code === 'FORBIDDEN_TOKEN');
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe('HIGH');
  });

  it('flags CASUAL token', () => {
    const events = [
      makeShadowEvent({
        memoryContext: {
          sessionPattern: 'CASUAL',
          confidenceLevel: 'MED',
          topSchemas: [],
        },
      }),
    ];
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'FORBIDDEN_TOKEN')).toBe(true);
  });

  it('does not flag clean events', () => {
    const events = [makeShadowEvent()];
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'FORBIDDEN_TOKEN')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. MED flag: EXCESSIVE_INJECTION_RATE per user
// ---------------------------------------------------------------------------

describe('analytics — MED: EXCESSIVE_INJECTION_RATE', () => {
  it('flags when user injection rate > threshold', () => {
    const events: MemoryV1ShadowEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeShadowEvent({ userId: 'heavy-user', injected: true }));
    }
    const report = analyzeMemoryV1Logs(events);
    const flag = report.flags.find((f) => f.code === 'EXCESSIVE_INJECTION_RATE');
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe('MED');
    expect(flag!.detail).toContain('heavy-user');
  });

  it('does not flag when rate is below threshold', () => {
    const events: MemoryV1ShadowEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeShadowEvent({ userId: 'moderate-user', injected: i < 5 }));
    }
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'EXCESSIVE_INJECTION_RATE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. MED flag: OSCILLATION_SPIKE from debug stream
// ---------------------------------------------------------------------------

describe('analytics — MED: OSCILLATION_SPIKE', () => {
  it('flags when winner flips exceed threshold', () => {
    const events: MemoryV1DebugSnapshotEvent[] = [];
    const threshold = MEMORY_V1_DRIFT_THRESHOLDS.oscillationSpikeCount;
    for (let i = 0; i < threshold + 2; i++) {
      events.push(makeDebugEvent({
        userId: 'flip-user',
        winnerId: i % 2 === 0 ? 's1' : 's2',
        tsMs: 1000 + i,
      }));
    }
    const report = analyzeMemoryV1Logs(events);
    const flag = report.flags.find((f) => f.code === 'OSCILLATION_SPIKE');
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe('MED');
    expect(flag!.detail).toContain('flip-user');
  });

  it('does not flag when flips are under threshold', () => {
    const events = [
      makeDebugEvent({ userId: 'stable', winnerId: 's1', tsMs: 1000 }),
      makeDebugEvent({ userId: 'stable', winnerId: 's1', tsMs: 2000 }),
      makeDebugEvent({ userId: 'stable', winnerId: 's2', tsMs: 3000 }),
    ];
    const report = analyzeMemoryV1Logs(events);
    expect(report.flags.some((f) => f.code === 'OSCILLATION_SPIKE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Rendered markdown
// ---------------------------------------------------------------------------

describe('analytics — markdown rendering', () => {
  it('contains Flags section and "No flags raised" when clean', () => {
    const events = [
      makeShadowEvent({ band: 'B3', injected: false }),
    ];
    const report = analyzeMemoryV1Logs(events);
    const md = renderMemoryV1ShadowReportMd(report);

    expect(md).toContain('## Flags');
    expect(md).toContain('No flags raised.');
  });

  it('contains flag table when flags present', () => {
    const events = [
      makeShadowEvent({ band: 'B0', injected: true }),
    ];
    const report = analyzeMemoryV1Logs(events);
    const md = renderMemoryV1ShadowReportMd(report);

    expect(md).toContain('## Flags');
    expect(md).toContain('INJECTION_AT_LOW_BAND');
    expect(md).toContain('HIGH');
    expect(md).not.toContain('No flags raised.');
  });

  it('contains all expected sections', () => {
    const report = analyzeMemoryV1Logs([makeShadowEvent()]);
    const md = renderMemoryV1ShadowReportMd(report);

    expect(md).toContain('## Totals');
    expect(md).toContain('## Counts by Band');
    expect(md).toContain('## Counts by Policy Signature');
    expect(md).toContain('## Confidence Distribution');
    expect(md).toContain('## Top Trajectories');
    expect(md).toContain('## Top Tendencies');
    expect(md).toContain('## Flags');
  });

  it('injection rate displayed as percentage', () => {
    const events = [
      makeShadowEvent({ injected: true }),
      makeShadowEvent({ injected: false }),
    ];
    const report = analyzeMemoryV1Logs(events);
    const md = renderMemoryV1ShadowReportMd(report);
    expect(md).toContain('50.0%');
  });
});

// ---------------------------------------------------------------------------
// 8. Policy signature
// ---------------------------------------------------------------------------

describe('policySignature', () => {
  it('B2 signature is deterministic and categorical', () => {
    const sig = computeMemoryV1PolicySignature(getMemoryV1Policy('B2'));
    expect(sig).toBe('B2:inject=Y:max=1:traj=Y:tend=N:pattern=N');
  });

  it('B4 signature', () => {
    const sig = computeMemoryV1PolicySignature(getMemoryV1Policy('B4'));
    expect(sig).toBe('B4:inject=Y:max=3:traj=Y:tend=Y:pattern=Y');
  });

  it('B0 signature', () => {
    const sig = computeMemoryV1PolicySignature(getMemoryV1Policy('B0'));
    expect(sig).toBe('B0:inject=N:max=0:traj=N:tend=N:pattern=N');
  });

  it('no floats in any signature', () => {
    for (const band of ['B0', 'B1', 'B2', 'B3', 'B4'] as const) {
      const sig = computeMemoryV1PolicySignature(getMemoryV1Policy(band));
      expect(sig).not.toMatch(/\d+\.\d+/);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. String input parsing (JSON lines from log files)
// ---------------------------------------------------------------------------

describe('analytics — string parsing', () => {
  it('parses prefixed JSON lines', () => {
    const line = `[LoRa::MemoryV1Shadow] ${JSON.stringify(makeShadowEvent())}`;
    const report = analyzeMemoryV1Logs([line]);
    expect(report.totals.events).toBe(1);
  });

  it('parses debug prefixed lines', () => {
    const line = `[LoRa::MemoryV1Debug] ${JSON.stringify(makeDebugEvent())}`;
    const report = analyzeMemoryV1Logs([line]);
    expect(report.totals.events).toBe(1);
  });
});
