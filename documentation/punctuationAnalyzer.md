**A:** Period detection is **formally supported** with careful exclusion rules:

**Detects:**
- Sentence-ending single periods: "Hello."
- Periods followed by whitespace or end-of-string

**Excludes:**
- Abbreviations: "Dr. Smith" (handled by `stripAbbreviations`)
- Decimals: "3.14" (negative lookahead/lookbehind)
- URLs: "example.com" (handled by `stripUrls`)
- Ellipsis: "..." (detected separately with higher weight)

**Implementation:**
```typescript
// Regex: (?<!\d)\.(?!\d|\.)(?=\s|$)
// Negative lookbehind: not preceded by digit
// Negative lookahead: not followed by digit or another period
// Positive lookahead: followed by whitespace or end
```

**Weight:** 0.05 (ultra-low baseline, barely above zero)

**Why include periods?**
- Distinguishes neutral emotional state from absence of punctuation
- Provides complete coverage of sentence-ending punctuation
- Acts as baseline for calibration

---

## Multimodal EIV Fusion (System-Level Integration)

This analyzer provides **EIV_text** component. System-level fusion combines multiple modalities:

```typescript
// Step 1: Compute EIV from each modality
EIV_text = punctuationAnalyzer + lexicalIntensity
EIV_voice = 0.35·norm(F0_std) + 0.30·norm(energy) + 0.20·norm(rate) + 0.15·norm(F0_range)
EIV_face = FACS_AU_intensity_mapping (A=0.1, B=0.3, C=0.5, D=0.75, E=1.0)
EIV_physio = 0.50·norm(inverse_RMSSD) + 0.35·norm(SCR_freq) + 0.15·norm(ΔHR)

// Step 2: Calibrate confidence per modality
conf_text = ECE_calibrated_confidence(text_model)
conf_voice = inter_rater_agreement OR ECE
conf_face = FACS_inter_observer_agreement (κ ≈ 0.40-0.60 for intensity)
conf_physio = signal_quality_metric (SNR, missing_data)

// Step 3: Fuse into global EIV (confidence-weighted)
EIV_global = (w_T·EIV_text·conf_T + w_V·EIV_voice·conf_V 
            + w_F·EIV_face·conf_F + w_P·EIV_physio·conf_P)
           / (w_T·conf_T + w_V·conf_V + w_F·conf_F + w_P·conf_P)

// Where w_X = learned modality weights via cross-validation
```

**Research Validation Targets:**
- Text-voice correlation: r ≥ 0.40-0.60 (Schewski et al., 2025)
- Face FACS agreement: κ ≥ 0.60 for AU presence, ≥ 0.40 for intensity
- Physio-arousal correlation: r ≈ 0.25-0.35 (EDA/HRV studies)
- Global EIV vs human ratings: r ≥ 0.60, κ ≥ 0.50

**Multimodal Conflict Resolution:**
- When modalities disagree (calm voice + tense face):
  - Flag uncertainty in output
  - Lower aggregate confidence
  - Require human review for critical decisions
  - Trust modality with highest confidence if ECE < 5%

---

## Behavioral Thresholds (From Research)

### EIV Response Mapping

| EIV Range | State | System Behavior | Confidence Required |
|-----------|-------|-----------------|---------------------|
| 0.0-0.2 | Minimal emotion | Neutral tone, maintain poise | Low (info gathering) |
| 0.2-0.4 | Mild emotion | Gentle acknowledgment | Low-Medium |
| 0.4-0.6 | Moderate emotion | Increase attunement, validate | Medium |
| 0.6-0.8 | Strong emotion | High empathy, emotional support | Medium-High |
| 0.8-1.0 | Peak/Crisis | Immediate de-escalation, safety focus | High (multi-modal agreement) |

### ETV Trust Mapping (System-Level, Not This Analyzer)

| ETV Range | State | System Behavior | Risk |
|-----------|-------|-----------------|------|
| 0.0-0.2 | Active distrust | Increase transparency, user control | High non-compliance |
| 0.2-0.4 | Tentative doubt | Demonstrate reliability, consistency | Selective engagement |
| 0.4-0.6 | Neutral/Uncertain | Standard interaction, rapport-building | Normal |
| 0.6-0.8 | Moderate trust | Reinforce competence, personalize | Lower override |
| 0.8-1.0 | High trust | Maintain consistency, avoid surprises | Highest dependence |

