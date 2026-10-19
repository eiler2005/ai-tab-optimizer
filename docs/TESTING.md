# Testing

This document describes the test strategy, the layout of the existing test suites, how to run them, and the gaps we know about. The actual test plan and the latest run report live in [`docs/testing/TEST_PLAN.md`](testing/TEST_PLAN.md) and [`docs/testing/TEST_REPORT.md`](testing/TEST_REPORT.md).

## Strategy

The project has two execution surfaces — the TypeScript extension and the Python FastAPI server — and each has its own runner. The test pyramid we aim for:

| Layer | Tooling | Where it covers |
|---|---|---|
| **Unit** | Vitest (TS), pytest (Python) | Pure utilities, type guards, single message handlers, single endpoints |
| **Integration** | pytest with FastAPI test client | End-to-end through HTTP into SQLite, with the CLI provider stubbed where appropriate |
| **Behavioural** | pytest scenarios | Multi-step flows: provider failover, stop-and-resume, retention sweeps |
| **Browser integration** | Playwright Chromium | Built MV3 extension, real tabs/groups/storage and isolated FastAPI/SQLite |
| **Manual** | Documented in [SETUP.md](../SETUP.md) | Side-panel views, Chrome integration, Obsidian export |

The extension now has real Chromium integration/UI tests in `extension/e2e/` in addition to unit tests with simulated Chrome APIs. Live provider CLIs remain stubbed in automated tests.

## TypeScript — Vitest

**Where:** [`extension/src/**/__tests__/`](../extension/src) (see the latest run report for counts). Configuration: [`extension/vitest.config.ts`](../extension/vitest.config.ts).

| File | Covers |
|---|---|
| [`extension/src/background/__tests__/transport.test.ts`](../extension/src/background/__tests__/transport.test.ts) | HTTP transport: timeout via `AbortController`, multi-candidate URL fallback, abort-vs-error distinction |
| [`extension/src/background/__tests__/analysis-helpers.test.ts`](../extension/src/background/__tests__/analysis-helpers.test.ts) | Tab fingerprinting, status computation, summary aggregation |
| [`extension/src/background/__tests__/tab-actions.test.ts`](../extension/src/background/__tests__/tab-actions.test.ts) | Typed Chrome tab API wrappers, including `failedTabIds` tracking |
| [`extension/src/shared/utils/__tests__/url.test.ts`](../extension/src/shared/utils/__tests__/url.test.ts) | URL normalization, domain extraction |
| [`extension/src/shared/utils/__tests__/rules.test.ts`](../extension/src/shared/utils/__tests__/rules.test.ts) | Rule engine (exact / near duplicate detection, stale heuristic) |
| [`extension/src/side-panel/__tests__/recommendation-state.test.ts`](../extension/src/side-panel/__tests__/recommendation-state.test.ts) | Per-tab recommendation state machine |

The Vitest config uses the `node` environment (no DOM) and only collects coverage from `src/shared/utils/**` and `src/background/**` — the layers where pure logic lives. Unit coverage excludes UI components; Playwright separately exercises real extension UI and Chrome APIs.

### Running Vitest

```bash
cd extension
pnpm test              # run once
pnpm test:watch        # rerun on file changes
pnpm test:coverage     # text + html coverage report under coverage/
```

## Python — pytest

**Where:** [`tests/`](../tests). Shared fixtures: [`tests/conftest.py`](../tests/conftest.py).

| File | Covers |
|---|---|
| [`tests/test_api.py`](../tests/test_api.py) | FastAPI endpoints via `httpx`/`TestClient`: `/analyze`, `/tab-history`, `/snapshots`, `/clusters`, `/cache/urls`, `/sessions`, settings persistence |
| [`tests/test_runtime_behavior.py`](../tests/test_runtime_behavior.py) | Provider failover policy, retention sweeps, `analysis_runs` resume semantics, runtime-state transitions |

`conftest.py` provides an isolated SQLite database per test, so suites run in parallel without interfering. CLI subprocess invocations are stubbed where the test exercises orchestration rather than the real provider.

### Running pytest

```bash
.venv/bin/pip install -r requirements.txt   # one-time
.venv/bin/pytest                            # run all tests
.venv/bin/pytest tests/test_api.py -v       # one file, verbose
.venv/bin/pytest -k "failover"              # filter by name
```

## Static checks

Even when not strictly "tests", these run alongside the test suites and gate releases:

```bash
# TypeScript — strict mode, zero `any`
cd extension && pnpm typecheck

# Python — syntax-level check across all server modules
.venv/bin/python -m py_compile agent.py server_core/*.py

# Production build sanity
cd extension && pnpm build
```

