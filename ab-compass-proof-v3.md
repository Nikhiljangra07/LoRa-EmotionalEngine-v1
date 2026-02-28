# Compass Proof Pack

- **Script version:** v3
- **Model:** claude-sonnet-4-6
- **Temperature:** 0
- **Timestamp:** 2026-02-28T12:47:47.046Z

---

## 1. Early Compass Engagement (turns 1–8)

- First turn maskedPressure=true: none
- First turn escalation moved off CALM: none
- First turn guidanceMode ≠ CALM_NEUTRAL: none

---

## 2. Key Transitions Table

| Turn | User (trunc 80) | A: maskedPressure | A: escalationState | A: escalationTrend | A: volatilityTier | A: volatilityTrend | A: ekman | A: guidanceMode | A: pacing | A: qBudget | A: validation | B: (same columns) |
|------|-----------------|-------------------|--------------------|--------------------|------------------|--------------------|----------|----------------|-----------|------------|---------------|-------------------|
| 1 | I'm behind again. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 2 | I'm fine. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 3 | Don't worry about it. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 4 | Doesn't matter. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 5 | Forget it. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 6 | Doesn't matter. I said forget it. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 7 | I'm not mad. I'm just tired of this. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 8 | Whatever. Do whatever you want. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 9 | No excuses. Just tell me what to do. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 10 | I can't focus. Nothing's working. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 11 | I'm fine. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 12 | It doesn't matter anymore. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 13 | Fine. One tiny thing. I did it. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 14 | Still feels pointless but I did it. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 15 | Forget what I said earlier. It does matter. I care. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 16 | I just want this to work. One step at a time. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 17 | No excuses. Give me the next one. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 18 | I did that too. Small win. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 19 | One more. Keep it small. | false | CALM | FLAT | LOW | STABLE | SURPRISE | CALM_NEUTRAL |  |  |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |
| 20 | Now. | false | CALM | FLAT | LOW | STABLE | SURPRISE | STABILIZE | SLOW | ZERO |  | B:  |  |  | LOW |  |  | CALM_NEUTRAL |  |  |  |

---

## 3. Why This Is Not A Wrapper

### Top 3 most differentiating turns

#### Turn 20

**Injected overlays in A but absent in B:**
- ekmanDominant
- signalContext
- pacingHint
- questionBudget
- toneHint
- validationHint
- interruptHint

**A response (first 400 chars):**
```
I’m here with you. Let’s take this one step at a time.
```

**B response (first 400 chars):**
```
I’m here with you. Let’s take this one step at a time.
```

**Attribution:** escalation gradient, volatility trend, ekman weighting

#### Turn 1

**Injected overlays in A but absent in B:**
- ekmanDominant

**A response (first 400 chars):**
```
I’m here with you. Let’s take this one step at a time.
```

**B response (first 400 chars):**
```
I’m here with you. Let’s take this one step at a time.
```

**Attribution:** escalation gradient, volatility trend, ekman weighting

#### Turn 2

**Injected overlays in A but absent in B:**
- ekmanDominant

**A response (first 400 chars):**
```
I’m here with you. Let’s take this one step at a time.
```

**B response (first 400 chars):**
```
I’m here with you. Let’s take this one step at a time.
```

**Attribution:** escalation gradient, volatility trend, ekman weighting