**ETV Dynamics (Akash et al., 2017, n=581):**
- Steady-state convergence: 8-10 interactions
- Recovery after breach: ~8+ positive experiences needed
- Demographic variations: US (γ=0.120), India (γ=0.105), Female (α=0.355), Male (α=0.340)

---

### Q: Why is aggregation strategy "MAX" instead of "SUM"?# Punctuation Emotional Intensity System

## Overview

Production-ready, research-backed system for measuring **EIV (Emotional Intensity Value)** from punctuation patterns. Part of broader emotion architecture that includes **ETV (Emotional Trust Value)** at system level.

Every design decision is validated through peer-reviewed research or explicitly labeled as heuristic.

**Status:** ✅ Production Ready (with documented calibration needs)

---

## Emotion State Architecture

This analyzer implements **EIV_text** component within multi-component emotion state:

```typescript
Emotion_State(t) = {
  category:      emotion class ∈ {anger, joy, sadness, ...}
  
  // INTENSITY (This System)
  EIV:           [0.0, 1.0] emotional intensity/arousal
  EIV_text:      punctuation + lexical intensity
  EIV_voice:     acoustic features (F0, energy, rate)
  EIV_face:      FACS AU intensity mapping
  EIV_physio:    EDA + HRV normalized features
  
  // TRUST (Separate System)
  ETV:           [0.0, 1.0] user trust in AI
  CT:            cumulative trust component
  BX:            expectation bias
  
  confidence:    [0.0, 1.0] model calibration (ECE)
  uncertainty:   [0.0, 1.0] epistemic uncertainty
}
```

**Key Distinctions:**
- **EIV**: How **strong** is the emotion? (arousal/activation)
- **ETV**: How much does user **trust** the AI? (relationship quality)
- **Category**: What **type** of emotion? (joy, anger, etc.)
- **Confidence**: How **certain** is the model? (calibration)

**ETV is NOT calculated here.** It's maintained at system level via third-order linear dynamics (Akash et al., 2017).

---

## Architecture: Five-Layer Responsibility Hierarchy

### Layer 1: Detection (`PunctuationAnalyzer.ts`)

**Responsibility:** What happened in the text?

**Owns:**
- Regex pattern detection
- Counting occurrences
- Position identification (start/mid/end)
- Raw signal emission

**Returns:**
```typescript
{
  type: 'exclamation',
  count: 3,
  position: 'end'
}
```

**Does NOT:**
- ❌ Calculate weights
- ❌ Compute intensity (EIV)
- ❌ Apply caps
- ❌ Interpret emotion
- ❌ Calculate ETV (trust is system-level)

**This file should be boring.** If it's interesting, you're doing it wrong.

**CRITICAL NOTE on confidence:**
```typescript
AnalyzerResult.confidence = 0  // Always placeholder in Layer 1
```
This is NOT signal confidence. It's post-aggregation analyzer confidence,
calculated by Layer 3 (math) or consuming system. Layer 1 only detects.

---

### Layer 2: Configuration (`punctuation.config.ts`)

**Responsibility:** What do we believe about punctuation?

**Owns:**
- Base weights with research citations
- Increment values
- Caps and thresholds
- Precedence hierarchy
- Policy decisions

**Contains:**
- Inline research citations
- Comments explaining WHY, not HOW
- Explicit heuristic labels

**Does NOT:**
- ❌ Execute logic
- ❌ Detect patterns
- ❌ Perform calculations

**This file is POLICY, not code.** Changing values = changing beliefs about emotion.

---

### Layer 3: Mathematics (`punctuation.math.ts`)

**Responsibility:** How is intensity computed?

**Owns:**
- Incremental scaling formulas
- Clamping and bounds
- Aggregation strategies
- Pure mathematical functions

**Example functions:**
```typescript
calculateIncrementalIntensity(base, count)
aggregateSignals(signals)
clamp(value, min, max)
```

**Does NOT:**
- ❌ Detect text patterns
- ❌ Define policy
- ❌ Interpret emotion

**This file should read like a math paper.** Every function is pure: same inputs → same outputs.

---

### Layer 4: Tests (`PunctuationAnalyzer.test.ts`)