The pre-commit hook ([`.husky/pre-commit`](../.husky/pre-commit)) runs `pnpm typecheck` on staged TypeScript files and a basic secret-scan, so most regressions are caught before a commit lands.

## CI

The [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) workflow runs on every push and PR to `master`:

| Job | What it does |
|---|---|
| `typecheck` | `cd extension && pnpm install --frozen-lockfile && pnpm typecheck` |
| `build` | `cd extension && pnpm install --frozen-lockfile && pnpm build` |
| `python-check` | `pip install -r requirements.txt && python -m py_compile agent.py` |

Vitest runs in the TypeScript job; pytest runs in the Python job.

## Test layout philosophy

A few rules-of-thumb the existing suites follow; new tests should match:

- **Co-locate, don't centralize.** Each TypeScript module's tests live in a sibling `__tests__/` folder, not in a top-level `tests/` directory. This keeps "where do I add a test?" obvious.
- **One concern per file.** `transport.test.ts` doesn't reach into `analysis-helpers.ts`, even though they're in the same folder.
- **Stub at the boundary.** Python integration tests stub the CLI subprocess but exercise the full HTTP→SQLite path. TypeScript tests stub `fetch` and Chrome APIs but exercise real logic.
- **Real database, isolated per test.** pytest creates an in-memory SQLite database per test (see `conftest.py`). We don't mock SQLite — that would defeat the point of integration tests.
- **No flakiness budget.** A flaky test gets fixed or removed the same day. There is no "skip on CI" annotation in the suite.

## What good test coverage looks like (for new contributions)

When you add a new feature, aim for at least one test in each of these dimensions that applies:

- **Pure logic** — a Vitest test for the helper, a pytest test for the policy module.
- **HTTP contract** — for new FastAPI endpoints, a `test_api.py` case that hits the URL and asserts the response shape.
- **State transitions** — for anything stateful (analysis runs, retention, focus mode), a `test_runtime_behavior.py` scenario that walks through the lifecycle.
- **Error paths** — at least one test where the dependency fails (CLI errors, abort, rate limit, missing file). The provider failover code is tested this way.

You don't need to test every glue line, but the *decisions* the code makes should each have a test.

## Known gaps

These are tracked in [`docs/IMPROVEMENTS.md`](IMPROVEMENTS.md) and consciously deferred:

| Gap | Impact |
|---|---|
| No isolated React component suite | Core workspace UI is covered through real Chromium E2E |
| No real-provider AI end-to-end test | Browser workspace tests run offline; Python tests stub provider CLIs |
| No coverage threshold | We collect coverage but don't fail builds below a percentage |
| No fuzz tests for the rule engine | URL normalization is the trickiest pure code in the repo and would benefit from property-based tests |

If you fix any of these, please update this section in the same PR.

## Test-related docs in this repo

- [`docs/testing/TEST_PLAN.md`](testing/TEST_PLAN.md) — current test plan, scenarios, exit criteria.
- [`docs/testing/TEST_REPORT.md`](testing/TEST_REPORT.md) — the most recent test run summary.
- [`SETUP.md`](../SETUP.md) — manual smoke-test scripts for each side-panel view.

## Chromium extension E2E

From `extension/`, run `pnpm exec playwright install chromium`, `pnpm build`, then `pnpm test:e2e`. Tests launch a separate temporary persistent Chromium profile, load the built MV3 extension and use real tab/window/group/storage APIs. User browser profiles and real AI accounts are not used. Fixtures serve isolated `.test` pages and configure the AI server to an unusable port. Tests cover worker stop/restart, duplicate close/Undo, intact group moves, recreated source windows, notes, JSON downloads/imports, multi-window collection restore, idempotent reopening, and English/Russian narrow layouts. CI installs Chromium and OS dependencies and uploads traces/screenshots on failure.

## Large-workspace usability measurement

From `extension/`, run `node scripts/measure-usability.mjs` after building. This
creates isolated temporary Chromium profiles, 600 synthetic live tabs, 1,000 saved
materials and 40 collections. It measures input-to-DOM search latency, first useful
render and saved-page retrieval, verifies single-page open/focus, and checks narrow
layouts at 360/420/600 px with 100%/200% root text sizes. A Russian 360 px check is
included. `AITAB_BASELINE_DIST` optionally selects an independently built old version
for the same sequential workload; `AITAB_MEASUREMENT_TABS` supports 120–1,000.

Results are written to `docs/testing/usability-measurements.json`; screenshots go
to `/tmp/aitab-ux-measurements/`. This is an explicit local measurement, not a CI
latency gate or human usability study. Input timing includes Playwright overhead.
The normal E2E suite separately checks keyboard menus and reveal-current beyond
100 rows, scoped selection, stable topics, merge/split/Undo and offline navigation.
