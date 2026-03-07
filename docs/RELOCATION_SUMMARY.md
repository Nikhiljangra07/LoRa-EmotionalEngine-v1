# Relocation Summary — Dev/Test Harnesses & Artifacts

**Date:** Relocation of test harnesses, evaluation artifacts, and dev-only scripts so they do not affect the runtime pipeline.

---

## Files moved

### To `devtools/stress/` (experimental stress harnesses)
| From | To |
|------|-----|
| `scripts/memoryStressTest.ts` | `devtools/stress/memoryStressTest.ts` |
| `scripts/memory_v1_stress_run.ts` | `devtools/stress/memory_v1_stress_run.ts` |

### To `devtools/tests/`
| From | To |
|------|-----|
| `scripts/memory_v1_live_smoke.ts` | `devtools/tests/memory_v1_live_smoke.ts` |
| `scripts/memory_v1_run.ts` | `devtools/tests/memory_v1_run.ts` |
| `scripts/memory_v1_shadow_report.ts` | `devtools/tests/memory_v1_shadow_report.ts` |
| `scripts/memory_v1_shadow_smoke.ts` | `devtools/tests/memory_v1_shadow_smoke.ts` |
| `scripts/prompt_diff_report.ts` | `devtools/tests/prompt_diff_report.ts` |

### To `archive/research/` (experiment output artifacts)
| From | To |
|------|-----|
| `ab-wave-report-v1.json` | `archive/research/ab-wave-report-v1.json` |
| `ab-wave-report-v2.json` | `archive/research/ab-wave-report-v2.json` |
| `ab-wave-report-v3.json` | `archive/research/ab-wave-report-v3.json` |
| `ab-compass-proof-v3.json` | `archive/research/ab-compass-proof-v3.json` |
| `ab-harness-report.json` | `archive/research/ab-harness-report.json` |

**Not moved:** `scripts/memory_v1_debug_smoke.ts` (still referenced by `memory:v1:debug-smoke` from `scripts/`).

---

## Scripts updated (package.json)

| Script | Old path | New path |
|--------|----------|----------|
| `stress:memory` | `scripts/memoryStressTest.ts` | `devtools/stress/memoryStressTest.ts` |
| `memory:v1:stress` | `scripts/memory_v1_stress_run.ts` | `devtools/stress/memory_v1_stress_run.ts` |
| `memory:v1:shadow-smoke` | `scripts/memory_v1_shadow_smoke.ts` | `devtools/tests/memory_v1_shadow_smoke.ts` |
| `memory:v1:live-smoke` | `scripts/memory_v1_live_smoke.ts` | `devtools/tests/memory_v1_live_smoke.ts` |
| `memory:v1:shadow-report` | `scripts/memory_v1_shadow_report.ts` | `devtools/tests/memory_v1_shadow_report.ts` |

`memory:v1:debug-smoke` unchanged (`scripts/memory_v1_debug_smoke.ts`).

---

## Path/import fixes in moved files

- **devtools/stress/memoryStressTest.ts:** `./utils/dateRecallEvaluator` → `../../scripts/utils/dateRecallEvaluator`
- **devtools/stress/memory_v1_stress_run.ts:** `PROJECT_ROOT` → `path.resolve(__dirname, '..', '..')`; `../src/...` → `../../src/...`
- **devtools/tests/memory_v1_*.ts:** `PROJECT_ROOT` → `path.resolve(__dirname, '..', '..')` where used; **memory_v1_run.ts** and **prompt_diff_report.ts:** `../src/...` → `../../src/...`

---

## .gitignore

Added/ensured:

- `debug/` (full directory)
- `stress-tests/`
- `coverage/`

(`logs/` was already present.)

---

## Runtime import safety check

**PASS** — No file under `src/` imports from `scripts/`, `devtools/`, or the moved script paths. `src/server/adapter.ts` imports only from `src/` (e.g. `../config/`, `./routes/`, `../emotion-core/`).

---

## TypeScript compile check

**PASS** — `npx tsc --noEmit` completes with exit code 0.

---

## Summary

- **Files moved:** 7 scripts (2 → devtools/stress, 5 → devtools/tests), 5 JSON artifacts → archive/research.
- **Scripts updated:** 5 package.json script paths.
- **Runtime import safety:** PASS.
- **TypeScript compile:** PASS.
- Production server entry point and memory pipeline logic were not changed.