**Responsibility:** Prove guarantees

**Tests map directly to research claims:**
- Boundedness [0, 1]
- Monotonicity (more marks → higher intensity)
- Precedence hierarchy (! > ? > ...)
- Supra-additive effects (!? > average)
- Boundary discourse effects
- Robustness to edge cases

**NO TEST WITHOUT A REASON.** Each test answers: "What claim are we validating?"

**35 test cases covering 10 research claims**

---

### Layer 5: Documentation (This File)

**Responsibility:** Explain the system to humans

**Answers:**
- What each file does (and does NOT do)
- Where research lives
- What is safe to change
- What is forbidden to touch
- How to calibrate in production

**Audience:** Future engineers, including future you.

---

## Research Foundation

### Core Sources

1. **Teh et al. (2015)** - Human rating study, 500 participants
   - Finding: ! is non-selective intensity amplifier
   - Application: Base weight for exclamation (0.7)

2. **VADER** (Hutto & Gilbert, 2014) - Social media sentiment analyzer
   - Finding: Each ! adds ~0.292 to compound score
   - Application: Increment calibration (0.0262, 25% more conservative)

3. **Circumplex Model of Affect** (Russell, 1980-present)
   - Theory: Emotions exist on bounded dimensions
   - Application: [0, 1] bounded scale for arousal/intensity

4. **Bose et al. (2021)** - Measurement theory for emotions
   - Principle: Bounded scales respect physiological limits
   - Application: MAX_INTENSITY cap at 1.0

5. **Teh et al. (2022)** - Textual variations and layering
   - Finding: Combining emphasis produces supra-additive effects
   - Application: Mixed punctuation (!?) = 0.8, not 0.6

6. **Yus (2005), Sampietro (2016), Thompson et al. (2016)**
   - Finding: Repetition signals urgency and commitment
   - Application: Incremental scaling, confidence boost

### Research Gaps (Explicitly Acknowledged)

**What is VALIDATED by research:**
- ✅ Base weights for !, ?, ... (Teh et al., VADER, pragmatics)
- ✅ Bounded scale [0, 1] (Circumplex, measurement theory)
- ✅ Repetition as intensifier (Yus, Sampietro, Thompson)
- ✅ Supra-additive effects for !? (Teh et al. 2022)
- ✅ Boundary discourse effects (pragmatics)

**What is HEURISTIC (requires calibration):**
- ⚠️ Exact increment (0.0262) - Derived from VADER but modified
- ⚠️ Linear vs logarithmic scaling - Psychology suggests diminishing returns
- ⚠️ Aggregation strategy (MAX) - No research on cross-pattern combination
- ⚠️ Confidence thresholds - Qualitative claims quantified via heuristics
- ⚠️ Position modifiers - Effect is real, magnitudes are estimates

---

## Weight System

### Base Weights [0, 1 Scale]

| Punctuation | Weight | Range | Research |
|-------------|--------|-------|----------|
| Exclamation (!) | 0.7 | [0.65, 0.75] | Teh et al. (2015), VADER |
| Question (?) | 0.5 | [0.45, 0.55] | Epistemic emotions, moderate arousal |
| Ellipsis (...) | 0.2 | [0.15, 0.25] | Discourse pragmatics, hesitation |
| Mixed (!? or ?!) | 0.8 | [0.75, 0.85] | Teh et al. (2022), supra-additive |
| Trailing Ellipsis | 0.3 | [0.25, 0.35] | Boundary discourse effects |
| Period (.) | 0.05 | N/A | Oad et al. (2021), neutral baseline |

**Period Implementation:**
- ✅ **FORMALLY SUPPORTED** in Layer 1 detection
- Detects sentence-ending single periods only
- Excludes: abbreviations (Dr.), decimals (3.14), URLs, ellipsis (...)
- Acts as ultra-low baseline (0.05) for neutral emotional state

### Incremental Scaling

**Formula:** `EIV = min(baseWeight + (count - 1) × 0.0262, 1.0)`

**Progression for Exclamation:**

| Marks | EIV | Change | % Increase |
|-------|-----|--------|------------|
| 1 | 0.7000 | - | - |
| 2 | 0.7262 | +0.0262 | +3.7% |
| 3 | 0.7524 | +0.0262 | +3.6% |
| 4 | 0.7786 | +0.0262 | +3.5% |
| 10 | 0.9358 | - | +33.7% total |

