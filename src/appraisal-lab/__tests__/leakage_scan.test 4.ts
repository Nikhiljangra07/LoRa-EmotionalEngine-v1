/**
 * Tests for the synthetic label-leakage scanner.
 *
 * All tests use small in-memory fixtures — no disk I/O.
 */

import {
  scanRow,
  scanDataset,
  LeakageScanResult,
  formatScanResult,
} from '../quality/leakage_scan';

// ============================================================
// Helper: build a raw synthetic row fixture
// ============================================================

function synRow(id: string, sentiment: string, content: string) {
  return { id, sentiment, content };
}

function mergedRow(id: string, emotion: string, text: string, source: string) {
  return { id, emotion, text, source };
}

// ============================================================
// scanRow — DISGUST detections
// ============================================================

describe('scanRow — DISGUST banlist', () => {
  it('detects "disgusted"', () => {
    const m = scanRow('d1', 'DISGUST', 'I felt disgusted by the scene.');
    expect(m).toContain('disgusted');
  });

  it('detects "disgusting"', () => {
    const m = scanRow('d2', 'DISGUST', 'The smell was disgusting.');
    expect(m).toContain('disgusting');
  });

  it('detects bare "disgust"', () => {
    const m = scanRow('d3', 'DISGUST', 'A feeling of disgust overcame me.');
    expect(m).toContain('disgust');
  });

  it('detects "gross"', () => {
    const m = scanRow('d4', 'DISGUST', 'It was gross.');
    expect(m).toContain('gross');
  });

  it('detects "repulsive"', () => {
    const m = scanRow('d5', 'DISGUST', 'The conditions were repulsive.');
    expect(m).toContain('repulsive');
  });

  it('detects "nasty"', () => {
    const m = scanRow('d6', 'DISGUST', 'A nasty surprise awaited.');
    expect(m).toContain('nasty');
  });

  it('detects "sickening"', () => {
    const m = scanRow('d7', 'DISGUST', 'The sight was sickening.');
    expect(m).toContain('sickening');
  });

  it('detects "revolting"', () => {
    const m = scanRow('d8', 'DISGUST', 'The food was revolting.');
    expect(m).toContain('revolting');
  });

  it('detects "filthy"', () => {
    const m = scanRow('d9', 'DISGUST', 'The room was filthy.');
    expect(m).toContain('filthy');
  });

  it('detects multiple banned words in one row', () => {
    const m = scanRow('d10', 'DISGUST', 'It was gross and disgusting.');
    expect(m.length).toBeGreaterThanOrEqual(2);
    expect(m).toContain('gross');
    expect(m).toContain('disgusting');
  });
});

// ============================================================
// scanRow — NEUTRAL detections
// ============================================================

describe('scanRow — NEUTRAL banlist', () => {
  it('detects "neutral"', () => {
    const m = scanRow('n1', 'NEUTRAL', 'I felt neutral about it.');
    expect(m).toContain('neutral');
  });

  it('detects "emotionless"', () => {
    const m = scanRow('n2', 'NEUTRAL', 'The response was emotionless.');
    expect(m).toContain('emotionless');
  });

  it('detects "indifferent"', () => {
    const m = scanRow('n3', 'NEUTRAL', 'She seemed indifferent.');
    expect(m).toContain('indifferent');
  });

  it('detects "no emotion"', () => {
    const m = scanRow('n4', 'NEUTRAL', 'I had no emotion about the event.');
    expect(m).toContain('no emotion');
  });

  it('detects "blank"', () => {
    const m = scanRow('n5', 'NEUTRAL', 'My face was blank.');
    expect(m).toContain('blank');
  });
});

// ============================================================
// False-positive avoidance
// ============================================================

describe('false-positive avoidance', () => {
  it('does NOT flag "This feels fine." for NEUTRAL', () => {
    const m = scanRow('fp1', 'NEUTRAL', 'This feels fine.');
    expect(m).toHaveLength(0);
  });

  it('does NOT flag "I stayed calm." for NEUTRAL', () => {
    const m = scanRow('fp2', 'NEUTRAL', 'I stayed calm.');
    expect(m).toHaveLength(0);
  });

  it('does NOT flag "Nothing unusual happened." for NEUTRAL', () => {
    const m = scanRow('fp3', 'NEUTRAL', 'Nothing unusual happened.');
    expect(m).toHaveLength(0);
  });

  it('does NOT flag "okay" for NEUTRAL', () => {
    const m = scanRow('fp4', 'NEUTRAL', 'Everything was okay.');
    expect(m).toHaveLength(0);
  });

  it('does NOT flag clean DISGUST text', () => {
    const m = scanRow('fp5', 'DISGUST', 'The kitchen had sanitation issues.');
    expect(m).toHaveLength(0);
  });

  it('does NOT flag DISGUST banlist words in NEUTRAL rows', () => {
    const m = scanRow('fp6', 'NEUTRAL', 'The word disgusted appeared in the book.');
    expect(m).toHaveLength(0);
  });

  it('does NOT flag NEUTRAL banlist words in DISGUST rows', () => {
    const m = scanRow('fp7', 'DISGUST', 'She remained neutral throughout.');
    expect(m).toHaveLength(0);
  });
});

