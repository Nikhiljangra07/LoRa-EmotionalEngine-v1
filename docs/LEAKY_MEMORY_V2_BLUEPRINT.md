# Leaky Schema Memory V2 -- Formal Engineering Blueprint

**Version:** 2.2.0
**Date:** 2026-02-26
**Status:** SPECIFICATION (pre-implementation)
**Scope:** Dual-database memory layer (ChromaDB + FalkorDB), integration with `EngineOrchestrator`, `PromptTemplateBuilder`, and ETV
**Authors:** LoRa Architecture Team
**Companion:** `docs/ETV_V1_BLUEPRINT.md`

---

## Table of Contents

1. [Definition and Scope](#1-definition-and-scope)
2. [Goals](#2-goals)
3. [Non-Goals](#3-non-goals)
4. [Hard Invariants](#4-hard-invariants)
5. [Research Grounding](#5-research-grounding)
6. [System Architecture](#6-system-architecture)
7. [TypeScript Type Definitions](#7-typescript-type-definitions)
8. [Emotion Encoder Specification](#8-emotion-encoder-specification)
9. [Episodic Buffer](#9-episodic-buffer)
10. [Schema Store](#10-schema-store)
11. [Retrieval Engine](#11-retrieval-engine)
12. [Consolidation Engine](#12-consolidation-engine)
13. [Fact Anchor Layer](#13-fact-anchor-layer)
14. [Failure Detectors](#14-failure-detectors)
15. [ETV Integration](#15-etv-integration)
16. [EngineOrchestrator Integration](#16-engineorchestrator-integration)
17. [PromptTemplateBuilder Integration](#17-prompttemplatebuilder-integration)
18. [Observability and Logging](#18-observability-and-logging)
19. [Testing Strategy](#19-testing-strategy)
20. [Step-by-Step Implementation Guide](#20-step-by-step-implementation-guide)
21. [Phased Rollout Plan](#21-phased-rollout-plan)

---

## 1. Definition and Scope

Leaky Schema Memory is LoRa's privacy-first, dual-database memory layer that provides cross-session behavioral continuity and factual context without storing raw conversation transcripts.

It has two independent subsystems:
- **Emotional Pattern Layer** (ChromaDB): Stores 21-dimensional emotion vectors as episodic events, consolidates them into behavioral schemas via EWMA. Enables LoRa to recognize recurring emotional patterns and adapt response strategy.
- **Factual Anchor Layer** (FalkorDB): Stores structured fact extractions (dates, people, events, preferences, goals) as a knowledge graph. Enables LoRa to maintain conversational context across sessions.

Together they implement **Fuzzy-Trace Theory** (Reyna & Brainerd, 1995): humans store two independent memory traces -- verbatim (exact details, fades quickly) and gist (meaning/essence, persists). LoRa's raw transcript is the verbatim trace (deleted). The emotional patterns and fact anchors are the gist traces (preserved).

**What it IS:**
- Privacy-first behavioral continuity engine
- Dual-gist extraction: emotional patterns + factual anchors
- Companion to the ETV (Emotional Trust Value) system -- ETV gates how aggressively memory is used

**What it is NOT:**
- A conversation logger or transcript store
- A general-purpose knowledge base
- A replacement for ETV (memory provides context; ETV provides trust calibration)
- A content-based topic classifier

---

## 2. Goals

| ID | Goal | Mechanism |
|----|------|-----------|
| G1 | Cross-session emotional pattern recognition | Schema Store in ChromaDB with cosine similarity retrieval |
| G2 | Cross-session factual context preservation | Fact Anchor graph in FalkorDB with entity-relationship traversal |
| G3 | Privacy-first design -- no raw transcripts persisted | Lossy compression through analyzer pipeline (emotional) + structured extraction with source deletion (factual) |
| G4 | Differentiate similar emotions by context | Fact anchors disambiguate: "interview anxiety" vs "car accident anxiety" share emotional patterns but differ in anchors |
| G5 | Progressive forgetting -- specific episodes fade, general patterns persist | Episodic buffer decays; schemas consolidate; anchors expire by date or decay by recency |
| G6 | Compatible with existing architecture -- zero disruption when disabled | Feature-flagged; all memory operations gated by `memoryLayerEnabled`; existing pipeline unchanged when off |
| G7 | Complement ETV, not replace it | ETV gates memory write intensity; memory enriches ETV evidence score (Phase 3) |

---

## 3. Non-Goals

| ID | Non-Goal |
|----|----------|
| NG1 | Storing raw conversation transcripts or full sentences |
| NG2 | Semantic topic classification (topics = emotion-context clusters, not content) |
| NG3 | Real-time LLM calls in the hot path for extraction (V1 uses rule-based; V2 adds optional LLM) |
| NG4 | Cross-user memory sharing or comparison |
| NG5 | Replacing ETV with memory-based trust |
| NG6 | Building a general-purpose knowledge graph |

---

## 4. Hard Invariants

These are non-negotiable constraints that must hold at all times:

| ID | Invariant |
|----|-----------|
| INV-1 | No raw user message text is persisted in either database. Only numeric vectors and structured fact extractions survive. **Note:** Fact anchors contain named entities (people, dates, summaries) and constitute relational personal data -- see Section 13.5 for data classification and required safeguards. |
| INV-2 | Schema count per user <= 20 (ChromaDB) |
| INV-3 | Episodic event count per user <= 30 (ChromaDB) |
| INV-4 | Fact anchor count per user <= 15 (FalkorDB) |
| INV-5 | emotion_vec length == 21 (fixed, zero-filled for missing dims) |
| INV-6 | All emotion_vec dimensions in [0, 1] after normalization |
| INV-7 | L2 norm of emotion_vec == 1.0 (post-normalization) |
| INV-8 | salienceWeight in [0, 1] for all schemas |
| INV-9 | retrievalBias in [-0.20, +0.20] for all schemas |
| INV-10 | retrieval_score = clamp(cosineSim + retrievalBias, -1, 1) |
| INV-11 | No-match gate uses raw cosine, not biased score: if max(cosineSim) < theta_retrieve -> no match |
| INV-12 | Consolidation runs ONLY at endSession() or idle timeout -- never per-message |
| INV-13 | All memory operations gated by featureFlags.memoryLayerEnabled |
| INV-14 | Deterministic: same inputs produce identical outputs |
| INV-15 | Fact anchors with confidence < ANCHOR_CONFIRM_THRESHOLD (0.60) are quarantined -- never surfaced in MemoryContext until reinforced or confirmed |
| INV-16 | Anchor injection into MemoryContext requires passing the Anchor Relevance Arbiter -- emotional-context relevance score >= ANCHOR_RELEVANCE_FLOOR (0.25) |
| INV-17 | User deletion request purges ALL fact anchors and ALL schemas for that userId from both databases within one call. No partial deletion. |

---

## 5. Research Grounding

### 5.1 Fuzzy-Trace Theory (Reyna & Brainerd, 1995)

The core cognitive science foundation. FTT establishes that memory operates through two independent parallel traces:
- **Verbatim traces**: Precise, literal memories with exact details -- fade rapidly
- **Gist traces**: Meaning-based, intuitive memories focused on semantic essence -- persist long-term

This maps directly to LoRa's architecture:
- Raw transcript = verbatim trace -> deleted after extraction
- Emotional patterns (ChromaDB) = emotional gist -> persists as schemas
- Fact anchors (FalkorDB) = factual gist -> persists as entity graph

Source: Reyna, V. F., & Brainerd, C. J. (1995). "Fuzzy-trace theory: An interim synthesis." Learning and Individual Differences, 7(1), 1-75.

### 5.2 Episodic vs Semantic Memory (Tulving, 1972)

The two-tier memory architecture (episodic buffer + schema store) mirrors Tulving's distinction:
- **Episodic memory** (buffer): Specific events with temporal context -- fades over days
- **Semantic memory** (schemas): Generalized knowledge and patterns -- persists across sessions

Source: Tulving, E. (1972). "Episodic and semantic memory." Organization of Memory, 1, 381-403.

### 5.3 Appraisal Theory (Scherer, 2001)

The decision to use emotion-context clusters rather than content-based topics is grounded in appraisal theory: emotions are characterized by appraisal patterns (valence, arousal, agency, control, certainty, goal-relevance), not by content. Two conversations about different subjects but with the same emotional signature should cluster together because LoRa's response strategy depends on emotional pattern, not content.

Source: Scherer, K. R. (2001). "Appraisal considered as a process of multilevel sequential checking." Appraisal processes in emotion, 92-120.

### 5.4 Conversational Memory Research

People retain fewer than 20% of specific ideas from conversations after even a short delay (Stafford et al., 1987). What they DO recall: salient events, emotional peaks, surprising statements, personally relevant facts. This validates the salience-gated extraction model.

Source: Stafford, L., Burggraf, C. S., & Sharkey, W. F. (1987). "Conversational memory." Human Communication Research, 14(2), 203-229.

### 5.5 Retrieval-Induced Forgetting (Anderson, 2003)

The RIF mechanism in schema retrieval is grounded in the finding that retrieving certain memories can inhibit access to related but non-retrieved memories. The bounded RIF with anti-oscillation guard prevents schema dominance while maintaining retrieval stability.

Source: Anderson, M. C. (2003). "Rethinking interference theory." Memory, 11(2), 141-163.

### 5.6 Affect Dynamics (Jahng et al., 2008; Houben et al., 2015)

AVI (Appraisal Volatility Index) uses RMSSD as the mathematical technique for measuring emotional instability, grounded in affect dynamics literature.

Sources:
- Jahng, S., Wood, P. K., & Trull, T. J. (2008). Psychological Methods, 13(4), 354.
- Houben, M., Van Den Noortgate, W., & Kuppens, P. (2015). Psychological Bulletin, 141(4), 901.

---

## 6. System Architecture

### 6.1 Dual-Database Architecture

**Database 1: ChromaDB** (Emotional Pattern Layer)
- Purpose: Store and retrieve emotion vectors via cosine similarity
- Contents: Episodic events (max 30 per user), Schema centroids (max 20 per user)
- Why ChromaDB: Lightweight, TypeScript-native, local persistent storage, built-in cosine similarity, minimal infrastructure. LoRa's vector search needs are small (20 schemas x 21 dims per user) -- Milvus is enterprise overkill for this scale.
- Install: `npm install chromadb`

**Database 2: FalkorDB** (Factual Anchor Layer)
- Purpose: Store and traverse entity-relationship graphs for factual context
- Contents: People, events, dates, preferences, goals -- connected as a knowledge graph per user
- Why FalkorDB: Embedded zero-config mode via `falkordblite` (npm install), TypeScript SDK, purpose-built agentic memory with Graphiti integration, multi-tenant isolation via group_id. Memgraph lacks embedded mode and degrades after ~10k nodes.
- Install: `npm install falkordblite`

### 6.2 Data Flow Diagram

```
USER SENDS MESSAGE
        |
        v
+---------------------------------------------------------------+
|  LAYER 1: SIGNAL EXTRACTION (existing, 7 analyzers)           |
|  Punctuation -> ExpressionStrength -> Valence -> Arousal ->    |
|  Emoji -> Capitalization -> Repetition                         |
|  Output: { expressionStrength, valence, arousal }              |
|  Raw text: STILL ALIVE (temporarily)                           |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  LAYER 2: EMOTIONAL COMPUTATION (existing)                     |
|  EIVScorer -> EmotionalStateInterpreter -> MomentumTracker     |
|  AVIScorer -> [AppraisalBridge if enabled]                     |
|  Output: EIV, EmotionalState, AVI, Momentum, [AppraisalResult]|
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  LAYER 3: DUAL MEMORY ENCODING (NEW)                          |
|                                                                |
|  A) EmotionEncoder                                             |
|     Input: all numeric signals from Layer 2                    |
|     Process: DIM_SPEC normalize -> block-weight -> L2-norm     |
|     Output: emotion_vec [21 dims] -> ChromaDB episodic buffer  |
|                                                                |
|  B) FactExtractor (rule-based V1)                              |
|     Input: signalPacket.messageText (LAST TIME TEXT IS READ)   |
|     Process: date regex, entity patterns, event keywords       |
|     Output: FactAnchors -> FalkorDB entity graph               |
|                                                                |
|  *** RAW TEXT PERMANENTLY DELETED AFTER THIS POINT ***         |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  LAYER 4: DUAL RETRIEVAL (NEW)                                |
|                                                                |
|  A) ChromaDB: cosine similarity on emotion_vec                 |
|     -> matched schemas with trajectoryLabel, tendencyLabel     |
|                                                                |
|  B) FalkorDB: graph traversal on entities + dates              |
|     -> upcoming events, relevant people, active goals          |
|                                                                |
|  Combined: MemoryContext { schemas + anchors }                 |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  LAYER 5: TRUST CALIBRATION (existing - ETV)                  |
|  ETVPolicy: BAND_X, initiative, assertiveness, etc.            |
|  Gates how much memory context feeds into prompt               |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  LAYER 6: RESPONSE GENERATION (existing + enhanced)            |
|  PromptTemplateBuilder.build(                                  |
|    emotionalState, etvState,                                   |
|    { etvPolicy, memoryContext, guidanceMode, hints... }        |
|  ) -> LLM generates response with full context                 |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  LAYER 7: SESSION BOUNDARY (existing + enhanced)               |
|  endSession() or 35-min idle timeout:                          |
|  A) ETV update (existing) - Beta-with-decay model              |
|  B) Schema consolidation (NEW) - EWMA update, merge, prune    |
|  C) Anchor maintenance (NEW) - reinforce, decay, expire        |
+---------------------------------------------------------------+
```

### 6.3 Integration Points in EngineOrchestrator

**Per-message hot path** (inside `processMessage()`, after AVI computation ~line 215):

```typescript
if (featureFlags.memoryLayerEnabled) {
  const emotionVec = EmotionEncoder.encode({
    eivValue: eivResult.value,
    valenceScore: analyzerOutputs.valence.score,
    arousalScore: analyzerOutputs.arousal.score,
    expressionStrength: analyzerOutputs.expressionStrength.score,
    dominantEmotion: emotionalState.dominant,
    avi: AVIScorer.computeAVI(this.sessionEIVs),
    momentum: this.interpreter.momentum,
    appraisalResult: appraisalResult,
  });

  const salience = SalienceComputer.compute(emotionVec, eivResult.value, avi);

  if (salience >= MEMORY_CONFIG.salienceFloor
      && this.sessionEncodeCount < MEMORY_CONFIG.maxWritesPerSession) {
    await this.episodicBuffer.push(emotionVec, salience, this.currentSessionId);
    this.sessionEncodeCount++;
  }

  if (featureFlags.factAnchorEnabled && signalPacket?.messageText) {
    const anchors = FactExtractor.extract(
      signalPacket.messageText, this.userId, emotionVec,
    );
    for (const anchor of anchors) {
      await this.factAnchorStore.upsert(anchor);
    }
  }

  const schemaMatch = await this.schemaStore.retrieve(emotionVec);

  if (featureFlags.factAnchorEnabled) {
    const candidateAnchors = await this.factAnchorStore.getCandidates(this.userId);
    const scoredAnchors = AnchorRelevanceArbiter.score(
      candidateAnchors, emotionVec, MEMORY_CONFIG.anchorRelevanceWeights,
    );
    this.currentMemoryContext = { ...schemaMatch, relevantAnchors: scoredAnchors };
  } else {
    this.currentMemoryContext = { ...schemaMatch, relevantAnchors: [] };
  }
}
```

**Session boundary** (inside `endSession()`, after ETV update ~line 950):

```typescript
if (featureFlags.memoryLayerEnabled) {
  try {
    const consolidationResult = await ConsolidationEngine.consolidate(
      this.userId, this.episodicBuffer, this.schemaStore,
    );
    await this.factAnchorStore.maintain(this.userId);
    DecisionLogger.logMemoryConsolidate({
      userId: this.userId,
      sessionId: this.currentSessionId,
      ...consolidationResult,
    });
  } catch (err) {
    if (debugEnabled) console.error('[LoRa::Memory] Consolidation failed:', err);
  }
  this.sessionEncodeCount = 0;
}
```

---

## 7. TypeScript Type Definitions

```typescript
type EmotionVec = number[]; // length == 21, L2-normalized

type EpisodicEvent = {
  eventId: string;
  sessionId: string;
  userId: string;
  emotionVec: EmotionVec;
  salience: number;           // [0, 1]
  survivalScore: number;      // computed: salience * recency * distinctiveness
  timestamp: number;          // epoch ms
  survivalLockUntil: number;  // epoch ms (0 = no lock)
};

type SchemaRecord = {
  schemaId: string;
  userId: string;
  centroidVec: EmotionVec;
  salienceWeight: number;          // [0, 1], EWMA of assigned episode salience
  retrievalBias: number;           // [-0.20, +0.20], RIF adjustment only
  episodeCount: number;
  sessionCount: number;
  createdAt: number;
  lastUpdatedAt: number;
  trajectoryLabel: string;
  tendencyLabel: string;
  mode: 'baseline' | 'enhanced';
};

type FactAnchor = {
  anchorId: string;
  userId: string;
  type: 'date_event' | 'person' | 'preference' | 'goal' | 'life_event';
  summary: string;              // max 120 chars, no raw verbatim
  date?: string;                // ISO date if time-bound
  entities: string[];
  salience: number;             // [0, 1]
  extractionConfidence: number; // [0, 1] -- rule-match quality score
  status: 'quarantined' | 'confirmed'; // quarantined until reinforced or confidence >= 0.60
  sessionId: string;
  createdAt: number;
  expiresAt?: number;
  reinforceCount: number;
  emotionVecAtCreation: EmotionVec; // snapshot of emotion_vec when anchor was extracted
};

type MemoryContext = {
  topSchemas: Array<{
    schemaId: string;
    emotionTrajectory: string;
    behavioralTendency: string;
    relevance: number;           // softmax probability
  }>;
  sessionPattern: string;
  confidenceLevel: number;
  relevantAnchors: Array<{
    anchorId: string;
    type: string;
    summary: string;
    date?: string;
    entities: string[];
    relevance: number;            // arbiter composite score
    emotionalProximity: number;   // cosine(current_emotionVec, anchor.emotionVecAtCreation)
    isUpcoming?: boolean;
  }>;
};

type RIFGuardState = {
  recentWinners: string[];       // last K=5 winning schema IDs
  cooldownRemaining: number;
};

type ConsolidationResult = {
  schemasCreated: number;
  schemasMerged: number;
  schemasPruned: number;
  episodesEvicted: number;
  totalSchemas: number;
  totalEpisodes: number;
  noveltyFlag: boolean;
};

type MemoryConfig = {
  maxSchemas: number;            // 20
  maxEpisodes: number;           // 30
  maxAnchors: number;            // 15
  maxWritesPerSession: number;   // 10
  maxAnchorsPerSession: number;  // 3
  dims: number;                  // 21
  salienceFloor: number;         // 0.15
  salienceWeights: {
    baseline: { wEiv: number; wAvi: number };
    enhanced: { wEiv: number; wAvi: number; wEsc: number };
  };
  blockWeights: {
    scalars: number;             // 1.0
    onehot: number;              // 0.4
    momentum: number;            // 0.7
    appraisal: number;           // 0.8
  };
  temperature: number;           // 0.15
  thetaRetrieve: number;         // 0.40
  confidenceMin: number;         // 0.30
  alphaRif: number;              // 0.05
  betaRif: number;               // 0.03
  biasDecay: number;             // 0.01
  flipRateThreshold: number;     // 0.60
  rifCooldownK: number;          // 5
  alphaSchema: number;           // 0.3
  alphaTrajectory: number;       // 0.2
  thetaTopic: number;            // 0.65
  thetaMerge: number;            // 0.80
  deltaRelax: number;            // 0.05
  maxRelaxSteps: number;         // 3
  mergeMinCoOccurrence: number;  // 3
  mergeMinAge: number;           // 2 sessions
  episodicHalflife: number;      // 72 hours
  survivalLockTurns: number;     // 5
  anchorSalienceFloor: number;        // 0.30
  anchorGracePeriodDays: number;      // 7
  anchorConfirmThreshold: number;     // 0.60 -- below this, anchor stays quarantined
  anchorRelevanceFloor: number;       // 0.25 -- minimum arbiter score to inject into prompt
  anchorRelevanceWeights: {
    emotionalProximity: number;       // 0.40
    recency: number;                  // 0.30
    reinforcement: number;            // 0.20
    temporalUrgency: number;          // 0.10
  };
};
```

---

## 8. Emotion Encoder Specification

### 8.1 Dimension Normalization Specification (DIM_SPEC)

Every dimension is normalized through a 3-step pipeline:
1. **Normalize** each scalar per DIM_SPEC (clamp + rescale + fallback)
2. **Block-weight** -- multiply each dimension by its block's weight
3. **L2 normalize** the block-weighted vector: `v_final = v_weighted / (||v_weighted||_2 + 1e-8)`

| Dim | Signal | Raw Range | Clamp | Rescale | Fallback | Block |
|-----|--------|-----------|-------|---------|----------|-------|
| 0 | eivValue | [0, 1] | [0, 1] | identity | 0.0 | scalars (1.0) |
| 1 | valenceScore | [-1, 1] | [-1, 1] | (x+1)/2 | 0.5 | scalars (1.0) |
| 2 | arousalScore | [0, 1] | [0, 1] | identity | 0.0 | scalars (1.0) |
| 3 | expressionStrength | [0, 1] | [0, 1] | identity | 0.0 | scalars (1.0) |
| 4 | dominant_JOY | {0, 1} | {0, 1} | identity | 0 | onehot (0.4) |
| 5 | dominant_SADNESS | {0, 1} | {0, 1} | identity | 0 | onehot (0.4) |
| 6 | dominant_ANGER | {0, 1} | {0, 1} | identity | 0 | onehot (0.4) |
| 7 | dominant_FEAR | {0, 1} | {0, 1} | identity | 0 | onehot (0.4) |
| 8 | dominant_CONTENTMENT | {0, 1} | {0, 1} | identity | 0 | onehot (0.4) |
| 9 | dominant_NEUTRAL | {0, 1} | {0, 1} | identity | 0 | onehot (0.4) |
| 10 | avi | [0, 1] | [0, 1] | identity | 0.0 | momentum (0.7) |
| 11 | valenceBias | [-1, 1] | [-1, 1] | (x+1)/2 | 0.5 | momentum (0.7) |
| 12 | arousalBias | [0, 1] | [0, 1] | identity | 0.0 | momentum (0.7) |
| 13 | momentumConfidence | [0, 1] | [0, 1] | identity | 0.0 | momentum (0.7) |
| 14 | pressureScalar | [0, ~60] | [0, 120] | tanh(x/30) | 0.0 | appraisal (0.8) |
| 15 | pressureSlope | [-30, 30] | [-60, 60] | (tanh(x/15)+1)/2 | 0.5 | appraisal (0.8) |
| 16 | pressureVolatility | [0, ~15] | [0, 30] | tanh(x/8) | 0.0 | appraisal (0.8) |
| 17 | moodDominance | [0, 1] | [0, 1] | identity | 0.0 | appraisal (0.8) |
| 18 | escalationScore | [0, 1] | [0, 1] | identity | 0.0 | appraisal (0.8) |
| 19 | collapseSeverity | [0, 1] | [0, 1] | identity | 0.0 | appraisal (0.8) |
| 20 | agencyDeficit | [0, 1] | [0, 1] | identity | 0.0 | appraisal (0.8) |

**Pressure bounds justification:** pressureScalar is the raw sum of 6 per-family pressures. PRESSURE_NORM=10 in `mood-engine/constants.ts` implies per-family typical max ~10; sum typical max ~60. Clamp at 2x headroom (120). Divisor 30 maps typical range to tanh's linear region: tanh(60/30) = 0.96. Chosen to map typical operating range to tanh's linear region.

When `appraisalBridgeEnabled = false`, dims 14-20 are zero-filled. Zero dimensions contribute nothing to the dot product after block weighting.

### 8.2 Block Weighting

Block weighting happens BEFORE L2 normalization:

```
BLOCK_WEIGHTS = {
  scalars: 1.0,    // dims 0-3: core emotional signals
  onehot: 0.4,     // dims 4-9: dominant emotion label
  momentum: 0.7,   // dims 10-13: AVI + momentum
  appraisal: 0.8,  // dims 14-20: appraisal bridge signals
}
```

The one-hot block at 0.4 acts as a **directional anchor** -- the emotion label influences similarity but cannot dominate unless the continuous signals agree. This prevents schemas from degenerating into "same dominant emotion" clusters.

**Phase 2 upgrade path:** If familyWeights (soft probabilities from AppraisalResult.family.weights) replace the one-hot encoding in dims 4-9, they MUST be L1-normalized (sum = 1) before block weighting.

### 8.3 Salience Computation

**Baseline mode** (appraisalBridgeEnabled = false):
```
salience = 0.60 * EIV + 0.40 * AVI
```

**Enhanced mode** (appraisalBridgeEnabled = true):
```
salience = 0.45 * EIV + 0.30 * AVI + 0.25 * escalation_normalized
```

**Gating rules:**
- `SALIENCE_FLOOR = 0.15` -- events below this are not encoded
- `MAX_WRITES_PER_SESSION = 10` -- hard cap prevents schema pollution from long sessions
- `SALIENCE_OVERRIDE` conditions: if collapseEvent = true OR hasViolation = true, force encode regardless of floor

---

## 9. Episodic Buffer

### 9.1 Storage

Episodic events are stored in ChromaDB as embeddings with metadata:
```typescript
await collection.add({
  ids: [event.eventId],
  embeddings: [event.emotionVec],
  metadatas: [{
    sessionId: event.sessionId,
    salience: event.salience,
    timestamp: event.timestamp,
    survivalLockUntil: event.survivalLockUntil,
  }]
});
```

### 9.2 Survival Policy

When the buffer reaches 30 events, the event with the lowest eviction score is removed.

**Eviction score:**
```
evictionScore = salience * recency * distinctiveness
```

Where:
- `recency = exp(-deltaHours / EPISODIC_HALFLIFE)` where EPISODIC_HALFLIFE = 72 hours
- `distinctiveness = euclideanDistance(event.emotionVec, nearestOtherEvent.emotionVec)`

**Survival floor:** If `salience > 0.8`, the event gets `survivalLockUntil = timestamp + SURVIVAL_LOCK_TURNS * avgMessageInterval`. While locked, it cannot be evicted. SURVIVAL_LOCK_TURNS = 5.

---

## 10. Schema Store

### 10.1 Schema Matching

When a new episodic event is encoded, its emotion_vec is compared against all schema centroids. Since both vectors are L2-normalized:
```
cosineSim_i = dot(event.emotionVec, schema_i.centroidVec)
```

If `max(cosineSim) >= theta_topic (0.65)`, the event is assigned to the closest schema.
If `max(cosineSim) < theta_topic`, a new schema is created with this event's emotion_vec as the initial centroid.

### 10.2 Schema Update (EWMA)

When an event is assigned to a schema:
```
centroidVec = (1 - alpha_schema) * centroidVec + alpha_schema * event.emotionVec
centroidVec = centroidVec / (||centroidVec||_2 + 1e-8)  // re-normalize
```
Where alpha_schema = 0.3.

salienceWeight is updated:
```
salienceWeight = (1 - alpha_trajectory) * salienceWeight + alpha_trajectory * event.salience
```
Where alpha_trajectory = 0.2.

episodeCount++ and lastUpdatedAt = now. If this is a new session touching this schema, sessionCount++.

---

## 11. Retrieval Engine

### 11.1 Softmax Retrieval

Given a query emotion_vec, compute scores for all schemas:
```
rawSim_i = cosineSim(query, schema_i.centroidVec)
score_i = clamp(rawSim_i + schema_i.retrievalBias, -1, 1)
p_i = exp(score_i / T) / sum_j(exp(score_j / T))
```
Where T = 0.15 (temperature -- sharp softmax for strong winner-take-all).

`confidenceLevel = max(p_i)`

**No-match condition** (uses raw cosine, NOT biased score):
If `max(rawSim) < theta_retrieve (0.40)` OR `confidenceLevel < c_min (0.30)` -> return empty MemoryContext.

The bias is a policy trick. It NEVER "fakes" similarity.

### 11.2 RIF (Retrieval-Induced Forgetting)

After each retrieval:
1. Winning schema: `retrievalBias += alpha_rif (0.05)`
2. All other schemas: `retrievalBias -= beta_rif (0.03) / (numSchemas - 1)`
3. ALL schemas: `retrievalBias *= (1 - BIAS_DECAY)` where BIAS_DECAY = 0.01
4. Clamp all biases to [-0.20, +0.20]

The bias decay (step 3) keeps retrievalBias zero-mean-stabilized over time. Without it, biases drift and become a second hidden "salience." The half-life of the decay is ~69 retrievals (ln(2) / 0.01), meaning early advantages fade within ~7 sessions.

### 11.3 RIF Oscillation Guard

Detects winner flipping using **winner flip rate**.

State:
```typescript
type RIFGuardState = {
  recentWinners: string[];    // last K=5 winning schema IDs
  cooldownRemaining: number;  // retrievals remaining in cooldown
};
```

Algorithm:
1. After each retrieval, push winning schemaId to recentWinners (ring buffer, K=5)
2. Compute flipRate = count(recentWinners[i] !== recentWinners[i-1] for i=1..K-1) / (K-1)
3. If flipRate > FLIP_RATE_THRESHOLD (0.60) AND cooldownRemaining === 0:
   - Set cooldownRemaining = K (= 5)
   - For next 5 retrievals: alpha_rif_effective = alpha_rif / 2, beta_rif_effective = beta_rif / 2
   - Log `[LoRa::MemoryRIFGuard] activated, flipRate={flipRate}`
4. Each retrieval decrements cooldownRemaining
5. When cooldownRemaining hits 0: restore full alpha/beta, log `[LoRa::MemoryRIFGuard] deactivated`

Why flip rate over confidence RMSSD: Flip rate directly measures what we prevent -- schemas bouncing on consecutive retrievals. Confidence can fluctuate legitimately when a user's emotional state genuinely changes. Flip rate has no false positives from real emotional transitions.

---

## 12. Consolidation Engine

Runs ONLY at endSession() or idle timeout. Never per-message.

### 12.1 Schema EWMA Update

For each episodic event assigned to a schema, centroid and weights were already updated per-event (Section 10.2). Consolidation handles structural operations: merge and prune.

### 12.2 Two-Gate Pressure-Merge

When schema count reaches 20, attempt to merge the two most similar schemas:

**Gate 1:** Topic Similarity -- `cosineSim(schemaA.centroid, schemaB.centroid) > theta_merge (0.80)`
**Gate 2:** Compatibility -- both schemas must have:
- `minCoOccurrence >= 3` (both touched by at least 3 of the same sessions)
- `minAge >= 2` sessions each

If both gates pass, merge:
```
mergedCentroid = (A.centroidVec * A.episodeCount + B.centroidVec * B.episodeCount)
                 / (A.episodeCount + B.episodeCount)
mergedCentroid = mergedCentroid / ||mergedCentroid||_2
mergedSalienceWeight = max(A.salienceWeight, B.salienceWeight)
mergedEpisodeCount = A.episodeCount + B.episodeCount
```
The merged schema keeps the older schemaId. The other is deleted.

### 12.3 Capacity Behavior at 20 Schemas

When a new schema needs to be created but count == 20:
1. Attempt pressure-merge with current theta_merge (0.80)
2. If no merge candidates, relax theta_merge by delta_relax (0.05). Max 3 relaxation steps (effective theta = 0.65)
3. If still no candidates after 3 relaxations, prune the lowest-scoring schema then create new

**Prune score:** `pruneScore = salienceWeight * recencyFactor` where `recencyFactor = exp(-deltaHours / pruneHalflife)`
**Tie-break:** lowest `episodeCount * salienceWeight` loses.

### 12.4 Episodic Buffer Pruning

After consolidation, prune episodic events that:
- Have expired survival locks AND evictionScore is in the bottom 20% of the buffer
- Are older than 7 days AND salience < SALIENCE_FLOOR

---

## 13. Fact Anchor Layer

### 13.1 Data Classification Warning

> **LEGAL NOTICE:** The Fact Anchor Layer persists **named entities** (people's names, dates, relationships, preferences) tied to a userId. This constitutes **relational personal data** under GDPR Article 4(1) and similar frameworks. The Emotional Pattern Layer (ChromaDB) stores only anonymous numeric vectors -- behavioral signal memory. The Fact Anchor Layer (FalkorDB) stores structured personal context -- **personal relationship memory**. These are different legal categories.

**Required safeguards before production deployment:**

| Requirement | Implementation |
|-------------|---------------|
| Explicit consent | User must opt-in to factual memory separately from emotional memory. Feature flag: `factAnchorEnabled` (independent of `memoryLayerEnabled`) |
| Right to deletion | `FactAnchorStore.purgeAll(userId)` must delete ALL nodes and edges for a user in a single atomic call. No orphan edges. |
| Right to access | `FactAnchorStore.exportAll(userId)` must return all anchors in human-readable JSON format |
| Data minimization | Summaries capped at 120 chars. No raw sentences stored. Entity names stored as extracted tokens, not in sentence context. |
| Retention limits | All anchors have either explicit `expiresAt` (date_events) or implicit decay (preferences/goals decay by recency). Maximum absolute retention: 365 days from creation. |
| Isolation | Each userId has its own subgraph. No cross-user edges. Enforced by graph query prefix: `MATCH (u:User {id: $userId})` on every query. |

**If consent is not obtained or the legal review is incomplete:** Set `factAnchorEnabled = false`. The emotional pattern layer operates independently and stores zero personal data.

### 13.2 Extraction (V1: Rule-Based with Confidence Scoring)

The FactExtractor runs on `signalPacket.messageText` during `processMessage()`. This is the **last point where raw text is read** -- it is never persisted.

**Known limitation:** Rule-based extraction is inherently fragile. Expected accuracy for V1: ~55-65% precision, ~40-50% recall. This is deliberately low. The system is designed to be **conservative** -- missing a real anchor is acceptable; injecting a false anchor is not. The quarantine mechanism (Section 13.3) absorbs extraction errors.

| Type | Pattern | Confidence | Example Input | Extracted |
|------|---------|-----------|--------------|-----------|
| date_event | ISO date or well-formed relative date ("next Tuesday", "March 22nd") + event keyword within 10 tokens | 0.80 | "Jake's birthday is March 22nd" | { type: "date_event", summary: "Jake birthday", date: "2026-03-22", entities: ["Jake"], confidence: 0.80 } |
| date_event | Relative date without clear event keyword | 0.45 | "maybe something next week" | { ..., confidence: 0.45 } -> **quarantined** |
| person | Possessive ("my") + relationship noun ("therapist", "friend", "boss") + proper noun | 0.75 | "my therapist Dr. Chen" | { type: "person", summary: "therapist Dr Chen", entities: ["Dr. Chen"], confidence: 0.75 } |
| person | Proper noun only, no relationship signal | 0.35 | "I talked to Sarah" | { ..., confidence: 0.35 } -> **quarantined** |
| preference | Strong signal phrase ("I love", "I hate", "I can't stand", "I always") | 0.70 | "I love hiking but hate mornings" | { type: "preference", summary: "loves hiking dislikes mornings", confidence: 0.70 } |
| preference | Weak signal ("I kind of like", "maybe I prefer") | 0.40 | "I kind of like jazz" | { ..., confidence: 0.40 } -> **quarantined** |
| goal | Clear intent ("I want to", "I'm trying to", "I need to", "my goal is") | 0.70 | "I'm trying to exercise more" | { type: "goal", summary: "wants to exercise more", confidence: 0.70 } |

**Confidence scoring rules:**
- Each extraction pattern has a base confidence (see table above)
- Confidence += 0.10 if multiple signals co-occur (e.g., date + person + event keyword in same utterance)
- Confidence -= 0.15 if extraction relies on a single weak signal
- Final confidence clamped to [0, 1]

**Max MAX_ANCHORS_PER_SESSION = 3 new anchors per session.**

**V2 upgrade path:** Replace rule-based extraction with a lightweight LLM call (post-response, off the hot path) that produces structured JSON. This raises precision to ~85-90% but adds latency and cost. The quarantine mechanism still applies -- even LLM extraction is not 100%.

### 13.3 Quarantine Mechanism

Anchors with `extractionConfidence < ANCHOR_CONFIRM_THRESHOLD (0.60)` enter quarantine:

```
status = confidence >= 0.60 ? 'confirmed' : 'quarantined'
```

**Quarantined anchors:**
- ARE stored in FalkorDB (so reinforcement can find them)
- Are NOT surfaced in MemoryContext (INV-15)
- Are NOT injected into prompts
- Remain invisible to LoRa's response generation

**Promotion from quarantine:**
- If user re-mentions the same entity/fact in a later message or session: `reinforceCount++`
- If `reinforceCount >= 1` (mentioned at least twice): promote to `status = 'confirmed'`
- Rationale: If the user mentions something twice, it is real regardless of extraction confidence

**Quarantine expiry:**
- Quarantined anchors that are not reinforced within 3 sessions are deleted
- This prevents junk anchors from accumulating

### 13.4 Storage in FalkorDB

```cypher
CREATE (u:User {id: $userId})
CREATE (p:Person {name: "Jake", relation: "friend"})
CREATE (e:Event {type: "birthday_party", date: "2026-03-22", summary: "Jake birthday party"})
CREATE (u)-[:MENTIONED]->(p)
CREATE (p)-[:HAS_EVENT]->(e)
CREATE (e)-[:EMOTIONAL_CONTEXT]->(t:EmotionTag {
  eivAtCreation: 0.72, sessionId: "sess-1",
  emotionVecSnapshot: [0.8, 0.6, ...],
  extractionConfidence: 0.80,
  status: "confirmed"
})
```

**Deletion (Right to erasure):**
```cypher
MATCH (u:User {id: $userId})-[r1]->(n)-[r2]->()
DELETE r1, r2, n
WITH u
MATCH (u)-[r3]->()
DELETE r3, u
```

### 13.5 Anchor Relevance Arbiter

**Problem:** Without arbitration, anchors are injected based on recency alone. This produces context bleed -- "Jake's birthday next week" surfaces while the user is talking about work stress, because Jake's birthday is recent. The anchor is real but irrelevant to the current emotional moment.

**Solution:** Every candidate anchor is scored against the current emotional context before injection.

**Arbiter score computation:**

```
emotionalProximity = cosineSim(current_emotionVec, anchor.emotionVecAtCreation)
recencyScore = exp(-deltaHours / anchorRecencyHalflife)
reinforcementScore = min(anchor.reinforceCount / 5, 1.0)
temporalUrgency = anchor.isUpcoming ? (1 - daysUntil / 14) : 0

arbiterScore = W_emotion * emotionalProximity
             + W_recency * recencyScore
             + W_reinforce * reinforcementScore
             + W_temporal * temporalUrgency
```

Where:
- `W_emotion = 0.40` -- strongest weight: emotional context match
- `W_recency = 0.30` -- recent mentions get priority
- `W_reinforce = 0.20` -- repeatedly mentioned anchors are more important
- `W_temporal = 0.10` -- upcoming dates get a small boost

**Gating:**
- If `arbiterScore < ANCHOR_RELEVANCE_FLOOR (0.25)` -> anchor is **suppressed** for this message
- Only anchors with `status = 'confirmed'` are candidates (INV-15)
- Maximum 3 anchors injected per message (top-3 by arbiterScore)

**Why emotional proximity is the dominant weight:**
Two conversations -- "interview anxiety" and "car accident anxiety" -- share similar emotional patterns but have completely different anchors. The emotional proximity score ensures that when the user is in an "interview anxiety" emotional state, the interview-related anchors (created during a similar emotional moment) rank higher than car-related anchors. This is what disambiguates identical emotions by context (Goal G4).

**Edge case: temporalUrgency override.**
If an anchor has `isUpcoming = true` AND `daysUntil <= 2` (imminent event), it bypasses the relevance floor. Rationale: a birthday party tomorrow is relevant regardless of current emotional state. The arbiterScore is still computed and logged, but the floor gate is skipped. This is the ONLY override.

### 13.6 Retrieval Query (Updated)

```cypher
MATCH (u:User {id: $userId})-[:MENTIONED]->(n)
WHERE n.status = 'confirmed'
OPTIONAL MATCH (n)-[:HAS_EVENT]->(e)
RETURN n, e
ORDER BY n.reinforceCount DESC, n.createdAt DESC
LIMIT 10
```

The top 10 candidates are then scored by the Anchor Relevance Arbiter in TypeScript. Top 3 by arbiterScore (above floor) are included in MemoryContext.

### 13.7 Anchor Lifecycle

- **Creation:** Extracted with confidence score. If confidence >= 0.60 -> confirmed. Otherwise -> quarantined.
- **Reinforcement:** If user re-mentions the same fact, reinforceCount++ and salience increases. If quarantined and reinforceCount >= 1 -> promote to confirmed.
- **Expiry:** date_event anchors get expiresAt = date + GRACE_PERIOD (7 days). All anchors have absolute max retention of 365 days.
- **Quarantine expiry:** Quarantined anchors not reinforced within 3 sessions are deleted.
- **Preferences and goals don't expire by date** -- they decay purely by recency and reinforcement.
- **Eviction:** When at capacity (15), lowest `salienceWeight * recencyFactor * (1 + reinforceCount * 0.2)` is evicted. Quarantined anchors are evicted first.

---

## 14. Failure Detectors

### 14.1 Sticky Schemas
**Detection:** Last 5 emotion_vecs increasingly distant from all schema centroids without new schema creation for K=5 turns.
**Correction:** Force Schema Shock -- lower theta_topic temporarily to create new schema.

### 14.2 Negativity Bias
**Detection:** Emotion trajectory shift > 3 standard deviations from baseline across all schemas.
**Correction:** Raise negative salience gate. Halve alpha_trajectory for negative schemas.

### 14.3 Fragile Context (Oscillation)
**Detection:** RIF guard flip rate > 0.6 triggers for 3+ consecutive sessions.
**Correction:** Increase temperature T temporarily (T = 0.25). Reset after 2 stable sessions.

### 14.4 System Bloat
**Detection:** Schema count == 20 AND average cosineSim between top-2 schemas > 0.75.
**Correction:** Trigger pressure-merge with relaxed theta (theta_merge - 0.10).

### 14.5 Memory Wipe
**Detection:** High-salience event (S > 0.8) pruned prematurely.
**Correction:** Enforce survival lock timer strictly. Increase distinctiveness floor.

### 14.6 Anchor Context Bleed
**Detection:** Arbiter consistently suppresses >80% of confirmed anchors across 5+ consecutive messages (all anchors failing relevance floor).
**Correction:** This indicates either (a) anchors are stale and should be decayed faster, or (b) the user's current emotional context has shifted far from when anchors were created. Log `[LoRa::MemoryAnchorBleed]` and temporarily raise `W_recency` from 0.30 to 0.50 for 1 session. If persists for 3+ sessions, trigger aggressive anchor decay (halve all anchor salience weights).

### 14.7 Quarantine Overflow
**Detection:** Quarantined anchor count > 2x confirmed anchor count for a user.
**Correction:** Extraction quality is poor. Log `[LoRa::MemoryQuarantineOverflow]` and reduce MAX_ANCHORS_PER_SESSION to 1 for next 3 sessions. Purge oldest quarantined anchors exceeding the 2x ratio.

---

## 15. ETV Integration

### 15.1 ETV -> Memory (Gating)

ETVPolicy gates memory write intensity:
- **BAND_0-1**: Conservative -- only events with salience > 0.40 encoded; reduced alpha_schema (0.15)
- **BAND_2-3**: Normal -- standard encoding and learning
- **BAND_4**: Full -- enhanced encoding; alpha_schema = 0.3

### 15.2 Memory -> ETV (Phase 3 Enrichment)

When memory layer is active, SessionSummaryV1 can be extended:
- `contradictionRate`: schema oscillation count per session / messageCount
- `correctionRate`: schema prediction error magnitude
- `inferenceReliability`: average schema retrieval confidence

**Governor:** Only feed ETV if `confidenceLevel > 0.40` AND `messageCount >= 6`. If noveltyFlag = true (new schema created), suppress contradiction/correction signals for that session.

### 15.3 AVI Connection

AVI feeds into the memory layer at two points:
1. **Emotion Vector dim 10**: AVI value is encoded as a dimension in the emotion_vec
2. **Salience computation**: AVI contributes 40% (baseline) or 30% (enhanced) of salience score
3. **ETV evidence score**: AVI feeds through sessionEIVs -> z_t -> Beta update (existing, implemented)

---

## 16. EngineOrchestrator Integration

### 16.1 New Properties

```typescript
private episodicBuffer: EpisodicBuffer;
private schemaStore: SchemaStore;
private factAnchorStore: FactAnchorStore;
private currentMemoryContext: MemoryContext | null = null;
private sessionEncodeCount: number = 0;
private rifGuardState: RIFGuardState = { recentWinners: [], cooldownRemaining: 0 };
```

### 16.2 Initialization (constructor)

```typescript
if (featureFlags.memoryLayerEnabled) {
  this.episodicBuffer = new EpisodicBuffer(chromaClient, userId);
  this.schemaStore = new SchemaStore(chromaClient, userId);
  this.factAnchorStore = new FactAnchorStore(falkorClient, userId);
}
```

### 16.3 processMessage() Integration

After existing AVI computation (~line 215), before prompt building:
1. Encode emotion_vec from available signals
2. Compute salience; if above floor and under session cap, push to episodic buffer
3. Extract fact anchors from raw text (last time text is touched)
4. Retrieve matching schemas + relevant anchors
5. Set `this.currentMemoryContext`

### 16.4 endSession() Integration

After ETV update (~line 950):
1. Run ConsolidationEngine.consolidate()
2. Run factAnchorStore.maintain()
3. Log consolidation results
4. Reset sessionEncodeCount

---

## 17. PromptTemplateBuilder Integration

New optional parameter in `PromptTemplateBuilder.build()`:

```typescript
memoryContext?: MemoryContext;
```

When present and `memoryLayerEnabled = true`:
- Top schemas are formatted as behavioral hints: "User tends toward [trajectoryLabel] patterns with [tendencyLabel] responses"
- Relevant anchors are formatted as context: "User mentioned [summary] on [date]"
- Confidence gates verbosity: confidenceLevel < 0.30 -> no memory hints injected

Gated by feature flag. When off, zero impact on existing prompt path.

---

## 18. Observability and Logging

### 18.1 Per-Message Logs

```
[LoRa::MemoryEvent] {
  userId, sessionId, salience, encoded: true/false,
  vecSummary: { eiv, valence, arousal, dominant },
  sessionEncodeCount
}
```

### 18.2 Retrieval Logs

```
[LoRa::MemoryRetrieve] {
  userId, topK: [{ schemaId, rawSim, biasedScore, prob }],
  confidence, matched: true/false,
  rifGuard: { active, flipRate, cooldownRemaining }
}
```

### 18.3 Consolidation Logs

```
[LoRa::MemoryConsolidate] {
  userId, sessionId,
  schemasCreated, schemasMerged, schemasPruned,
  episodesEvicted, totalSchemas, totalEpisodes,
  noveltyFlag, anchorsCreated, anchorsExpired
}
```

### 18.4 RIF Guard Logs

```
[LoRa::MemoryRIFGuard] {
  userId, action: "activated" | "deactivated",
  flipRate, cooldownK
}
```

**Privacy invariant:** No raw message text appears in any memory log. Only numeric summaries, schema IDs, and anchor summaries (which are already structured extractions, not verbatim text).

---

## 19. Testing Strategy

### 19.1 Unit Tests

| Test | What it proves |
|------|---------------|
| EmotionEncoder produces length-21 vec | INV-5 |
| All dims in [0, 1] after normalize | INV-6 |
| L2 norm == 1.0 after full encode | INV-7 |
| Salience floor gates writes | Salience gating |
| Session cap prevents over-encoding | MAX_WRITES_PER_SESSION |
| Schema EWMA produces valid centroid | INV-7 on update |
| Softmax retrieval math correct | Temperature, no-match gate |
| RIF bias stays in [-0.20, 0.20] | INV-9 |
| RIF bias decays toward zero | Zero-mean stabilization |
| Flip rate computation correct | RIF guard |
| Merge produces valid centroid | INV-7 on merge |
| Prune removes lowest score | Deterministic prune |
| FactExtractor extracts dates/people | Rule-based extraction |
| FactExtractor confidence scoring correct | Confidence bounds |
| Quarantined anchors never in MemoryContext | INV-15 |
| Quarantine promotion on reinforcement | Quarantine -> confirmed |
| Quarantine expiry after 3 sessions | Junk cleanup |
| Arbiter scores below floor -> suppressed | INV-16 |
| Arbiter emotionalProximity cosine correct | Context relevance |
| Temporal urgency override for imminent events | Edge case |
| purgeAll deletes ALL user data | INV-17 |
| Anchor lifecycle (reinforce, expire) | Anchor maintenance |

### 19.2 Integration Tests

| Test | What it proves |
|------|---------------|
| processMessage encodes + retrieves | Hot path integration |
| endSession consolidates | Cold path integration |
| Feature flag off -> zero side effects | INV-13 |
| ChromaDB persistence survives restart | Data durability |
| FalkorDB persistence survives restart | Data durability |
| MemoryContext flows to PromptBuilder | End-to-end |
| factAnchorEnabled=false -> zero FalkorDB ops | Independent gating |
| Arbiter filters irrelevant anchors in live flow | Relevance gating |
| No raw text in any log | INV-1 |

### 19.3 Stress Tests

| Test | What it proves |
|------|---------------|
| 1000 episodes -> buffer stays <= 30 | INV-3 |
| 100 unique patterns -> schemas stay <= 20 | INV-2 |
| Rapid schema flipping -> RIF guard activates | Anti-oscillation |
| 50 anchors -> store stays <= 15 | INV-4 |

---

## 20. Step-by-Step Implementation Guide

### Step 1: Constants and Types (Day 1)

**Create:** `src/emotion-core/memory/constants.ts`
- Define `MEMORY_CONFIG` frozen object with all constants from Section 7
- Define `DIM_SPEC` array with all 21 dimension specifications from Section 8.1
- Define `BLOCK_WEIGHTS` object

**Create:** `src/emotion-core/memory/types.ts`
- All types from Section 7: EmotionVec, EpisodicEvent, SchemaRecord, FactAnchor, MemoryContext, RIFGuardState, ConsolidationResult, MemoryConfig

**Test:** Unit tests for type guards, config freeze, constant bounds.

### Step 2: Emotion Encoder (Day 1-2)

**Create:** `src/emotion-core/memory/EmotionEncoder.ts`
- `normalizeScalar(value, dimSpec)` -- clamp, rescale, fallback per DIM_SPEC
- `applyBlockWeights(vec, blockWeights)` -- multiply each dim by its block weight
- `l2Normalize(vec)` -- divide by L2 norm + epsilon
- `encode(signals)` -- main entry: normalize all 21 dims -> block weight -> L2 normalize

**Create:** `src/emotion-core/memory/SalienceComputer.ts`
- `compute(emotionVec, eiv, avi, escalation?, override?)` -- returns salience in [0, 1]
- Handles baseline vs enhanced mode
- Applies floor and override logic

**Test:** Deterministic output for same inputs. All dims in [0,1]. L2 norm == 1.0. Salience floor gates correctly.

### Step 3: Feature Flags (Day 2)

**Edit:** `src/emotion-core/config/featureFlags.ts`
- Add `memoryLayerEnabled: boolean` (default: false) -- gates emotional pattern layer
- Add `factAnchorEnabled: boolean` (default: false) -- gates factual anchor layer INDEPENDENTLY

**Two independent flags because:** Emotional pattern memory stores anonymous numeric vectors (no legal burden). Factual anchor memory stores named entities (relational personal data, requires consent). A deployment can run emotional memory without factual anchors.

**Test:** Both flags off -> nothing in memory path executes. memoryLayerEnabled=true, factAnchorEnabled=false -> emotional encoding works, zero FalkorDB operations.

### Step 4: Episodic Buffer (Day 2-3)

**Create:** `src/emotion-core/memory/EpisodicBuffer.ts`
- `push(emotionVec, salience, sessionId)` -- add event to ChromaDB
- `getAll(userId)` -- retrieve all episodes for user
- `evict()` -- remove lowest eviction score event when at capacity
- `prune(criteria)` -- batch remove expired/low-salience events

**Dependency:** `npm install chromadb`

**Test:** Buffer never exceeds 30. Survival locks prevent eviction. Eviction score computation correct.

### Step 5: Schema Store (Day 3-4)

**Create:** `src/emotion-core/memory/SchemaStore.ts`
- `matchOrCreate(emotionVec, salience, sessionId)` -- find matching schema or create new
- `updateCentroid(schemaId, emotionVec, salience)` -- EWMA update
- `retrieve(queryVec)` -- softmax retrieval with RIF
- `getAll(userId)` -- list all schemas

**Test:** Schema matching threshold correct. EWMA produces valid centroids. Softmax math verified.

### Step 6: Retrieval Engine + RIF (Day 4-5)

**Create:** `src/emotion-core/memory/RetrievalEngine.ts`
- `retrieve(queryVec, schemas, rifState)` -- full retrieval pipeline
- `updateRIF(schemas, winnerId, rifState)` -- RIF bias updates with decay
- `checkFlipRate(rifState)` -- oscillation guard

**Test:** No-match gate works. Bias stays bounded. Flip rate triggers cooldown. Bias decays toward zero.

### Step 7: Consolidation Engine (Day 5-6)

**Create:** `src/emotion-core/memory/ConsolidationEngine.ts`
- `consolidate(userId, buffer, schemaStore)` -- main entry
- `attemptMerge(schemas)` -- two-gate pressure merge
- `pruneLowest(schemas)` -- remove lowest-scoring schema
- `pruneEpisodes(buffer)` -- clean old/low-salience episodes

**Test:** Merge criteria correct. Capacity behavior deterministic. Prune removes correct schema.

### Step 8: Fact Extractor with Confidence Scoring (Day 6-7)

**Create:** `src/emotion-core/memory/FactExtractor.ts`
- `extract(messageText, userId, emotionVec)` -- rule-based extraction returning FactAnchor[]
- Each pattern has a base confidence score (see Section 13.2)
- Co-occurrence bonus (+0.10), weak-signal penalty (-0.15)
- Anchors with confidence >= 0.60 -> status: 'confirmed'
- Anchors with confidence < 0.60 -> status: 'quarantined'
- Stores `emotionVecAtCreation` snapshot on each anchor for arbiter use

**Test:** Extracts dates, people, preferences, goals from sample messages. Confidence scores correct. Quarantine classification correct. Respects per-session cap.

### Step 9: Fact Anchor Store with Quarantine (Day 7-8)

**Create:** `src/emotion-core/memory/FactAnchorStore.ts`
- `upsert(anchor)` -- add or reinforce existing anchor in FalkorDB. On reinforcement of quarantined anchor: promote to confirmed if reinforceCount >= 1
- `getCandidates(userId)` -- retrieve all confirmed anchors (quarantined excluded)
- `maintain(userId)` -- expire old date_events, purge quarantined anchors not reinforced within 3 sessions, decay, evict at capacity
- `purgeAll(userId)` -- atomic deletion of ALL nodes and edges for userId (INV-17)
- `exportAll(userId)` -- return all anchors in human-readable JSON (right to access)

**Dependency:** `npm install falkordblite`

**Test:** Upsert reinforces existing. Quarantine blocks surfacing. Promotion works. Quarantine expiry works. Expiry works. Capacity maintained at 15. purgeAll leaves zero traces.

### Step 9.5: Anchor Relevance Arbiter (Day 8)

**Create:** `src/emotion-core/memory/AnchorRelevanceArbiter.ts`
- `score(candidates, currentEmotionVec, weights)` -- compute arbiter score for each candidate anchor
- `emotionalProximity` = cosine similarity between current emotion_vec and anchor's emotionVecAtCreation
- `temporalUrgency` override for events within 2 days
- Filter by ANCHOR_RELEVANCE_FLOOR (0.25)
- Return top 3 scored anchors

**Test:** Arbiter suppresses low-relevance anchors. Emotional proximity dominates scoring. Temporal override works for imminent events. Empty input -> empty output.

### Step 10: EngineOrchestrator Integration (Day 8-9)

**Edit:** `src/emotion-core/engines/EngineOrchestrator.ts`
- Add memory-related properties (Section 16.1)
- In constructor: initialize memory stores if flag enabled (Section 16.2)
- In processMessage(): add encoding + retrieval after AVI computation (Section 16.3)
- In endSession(): add consolidation + anchor maintenance after ETV update (Section 16.4)

**All additions gated by `featureFlags.memoryLayerEnabled`.**

**Test:** Integration test with flag on AND off. Existing 1172+ tests still pass.

### Step 11: PromptTemplateBuilder Integration (Day 9)

**Edit:** `src/emotion-core/prompt/PromptTemplateBuilder.ts`
- Add optional `memoryContext` parameter to `build()`
- Format schema hints and anchor context into prompt sections
- Gate by confidence level (< 0.30 -> no injection)

**Test:** Prompt includes memory context when provided. Prompt unchanged when not provided.

### Step 12: Observability (Day 9-10)

**Edit:** `src/emotion-core/logging/DecisionLogger.ts`
- Add `logMemoryEvent()`, `logMemoryRetrieve()`, `logMemoryConsolidate()`, `logMemoryRIFGuard()`
- Ensure no raw text in any log entry

**Test:** Log format verification. Privacy invariant check.

### Step 13: End-to-End Testing (Day 10)

- Full pipeline test: message -> encode -> retrieve -> prompt -> session end -> consolidate
- Multi-session test: 3 sessions with emotional continuity verification
- Fact anchor test: mention event -> verify retrieval in next session
- Stability test: existing test suite passes with flag on and off

---

## 21. Phased Rollout Plan

### Phase 1: Shadow Mode (Week 1-2)
- Feature flag: `memoryLayerEnabled = true`, but memory context is **logged only**, not injected into prompts
- All encoding, retrieval, and consolidation runs
- Logs are analyzed for quality: schema stability, salience distribution, retrieval confidence
- Existing behavior unchanged -- PromptTemplateBuilder ignores memoryContext
- **Success criteria:** No test regressions. Logs show reasonable salience distribution. Schema count stays bounded.

### Phase 2: Passive Injection (Week 3-4)
- Memory context injected into PromptTemplateBuilder but with reduced weight
- Only top-1 schema with confidence > 0.50 included
- Fact anchors injected only for upcoming dates (within 7 days)
- **Success criteria:** User experience unchanged or slightly improved. No hallucinated memories. No creepy recall.

### Phase 3: Full Operation (Week 5+)
- Full memory context injection with ETV gating
- Memory -> ETV enrichment enabled (contradictionRate, inferenceReliability from schemas)
- All failure detectors active
- **Success criteria:** Cross-session continuity measurably improved. No privacy violations. Schema oscillation rate < 0.2.

---

## Appendix A: Full Constants Table

| Constant | Value | Type | Bounds | Justification |
|----------|-------|------|--------|---------------|
| maxSchemas | 20 | int | [1, 50] | Cognitive limit on distinct behavioral patterns |
| maxEpisodes | 30 | int | [10, 100] | Buffer size balancing recency and richness |
| maxAnchors | 15 | int | [5, 30] | Practical limit on active factual context |
| maxWritesPerSession | 10 | int | [3, 20] | Prevents schema pollution from long sessions |
| maxAnchorsPerSession | 3 | int | [1, 5] | Prevents anchor flooding |
| dims | 21 | int | fixed | 14 baseline + 7 appraisal |
| salienceFloor | 0.15 | float | [0, 0.5] | Below this, events are noise |
| temperature | 0.15 | float | [0.05, 0.50] | Sharp softmax for winner-take-all |
| thetaRetrieve | 0.40 | float | [0.20, 0.70] | Minimum raw cosine for match |
| confidenceMin | 0.30 | float | [0.10, 0.50] | Minimum softmax probability for confidence |
| alphaRif | 0.05 | float | [0.01, 0.10] | RIF boost for winner |
| betaRif | 0.03 | float | [0.01, 0.10] | RIF penalty for losers |
| biasDecay | 0.01 | float | [0.001, 0.05] | Zero-mean stabilization for retrievalBias |
| flipRateThreshold | 0.60 | float | [0.40, 0.80] | Oscillation detection sensitivity |
| rifCooldownK | 5 | int | [3, 10] | Cooldown retrievals after guard triggers |
| alphaSchema | 0.3 | float | [0.1, 0.5] | EWMA smoothing for centroid update |
| alphaTrajectory | 0.2 | float | [0.1, 0.4] | EWMA smoothing for salience weight |
| thetaTopic | 0.65 | float | [0.50, 0.80] | Schema matching threshold |
| thetaMerge | 0.80 | float | [0.70, 0.90] | Merge similarity threshold |
| deltaRelax | 0.05 | float | [0.03, 0.10] | Merge relaxation step |
| maxRelaxSteps | 3 | int | [1, 5] | Maximum relaxation attempts |
| mergeMinCoOccurrence | 3 | int | [2, 5] | Minimum shared sessions for merge |
| mergeMinAge | 2 | int | [1, 5] | Minimum sessions for merge eligibility |
| episodicHalflife | 72 | float | [24, 168] | Hours; episodic decay rate |
| survivalLockTurns | 5 | int | [3, 10] | High-salience event protection |
| anchorSalienceFloor | 0.30 | float | [0.10, 0.50] | Minimum salience for anchor creation |
| anchorGracePeriodDays | 7 | int | [3, 14] | Days after event date before sharp decay |
| anchorConfirmThreshold | 0.60 | float | [0.40, 0.80] | Below this, anchor quarantined until reinforced |
| anchorRelevanceFloor | 0.25 | float | [0.10, 0.40] | Minimum arbiter score for prompt injection |
| W_emotion | 0.40 | float | [0.25, 0.60] | Arbiter: emotional proximity weight (dominant) |
| W_recency | 0.30 | float | [0.15, 0.40] | Arbiter: recency weight |
| W_reinforce | 0.20 | float | [0.10, 0.30] | Arbiter: reinforcement count weight |
| W_temporal | 0.10 | float | [0.05, 0.20] | Arbiter: upcoming date urgency weight |
| anchorMaxRetentionDays | 365 | int | [180, 730] | Absolute max retention for any anchor |
| quarantineMaxSessions | 3 | int | [2, 5] | Sessions before unconfirmed anchor is purged |
| BLOCK_WEIGHTS.scalars | 1.0 | float | fixed | Baseline magnitude |
| BLOCK_WEIGHTS.onehot | 0.4 | float | [0.2, 0.6] | Directional anchor, not dominator |
| BLOCK_WEIGHTS.momentum | 0.7 | float | [0.4, 1.0] | Moderate influence |
| BLOCK_WEIGHTS.appraisal | 0.8 | float | [0.5, 1.0] | Strong when available |

---

## Appendix B: File Layout

```
src/emotion-core/memory/
  constants.ts          -- MEMORY_CONFIG, DIM_SPEC, BLOCK_WEIGHTS
  types.ts              -- All memory types
  EmotionEncoder.ts     -- normalizeScalar, applyBlockWeights, l2Normalize, encode
  SalienceComputer.ts   -- compute salience with gating
  EpisodicBuffer.ts     -- ChromaDB episodic event management
  SchemaStore.ts        -- ChromaDB schema management + EWMA
  RetrievalEngine.ts    -- Softmax retrieval + RIF + guard
  ConsolidationEngine.ts -- Merge, prune, capacity management
  FactExtractor.ts      -- Rule-based fact extraction with confidence scoring
  FactAnchorStore.ts    -- FalkorDB anchor management with quarantine
  AnchorRelevanceArbiter.ts -- Emotional-context relevance scoring for anchors
  index.ts              -- Public exports
  __tests__/
    EmotionEncoder.test.ts
    SalienceComputer.test.ts
    EpisodicBuffer.test.ts
    SchemaStore.test.ts
    RetrievalEngine.test.ts
    ConsolidationEngine.test.ts
    FactExtractor.test.ts
    FactAnchorStore.test.ts
    AnchorRelevanceArbiter.test.ts
    integration.test.ts
    stress.test.ts
```

---

## Appendix C: Known Structural Risks

These are not bugs. They are documented design trade-offs with known consequences. Each risk is accepted for V1 with stated mitigations and monitoring.

### RISK-1: Cross-Mode Vector Drift

**Affected sections:** 8.1 (DIM_SPEC), 10.1 (Schema Matching)

**The issue:** Baseline mode populates dims 0-13 and zero-fills dims 14-20. Enhanced mode populates all 21 dims. Both produce valid L2-normalized vectors, and cosine similarity between them is mathematically correct. However, enhanced-mode vectors carry higher dimensional density (more non-zero signal), while baseline vectors have lower signal entropy (7 dims are always zero). Over time, if a user enables the appraisal bridge after accumulating baseline schemas, the schema space shifts: new enhanced vectors will cluster differently in the 21-dim space than old baseline vectors do in the effective 14-dim subspace. Enhanced schemas may dominate similarity scoring simply because they carry more discriminative signal, not because they represent stronger emotional patterns.

**Severity:** Low-medium. Does not break correctness. Does create gradual schema bias toward enhanced-mode entries.

**Why this is acceptable for V1:** Mode transitions are rare (the appraisal bridge is either on or off for a deployment). The EWMA centroid update will gradually absorb the mode shift as new episodes touch old schemas. The merge/prune machinery handles schema evolution.

**Required mitigation:**
1. Log every mode transition per user: `[LoRa::MemoryModeTransition] userId={id}, from={baseline|enhanced}, schemasAffected={count}`
2. Store `mode: 'baseline' | 'enhanced'` on each SchemaRecord (already in type definition)
3. On retrieval, log when a baseline schema wins against an enhanced query or vice versa: `[LoRa::MemoryCrossMode] schemaMode={mode}, queryMode={mode}, rawSim={sim}`

**Long-term fix (V2+):** If mode transitions become frequent, introduce a one-time schema re-encoding pass that projects baseline centroids into the enhanced subspace using the user's recent enhanced vectors as calibration anchors.

---

### RISK-2: Fact Extractor V1 Over-Extraction

**Affected sections:** 13.2 (Extraction), 13.3 (Quarantine)

**The issue:** Rule-based extraction using capitalized-word detection will produce false positives. Example:

> "I met Jake and the Dog barked."

A naive capitalized-word rule extracts both "Jake" (correct: person) and "Dog" (incorrect: common noun that happened to be capitalized, or mid-sentence stylistic capitalization). This creates noise nodes in FalkorDB -- phantom entities that clutter the graph and dilute relevance scoring.

**Severity:** Medium. Won't crash anything. Will degrade anchor quality and potentially inject irrelevant context into prompts if false entities get reinforced.

**Why this is acceptable for V1:** Three layers of defense already exist:
1. **Confidence scoring** -- a capitalized word without a relationship signal ("my", possessive, role noun) gets confidence ~0.35, which is below the 0.60 threshold -> **quarantined automatically**
2. **Quarantine mechanism** -- false extractions that are never re-mentioned expire after 3 sessions
3. **Anchor cap** -- MAX_ANCHORS_PER_SESSION = 3 limits flood rate

**Additional mitigation (add to FactExtractor implementation):**
- Maintain a stoplist of common nouns frequently capitalized mid-sentence: `["Monday", "Tuesday", ..., "January", ..., "Internet", "God", "Christmas", "Easter", "The"]`
- Require person-type extractions to co-occur with at least one relationship signal OR appear as the grammatical subject/object of a verb phrase -- not just any capitalized token
- Log all quarantined extractions for extraction quality monitoring: `[LoRa::MemoryExtractQuarantine] type={type}, summary={summary}, confidence={conf}, reason="no_relationship_signal"`

**Long-term fix (V2+):** Replace regex extraction with a lightweight LLM call (post-response, off hot path) that returns structured JSON. Expected to raise precision from ~60% to ~85-90%.

---

### RISK-3: Schema Capacity at 20 — Intentional Forgetting

**Affected sections:** 12.2 (Pressure-Merge), 12.3 (Capacity Behavior)

**The issue:** 20 schemas per user is a hard cap. Human emotional pattern diversity may exceed this over months or years of use. The merge -> relax -> prune pipeline is deterministic and clean, but it produces **behavioral compression**: niche emotional patterns that occur rarely will be absorbed into nearby schemas or pruned entirely. Over long timescales, LoRa's schema space converges toward the user's dominant emotional patterns and forgets infrequent ones.

**Severity:** Low. This is a design feature, not a bug.

**Why this is philosophically correct:** Fuzzy-Trace Theory (Section 5.1) predicts exactly this behavior in human memory. Humans do not retain infinite emotional pattern granularity -- rare experiences are absorbed into broader schemas ("that felt like the other stressful time") while frequent patterns sharpen. The 20-schema cap mirrors this cognitive constraint. LoRa's memory becomes a compressed representation of the user's emotional landscape, weighted toward recency and frequency. This IS the design intent.

**What this means in practice:**
- A user who has 5 dominant emotional patterns will have sharp, well-calibrated schemas
- A user with 30+ distinct patterns will see niche ones compressed or forgotten
- The merge logic preserves the most salient patterns and compresses the least distinctive ones
- Pruned schemas are gone permanently -- there is no recovery

**Required monitoring:**
- Log every prune event: `[LoRa::MemorySchemaPrune] schemaId={id}, salienceWeight={w}, episodeCount={count}, age={sessions}`
- Track schema churn rate: if > 3 prunes per 10 sessions, the cap may be too low for this user
- Dashboard metric: `schemasAtCapacity` count per user -- if a significant percentage of users are persistently at 20, consider raising the cap

**Long-term option (V2+):** Introduce tiered schemas -- "active" (max 20, in ChromaDB) and "archived" (overflow, in cold storage). Archived schemas can be reactivated if a new episode matches them with high similarity. This preserves niche patterns without inflating the active retrieval space.

---

### RISK-4: Retrieval Temperature (T = 0.15) — Winner-Take-All

**Affected section:** 11.1 (Softmax Retrieval)

**The issue:** T = 0.15 produces an extremely sharp softmax distribution. For two schemas with cosine similarities 0.80 and 0.75:

```
p_1 = exp(0.80 / 0.15) / (exp(0.80/0.15) + exp(0.75/0.15))
    = exp(5.33) / (exp(5.33) + exp(5.00))
    = 207 / (207 + 148)
    = 0.583

p_2 = 0.417
```

Even with only 0.05 cosine difference, the winner gets 58% probability. With a 0.10 gap the winner approaches 70%+. This means LoRa will almost always commit to a single schema interpretation, even when the user's emotional state genuinely overlaps two patterns.

**Severity:** Low. This is a deliberate design choice.

**Why this is acceptable:**
1. **Stability over nuance.** Blended retrieval (high T) causes response strategy oscillation -- LoRa's behavioral output would mix signals from multiple schemas, producing inconsistent tone. A sharp winner provides clear, committed response strategy.
2. **RIF guard compatibility.** The RIF mechanism assumes a single winner per retrieval. Blended retrieval would require a fundamentally different RIF model (multi-winner suppression), adding complexity for marginal benefit.
3. **Confidence gating depends on it.** The `confidenceLevel = max(p_i)` metric is only meaningful when the softmax is sharp enough to discriminate. At high T, confidenceLevel would hover around `1/numSchemas` for everything, defeating the no-match gate.

**What this sacrifices:** Genuine emotional transitions where the user is "between" two patterns will be interpreted as one or the other, not a blend. LoRa may slightly over-commit to the closer schema. The user would not notice this in most cases -- the response strategy difference between two adjacent schemas is small.

**Required monitoring:**
- Log margin between top-2 softmax probabilities: `[LoRa::MemoryRetrieveMargin] p1={p1}, p2={p2}, margin={p1-p2}`
- If margin < 0.10 for > 50% of retrievals in a session, the user may be in a transitional emotional state -> log `[LoRa::MemoryNarrowMargin]` for analysis
- This data informs whether T should be relaxed in future versions

**Long-term option (V2+):** Introduce adaptive temperature: `T_effective = T_base + margin_penalty` where `margin_penalty` increases when recent retrievals have narrow margins. This would soften the softmax only when the data suggests genuine ambiguity, maintaining sharpness otherwise.