**Properties:**
- Monotonic: Never decreases
- Bounded: Always ≤ 1.0
- Linear: Constant increment (heuristic choice)

---

## Usage

### Basic Analysis

```typescript
import { PunctuationAnalyzer } from './PunctuationAnalyzer';
import { 
  calculateIncrementalIntensity, 
  aggregateSignals 
} from './punctuation.math';
import { BASE_WEIGHTS } from './punctuation.config';

const analyzer = new PunctuationAnalyzer();

// Step 1: Detect patterns
const result = analyzer.analyze('Amazing!!!');

// Step 2: Calculate intensity (Layer 3)
const eiv = calculateIncrementalIntensity(
  BASE_WEIGHTS.EXCLAMATION,
  result.signals[0].value // count: 3
);

console.log(eiv); // 0.7524

// Step 3: Aggregate multiple signals
const signals = [
  { category: 'exclamation', eiv: 0.7524, confidence: 0.85 },
  { category: 'question', eiv: 0.5524, confidence: 0.85 },
];

const aggregate = aggregateSignals(signals);
console.log(aggregate.aggregateEIV); // 0.7524 (max strategy)
```

### Complete Pipeline

```typescript
// Full workflow
const text = "Wow!!! Really??? I can't believe it!";

// Layer 1: Detect
const detection = analyzer.analyze(text);

// Layer 3: Calculate intensities
const intensities = detection.signals.map(signal => ({
  category: signal.type,
  eiv: calculateIncrementalIntensity(
    BASE_WEIGHTS[signal.type.toUpperCase()],
    signal.value
  ),
  confidence: calculateConfidence(signal.value, signal.position),
}));

// Layer 3: Aggregate
const final = aggregateSignals(intensities);

console.log(final);
// {
//   aggregateEIV: 0.7524,
//   aggregateConfidence: 0.85,
//   breakdown: { exclamation: 0.7524, question: 0.5524 },
//   strategy: 'MAX'
// }
```

---

## What is Safe to Change

### ✅ SAFE: Policy adjustments (Layer 2)

**You can modify:**
- Base weights (within defensible ranges)
- Increment value (test alternatives like 0.02 or 0.03)
- Aggregation strategy (change from MAX to weighted avg)
- Confidence thresholds
- Position modifiers

**How to change:**
1. Edit `punctuation.config.ts`
2. Run full test suite
3. A/B test with real users
4. Document empirical results
5. Update research citations

**Example:**
```typescript
// Testing alternative increment
export const REPETITION_INCREMENT = 0.030; // Was 0.0262

// Run tests: npm test
// If tests pass, deploy to subset of users
// Measure engagement/accuracy metrics
// Keep or revert based on data
```

---

### ⚠️ CAUTION: Detection logic (Layer 1)

**You can modify:**
- Regex patterns (if bugs found)
- Position resolution thresholds
- Text cleaning rules

**BUT:**
- Must not introduce weight calculations
- Must not interpret emotion
- Must maintain boring, data-only output

**Forbidden:**
```typescript
// ❌ WRONG: Analyzer calculating intensity
if (count > 3) {
  eiv = 0.9; // NO! Belongs in Layer 3
}

// ✅ RIGHT: Analyzer reporting facts
return { type: 'exclamation', count: count };
```

---

### 🛑 FORBIDDEN: Cross-layer violations

**Never:**
- Put weights in detection (Layer 1 ← Layer 2 violation)
- Put regex in math (Layer 3 ← Layer 1 violation)
- Put calculations in config (Layer 2 ← Layer 3 violation)
- Skip tests when changing policy

**Why these rules exist:**
- Testability: Pure functions are easy to test
- Maintainability: Clear responsibilities = fewer bugs
- Calibration: Can A/B test policies without breaking detection
- Research traceability: Changes map to specific claims

---

## Production Calibration Guide

### Step 1: Baseline Metrics (Week 1)

Deploy current system, collect:
- User engagement (messages per session)
- Emotional accuracy ratings (if available)
- EIV distribution across messages
- Edge case frequency

