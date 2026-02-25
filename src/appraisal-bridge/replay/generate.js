/**
 * One-time fixture generator for bridge replay golden tests.
 * Run: node src/appraisal-bridge/replay/generate.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, { recursive: true });

function tierFor(eiv) {
  if (eiv < 0.2) return 'minimal';
  if (eiv < 0.4) return 'low';
  if (eiv < 0.6) return 'moderate';
  if (eiv < 0.8) return 'elevated';
  return 'high';
}

function arousalFor(score) {
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.3) return 'MEDIUM';
  return 'LOW';
}

function valenceFor(score) {
  if (score > 0.15) return 'POSITIVE';
  if (score < -0.15) return 'NEGATIVE';
  return 'NEUTRAL';
}

// ── 1. Calm baseline (50 steps) ──────────────────────────────────────

function calmBaseline() {
  const out = [];
  for (let i = 0; i < 50; i++) {
    const v = 0.05 * Math.sin(i * 0.3);
    const a = 0.15 + 0.05 * Math.sin(i * 0.5);
    const es = 0.12 + 0.03 * Math.cos(i * 0.4);
    const eiv = 0.12 + 0.04 * Math.sin(i * 0.2);
    out.push({
      messageIndex: i + 1,
      timestampMs: 1000 + i * 30000,
      deltaMessageSeconds: i === 0 ? 0 : 30,
      valenceScore: v,
      valenceConfidence: 0.7,
      arousalScore: a,
      arousalConfidence: 0.7,
      expressionStrength: es,
      esConfidence: 0.65,
      eivValue: eiv,
      eivTier: tierFor(eiv),
      emotionalState: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 },
    });
  }
  return out;
}

// ── 2. Escalation burst (30 steps) ──────────────────────────────────

function escalationBurst() {
  const out = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const delta = i === 0 ? 0 : 1.5 + 3.5 * (1 - t);
    const v = -0.2 - 0.7 * t;
    const a = 0.3 + 0.65 * t;
    const es = 0.3 + 0.6 * t;
    const eiv = 0.3 + 0.55 * t;
    out.push({
      messageIndex: i + 1,
      timestampMs: 1000 + i * 3000,
      deltaMessageSeconds: delta,
      valenceScore: v,
      valenceConfidence: 0.75 + 0.2 * t,
      arousalScore: a,
      arousalConfidence: 0.7 + 0.25 * t,
      expressionStrength: es,
      esConfidence: 0.7 + 0.25 * t,
      eivValue: eiv,
      eivTier: tierFor(eiv),
      emotionalState: {
        dominant: 'NEUTRAL',
        arousal: arousalFor(a),
        valence: 'NEGATIVE',
        confidence: 0.75 + 0.2 * t,
      },
    });
  }
  return out;
}

// ── 3. Oscillation (100 steps) ──────────────────────────────────────

function oscillation() {
  const out = [];
  for (let i = 0; i < 100; i++) {
    const phase = (i * 2 * Math.PI) / 20;
    const v = 0.5 * Math.sin(phase);
    const a = 0.5 + 0.3 * Math.cos(phase);
    const es = 0.4 + 0.2 * Math.sin(phase + 1);
    const eiv = 0.35 + 0.2 * Math.abs(Math.sin(phase));
    out.push({
      messageIndex: i + 1,
      timestampMs: 1000 + i * 15000,
      deltaMessageSeconds: i === 0 ? 0 : 15,
      valenceScore: v,
      valenceConfidence: 0.75,
      arousalScore: a,
      arousalConfidence: 0.75,
      expressionStrength: es,
      esConfidence: 0.7,
      eivValue: eiv,
      eivTier: tierFor(eiv),
      emotionalState: {
        dominant: 'NEUTRAL',
        arousal: arousalFor(a),
        valence: valenceFor(v),
        confidence: 0.75,
      },
    });
  }
  return out;
}

// ── 4. Recovery (80 steps) ──────────────────────────────────────────

function recovery() {
  const out = [];
  for (let i = 0; i < 80; i++) {
    const t = i / 79;
    const decay = Math.exp(-3 * t);
    const delta = i === 0 ? 0 : 20 + 20 * t;
    const v = -0.8 * decay + 0.1 * (1 - decay);
    const a = 0.9 * decay + 0.15 * (1 - decay);
    const es = 0.85 * decay + 0.1 * (1 - decay);
    const eiv = 0.8 * decay + 0.12 * (1 - decay);
    out.push({
      messageIndex: i + 1,
      timestampMs: 1000 + i * 25000,
      deltaMessageSeconds: delta,
      valenceScore: v,
      valenceConfidence: 0.8,
      arousalScore: a,
      arousalConfidence: 0.8,
      expressionStrength: es,
      esConfidence: 0.8,
      eivValue: eiv,
      eivTier: tierFor(eiv),
      emotionalState: {
        dominant: 'NEUTRAL',
        arousal: arousalFor(a),
        valence: valenceFor(v),
        confidence: 0.8,
      },
    });
  }
  return out;
}

// ── Write ────────────────────────────────────────────────────────────

const scenarios = {
  calm_baseline_50: calmBaseline(),
  escalation_burst_30: escalationBurst(),
  oscillation_100: oscillation(),
  recovery_80: recovery(),
};

for (const [name, data] of Object.entries(scenarios)) {
  const p = path.join(dir, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${p} (${data.length} snapshots)`);
}
