# ETV V1: Methodology -- Research Grounding and Architectural Justification

**Companion to:** `docs/ETV_V1_BLUEPRINT.md`
**Version:** 1.0.0
**Date:** 2026-02-25
**Purpose:** Formal documentation of how each architectural decision in the ETV V1 blueprint maps to peer-reviewed evidence, where the design extends beyond direct literature, and what gaps remain.

---

## Table of Contents

1. [Methodological Approach](#1-methodological-approach)
2. [Literature-to-Architecture Mapping](#2-literature-to-architecture-mapping)
3. [Derivation of the Core Model](#3-derivation-of-the-core-model)
4. [Derivation of the Gating Policy](#4-derivation-of-the-gating-policy)
5. [Derivation of the Decay Model](#5-derivation-of-the-decay-model)
6. [Derivation of the Evidence Score](#6-derivation-of-the-evidence-score)
7. [Derivation of the Band System](#7-derivation-of-the-band-system)
8. [Extrapolations and Novel Contributions](#8-extrapolations-and-novel-contributions)
9. [Gap Analysis](#9-gap-analysis)
10. [Strength-of-Evidence Assessment](#10-strength-of-evidence-assessment)

---

## 1. Methodological Approach

### 1.1 Grounding strategy

The ETV V1 architecture was derived through a structured process:

1. **Identify architectural requirements** from the LoRa v1 system specification (competence-based calibration, session-boundary updates, uncertainty-aware gating, per-user personalization, cross-session continuity).

2. **Map each requirement to established research domains** using two curated research reports containing peer-reviewed sources with verified quotes and DOIs.

3. **Select mathematical models** from the literature that satisfy the requirements, preferring models with both theoretical analysis and empirical validation.

4. **Adapt models to the application context** where the literature addresses a structurally analogous but not identical problem (e.g., adapting computational trust models from human-automation interaction to conversational AI behavioral calibration).

5. **Document every adaptation explicitly**, distinguishing between:
   - **Direct application** (the literature describes exactly this mechanism for this purpose)
   - **Structural analogy** (the literature describes this mechanism for a related purpose; we apply it to a structurally similar problem)
   - **Novel extrapolation** (the literature provides mathematical tools or principles that we combine in a way not previously documented)

### 1.2 Citation discipline

- All citations reference sources from the two attached research reports.
- No citations have been invented or hallucinated.
- Each citation includes the specific claim or quote that supports the architectural decision.
- Where a source provides indirect rather than direct support, this is stated explicitly.

### 1.3 Falsifiability

Every architectural decision in the blueprint produces testable predictions:
- The Beta-with-decay model predicts specific numerical trajectories given input sequences.
- The gating policy produces deterministic outputs given state inputs.
- The invariants are machine-checkable properties.

This means the architecture can be validated or refuted through testing, not just argued from authority.

---

## 2. Literature-to-Architecture Mapping

The following table maps each major architectural decision to its supporting literature, the type of support, and the specific adaptation made.

### 2.1 Core model selection

| Decision | Literature basis | Support type | Adaptation |
|---|---|---|---|
| **Use Beta distribution for trust** | Wang & Singh: Beta/Bernoulli trust with discount factor. Josang et al.: Beta model with exponential decay for dynamic trust. | **Direct application.** These papers define and analyze exactly this model for computational trust. | None. The Beta trust model is applied as described in the literature. |
| **Maintain pseudo-counts (r, s)** | Wang & Singh: *"Based on actual observations (r, s)..."* Josang et al.: *"m(o) is the number of successful interactions... and n(o) that of unsuccessful ones."* | **Direct application.** | None. |
| **Derive mean as r/(r+s)** | Standard Beta distribution property. Josang et al. define the scalar state as E[theta] = m/(m+n). | **Direct application.** | None. |
| **Derive variance from Beta** | Standard Beta distribution property: Var = rs/((r+s)^2(r+s+1)). | **Direct application.** Mathematical identity. | None. |

### 2.2 Temporal decay

| Decision | Literature basis | Support type | Adaptation |
|---|---|---|---|
| **Exponential decay on pseudo-counts** | Wang & Singh: temporal discount factor beta. Josang et al.: *"computational trust frameworks based on the 'beta' probability distribution and the principle of exponential decay."* | **Direct application.** | None. |
| **Half-life parameterization** | Half-life decay in MF-based recommenders: *"a novel half-life decaying modeling embedded into a matrix factorization process."* Jain et al.: *"exponential, linear, logistic, and power [decay functions]."* | **Structural analogy.** The half-life form is used in recommender systems for rating decay; we apply it to trust pseudo-count decay. | Mapping from rating staleness to trust evidence staleness. Both represent "older observations should count less." |
| **Decay applied to idle time between sessions** | Wang & Singh define decay as a function of time. Josang et al. analyze decay in dynamic settings. Trust-assessment slides: *"Old observations are given less weight (decayed) than more recent observations."* | **Structural analogy.** The literature defines decay over event sequences or discrete time steps, not explicitly over "idle time between sessions." | We map inter-session elapsed time to the decay variable. This is a straightforward temporal mapping but is not directly studied in the cited literature. |
| **Half-life H = 14 days** | No direct literature basis for this specific value. | **Engineering heuristic.** | Chosen to balance continuity (evidence persists for weeks) with adaptation (evidence halves in two weeks of inactivity). Subject to calibration. |

### 2.3 Session-boundary updates

| Decision | Literature basis | Support type | Adaptation |
|---|---|---|---|
| **Update only at session boundaries, not per-message** | Merritt (2015): trust calibration analyzed over reliability blocks. Lebiere et al. (2021): ACT-R model aggregates evidence across task blocks. Lavoura et al. (2025): recommender models retrained at data boundaries. | **Indirect support.** These works operate at block/episode granularity, implicitly endorsing slower update rates than per-event. No direct comparison of per-message vs per-session updating exists. | We formalize the implicit practice of block-level updating into an explicit architectural constraint. The 35-minute inactivity threshold is an engineering heuristic, not a literature claim. |
| **Session evidence score z_t as aggregate** | Wang & Singh: counts (r, s) can be computed over an episode and applied in a single update. Lebiere et al.: *"internal estimate of automation reliability"* updated from block-level performance. | **Structural analogy.** The literature aggregates trial-level outcomes into block-level trust updates. We aggregate per-message signals into session-level evidence scores. | Mapping from task trial outcomes to conversational session quality metrics. |

### 2.4 Uncertainty-aware gating

| Decision | Literature basis | Support type | Adaptation |
|---|---|---|---|
| **Use variance to gate behavioral assertiveness** | Paek & Horvitz (2000): *"decide between... Inquire_Goal... or Take_Action, based on a probability threshold."* Horvitz et al. (2014): *"speaking policies... trigger a dialog act requesting a confirmation or clarification... if... Concept uncertainty is low recognition confidence."* | **Structural analogy.** The literature uses belief uncertainty to gate dialog actions (ask vs act). We use ETV variance to gate behavioral depth and assertiveness. | Mapping from dialog-level belief uncertainty to longitudinal calibration uncertainty. The principle is identical (uncertainty reduces initiative); the timescale differs (per-utterance vs per-session). |
| **Risk-adjusted mean: mean - k*sqrt(var)** | Kuindersma et al.: confidence-bound criteria CB(theta, kappa) = -E[J] - kappa*s. Moore: risk-sensitive Kalman filtering with *"risk-sensitive parameter."* | **Structural analogy.** The literature uses variance penalties in control policy selection. We use the same mathematical form to penalize ETV when uncertainty is high. | Mapping from control policy cost to trust calibration. The mathematical form (mean - k*sigma) is identical; the domain differs. |
| **Tomsett et al. principle** | Tomsett et al. (2020): *"AI services can achieve [rapid trust calibration] by being both interpretable and uncertainty-aware."* | **Conceptual support.** This is a design principle, not a specific mechanism. | We instantiate the principle through the variance-penalized gating policy. |

### 2.5 Stability-plasticity

| Decision | Literature basis | Support type | Adaptation |
|---|---|---|---|
| **Implicit per-user adaptation via N_eff** | Yoo et al. (PISA, SIGIR 2025): *"prioritizing stability for stable users and plasticity for dynamic users."* Chen et al. (NeurIPS 2023): *"dynamically adjusts the meta-parameter and its learning rate w.r.t. environment change."* | **Structural analogy.** The literature uses per-user/per-task adaptation rates. Our Beta model provides implicit adaptation: users with more evidence (higher N_eff) are harder to shift. | The mechanism differs (explicit per-user learning rates vs implicit Bayesian evidence accumulation) but the effect is analogous: established users are more stable, new users are more plastic. |
| **Fixed M and H in V1** | Lavoura et al. (2025): *"profile algorithms according to their ability to... retain past patterns -- stability -- and... adapt to changes -- plasticity."* | **Indirect support.** The literature measures stability-plasticity tradeoffs but does not prescribe specific parameter values. | V1 uses fixed parameters. Per-user tuning is deferred to V2, where session-level z_t volatility could drive adaptive M. |

### 2.6 Calibration as accuracy, not maximization

| Decision | Literature basis | Support type | Adaptation |
|---|---|---|---|
| **ETV is calibration, not bonding** | Holland et al. (2024): *"Calibrated trust is the extent to which the judgments of trust are accurate... trust appropriately reflects the automation's capabilities."* Merritt (2015): *"Trust calibration (correspondence between aid reliability and user trust)."* Wischnewski et al. (CHI 2023): *"Overtrust and undertrust both constitute miscalibrated trust."* | **Direct application.** The literature defines calibrated trust as accuracy of trust relative to capability. We define ETV as accuracy of behavioral parameterization relative to interaction reliability. | Minimal. The conceptual framework applies directly. |

---

## 3. Derivation of the Core Model

### 3.1 Requirements that drove model selection

The ETV system requires a model that:

1. Produces a **scalar point estimate** in (0, 1) for behavioral parameterization.
2. Produces an **uncertainty signal** for risk-sensitive gating.
3. **Accumulates evidence** over sessions (not just the most recent session).
4. **Decays old evidence** to adapt to behavioral change.
5. Is **computationally trivial** (no matrix operations, no sampling, no optimization).
6. Is **deterministic** given the same inputs.

### 3.2 Models considered

| Model | Point estimate | Uncertainty | Evidence accumulation | Decay | Complexity | Selected |
|---|---|---|---|---|---|---|
| EMA | Yes | No | Implicit (exponential weighting) | Implicit | O(1) | No -- no uncertainty signal |
| Beta/Bernoulli | Yes (mean) | Yes (variance) | Yes (pseudo-counts) | Yes (count discounting) | O(1) | **Yes** |
| 1-D Kalman filter | Yes (mean) | Yes (variance) | Yes (recursive) | Yes (process noise) | O(1) | Considered -- equivalent expressiveness but less interpretable for trust |
| Bayesian logistic regression | Yes | Yes | Yes | Possible | O(d) per update | No -- unnecessary complexity for scalar state |

### 3.3 Why Beta-with-decay over 1-D Kalman

Both models produce a mean and variance from sequential observations. The Beta model was selected because:

1. **Interpretability:** Pseudo-counts (r, s) have a direct interpretation as "positive and negative evidence sessions." This is more intuitive for auditing and debugging than Kalman state covariance.
2. **Bounded output:** The Beta mean is naturally in (0, 1) without transformation. The Kalman mean requires clamping or a link function.
3. **Literature alignment:** The computational trust literature (Wang & Singh, Josang et al.) uses Beta models specifically. Using the same model family strengthens the grounding claim.
4. **Decay semantics:** Multiplicative decay on pseudo-counts has a clear interpretation (forgetting old evidence). Kalman process noise has a less direct interpretation for trust.

The 1-D Kalman filter remains a valid alternative and could be adopted in V2 if the Beta model's discrete-evidence assumption proves limiting. Report 2, Section C notes that *"a 1-D Kalman filter on a latent reliability state x_t with observation noise is directly applicable to ETV as a scalar latent variable"* [Report 2, Section C, citing Moore].

---

## 4. Derivation of the Gating Policy

### 4.1 From literature to policy knobs

The gating policy translates ETV state into behavioral parameters. The derivation follows three steps:

**Step 1: Establish the principle that uncertainty should gate initiative.**

Paek & Horvitz (2000) establish that conversational systems should choose between asking and acting based on probability thresholds: *"the system has to decide between... conversational strategies... Inquire_Goal... or Take_Action, based on a probability threshold over inferred user goals"* [Report 1, Claim 4a]. Horvitz et al. (2014) extend this to speaking policies that *"trigger a dialog act requesting a confirmation or clarification... if... Concept uncertainty is low recognition confidence"* [Report 1, Claim 4c].

**Step 2: Establish the mathematical form of uncertainty penalty.**

Kuindersma et al. use confidence-bound criteria where action selection depends on mean minus a scaled standard deviation: CB(theta, kappa) = -E[J] - kappa*s [Report 2, Section E]. Moore's risk-sensitive Kalman filter penalizes uncertainty through an exponential cost function [Report 2, Section E]. Both establish the principle: **action utility decreases with uncertainty**.

**Step 3: Instantiate as continuous policy knobs.**

We define policy knobs as continuous functions of a risk-adjusted ETV score (p) and a confidence factor (conf). The functional forms (linear with clamp) are chosen for:
- Determinism and auditability
- Monotonicity (provable)
- Bounded output (enforced by clamp)
- Interpretability (each knob is a simple function of two variables)

The specific coefficients (e.g., 0.15 + 0.70*p for maxInitiative) are engineering choices that define the floor and ceiling of each behavioral dimension. They are not derived from literature but are constrained by the literature-grounded principles:
- Floor > 0 (system is never inert)
- Ceiling < 1 (system is never unconstrained)
- Monotonically increasing in p (more trust = more capability)
- Attenuated by conf (uncertainty reduces assertive behaviors)

### 4.2 The conf variable

The confidence factor conf = clamp(1 - sqrt(etvVar) * c_var, 0, 1) is a novel construction that maps Beta variance into a [0, 1] confidence scale. It is not directly from the literature but is motivated by:

- The risk-sensitive control principle that variance should penalize action selection [Kuindersma et al., Report 2, Section E].
- The decision-theoretic dialog principle that low confidence should trigger clarification rather than assertion [Paek & Horvitz, Report 1, Claim 4a].

The scaling constant c_var = 4.0 is chosen so that:
- At the cold-start variance (0.047), conf = 1 - sqrt(0.047) * 4 = 1 - 0.87 = 0.13 (very low confidence).
- At a well-established variance (0.005), conf = 1 - sqrt(0.005) * 4 = 1 - 0.28 = 0.72 (moderate-high confidence).
- At near-zero variance (0.001), conf = 1 - sqrt(0.001) * 4 = 1 - 0.13 = 0.87 (high confidence).

This produces a reasonable confidence curve that is aggressive at penalizing uncertainty for new users and permissive for established users.

---

## 5. Derivation of the Decay Model

### 5.1 From literature to half-life decay

The temporal decay model is derived in three steps:

**Step 1: Establish that trust evidence should decay with time.**

Wang & Singh introduce a temporal discount factor: *"Let beta be the temporal discount factor"* [Report 2, Section B]. Josang et al. analyze exponential decay for dynamic trust: *"computational trust frameworks based on the 'beta' probability distribution and the principle of exponential decay"* [Report 2, Section B]. Both establish that older evidence should count less.

**Step 2: Select the decay functional form.**

The literature uses multiplicative decay on pseudo-counts: r_t = beta * r_{t-1} + k_t. We adopt the same form. The half-life parameterization (decay = 2^(-dt/H)) is chosen over the raw exponential (decay = exp(-lambda*dt)) because:
- Half-life H has a direct interpretation ("after H time units, evidence is halved").
- It is easier to reason about for non-technical stakeholders.
- It is mathematically equivalent (lambda = ln(2)/H).

The half-life form is used in recommender systems: *"a novel half-life decaying modeling embedded into a matrix factorization process"* [Report 2, Section B].

**Step 3: Apply decay to inter-session idle time.**

The literature defines decay over event sequences or discrete time steps. We apply it to the elapsed time between session boundaries. This is a straightforward temporal mapping: the "time steps" in Wang & Singh's model become hours or days of real elapsed time. The mapping is not explicitly studied in the cited literature but is consistent with the time-aware recommender literature, which applies decay to *"the ratings to give more weightage to the most recent ratings"* based on real timestamps [Jain et al., Report 2, Section B].

### 5.2 Decay floor

The epsilon floor (decay >= 0.01, counts >= 0.01) is an engineering safeguard not from the literature. It prevents the Beta distribution from degenerating (r or s reaching 0) after extreme idle periods. Without this floor, a user returning after years of inactivity would have near-zero counts, making the Beta distribution numerically unstable.

---

## 6. Derivation of the Evidence Score

### 6.1 The modeling assumption

The evidence score z_t maps session-level aggregates (emotional intensity, appraisal volatility, correction rates, safety triggers, etc.) into a scalar "interaction reliability" score in [0, 1].

This mapping is the **primary novel contribution** of the ETV architecture. The literature provides:
- The framework for updating trust with session-level evidence (Wang & Singh, Josang et al.)
- The principle that trust should reflect reliability (Holland et al., Merritt)
- The concept of session-level aggregation (Lebiere et al., Lavoura et al.)

But the literature does **not** define how to compute a reliability score from emotional intensity, appraisal volatility, and conversational quality metrics. This is an application-specific modeling decision.

### 6.2 Design rationale

The evidence score is designed around the principle that **interaction reliability** (not emotional closeness) should drive trust calibration:

- **Low volatility** = the system's emotional assessments were stable, suggesting accurate calibration. (Positive evidence.)
- **Low correction rate** = the user did not frequently correct the system, suggesting appropriate behavior. (Positive evidence.)
- **Low safety trigger rate** = no safety boundaries were hit, suggesting the system operated within appropriate limits. (Positive evidence.)
- **High inference reliability** = the system's analyzers agreed with each other, suggesting confident signal extraction. (Positive evidence.)

This operationalizes Holland et al.'s definition: *"calibrated trust is the extent to which the judgments of trust are accurate... trust appropriately reflects the automation's capabilities"* [Report 1, Claim 1a]. The "capabilities" here are the system's ability to produce stable, uncorrected, safe, and reliable emotional assessments.

### 6.3 Weight selection

The weights in the linear z_t formulation (Section 8.3 of the blueprint) are initial engineering estimates, not literature-derived values. They reflect the following priority ordering:

1. **Safety triggers and contradictions** (w3, w4 = 0.25): strongest negative signals. A session with safety triggers or contradictions is unreliable regardless of other metrics.
2. **Mean volatility** (w1 = 0.30): primary instability signal. High average volatility indicates the system was consistently uncertain.
3. **Peak volatility** (w2 = 0.20): spike sensitivity. A single extreme volatility event is concerning but less informative than sustained volatility.
4. **Corrections** (w5 = 0.20): moderate negative signal. User corrections indicate miscalibration.
5. **Clarifications** (w6 = 0.15): mild negative signal. System-initiated clarification is sometimes appropriate, so it is penalized less.

The composite weights (a1 = 0.45, a2 = 0.30, a3 = 0.25) reflect the relative importance of stability, cooperation, and inference reliability. Stability is weighted highest because it most directly reflects the system's calibration accuracy.

All weights are subject to calibration against labeled interaction data when available.

---

## 7. Derivation of the Band System

### 7.1 From continuous to discrete

The band system discretizes the continuous risk-adjusted ETV into five operational levels. This discretization serves two purposes:

1. **Behavioral clarity:** It is easier to define and audit disallowed behaviors per band than per continuous value.
2. **Prompt engineering:** The prompt builder can select band-specific behavioral templates rather than interpolating continuously.

### 7.2 Risk-adjusted mean

The formula riskAdjusted = mean - k * sqrt(var) is a standard confidence-bound construction. It is directly analogous to:

- Kuindersma et al.'s CB(theta, kappa) = -E[J] - kappa*s, where s is standard deviation [Report 2, Section E].
- Lower confidence bounds in Bayesian optimization (UCB/LCB), where the bound is mean +/- kappa * sigma.

The risk-aversion coefficient k = 1.5 is an engineering choice. It means that a user needs approximately 1.5 standard deviations of "safety margin" above a band threshold to be assigned to that band. This is conservative by design: the system prefers to underestimate trust rather than overestimate it, consistent with the calibration principle that *"overtrust and undertrust both constitute miscalibrated trust"* but overtrust is more dangerous in a behavioral system [Wischnewski et al., Report 1, Claim 1c].

### 7.3 Band naming

The bands are named using capability-access terminology (Baseline Access, Verified Interaction, Stable Operator, Reliable Context Use, High-Confidence Adaptation) rather than relationship terminology (acquaintance, friend, close friend). This reflects the non-goal NG1: ETV is not affective bonding.

---

## 8. Extrapolations and Novel Contributions

The following aspects of the architecture extend beyond what is directly documented in the cited literature. Each is flagged with its rationale.

### 8.1 Emotional metrics as reliability proxy

**What:** Mapping emotional intensity (EIV), appraisal volatility (AVI), and conversational quality metrics into a "reliability" score that drives a Beta trust model.

**Why this is an extrapolation:** The computational trust literature (Wang & Singh, Josang et al.) defines trust over task performance outcomes (success/failure of automated actions). The ETV system defines trust over emotional-behavioral calibration quality (stability of emotional assessments, absence of corrections and safety triggers). These are structurally analogous -- both are binary-decomposable quality signals -- but the specific domain (emotional AI calibration) is not addressed in the cited literature.

**Justification:** The mapping preserves the mathematical structure of the Beta trust model. The evidence score z_t is bounded in [0, 1] and interpretable as a "session success probability," which is exactly the parameter that the Beta distribution models. The specific features (volatility, corrections, safety triggers) are reasonable proxies for calibration quality because they measure the system's behavioral accuracy from observable signals.

### 8.2 Session-boundary-only updates as architectural constraint

**What:** Enforcing that ETV updates occur only at session boundaries, never per-message.

**Why this is an extrapolation:** The trust literature operates at block/episode granularity but does not formally prove that session-level updates are superior to per-message updates. Report 1, Claim 3 assessment states: *"little direct empirical or theoretical work that proves 'session-level aggregation improves stability compared to per-turn updates' as a formal design rule."*

**Justification:** Session-boundary updating is adopted as an engineering constraint for three reasons:
1. It reduces per-message computational overhead (ETV is read once per session, not computed per message).
2. It smooths per-message noise by aggregating over the full session before updating.
3. It aligns with the block-level granularity used in the trust literature (Merritt 2015, Lebiere et al. 2021), even though the literature does not formally compare granularities.

### 8.3 The conf variable construction

**What:** conf = clamp(1 - sqrt(etvVar) * c_var, 0, 1) as a variance-to-confidence mapping.

**Why this is an extrapolation:** The literature uses variance penalties in action selection (Kuindersma et al.) and risk-sensitive estimation (Moore), but does not define this specific functional form for mapping Beta variance to a confidence factor.

**Justification:** The construction is a simple, monotonic, bounded transformation that maps high variance to low confidence. It satisfies the literature-grounded principle that uncertainty should reduce assertive behavior. The scaling constant c_var is calibrated to produce reasonable confidence values across the expected variance range (0.001 to 0.05).

### 8.4 The 35-minute session boundary

**What:** Defining a session as ending after 35 minutes of user inactivity.

**Why this is an extrapolation:** No cited source specifies this threshold. The existing codebase uses 3600 seconds (1 hour).

**Justification:** This is an operational heuristic. 35 minutes is chosen as a reasonable upper bound for a single conversational episode, balancing:
- Too short (e.g., 10 minutes): would split natural pauses into separate sessions.
- Too long (e.g., 2 hours): would merge distinct conversational contexts into one session.

The value is configurable and subject to empirical tuning.

---

## 9. Gap Analysis

### 9.1 Gaps in direct literature support

| Gap | Severity | Mitigation |
|---|---|---|
| No direct comparison of per-message vs per-session ETV updates | Moderate | Session-boundary updating is consistent with block-level practice in the literature. Can be empirically validated post-launch. |
| No literature on mapping emotional metrics to Beta trust evidence | Moderate | The mapping preserves the mathematical structure of Beta trust models. The specific features are reasonable proxies for calibration quality. |
| No literature basis for specific weight values in z_t | Low | Weights are initial estimates subject to calibration. The architecture supports weight tuning without structural changes. |
| No literature basis for H = 14 days or k = 1.5 | Low | These are engineering parameters. The architecture supports tuning without structural changes. |
| No literature on 35-minute session boundary | Low | Engineering heuristic. Configurable. |
| Stability-plasticity mechanisms not instantiated for trust calibration specifically | Moderate | The Beta model provides implicit per-user adaptation via N_eff. Explicit per-user tuning is deferred to V2. |

### 9.2 Gaps in the research reports themselves

| Gap | Impact on architecture |
|---|---|
| Report 1, Claim 3 has only indirect support | Session-boundary updating is adopted as an engineering constraint with conceptual (not empirical) justification. |
| Report 2 notes that *"most trust models focus on task performance reliability, not 'emotional' metrics"* | The evidence score z_t is a novel mapping. Its validity depends on whether the chosen features are good proxies for calibration quality. |
| Risk-sensitive control papers address physical control, not conversational behavior | The mathematical form (mean - k*sigma) is domain-independent. Application to conversational initiative is indirect but mathematically consistent. |

---

## 10. Strength-of-Evidence Assessment

Each major architectural component is rated on a three-level scale:

- **Strong:** Direct application of a well-established model with minimal adaptation.
- **Moderate:** Structural analogy from a related domain, with clear mathematical correspondence.
- **Weak:** Novel construction motivated by literature principles but not directly documented.

| Component | Evidence strength | Primary sources | Notes |
|---|---|---|---|
| Beta distribution for trust | **Strong** | Wang & Singh; Josang et al. | Standard computational trust model. |
| Pseudo-count representation | **Strong** | Wang & Singh; Josang et al. | Directly from the literature. |
| Exponential decay on counts | **Strong** | Wang & Singh; Josang et al.; Jain et al. | Well-established in trust and recommender systems. |
| Half-life parameterization | **Moderate** | Half-life decay in MF recommenders | Structural analogy from recommender systems. |
| Session-boundary updating | **Moderate** | Merritt 2015; Lebiere et al. 2021; Lavoura et al. 2025 | Consistent with block-level practice; no direct comparison to per-message. |
| Uncertainty-gated initiative | **Strong** | Paek & Horvitz 2000; Horvitz et al. 2014 | Directly established in decision-theoretic dialog. |
| Risk-adjusted mean (mean - k*sigma) | **Moderate** | Kuindersma et al.; Moore | Standard confidence-bound form; applied to a new domain. |
| Evidence score z_t | **Weak** | Novel construction | Motivated by calibration-as-accuracy principle (Holland et al., Merritt). Specific feature mapping is application-specific. |
| Band system | **Weak** | Novel construction | Discretization of continuous risk-adjusted score. Thresholds are engineering choices. |
| Policy knob equations | **Weak** | Novel construction | Functional forms motivated by monotonicity and uncertainty-penalty principles from the literature. Specific coefficients are engineering choices. |
| Stability-plasticity via N_eff | **Moderate** | Yoo et al. PISA; Chen et al. NeurIPS 2023 | Implicit adaptation is a natural property of Bayesian models. Explicit per-user tuning deferred. |
| Calibration (not bonding) framing | **Strong** | Holland et al. 2024; Merritt 2015; Wischnewski et al. CHI 2023 | Directly from the trust calibration literature. |

### Summary

The ETV V1 architecture rests on a **strong foundation** for its core mathematical model (Beta-with-decay, uncertainty-gated initiative, calibration-as-accuracy). The **moderate** components are structural analogies from well-established related domains. The **weak** components are novel constructions that are mathematically consistent with the literature but require empirical validation. All weak components are parameterized and configurable, allowing calibration without architectural changes.
