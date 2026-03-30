# Test Report — AI Tab Optimizer v0.3

**Date:** 2026-03-30
**Environment:** macOS 25.3 · Node 20 · Python 3.13.2
**Author:** Denis Ermilov

---

## Summary

| Layer | Runner | Total | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|---|
| TypeScript (url, rules) | Vitest 4.1.2 | 47 | **47** | 0 | 0 | 370 ms |
| Python (FastAPI server) | pytest 9.0.2 | 23 | **23** | 0 | 0 | 130 ms |
| **Total** | | **70** | **70** | **0** | **0** | **~500 ms** |

All 70 tests pass on first run. No flaky tests observed.

---

## TypeScript Results

```
 Test Files  2 passed (2)
      Tests  47 passed (47)
   Start at  07:39:00
   Duration  370ms (transform 64ms, setup 0ms, import 84ms, tests 11ms)
```

### File breakdown

| File | Tests | Status |
|---|---|---|
| `src/shared/utils/__tests__/url.test.ts` | 25 | All pass |
| `src/shared/utils/__tests__/rules.test.ts` | 22 | All pass |

### Notable test cases

- **Tracking-param deduplication** (R05): `?utm_source=fb` and `?utm_source=google` on the same path normalize to identical strings — exact-duplicate logic correctly fires.
- **Near-duplicate threshold** (R08): `github.com/org/repo/tree/main/src/index.ts` vs `.../utils.ts` share 5 of 6 path segments (≈ 0.833), which exceeds the 0.8 threshold — both tabs flagged.
- **Stale threshold customization** (R15): a tab accessed 3 days ago is NOT stale with `threshold=7` but IS stale with `threshold=2` — verified in the same test.

---

## Python Results

```
======================== 23 passed, 1 warning in 0.13s =========================
```

### File breakdown

| File | Tests | Status |
|---|---|---|
| `tests/test_api.py` | 23 | All pass |

### Class breakdown

| Class | Tests | Status |
|---|---|---|
| `TestHealth` | 1 | Pass |
| `TestSettings` | 3 | Pass |
| `TestTabAnalysisStatus` | 3 | Pass |
| `TestUrlAnalysisImport` | 3 | Pass |
| `TestClusters` | 5 | Pass |
| `TestSnapshots` | 5 | Pass |
| `TestCacheStats` | 3 | Pass |

### Warning

```
DeprecationWarning: There is no current event loop
    db = asyncio.get_event_loop().run_until_complete(_setup())
```

Python 3.10+ deprecates `get_event_loop()` in contexts where no loop exists. The warning is benign (pytest still runs correctly), but should be resolved before upgrading to a future Python version that removes the fallback. Fix: replace with `asyncio.run(_setup())` in conftest.py.

---

## Defects Found During Test Writing

The following issues were discovered when writing the tests — all were fixed before the first passing run.

| # | Component | Issue | Fix |
|---|---|---|---|
| D01 | `conftest.py` | `app.router.lifespan_context` is re-run by `TestClient.__enter__`, overwriting the in-memory DB with a connection to the real `tab_analysis.db` | Replaced `app.router.lifespan_context` with a test-only async context manager that injects the in-memory DB instead |
| D02 | `test_api.py` | `GET /settings` response shape is `{"settings": {...}}` — tests were asserting on the flat dict | Updated all settings assertions to use `data["settings"][key]` |
| D03 | `test_api.py` | `GET /snapshots` response shape is `{"snapshots": [...]}` — tests expected a bare list | Updated all snapshot assertions to use `data["snapshots"]` |
| D04 | `test_api.py` | `GET /clusters` response shape is `{"clusters": [...]}` — tests expected a bare list | Updated all cluster assertions to use `data["clusters"]` |
| D05 | `test_api.py` | `GET /cache/urls` response shape is `{"entries": [...], "total": N}` — tests expected a bare list | Updated to check `data["entries"]` and `data["total"]` |
| D06 | `test_api.py` | `TabInput` requires `pinned: bool` and `active: bool` — tests omitted these fields, causing 422 validation errors | Added `pinned: false, active: false` to all tab fixtures; extracted `make_tab()` helper |
| D07 | `test_api.py` | `ImportUrlAnalysisRequest.provider` accepts `"claude_code" \| "codex_cli" \| null` — tests were sending `"heuristic"` for this field | Moved analysis source to the correct field `analysisSource: "heuristic"` and set `provider: null` |
| D08 | `rules.test.ts` | Near-duplicate test used `stackoverflow.com/questions/12345/how-to-foo` vs `.../how-to-bar` — only 2 of 4 segments match (0.5 < 0.8 threshold), so tabs were not flagged | Changed to `github.com/org/repo/tree/main/src/index.ts` vs `.../utils.ts` (5/6 ≈ 0.833 > 0.8) |

---

## Coverage Notes

The test suite covers the main happy path and key error paths for each tested module. Coverage tooling was not measured for this report. The following paths are exercised:

**TypeScript — url.ts:**
- All 3 exported functions (`normalizeUrl`, `extractDomain`, `slugify`)
- All tracking-param removal branches
- Invalid URL fallback paths
- Edge cases: empty string, root slash, hash strip

**TypeScript — rules.ts:**
- `runRules` with 0, 1, 2, 3 tabs
- All three flag types: `isExactDuplicate`, `isNearDuplicate`, `isStale`
- `duplicateOfTabId` linkage
- `domainGroup` assignment
- Invalid URL robustness

**Python — agent.py endpoints:**
- `/health`, `/settings` (GET+POST), `/tab-analysis-status`, `/url-analysis/import`,
  `/clusters` (GET+POST merge+PUT+DELETE), `/snapshots` (GET+POST+DELETE),
  `/cache-stats`, `/cache/urls`
- Isolation: every test uses a dedicated in-memory DB; no cross-test state leakage

---

## How to Reproduce

```bash
# TypeScript
cd extension && pnpm test

# Python
cd ..   # back to project root
.venv/bin/python -m pytest tests/ -v
```

Both commands should produce 0 failures.