// ============================================================
// scanDataset — raw synthetic format
// ============================================================

describe('scanDataset — raw synthetic format', () => {
  it('counts scanned rows correctly', () => {
    const rows = [
      synRow('s1', 'DISGUST', 'The conditions were poor.'),
      synRow('s2', 'NEUTRAL', 'A routine morning.'),
    ];
    const r = scanDataset(rows);
    expect(r.totalRows).toBe(2);
  });

  it('reports zero violations on clean data', () => {
    const rows = [
      synRow('s1', 'DISGUST', 'The conditions were poor.'),
      synRow('s2', 'NEUTRAL', 'A routine morning.'),
    ];
    const r = scanDataset(rows);
    expect(r.violations).toBe(0);
    expect(r.rowsWithViolations).toHaveLength(0);
  });

  it('reports violations with correct detail', () => {
    const rows = [
      synRow('s1', 'DISGUST', 'I felt disgusted by what I saw.'),
      synRow('s2', 'NEUTRAL', 'A routine morning.'),
    ];
    const r = scanDataset(rows);
    expect(r.violations).toBe(1);
    expect(r.rowsWithViolations[0].id).toBe('s1');
    expect(r.rowsWithViolations[0].emotion).toBe('DISGUST');
    expect(r.rowsWithViolations[0].matchedTerms).toContain('disgusted');
  });
});

// ============================================================
// scanDataset — merged format (filters by source)
// ============================================================

describe('scanDataset — merged format', () => {
  it('skips ISEAR rows even if they contain banned words', () => {
    const rows = [
      mergedRow('ISEAR-001', 'ANGER', 'I was disgusted by the response.', 'ISEAR'),
      mergedRow('SYN_001', 'DISGUST', 'The kitchen was clean.', 'SYNTHETIC'),
    ];
    const r = scanDataset(rows);
    expect(r.totalRows).toBe(1);
    expect(r.violations).toBe(0);
  });

  it('catches violations in SYNTHETIC rows of merged dataset', () => {
    const rows = [
      mergedRow('SYN_001', 'DISGUST', 'The sight was revolting.', 'SYNTHETIC'),
    ];
    const r = scanDataset(rows);
    expect(r.violations).toBe(1);
  });
});

// ============================================================
// Build-fail semantics
// ============================================================

describe('build-fail semantics', () => {
  it('violations > 0 means build should fail', () => {
    const rows = [
      synRow('s1', 'DISGUST', 'The food was gross and revolting.'),
    ];
    const r = scanDataset(rows);
    expect(r.violations).toBeGreaterThan(0);
  });

  it('clean dataset means build passes', () => {
    const rows = [
      synRow('s1', 'DISGUST', 'The conditions raised concerns about sanitation.'),
      synRow('s2', 'NEUTRAL', 'I checked the weather forecast.'),
    ];
    const r = scanDataset(rows);
    expect(r.violations).toBe(0);
  });
});

// ============================================================
// formatScanResult
// ============================================================

describe('formatScanResult', () => {
  it('clean result shows checkmark', () => {
    const r: LeakageScanResult = { totalRows: 10, violations: 0, rowsWithViolations: [] };
    const out = formatScanResult(r);
    expect(out).toContain('✔');
    expect(out).toContain('Violations: 0');
  });

  it('dirty result shows X and Build failed', () => {
    const r: LeakageScanResult = {
      totalRows: 10,
      violations: 1,
      rowsWithViolations: [{ id: 'SYN_1', emotion: 'DISGUST', matchedTerms: ['disgusted'] }],
    };
    const out = formatScanResult(r);
    expect(out).toContain('❌');
    expect(out).toContain('Build failed');
    expect(out).toContain('SYN_1');
    expect(out).toContain('disgusted');
  });
});