**Tools:**
```typescript
// Add telemetry
const result = analyzer.analyze(message);
analytics.track('punctuation_analysis', {
  aggregateEIV: result.aggregateEIV,
  signalCount: result.signals.length,
  userId: context.userId,
});
```

### Step 2: A/B Test Alternatives (Weeks 2-4)

**Experiment 1: Increment value**
- Control: 0.0262
- Variant A: 0.020 (more conservative)
- Variant B: 0.030 (more aggressive)

**Experiment 2: Aggregation strategy**
- Control: MAX
- Variant A: Weighted average
- Variant B: Probabilistic combination

**Experiment 3: Diminishing returns**
- Control: Linear scaling
- Variant A: Logarithmic scaling
- Variant B: Power-law scaling

### Step 3: Measure & Iterate (Ongoing)

**Key metrics:**
- Emotional accuracy (user feedback)
- Engagement (messages, session length)
- Edge case handling (robustness)
- Response appropriateness (qualitative)

**Decision criteria:**
- Statistically significant difference (p < 0.05)
- Positive impact on target metric
- No degradation in other metrics
- Passes all existing tests

### Step 4: Document Results

Update `punctuation.config.ts` with findings:

```typescript
/**
 * CALIBRATION HISTORY
 * 
 * v1.0 (2024-12-27): Initial research-backed values
 * v1.1 (2025-01-15): Increment reduced 0.0262 → 0.020
 *   - Reason: Users reported over-sensitivity to repetition
 *   - A/B test: 8.3% improvement in accuracy ratings
 *   - Sample: 10,000 users over 2 weeks
 * 
 * v1.2 (2025-02-01): Aggregation changed MAX → Weighted Avg
 *   - Reason: Co-occurring patterns were under-represented
 *   - A/B test: 5.1% improvement in engagement
 *   - Sample: 15,000 users over 3 weeks
 */
```

---

## Testing

### Run Full Suite

```bash
npm test PunctuationAnalyzer.test.ts
```

**Expected output:**
```
✅ 35 tests passing
✅ All research claims validated
✅ Edge cases handled
```

### Add New Tests

When adding features, tests MUST answer:

1. **What claim are we validating?**
   - Research citation OR explicit heuristic label

2. **What would failure look like?**
   - Concrete example of system breaking

3. **Is this already tested?**
   - No redundant tests

**Example:**
```typescript
describe('Claim: New Feature X', () => {
  it('validates research finding Y', () => {
    // Specific test mapping to specific claim
    const result = ...;
    expect(result).to...;
  });
});
```

---

## FAQ

### Q: What's the difference between EIV and ETV?

**EIV (Emotional Intensity Value):**
- Measures emotional **arousal/activation strength** [0, 1]
- Independent of valence (positive/negative)
- Calculated per message from multimodal signals
- Example: "I'm furious!!!" = high EIV (0.8+)

**ETV (Emotional Trust Value):**
- Measures user **trust in the AI system** [0, 1]
- Evolves over interactions via dynamic model
- Updated based on experience signals (success, transparency, alignment)
- Example: After 10 good interactions, ETV increases from 0.5 → 0.7

**Key difference:** EIV = current emotional state. ETV = cumulative relationship quality.

**ETV is NOT calculated by this analyzer.** It's maintained at system level using third-order linear dynamics (Akash et al., 2017):

```
T(n+1) = T(n) + αe[E(n) - T(n)] + αc[CT(n) - T(n)] + αb[BX(n) - T(n)]
Parameters: αe=0.113, αc=0.102, αb=0.147, γ=0.147
```

---

### Q: Why separate detection from math?

**A:** Testability and flexibility.
- Detection is hard to test (depends on regex complexity)
- Math is easy to test (pure functions)
- Separating them means policy changes don't break detection

### Q: Why not just use VADER weights directly?

**A:** VADER is optimized for social media sentiment (positive/negative).
We're measuring **intensity** (how strong), not **valence** (good/bad).
VADER's 0.292 per mark is for compound sentiment score, not bounded intensity.
Our 0.0262 is 25% more conservative and tuned for [0, 1] scale.

### Q: What if I disagree with a base weight?

**A:** 
1. Check if value is within defensible range (see config comments)
2. If yes, adjust and A/B test with real users
3. Document empirical results
4. Update research citations or mark as "calibrated heuristic"

