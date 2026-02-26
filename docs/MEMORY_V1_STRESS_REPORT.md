# Memory V1 — Long-Horizon Stress Report

## Summary

| Metric | Value |
|--------|-------|
| Sessions | 20 |
| Total messages | 1000 |
| Max schemas observed | 3 |
| Total injections | 850 |
| Raw injection rate | 85.0% |
| Messages policy allows injection | 850 |
| Governed injection rate | 100.0% |
| Total oscillation spikes | 0 |
| **Verdict** | **MILD_DRIFT** |

## Band Schedule

| Session | Band | Policy Signature |
|---------|------|------------------|
| 0 | B1 | `B1:inject=N:max=0:traj=N:tend=N:pattern=N` |
| 1 | B1 | `B1:inject=N:max=0:traj=N:tend=N:pattern=N` |
| 2 | B1 | `B1:inject=N:max=0:traj=N:tend=N:pattern=N` |
| 3 | B2 | `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` |
| 4 | B2 | `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` |
| 5 | B2 | `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` |
| 6 | B2 | `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` |
| 7 | B2 | `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` |
| 8 | B2 | `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` |
| 9 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 10 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 11 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 12 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 13 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 14 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 15 | B3 | `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` |
| 16 | B4 | `B4:inject=Y:max=3:traj=Y:tend=Y:pattern=Y` |
| 17 | B4 | `B4:inject=Y:max=3:traj=Y:tend=Y:pattern=Y` |
| 18 | B4 | `B4:inject=Y:max=3:traj=Y:tend=Y:pattern=Y` |
| 19 | B4 | `B4:inject=Y:max=3:traj=Y:tend=Y:pattern=Y` |

## Policy Signature Counts

| Signature | Sessions |
|-----------|----------|
| `B3:inject=Y:max=2:traj=Y:tend=N:pattern=Y` | 7 |
| `B2:inject=Y:max=1:traj=Y:tend=N:pattern=N` | 6 |
| `B4:inject=Y:max=3:traj=Y:tend=Y:pattern=Y` | 4 |
| `B1:inject=N:max=0:traj=N:tend=N:pattern=N` | 3 |

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
| 15 | 2 |
| 16 | 3 |
| 17 | 3 |
| 18 | 3 |
| 19 | 3 |

## Per-Session Detail

| Session | Band | Messages | Schemas | Injected | Oscillations | Created | Merged | Pruned |
|---------|------|----------|---------|----------|--------------|---------|--------|--------|
| 0 | B1 | 50 | 1 | 0 | 0 | 1 | 0 | 0 |
| 1 | B1 | 50 | 1 | 0 | 0 | 0 | 0 | 0 |
| 2 | B1 | 50 | 1 | 0 | 0 | 0 | 0 | 0 |
| 3 | B2 | 50 | 1 | 50 | 0 | 0 | 0 | 0 |
| 4 | B2 | 50 | 1 | 50 | 0 | 0 | 0 | 0 |
| 5 | B2 | 50 | 2 | 50 | 0 | 1 | 0 | 0 |
| 6 | B2 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 7 | B2 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 8 | B2 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 9 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 10 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 11 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 12 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 13 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 14 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 15 | B3 | 50 | 2 | 50 | 0 | 0 | 0 | 0 |
| 16 | B4 | 50 | 3 | 50 | 0 | 1 | 0 | 0 |
| 17 | B4 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |
| 18 | B4 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |
| 19 | B4 | 50 | 3 | 50 | 0 | 0 | 0 | 0 |

## Consolidation Churn

| Metric | Value |
|--------|-------|
| Total created | 3 |
| Total merged | 0 |
| Total pruned | 0 |
| Avg churn/session | 0.00 |
