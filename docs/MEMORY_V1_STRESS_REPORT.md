# Memory V1 — Long-Horizon Stress Report

## Summary

| Metric | Value |
|--------|-------|
| Sessions | 20 |
| Total messages | 1000 |
| Max schemas observed | 3 |
| Total injections | 950 |
| Injection rate | 95.0% |
| Total oscillation spikes | 0 |
| **Verdict** | **HIGH_DRIFT** |

## Schema Growth Over Sessions

| Session | Schemas |
|---------|---------|
| 0 | 1 |
| 1 | 1 |
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 5 | 2 |
| 6 | 2 |
| 7 | 2 |
| 8 | 2 |
| 9 | 2 |
| 10 | 2 |
| 11 | 2 |
| 12 | 2 |
| 13 | 2 |
| 14 | 2 |
| 15 | 3 |
| 16 | 3 |
| 17 | 3 |
| 18 | 3 |
| 19 | 3 |

## Per-Session Detail

| Session | Messages | Schemas | Injected | Oscillations | Created | Merged | Pruned |
|---------|----------|---------|----------|--------------|---------|--------|--------|
| 0 | 50 | 1 | 0 | 0 | 1 | 0 | 0 |
| 1 | 50 | 1 | 50 | 0 | 0 | 0 | 0 |
| 2 | 50 | 1 | 50 | 0 | 0 | 0 | 0 |
| 3 | 50 | 1 | 50 | 0 | 0 | 0 | 0 |
| 4 | 50 | 1 | 50 | 0 | 0 | 0 | 0 |
| 5 | 50 | 2 | 50 | 0 | 1 | 0 | 0 |
| 6 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 7 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 8 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 9 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 10 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 11 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 12 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 13 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 14 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 15 | 50 | 3 | 50 | 0 | 1 | 0 | 0 |
| 16 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |
| 17 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |
| 18 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |
| 19 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |

## Consolidation Churn

| Metric | Value |
|--------|-------|
| Total created | 3 |
| Total merged | 0 |
| Total pruned | 0 |
| Avg churn/session | 0.00 |