### Q: How do I add a new punctuation pattern?

**Steps:**
1. Layer 1: Add detection regex to `PunctuationAnalyzer.ts`
2. Layer 2: Add base weight to `punctuation.config.ts` with research or heuristic label
3. Layer 3: No changes needed (math is pattern-agnostic)
4. Layer 4: Add tests validating the new pattern
5. Layer 5: Update this README

### Q: What's the difference between signal confidence and analyzer confidence?

**Signal Confidence** (in `AnalyzerSignal`):
- Per-detection certainty [0, 1]
- "How confident are we about THIS specific punctuation detection?"
- Increases with repetition count, position (end boost), pattern clarity
- Calculated in Layer 3 based on detection characteristics

**Analyzer Confidence** (in `AnalyzerResult`):
- Post-aggregation overall reliability [0, 1]
- "How confident are we about the ENTIRE analysis result?"
- Weighted average of signal confidences OR Expected Calibration Error (ECE)
- Calculated after aggregation across all signals

**In Layer 1 (Detection):**
- `AnalyzerResult.confidence = 0` (always placeholder)
- Individual `signal.confidence = 0` (also placeholder)
- Layer 3 (Math) or consuming system fills these in

**Example:**
```typescript
// After Layer 3 processing:
{
  signals: [
    { type: 'exclamation', value: 3, confidence: 0.85, eiv: 0.7524 },
    { type: 'question', value: 2, confidence: 0.8, eiv: 0.5524 },
  ],
  confidence: 0.83, // Weighted average of signal confidences
  aggregateEIV: 0.7524, // Max strategy
}
```

---

### Q: How does period (.) detection work?

**A:** Summing would create impossible values.

Example:
- "Wow!!! Really???" 
- Exclamation EIV: 0.75
- Question EIV: 0.55
- **Sum: 1.30** ← IMPOSSIBLE (exceeds maximum)

MAX reflects that both patterns signal **the same emotional state**, not two separate states to add.

Alternative strategies (weighted average, probabilistic) are possible but require empirical validation.

---

## File Structure

```
emotion-core/
├── analyzers/content/
│   └── PunctuationAnalyzer.ts        # Layer 1: Detection
├── config/
│   └── punctuation.config.ts         # Layer 2: Policy
├── math/
│   └── punctuation.math.ts           # Layer 3: Calculations
├── types/
│   └── analysis.types.ts             # Shared interfaces
└── tests/
    └── PunctuationAnalyzer.test.ts   # Layer 4: Validation
```

---

## Roadmap

### v1.0 ✅ (Current)
- Research-backed base weights
- Linear incremental scaling
- Maximum-based aggregation
- 35 comprehensive tests
- Complete documentation

### v1.1 🔄 (In Progress)
- Production telemetry
- A/B testing framework
- User feedback integration

### v1.2 📋 (Planned)
- Diminishing returns (logarithmic scaling)
- Alternative aggregation strategies
- Context-aware adjustments
- Multi-language support

### v2.0 🔮 (Future)
- Machine learning calibration
- Real-time adaptation
- Emotion-specific weighting
- Cross-analyzer integration

---

## Contributing

### Before Changing Anything

1. Read this README completely
2. Understand the five-layer architecture
3. Identify which layer you're modifying
4. Check what's safe vs forbidden to change

### Pull Request Checklist

- [ ] Tests added for new claims
- [ ] Research citations included OR marked as heuristic
- [ ] No cross-layer violations
- [ ] All existing tests still pass
- [ ] Documentation updated
- [ ] Calibration plan outlined (if policy change)

---

## License

Research-backed implementation for integration into emotional analysis systems.

All research sources are cited and publicly available.

---

## References

See `punctuation.config.ts` for inline citations.

**Key Papers:**
- Teh et al. (2015, 2022): Punctuation effects on sentiment
- Hutto & Gilbert (2014): VADER sentiment analyzer
- Russell (1980, 2003): Circumplex model of affect
- Bose et al. (2021): Measurement theory for emotions
- Yus (2005), Sampietro (2016), Thompson et al. (2016): Repetition effects

---

**Version:** 1.0  
**Last Updated:** 2024-12-27  
**Status:** ✅ Production Ready (with calibration needs documented)