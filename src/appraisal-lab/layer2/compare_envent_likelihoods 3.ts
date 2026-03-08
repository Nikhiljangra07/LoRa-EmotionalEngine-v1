/**
 * Layer-2: Compare writer vs reader likelihood tables.
 *
 * Produces:
 *  - docs/layer2/likelihood_comparison.md
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WRITER_PATH = path.join(REPO_ROOT, "models", "likelihoods", "envent_likelihood_writer_v1.json");
const READER_PATH = path.join(REPO_ROOT, "models", "likelihoods", "envent_likelihood_reader_v1.json");
const REPORT_PATH = path.join(REPO_ROOT, "docs", "layer2", "likelihood_comparison.md");

const DIMS = ["valence", "arousal", "agency", "control", "certainty", "goalRelevance"] as const;
type Dim = (typeof DIMS)[number];

type Table = {
  version: string;
  alpha: number;
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
};

function log2(x: number): number {
  return Math.log(x) / Math.log(2);
}

function kl(p: Record<string, number>, q: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(p)) {
    const pv = p[k];
    const qv = q[k];
    if (pv > 0) s += pv * log2(pv / qv);
  }
  return s;
}

function jsd(p: Record<string, number>, q: Record<string, number>): number {
  const bins = [...new Set([...Object.keys(p), ...Object.keys(q)])].sort();
  const pp: Record<string, number> = {};
  const qq: Record<string, number> = {};
  const m: Record<string, number> = {};
  for (const b of bins) {
    pp[b] = p[b] ?? 0;
    qq[b] = q[b] ?? 0;
    m[b] = 0.5 * (pp[b] + qq[b]);
  }
  return 0.5 * kl(pp, m) + 0.5 * kl(qq, m);
}

function argmax(dist: Record<string, number>): string {
  return Object.entries(dist).sort((a, b) => b[1] - a[1])[0][0];
}

function main(): void {
  const writer = JSON.parse(fs.readFileSync(WRITER_PATH, "utf-8")) as Table;
  const reader = JSON.parse(fs.readFileSync(READER_PATH, "utf-8")) as Table;

  const emotions = [...new Set([...Object.keys(writer.priors), ...Object.keys(reader.priors)])].sort();
  const absDiffRows: Array<{ dim: string; emo: string; bin: string; writer: number; reader: number; abs: number }> = [];
  const jsRows: Array<{ dim: string; emo: string; js: number; flagged: boolean }> = [];

  for (const d of DIMS) {
    for (const e of emotions) {
      const wd = writer.likelihoods[d]?.[e];
      const rd = reader.likelihoods[d]?.[e];
      if (!wd || !rd) continue;
      const bins = [...new Set([...Object.keys(wd), ...Object.keys(rd)])].sort();
      for (const b of bins) {
        const wv = wd[b] ?? 0;
        const rv = rd[b] ?? 0;
        absDiffRows.push({ dim: d, emo: e, bin: b, writer: wv, reader: rv, abs: Math.abs(wv - rv) });
      }
      const j = jsd(wd, rd);
      jsRows.push({ dim: d, emo: e, js: j, flagged: j > 0.15 });
    }
  }

  const maxByDim = DIMS.map((d) => {
    const rows = jsRows.filter((r) => r.dim === d);
    const top = rows.slice().sort((a, b) => b.js - a.js)[0];
    const mean = rows.reduce((s, r) => s + r.js, 0) / (rows.length || 1);
    const flagged = rows.filter((r) => r.flagged).length;
    return { dim: d, max: top?.js ?? 0, maxEmotion: top?.emo ?? "-", mean, flagged };
  }).sort((a, b) => b.max - a.max);

  const topShifts = absDiffRows.slice().sort((a, b) => b.abs - a.abs).slice(0, 5);

  const fearControl = {
    writer: argmax(writer.likelihoods.control.fear),
    reader: argmax(reader.likelihoods.control.fear),
  };
  const angerAgency = {
    writer: argmax(writer.likelihoods.agency.anger),
    reader: argmax(reader.likelihoods.agency.anger),
  };

  const stableDims = maxByDim.filter((d) => d.max < 0.05).map((d) => d.dim);
  const sensitiveDims = maxByDim.filter((d) => d.max >= 0.05).map((d) => d.dim);

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);
  w("# Writer vs Reader Likelihood Comparison");
  w("");
  w(`- Writer table: \`${writer.version}\``);
  w(`- Reader table: \`${reader.version}\``);
  w(`- Generated: ${new Date().toISOString()}`);
  w("");
  w("## Max Divergence per Dimension (Jensen-Shannon)");
  w("");
  w("| Dimension | Max JSD | Emotion at Max | Mean JSD | Flags (JSD>0.15) |");
  w("|---|---:|---|---:|---:|");
  for (const r of maxByDim) {
    w(`| ${r.dim} | ${r.max.toFixed(4)} | ${r.maxEmotion} | ${r.mean.toFixed(4)} | ${r.flagged} |`);
  }
  w("");

  w("## Top 5 Writer vs Reader Probability Shifts");
  w("");
  w("| Dimension | Emotion | Bin | Writer | Reader | |Δ| |");
  w("|---|---|---|---:|---:|---:|");
  for (const r of topShifts) {
    w(`| ${r.dim} | ${r.emo} | ${r.bin} | ${r.writer.toFixed(4)} | ${r.reader.toFixed(4)} | ${r.abs.toFixed(4)} |`);
  }
  w("");

  w("## Numeric Summary");
  w("");
  w(`- Stable dimensions (max JSD < 0.05): ${stableDims.length ? stableDims.join(", ") : "none"}`);
  w(`- Observer-sensitive dimensions (max JSD ≥ 0.05): ${sensitiveDims.length ? sensitiveDims.join(", ") : "none"}`);
  w(`- FEAR/control dominant bin: writer=${fearControl.writer}, reader=${fearControl.reader}`);
  w(`- ANGER/agency dominant bin: writer=${angerAgency.writer}, reader=${angerAgency.reader}`);
  w(`- FEAR/control consistency: ${fearControl.writer === fearControl.reader ? "consistent" : "different"}`);
  w(`- ANGER/agency consistency: ${angerAgency.writer === angerAgency.reader ? "consistent" : "different"}`);
  w("");

  const dir = path.dirname(REPORT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf-8");
  console.log(`Wrote: ${REPORT_PATH}`);
}

main();

