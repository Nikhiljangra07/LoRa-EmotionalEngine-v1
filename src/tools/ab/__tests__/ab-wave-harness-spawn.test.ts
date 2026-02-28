/**
 * Unit tests for spawn-based A/B harness: child output parsing,
 * invalid JSON handling, and bridge-off invariant enforcement.
 *
 * Mocks child_process.spawn — no real subprocess.
 */

// Build minimal valid TurnResult for bridge-OFF (all appraisal-only fields absent)
function makeCleanTurn(i: number): Record<string, unknown> {
  return {
    turn: i,
    userMessage: 'test',
    assistantResponse: 'response',
    guidanceMode: 'calm',
    ekmanDominant: null,
    ekmanConfidence: null,
    volatilityState: 'low',
    escalationLevel: null,
    escalationState: null,
    escalationTrend: null,
    pacingHint: null,
    questionBudgetHint: null,
    validationIntensity: null,
    hints: [],
    prompt: 'plain prompt',
    maskedPressure: null,
    volatilityTrend: null,
    ekmanInfluenceApplied: null,
    promptOverlays: [],
  };
}

function makeViolatingTurn(i: number): Record<string, unknown> {
  return {
    ...makeCleanTurn(i),
    maskedPressure: true,
  };
}

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { spawnRun, enforceBridgeOffCleanliness } from '../ab-wave-harness';

describe('spawn-based A/B harness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses valid JSON from child and returns RunResult', async () => {
    const turns = [makeCleanTurn(1), makeCleanTurn(2)];
    const payload = JSON.stringify({ runLabel: 'A', turns }) + '\n';
    (spawn as jest.Mock).mockImplementation(() => {
      const child: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      setImmediate(() => {
        const dataCb = child.stdout.on.mock.calls.find((c: any) => c[0] === 'data')?.[1];
        if (dataCb) dataCb(Buffer.from(payload));
        const closeCb = child.on.mock.calls.find((c: any) => c[0] === 'close')?.[1];
        if (closeCb) closeCb(0);
      });
      return child;
    });

    const result = await spawnRun('A', 'v1');

    expect(result.label).toBe('A (Appraisal ON)');
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].turn).toBe(1);
    expect(result.turns[1].turn).toBe(2);
  });

  it('parses valid B JSON and returns RunResult', async () => {
    const turns = [makeCleanTurn(1)];
    const payload = JSON.stringify({ runLabel: 'B', turns }) + '\n';
    (spawn as jest.Mock).mockImplementation(() => {
      const child: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      setImmediate(() => {
        const dataCb = child.stdout.on.mock.calls.find((c: any) => c[0] === 'data')?.[1];
        if (dataCb) dataCb(Buffer.from(payload));
        const closeCb = child.on.mock.calls.find((c: any) => c[0] === 'close')?.[1];
        if (closeCb) closeCb(0);
      });
      return child;
    });

    const result = await spawnRun('B', 'v1');

    expect(result.label).toBe('B (Appraisal OFF)');
    expect(result.turns).toHaveLength(1);
  });

  it('rejects when child outputs invalid JSON', async () => {
    (spawn as jest.Mock).mockImplementation(() => {
      const child: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      setImmediate(() => {
        const dataCb = child.stdout.on.mock.calls.find((c: any) => c[0] === 'data')?.[1];
        if (dataCb) dataCb(Buffer.from('not valid json {{{'));
        const closeCb = child.on.mock.calls.find((c: any) => c[0] === 'close')?.[1];
        if (closeCb) closeCb(0);
      });
      return child;
    });

    await expect(spawnRun('A', 'v1')).rejects.toThrow(/invalid JSON|Expected single JSON/);
  });

  it('rejects when child exits non-zero', async () => {
    (spawn as jest.Mock).mockImplementation(() => {
      const child: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      setImmediate(() => {
        const closeCb = child.on.mock.calls.find((c: any) => c[0] === 'close')?.[1];
        if (closeCb) closeCb(1);
      });
      return child;
    });

    await expect(spawnRun('A', 'v1')).rejects.toThrow(/exited 1|Child A exited/);
  });

  it('rejects when runLabel in output does not match requested', async () => {
    const turns = [makeCleanTurn(1)];
    const payload = JSON.stringify({ runLabel: 'B', turns }) + '\n';
    (spawn as jest.Mock).mockImplementation(() => {
      const child: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      setImmediate(() => {
        const dataCb = child.stdout.on.mock.calls.find((c: any) => c[0] === 'data')?.[1];
        if (dataCb) dataCb(Buffer.from(payload));
        const closeCb = child.on.mock.calls.find((c: any) => c[0] === 'close')?.[1];
        if (closeCb) closeCb(0);
      });
      return child;
    });

    await expect(spawnRun('A', 'v1')).rejects.toThrow(/runLabel.*does not match|Child output runLabel/);
  });
});

describe('enforceBridgeOffCleanliness (bridge-off invariant)', () => {
  it('passes when B turns have no appraisal-only signals', () => {
    const clean = [makeCleanTurn(1), makeCleanTurn(2)].map((t) => t as any);
    expect(() => enforceBridgeOffCleanliness(clean)).not.toThrow();
  });

  it('throws when B turn has maskedPressure true', () => {
    const violating = [makeViolatingTurn(1)].map((t) => t as any);
    expect(() => enforceBridgeOffCleanliness(violating)).toThrow(/Bridge-OFF invariant|maskedPressure/);
  });

  it('throws when B turn has escalationState', () => {
    const violating = [{ ...makeCleanTurn(1), escalationState: 'rising' }].map((t) => t as any);
    expect(() => enforceBridgeOffCleanliness(violating)).toThrow(/Bridge-OFF invariant|escalationState/);
  });

  it('throws when B turn has SIGNAL CONTEXT in prompt', () => {
    const violating = [{ ...makeCleanTurn(1), prompt: 'foo SIGNAL CONTEXT bar' }].map((t) => t as any);
    expect(() => enforceBridgeOffCleanliness(violating)).toThrow(/Bridge-OFF invariant|signalContext/);
  });
});
