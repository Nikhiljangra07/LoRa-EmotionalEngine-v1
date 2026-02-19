/**
 * CLI: Mapping sanity validation for crowd-enVent → LoRa-6.
 *
 * Implements formulas from docs/layer2/mapping_spec.md, applies them to
 * crowd-enVent_generation.tsv, and writes a structured diagnostic report.
 *
 * Supports both spec v1 and v1.1 via --spec flag:
 *   --spec v1    → v1 control formula (max), report to mapping_sanity_report.md
 *   --spec v1.1  → v1.1 control formula (weighted), report to mapping_sanity_report_v1_1.md
 *
 * Default: v1.1
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/validate_mapping.ts
 *   npx ts-node src/appraisal-lab/cli/validate_mapping.ts --spec v1
 *   npx ts-node src/appraisal-lab/cli/validate_mapping.ts --spec v1.1
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// CLI argument parsing
// ============================================================

type SpecVersion = 'v1' | 'v1.1';

function parseSpecVersion(): SpecVersion {
  const idx = process.argv.indexOf('--spec');
  if (idx === -1 || idx + 1 >= process.argv.length) return 'v1.1';
  const val = process.argv[idx + 1];
  if (val === 'v1') return 'v1';
  if (val === 'v1.1') return 'v1.1';
  console.error(`Unknown spec version: ${val}. Use v1 or v1.1.`);
  process.exit(1);
}

// ============================================================
// Paths
// ============================================================

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TSV_PATH = path.join(
  REPO_ROOT, 'src', 'appraisal-lab', 'dataset',
  'crowd-enVent2023', 'corpus', 'crowd-enVent_generation.tsv',
);

function reportPath(spec: SpecVersion): string {
  const filename = spec === 'v1'
    ? 'mapping_sanity_report.md'
    : 'mapping_sanity_report_v1_1.md';
  return path.join(REPO_ROOT, 'docs', 'layer2', filename);
}

// ============================================================
// Spec §D: Shared normalization & binning (verbatim from spec)
// ============================================================

function clampLikert(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return 3;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (isNaN(n)) return 3;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

function norm(x: number): number {
  return (x - 1) / 4;
}

type Bin3 = 'LOW' | 'MED' | 'HIGH';
type Bin2 = 'LOW' | 'HIGH';
type ValenceBin = 'NEG' | 'NEU' | 'POS';
type AgencyBin = 'SELF' | 'OTHER' | 'SITUATION';

function bin3(v: number): Bin3 {
  if (v < 0.333) return 'LOW';
  if (v < 0.667) return 'MED';
  return 'HIGH';
}

function bin2(v: number): Bin2 {
  if (v < 0.500) return 'LOW';
  return 'HIGH';
}

function valenceBin(v: number): ValenceBin {
  if (v < 0.333) return 'NEG';
  if (v < 0.667) return 'NEU';
  return 'POS';
}

// ============================================================
// Spec §E: Dimension mapping functions
// ============================================================

const APPRAISAL_COLS = [
  'pleasantness', 'unpleasantness', 'suddenness', 'urgency', 'attention',
  'self_responsblt', 'other_responsblt', 'chance_responsblt',
  'self_control', 'other_control', 'chance_control',
  'predict_event', 'predict_conseq',
  'familiarity', 'goal_relevance', 'not_consider',
] as const;

interface LoRaContinuous {
  valence: number;
  arousal: number;
  control: number;
  certainty: number;
  goalRelevance: number;
}

interface LoRaBinned {
  valence: ValenceBin;
  arousal: Bin3;
  agency: AgencyBin;
  control: Bin3;
  certainty: Bin2;
  goalRelevance: Bin2;
}

interface MappedRow {
  text_id: string;
  emotion: string;
  continuous: LoRaContinuous;
  binned: LoRaBinned;
  control_v1: number;
  control_v1_1: number;
  rawNormed: {
    self_control: number;
    other_control: number;
    chance_control: number;
  };
  flags: {
    valence_conflict: boolean;
    avoidance: boolean;
    imputed_count: number;
  };
}

function mapRow(cols: Record<string, string>, spec: SpecVersion): MappedRow {
  const raw: Record<string, string> = {};
  let imputed = 0;
  for (const col of APPRAISAL_COLS) {
    raw[col] = cols[col] ?? '';
    const v = cols[col];
    if (v === undefined || v === null || v.trim() === '' || isNaN(Number(v.trim()))) {
      imputed++;
    }
  }

  // §E.1 Valence
  const p = clampLikert(raw.pleasantness);
  const u = clampLikert(raw.unpleasantness);
  const valence_c = (p - u + 4) / 8;

  // §E.2 Arousal
  const s_a = norm(clampLikert(raw.suddenness));
  const u_a = norm(clampLikert(raw.urgency));
  const a_a = norm(clampLikert(raw.attention));
  const arousal_c = (s_a + u_a + a_a) / 3;

  // §E.3 Agency
  const sr = clampLikert(raw.self_responsblt);
  const or_ = clampLikert(raw.other_responsblt);
  const cr = clampLikert(raw.chance_responsblt);
  const max_r = Math.max(sr, or_, cr);
  let agency: AgencyBin;
  if (cr === max_r) agency = 'SITUATION';
  else if (or_ === max_r) agency = 'OTHER';
  else agency = 'SELF';

  // §E.4 Control — compute BOTH versions for comparison
  const sc = norm(clampLikert(raw.self_control));
  const oc = norm(clampLikert(raw.other_control));
  const cc = norm(clampLikert(raw.chance_control));

  const control_v1 = Math.max(sc, oc);
  const control_v1_1_raw = 0.6 * sc + 0.2 * (1 - cc) + 0.2 * (1 - oc);
  const control_v1_1 = Math.max(0, Math.min(1, control_v1_1_raw));

  const control_c = spec === 'v1' ? control_v1 : control_v1_1;

  // §E.5 Certainty
  const pe = norm(clampLikert(raw.predict_event));
  const pc = norm(clampLikert(raw.predict_conseq));
  const f = norm(clampLikert(raw.familiarity));
  const certainty_c = (pe + pc + f) / 3;

  // §E.6 GoalRelevance
  const gr = norm(clampLikert(raw.goal_relevance));

  // Flags
  const valence_conflict = p >= 4 && u >= 4;
  const nc = clampLikert(raw.not_consider);
  const avoidance = nc >= 4;

  return {
    text_id: cols['text_id'] ?? '',
    emotion: (cols['emotion'] ?? '').trim(),
    continuous: {
      valence: valence_c,
      arousal: arousal_c,
      control: control_c,
      certainty: certainty_c,
      goalRelevance: gr,
    },
    binned: {
      valence: valenceBin(valence_c),
      arousal: bin3(arousal_c),
      agency,
      control: bin3(control_c),
      certainty: bin2(certainty_c),
      goalRelevance: bin2(gr),
    },
    control_v1,
    control_v1_1,
    rawNormed: { self_control: sc, other_control: oc, chance_control: cc },
    flags: { valence_conflict, avoidance, imputed_count: imputed },
  };
}

// ============================================================
// Statistics utilities
// ============================================================

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function pct(count: number, total: number): string {
  return (total === 0 ? 0 : (count / total) * 100).toFixed(1);
}

function fmt(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

// ============================================================
// Emotion label mapping (spec §F.4)
// ============================================================

const EMOTION_MAP: Record<string, string> = {
  'joy': 'JOY',
  'anger': 'ANGER',
  'fear': 'FEAR',
  'sadness': 'SADNESS',
  'disgust': 'DISGUST',
  'surprise': 'SURPRISE',
  'no-emotion': 'NEUTRAL',
};

function mapEmotion(raw: string): string | null {
  return EMOTION_MAP[raw.toLowerCase()] ?? null;
}

// ============================================================
// TSV loader
// ============================================================

function loadTSV(filePath: string): { headers: string[]; rows: Record<string, string>[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('Empty TSV file');

  const headers = lines[0].split('\t').map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

// ============================================================
// Report generation
// ============================================================

function generateReport(mapped: MappedRow[], totalRawRows: number, spec: SpecVersion): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  const now = new Date().toISOString().slice(0, 10);

  w(`# Layer-2 Mapping Sanity Report (Spec ${spec})`);
  w('');
  w(`**Generated:** ${now}`);
  w(`**Spec:** docs/layer2/mapping_spec.md ${spec}`);
  w(`**Dataset:** crowd-enVent_generation.tsv`);
  w(`**Script:** src/appraisal-lab/cli/validate_mapping.ts --spec ${spec}`);
  if (spec === 'v1.1') {
    w('**Control formula:** `0.6·norm(self_control) + 0.2·(1−norm(chance_control)) + 0.2·(1−norm(other_control))`');
  } else {
    w('**Control formula:** `max(norm(self_control), norm(other_control))`');
  }
  w('');
  w('---');
  w('');

  // --- A) Dataset summary ---
  w('## A. Dataset Summary');
  w('');
  w(`| Property | Value |`);
  w(`|----------|-------|`);
  w(`| Raw rows parsed | ${totalRawRows} |`);
  w(`| Rows after mapping (all 13 emotions) | ${mapped.length} |`);

  const emotionCounts: Record<string, number> = {};
  for (const r of mapped) {
    emotionCounts[r.emotion] = (emotionCounts[r.emotion] || 0) + 1;
  }
  const sortedEmotions = Object.keys(emotionCounts).sort();
  w(`| Distinct emotion labels | ${sortedEmotions.length} |`);

  const mappable = mapped.filter(r => mapEmotion(r.emotion) !== null);
  const unmappable = mapped.filter(r => mapEmotion(r.emotion) === null);
  w(`| Rows mappable to LoRa emotions | ${mappable.length} (${pct(mappable.length, mapped.length)}%) |`);
  w(`| Rows excluded (unmappable emotion) | ${unmappable.length} (${pct(unmappable.length, mapped.length)}%) |`);

  const flaggedValence = mapped.filter(r => r.flags.valence_conflict).length;
  const flaggedAvoidance = mapped.filter(r => r.flags.avoidance).length;
  const flaggedImputed = mapped.filter(r => r.flags.imputed_count >= 3).length;
  w(`| Valence-conflict flags (pleasant≥4 & unpleasant≥4) | ${flaggedValence} |`);
  w(`| Avoidance flags (not_consider≥4) | ${flaggedAvoidance} |`);
  w(`| Rows with 3+ imputed appraisal cols | ${flaggedImputed} |`);
  w('');

  w('### Emotion distribution');
  w('');
  w('| Emotion | Count | % | LoRa mapping |');
  w('|---------|-------|---|-------------|');
  for (const emo of sortedEmotions) {
    const loraMap = mapEmotion(emo);
    w(`| ${emo} | ${emotionCounts[emo]} | ${pct(emotionCounts[emo], mapped.length)}% | ${loraMap ?? '—(excluded)'} |`);
  }
  w('');

  // --- B) Per-dimension stats ---
  w('---');
  w('');
  w('## B. Per-Dimension Statistics');
  w('');

  const CONT_DIMS = ['valence', 'arousal', 'control', 'certainty', 'goalRelevance'] as const;
  type ContDim = typeof CONT_DIMS[number];

  w('### Continuous scores [0, 1]');
  w('');
  w('| Dimension | Min | Max | Mean | Median | Std | Range valid? |');
  w('|-----------|-----|-----|------|--------|-----|-------------|');
  for (const dim of CONT_DIMS) {
    const vals = mapped.map(r => r.continuous[dim]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const rangeOk = lo >= -0.001 && hi <= 1.001 ? 'OK' : 'OUT OF RANGE';
    w(`| ${dim} | ${fmt(lo)} | ${fmt(hi)} | ${fmt(mean(vals))} | ${fmt(median(vals))} | ${fmt(std(vals))} | ${rangeOk} |`);
  }
  w('');

  // Bin distributions
  w('### Bin distributions');
  w('');

  const vBins: Record<string, number> = { NEG: 0, NEU: 0, POS: 0 };
  for (const r of mapped) vBins[r.binned.valence]++;
  w('**valence** (3-bin: NEG / NEU / POS)');
  w('');
  w('| Bin | Count | % |');
  w('|-----|-------|---|');
  for (const b of ['NEG', 'NEU', 'POS']) {
    w(`| ${b} | ${vBins[b]} | ${pct(vBins[b], mapped.length)}% |`);
  }
  w('');

  const aBins: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0 };
  for (const r of mapped) aBins[r.binned.arousal]++;
  w('**arousal** (3-bin: LOW / MED / HIGH) — cognitive-activation composite');
  w('');
  w('| Bin | Count | % |');
  w('|-----|-------|---|');
  for (const b of ['LOW', 'MED', 'HIGH']) {
    w(`| ${b} | ${aBins[b]} | ${pct(aBins[b], mapped.length)}% |`);
  }
  w('');

  const agBins: Record<string, number> = { SELF: 0, OTHER: 0, SITUATION: 0 };
  for (const r of mapped) agBins[r.binned.agency]++;
  w('**agency** (categorical: SELF / OTHER / SITUATION)');
  w('');
  w('| Bin | Count | % |');
  w('|-----|-------|---|');
  for (const b of ['SELF', 'OTHER', 'SITUATION']) {
    w(`| ${b} | ${agBins[b]} | ${pct(agBins[b], mapped.length)}% |`);
  }
  w('');

  const cBins: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0 };
  for (const r of mapped) cBins[r.binned.control]++;
  w(`**control** (3-bin: LOW / MED / HIGH) — ${spec === 'v1.1' ? 'personal-controllability composite' : 'max(self, other)'}`);
  w('');
  w('| Bin | Count | % |');
  w('|-----|-------|---|');
  for (const b of ['LOW', 'MED', 'HIGH']) {
    w(`| ${b} | ${cBins[b]} | ${pct(cBins[b], mapped.length)}% |`);
  }
  w('');

  const cerBins: Record<string, number> = { LOW: 0, HIGH: 0 };
  for (const r of mapped) cerBins[r.binned.certainty]++;
  w('**certainty** (2-bin: LOW / HIGH)');
  w('');
  w('| Bin | Count | % |');
  w('|-----|-------|---|');
  for (const b of ['LOW', 'HIGH']) {
    w(`| ${b} | ${cerBins[b]} | ${pct(cerBins[b], mapped.length)}% |`);
  }
  w('');

  const grBins: Record<string, number> = { LOW: 0, HIGH: 0 };
  for (const r of mapped) grBins[r.binned.goalRelevance]++;
  w('**goalRelevance** (2-bin: LOW / HIGH)');
  w('');
  w('| Bin | Count | % |');
  w('|-----|-------|---|');
  for (const b of ['LOW', 'HIGH']) {
    w(`| ${b} | ${grBins[b]} | ${pct(grBins[b], mapped.length)}% |`);
  }
  w('');

  // --- C) Per-emotion mean vectors ---
  w('---');
  w('');
  w('## C. Per-Emotion Mean LoRa-6 Vectors');
  w('');
  w('Continuous scores averaged over all rows for each emotion. Agency shown as majority bin.');
  w('');
  w('| Emotion | n | valence | arousal | agency (mode) | control | certainty | goalRel | top-2 distinctive dims |');
  w('|---------|---|---------|---------|--------------|---------|-----------|---------|----------------------|');

  const overallMeans: Record<ContDim, number> = {} as Record<ContDim, number>;
  for (const dim of CONT_DIMS) {
    overallMeans[dim] = mean(mapped.map(r => r.continuous[dim]));
  }

  for (const emo of sortedEmotions) {
    const emoRows = mapped.filter(r => r.emotion === emo);
    const n = emoRows.length;

    const emoMeans: Record<ContDim, number> = {} as Record<ContDim, number>;
    for (const dim of CONT_DIMS) {
      emoMeans[dim] = mean(emoRows.map(r => r.continuous[dim]));
    }

    const agCounts: Record<string, number> = { SELF: 0, OTHER: 0, SITUATION: 0 };
    for (const r of emoRows) agCounts[r.binned.agency]++;
    let agMode = 'SITUATION';
    let agMax = 0;
    for (const b of ['SELF', 'OTHER', 'SITUATION']) {
      if (agCounts[b] > agMax) { agMax = agCounts[b]; agMode = b; }
    }

    const deviations = CONT_DIMS.map(dim => ({
      dim,
      dev: Math.abs(emoMeans[dim] - overallMeans[dim]),
    })).sort((a, b) => b.dev - a.dev);
    const top2 = deviations.slice(0, 2).map(d => {
      const dir = emoMeans[d.dim] > overallMeans[d.dim] ? '↑' : '↓';
      return `${d.dim}${dir}(${fmt(d.dev, 2)})`;
    }).join(', ');

    w(`| ${emo} | ${n} | ${fmt(emoMeans.valence)} | ${fmt(emoMeans.arousal)} | ${agMode} (${pct(agMax, n)}%) | ${fmt(emoMeans.control)} | ${fmt(emoMeans.certainty)} | ${fmt(emoMeans.goalRelevance)} | ${top2} |`);
  }
  w('');

  // --- D) Correlation matrix ---
  w('---');
  w('');
  w('## D. Correlation Matrix (Continuous Dimensions)');
  w('');
  w('Pearson r across all rows. Agency excluded (categorical).');
  w('');

  const dimVals: Record<ContDim, number[]> = {} as Record<ContDim, number[]>;
  for (const dim of CONT_DIMS) {
    dimVals[dim] = mapped.map(r => r.continuous[dim]);
  }

  w('| | valence | arousal | control | certainty | goalRel |');
  w('|---|---------|---------|---------|-----------|---------|');
  for (const row of CONT_DIMS) {
    const cells = CONT_DIMS.map(col => {
      if (row === col) return '1.000';
      return fmt(pearson(dimVals[row], dimVals[col]));
    });
    const label = row === 'goalRelevance' ? 'goalRel' : row;
    w(`| ${label} | ${cells.join(' | ')} |`);
  }
  w('');

  // --- E) Red flags ---
  w('---');
  w('');
  w('## E. Red Flags');
  w('');

  const redFlags: string[] = [];

  for (const dim of CONT_DIMS) {
    const vals = mapped.map(r => r.continuous[dim]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (lo < -0.001) redFlags.push(`${dim}: min value ${fmt(lo)} is below 0.`);
    if (hi > 1.001) redFlags.push(`${dim}: max value ${fmt(hi)} is above 1.`);
  }

  const SKEW_THRESHOLD = 80;
  for (const [name, bins] of [
    ['valence', vBins], ['arousal', aBins], ['control', cBins],
  ] as [string, Record<string, number>][]) {
    for (const b of Object.keys(bins)) {
      const p = (bins[b] / mapped.length) * 100;
      if (p > SKEW_THRESHOLD) {
        redFlags.push(`${name}: bin ${b} contains ${p.toFixed(1)}% of rows (>${SKEW_THRESHOLD}% threshold).`);
      }
    }
  }

  for (const b of Object.keys(agBins)) {
    const p = (agBins[b] / mapped.length) * 100;
    if (p > SKEW_THRESHOLD) {
      redFlags.push(`agency: bin ${b} contains ${p.toFixed(1)}% of rows (>${SKEW_THRESHOLD}% threshold).`);
    }
  }

  for (const [name, bins] of [
    ['certainty', cerBins], ['goalRelevance', grBins],
  ] as [string, Record<string, number>][]) {
    for (const b of Object.keys(bins)) {
      const p = (bins[b] / mapped.length) * 100;
      if (p > 90) {
        redFlags.push(`${name}: bin ${b} contains ${p.toFixed(1)}% of rows (>90% threshold for 2-bin dim).`);
      }
    }
  }

  // Per-emotion control flag: fear > 0.8
  const fearRows = mapped.filter(r => r.emotion === 'fear');
  if (fearRows.length > 0) {
    const fearControl = mean(fearRows.map(r => r.continuous.control));
    if (fearControl > 0.8) {
      redFlags.push(`FEAR mean control = ${fmt(fearControl)} exceeds 0.8 threshold (appraisal theory expects low control for fear).`);
    }
  }

  // Appraisal theory checks
  interface Expectation {
    emotion: string;
    dim: string;
    expected: string;
    check: (rows: MappedRow[]) => string;
  }

  const expectations: Expectation[] = [
    {
      emotion: 'anger', dim: 'valence', expected: 'below 0.333 (NEG)',
      check: (rows) => fmt(mean(rows.map(r => r.continuous.valence))),
    },
    {
      emotion: 'anger', dim: 'agency', expected: 'majority OTHER',
      check: (rows) => {
        const ct: Record<string, number> = { SELF: 0, OTHER: 0, SITUATION: 0 };
        rows.forEach(r => ct[r.binned.agency]++);
        return Object.entries(ct).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${pct(v, rows.length)}%`).join(', ');
      },
    },
    {
      emotion: 'fear', dim: 'control', expected: 'low (< 0.40)',
      check: (rows) => fmt(mean(rows.map(r => r.continuous.control))),
    },
    {
      emotion: 'joy', dim: 'valence', expected: 'above 0.667 (POS)',
      check: (rows) => fmt(mean(rows.map(r => r.continuous.valence))),
    },
    {
      emotion: 'sadness', dim: 'arousal', expected: 'low (< 0.40) under physiological def; acceptable under cognitive-activation def',
      check: (rows) => fmt(mean(rows.map(r => r.continuous.arousal))),
    },
    {
      emotion: 'surprise', dim: 'certainty', expected: 'low (< 0.40)',
      check: (rows) => fmt(mean(rows.map(r => r.continuous.certainty))),
    },
    {
      emotion: 'disgust', dim: 'valence', expected: 'below 0.333 (NEG)',
      check: (rows) => fmt(mean(rows.map(r => r.continuous.valence))),
    },
  ];

  const contradictions: string[] = [];
  for (const exp of expectations) {
    const emoRows = mapped.filter(r => r.emotion === exp.emotion);
    if (emoRows.length === 0) continue;
    const actual = exp.check(emoRows);
    contradictions.push(`- **${exp.emotion}** / ${exp.dim}: expected ${exp.expected}, actual = ${actual}`);
  }

  if (redFlags.length === 0) {
    w('No red flags detected.');
  } else {
    w(`**${redFlags.length} red flag(s) detected:**`);
    w('');
    for (const f of redFlags) {
      w(`- ${f}`);
    }
  }
  w('');
  w('### Appraisal-theory expectation checks');
  w('');
  w('These are soft checks against common appraisal-theory predictions. Deviations are not');
  w('necessarily bugs — they may reflect genuine empirical patterns in crowd-sourced data.');
  w('');
  for (const c of contradictions) {
    w(c);
  }
  w('');

  // --- F) Spec issues ---
  w('---');
  w('');
  w('## F. Spec Issues Detected');
  w('');
  w(`Automated checks for internal consistency of mapping_spec.md ${spec}:`);
  w('');

  const specIssues: string[] = [];

  const vMin = (1 - 5 + 4) / 8;
  const vMax = (5 - 1 + 4) / 8;
  if (Math.abs(vMin) > 0.001 || Math.abs(vMax - 1) > 0.001) {
    specIssues.push('Valence formula does not map to [0,1]. min=' + vMin + ', max=' + vMax);
  }

  const midNorm = norm(3);
  if (bin3(midNorm) !== 'MED') {
    specIssues.push('bin3(norm(3)) should be MED but got ' + bin3(midNorm));
  }

  if (bin2(midNorm) !== 'HIGH') {
    specIssues.push('bin2(norm(3)) should be HIGH but got ' + bin2(midNorm));
  }

  specIssues.push(
    'NOTICE: certainty bin2 threshold at 0.500 means Likert midpoint (3) across all inputs → ' +
    `certainty=${bin2(0.5)} (HIGH). Midpoint-imputed rows will always be HIGH. ` +
    'This is a known asymmetry of the 2-bin threshold being at 0.5 exactly.'
  );

  specIssues.push(
    'NOTICE: goalRelevance bin2 threshold at 0.500 means Likert midpoint (3) → ' +
    `goalRelevance=${bin2(0.5)} (HIGH). Same midpoint asymmetry as certainty.`
  );

  if (spec === 'v1.1') {
    const ctrlMin = 0.6 * 0 + 0.2 * (1 - 1) + 0.2 * (1 - 1);
    const ctrlMax = 0.6 * 1 + 0.2 * (1 - 0) + 0.2 * (1 - 0);
    if (Math.abs(ctrlMin) > 0.001 || Math.abs(ctrlMax - 1) > 0.001) {
      specIssues.push('v1.1 control formula does not map to [0,1]. min=' + ctrlMin + ', max=' + ctrlMax);
    }

    const ctrlMid = 0.6 * 0.5 + 0.2 * (1 - 0.5) + 0.2 * (1 - 0.5);
    specIssues.push(
      'NOTICE: v1.1 control at Likert midpoint (all=3): ' +
      `0.6·0.5 + 0.2·0.5 + 0.2·0.5 = ${fmt(ctrlMid)} → ${bin3(ctrlMid)}. ` +
      'Midpoint-imputed rows get MED control.'
    );
  }

  const errors = specIssues.filter(s => !s.startsWith('NOTICE:'));
  const notices = specIssues.filter(s => s.startsWith('NOTICE:'));
  if (errors.length > 0) {
    w(`**${errors.length} error(s):**`);
    w('');
    for (const s of errors) w(`- ${s}`);
    w('');
  }
  if (notices.length > 0) {
    w(`**${notices.length} notice(s) (not errors, but worth reviewing):**`);
    w('');
    for (const s of notices) w(`- ${s}`);
    w('');
  }
  if (errors.length === 0 && notices.length === 0) {
    w('No spec issues detected.');
    w('');
  }

  // ============================================================
  // v1.1-only sections: comparison and component correlations
  // ============================================================
  if (spec === 'v1.1') {

    // --- G) v1 vs v1.1 Comparison ---
    w('---');
    w('');
    w('## G. v1 → v1.1 Control Comparison');
    w('');
    w('Both v1 and v1.1 control scores were computed for every row. This section shows the deltas.');
    w('');

    const allV1 = mapped.map(r => r.control_v1);
    const allV11 = mapped.map(r => r.control_v1_1);

    w('### Overall control statistics');
    w('');
    w('| Metric | v1 | v1.1 | Delta |');
    w('|--------|-----|------|-------|');
    const meanV1 = mean(allV1);
    const meanV11 = mean(allV11);
    w(`| Mean | ${fmt(meanV1)} | ${fmt(meanV11)} | ${fmt(meanV11 - meanV1)} |`);
    const medV1 = median(allV1);
    const medV11 = median(allV11);
    w(`| Median | ${fmt(medV1)} | ${fmt(medV11)} | ${fmt(medV11 - medV1)} |`);
    w(`| Std | ${fmt(std(allV1))} | ${fmt(std(allV11))} | — |`);
    w(`| Min | ${fmt(Math.min(...allV1))} | ${fmt(Math.min(...allV11))} | — |`);
    w(`| Max | ${fmt(Math.max(...allV1))} | ${fmt(Math.max(...allV11))} | — |`);
    w('');

    w('### Control bin distribution change');
    w('');
    const binsV1: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0 };
    const binsV11: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0 };
    for (const r of mapped) {
      binsV1[bin3(r.control_v1)]++;
      binsV11[bin3(r.control_v1_1)]++;
    }
    w('| Bin | v1 count | v1 % | v1.1 count | v1.1 % | Δ count | Δ pp |');
    w('|-----|---------|------|-----------|--------|---------|------|');
    for (const b of ['LOW', 'MED', 'HIGH']) {
      const d = binsV11[b] - binsV1[b];
      const ppDelta = ((binsV11[b] - binsV1[b]) / mapped.length) * 100;
      w(`| ${b} | ${binsV1[b]} | ${pct(binsV1[b], mapped.length)}% | ${binsV11[b]} | ${pct(binsV11[b], mapped.length)}% | ${d >= 0 ? '+' : ''}${d} | ${ppDelta >= 0 ? '+' : ''}${ppDelta.toFixed(1)}pp |`);
    }
    w('');

    w('### Per-emotion control mean: v1 vs v1.1');
    w('');
    w('| Emotion | n | v1 mean | v1.1 mean | Delta | v1 bin (mode) | v1.1 bin (mode) | Improved? |');
    w('|---------|---|---------|-----------|-------|--------------|----------------|-----------|');

    for (const emo of sortedEmotions) {
      const emoRows = mapped.filter(r => r.emotion === emo);
      const n = emoRows.length;
      const emoV1 = mean(emoRows.map(r => r.control_v1));
      const emoV11 = mean(emoRows.map(r => r.control_v1_1));
      const delta = emoV11 - emoV1;
      const modeV1 = bin3(emoV1);
      const modeV11 = bin3(emoV11);

      let improved = '—';
      if (emo === 'fear' || emo === 'sadness') {
        improved = delta < 0 ? 'YES (↓ toward expected LOW)' : 'no';
      } else if (emo === 'anger' || emo === 'joy' || emo === 'pride') {
        improved = delta > -0.15 ? 'ok (stable or slight ↓)' : 'WATCH';
      }

      const highlight = emo === 'fear' ? ' **←**' : '';
      w(`| ${emo}${highlight} | ${n} | ${fmt(emoV1)} | ${fmt(emoV11)} | ${fmt(delta)} | ${modeV1} | ${modeV11} | ${improved} |`);
    }
    w('');

    const fearRowsComp = mapped.filter(r => r.emotion === 'fear');
    if (fearRowsComp.length > 0) {
      const fV1 = mean(fearRowsComp.map(r => r.control_v1));
      const fV11 = mean(fearRowsComp.map(r => r.control_v1_1));
      w('### FEAR control spotlight');
      w('');
      w(`- **v1 mean control:** ${fmt(fV1)} (bin: ${bin3(fV1)}) — appraisal theory expects LOW`);
      w(`- **v1.1 mean control:** ${fmt(fV11)} (bin: ${bin3(fV11)})`);
      w(`- **Delta:** ${fmt(fV11 - fV1)}`);
      w(`- **Interpretation:** ${fV11 < 0.40 ? 'Now aligns with appraisal-theory expectation (low personal control for fear).' : fV11 < fV1 ? 'Moved in the right direction but still above 0.40.' : 'No improvement.'}`);
      w('');
    }

    // --- H) Control component correlations ---
    w('---');
    w('');
    w('## H. Control Component Correlations');
    w('');
    w('Pearson r between the v1.1 control composite and each of its input columns (normed).');
    w('Validates the formula\'s directional behavior.');
    w('');

    const controlVals = mapped.map(r => r.control_v1_1);
    const selfCtrlVals = mapped.map(r => r.rawNormed.self_control);
    const otherCtrlVals = mapped.map(r => r.rawNormed.other_control);
    const chanceCtrlVals = mapped.map(r => r.rawNormed.chance_control);

    const corrSelf = pearson(controlVals, selfCtrlVals);
    const corrOther = pearson(controlVals, otherCtrlVals);
    const corrChance = pearson(controlVals, chanceCtrlVals);

    w('| Component | Pearson r | Expected sign | Match? |');
    w('|-----------|----------|---------------|--------|');
    w(`| self_control (weight 0.6, direct) | ${fmt(corrSelf)} | positive | ${corrSelf > 0 ? 'YES' : 'NO'} |`);
    w(`| chance_control (weight 0.2, inverted) | ${fmt(corrChance)} | negative | ${corrChance < 0 ? 'YES' : 'NO'} |`);
    w(`| other_control (weight 0.2, inverted) | ${fmt(corrOther)} | negative | ${corrOther < 0 ? 'YES' : 'NO'} |`);
    w('');

    if (corrSelf > 0 && corrChance < 0 && corrOther < 0) {
      w('All three component correlations match expected signs. The v1.1 formula is behaving as designed.');
    } else {
      const mismatches: string[] = [];
      if (corrSelf <= 0) mismatches.push('self_control (expected +, got ' + fmt(corrSelf) + ')');
      if (corrChance >= 0) mismatches.push('chance_control (expected −, got ' + fmt(corrChance) + ')');
      if (corrOther >= 0) mismatches.push('other_control (expected −, got ' + fmt(corrOther) + ')');
      w(`**WARNING:** Correlation sign mismatch for: ${mismatches.join(', ')}.`);
    }
    w('');
  }

  // --- Appendix: Verification checksums ---
  w('---');
  w('');
  w('## Appendix: Verification Checksums');
  w('');
  w('Spot-check values for the first 5 rows to enable manual verification against spec pseudocode.');
  w('');
  if (spec === 'v1.1') {
    w('| row | text_id | emotion | val_c | aro_c | agency | ctrl_v1 | ctrl_v1.1 | cert_c | goal_c |');
    w('|-----|---------|---------|-------|-------|--------|---------|-----------|--------|--------|');
    for (let i = 0; i < Math.min(5, mapped.length); i++) {
      const r = mapped[i];
      w(`| ${i + 1} | ${r.text_id} | ${r.emotion} | ${fmt(r.continuous.valence)} | ${fmt(r.continuous.arousal)} | ${r.binned.agency} | ${fmt(r.control_v1)} | ${fmt(r.control_v1_1)} | ${fmt(r.continuous.certainty)} | ${fmt(r.continuous.goalRelevance)} |`);
    }
  } else {
    w('| row | text_id | emotion | val_c | aro_c | agency | ctrl_c | cert_c | goal_c |');
    w('|-----|---------|---------|-------|-------|--------|--------|--------|--------|');
    for (let i = 0; i < Math.min(5, mapped.length); i++) {
      const r = mapped[i];
      w(`| ${i + 1} | ${r.text_id} | ${r.emotion} | ${fmt(r.continuous.valence)} | ${fmt(r.continuous.arousal)} | ${r.binned.agency} | ${fmt(r.continuous.control)} | ${fmt(r.continuous.certainty)} | ${fmt(r.continuous.goalRelevance)} |`);
    }
  }
  w('');

  return lines.join('\n');
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const spec = parseSpecVersion();
  const outPath = reportPath(spec);

  console.log(`=== Layer-2 Mapping Sanity Validation (spec ${spec}) ===`);
  console.log(`Loading: ${TSV_PATH}`);

  if (!fs.existsSync(TSV_PATH)) {
    console.error(`ERROR: Dataset not found at ${TSV_PATH}`);
    process.exit(1);
  }

  const { headers, rows } = loadTSV(TSV_PATH);
  console.log(`Parsed ${rows.length} data rows, ${headers.length} columns.`);

  const required = [
    'emotion', 'text_id', 'pleasantness', 'unpleasantness',
    'suddenness', 'urgency', 'attention',
    'self_responsblt', 'other_responsblt', 'chance_responsblt',
    'self_control', 'other_control', 'chance_control',
    'predict_event', 'predict_conseq', 'familiarity',
    'goal_relevance', 'not_consider',
  ];
  const missing = required.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    console.error(`ERROR: Missing required columns: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('All required columns present.');

  const mapped = rows.map(r => mapRow(r, spec));
  console.log(`Mapped ${mapped.length} rows.`);

  const report = generateReport(mapped, rows.length, spec);

  const reportDir = path.dirname(outPath);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(outPath, report, 'utf-8');
  console.log(`\nReport written to: ${outPath}`);
  console.log('Done.');
}

main();
