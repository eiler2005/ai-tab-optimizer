# Test Plan — AI Tab Optimizer v0.3

**Status:** Active
**Last updated:** 2026-03-30
**Author:** Denis Ermilov

---

## 1. Scope

This plan covers automated tests for the two independently testable parts of the codebase:

| Layer | Technology | Runner |
|---|---|---|
| Shared utility functions (TypeScript) | Vitest, Node env | `pnpm test` in `extension/` |
| FastAPI server endpoints (Python) | pytest + httpx | `pytest tests/` in project root |

Out of scope for automated tests:
- Chrome Extension UI (requires a real browser; covered by manual testing in SETUP.md)
- Claude Code CLI / Codex CLI integration (requires authenticated CLIs and incurs cost)
- Obsidian vault file writes (requires File System Access API in a browser context)

---

## 2. Test Strategy

### 2.1 TypeScript — Pure unit tests

**Principle:** test pure functions in isolation, no mocks, no Chrome API.

The two shared utility modules (`url.ts`, `rules.ts`) are pure functions with no side effects. Every test follows the pattern: *arrange input → call function → assert output*. No stubs or spies are needed.

**Fixture factory** (`fixtures.ts`): a `makeTab()` factory with an auto-incrementing ID counter lets each test construct minimal, valid `TabRecord` objects with only the fields relevant to the case under test.

**Environment:** `vitest` with `environment: 'node'` — no DOM, no browser globals needed for these modules.

### 2.2 Python — Integration tests against in-memory SQLite

**Principle:** test real HTTP request → response cycles. No mocking of the database or business logic.

Each test function gets a fresh in-memory SQLite database via the `client` fixture in `conftest.py`. The fixture replaces the FastAPI app's lifespan context manager (`app.router.lifespan_context`) with a test-only version that injects the in-memory connection. This ensures:
- No `tab_analysis.db` file is read or written during tests
- State is fully reset between test functions (fixture `scope="function"`)
- Tests run in the same process without network I/O

**No AI provider calls.** Tests never exercise the `/analyze` endpoint (which calls Claude Code CLI / Codex CLI) — that path requires authenticated external tools. All tests use `/url-analysis/import` to seed cache state when needed.

---

## 3. Test Cases

### 3.1 TypeScript — url.ts (25 tests)

| ID | Function | Description |
|---|---|---|
| U01 | `normalizeUrl` | Returns URL unchanged when nothing to normalize |
| U02 | `normalizeUrl` | Lowercases hostname |
| U03 | `normalizeUrl` | Removes `utm_source` tracking param |
| U04 | `normalizeUrl` | Removes `utm_medium` tracking param |
| U05 | `normalizeUrl` | Removes `utm_campaign` tracking param |
| U06 | `normalizeUrl` | Removes `fbclid` tracking param |
| U07 | `normalizeUrl` | Removes `gclid` tracking param |
| U08 | `normalizeUrl` | Strips tracking params and keeps non-tracking params |
| U09 | `normalizeUrl` | Sorts remaining query params alphabetically |
| U10 | `normalizeUrl` | Removes trailing slash from non-root pathname |
| U11 | `normalizeUrl` | Preserves root trailing slash |
| U12 | `normalizeUrl` | Strips hash fragment |
| U13 | `normalizeUrl` | Returns original string for invalid URL |
| U14 | `normalizeUrl` | Returns empty string unchanged |
| U15 | `normalizeUrl` | Two URLs with different tracking params are equal after normalizing |
| U16 | `extractDomain` | Extracts hostname from simple URL |
| U17 | `extractDomain` | Includes subdomain in hostname |
| U18 | `extractDomain` | Returns input string for invalid URL |
| U19 | `extractDomain` | Extracts hostname, ignores port |
| U20 | `extractDomain` | Handles URL with query string |
| U21 | `slugify` | Lowercases and replaces spaces with hyphens |
| U22 | `slugify` | Removes special characters |
| U23 | `slugify` | Collapses multiple spaces into single hyphen |
| U24 | `slugify` | Collapses multiple hyphens |
| U25 | `slugify` | Truncates to maxLen, no trailing hyphen after truncation |
| U26 | `slugify` | Handles empty string |
| U27 | `slugify` | Preserves existing hyphens |

### 3.2 TypeScript — rules.ts (22 tests)

| ID | Scenario | Description |
|---|---|---|
| R01 | Empty input | Returns empty tabs and zero counts |
| R02 | Single tab | No flags set on a single, unique tab |
| R03 | Exact duplicates | Second tab is marked as exact duplicate of first |
| R04 | Exact duplicates (×3) | All subsequent tabs marked; count = 2 |
| R05 | Tracking param duplicates | URLs differing only in UTM params treated as duplicates |
| R06 | Hash duplicates | URLs differing only in hash treated as duplicates |
| R07 | Different domains | Tabs on different domains not marked as duplicates |
| R08 | Near duplicates | Tabs on same domain with 5/6 path segments matching are near-duplicates |
| R09 | Near-dup: different domains | Tabs on different domains not near-duplicates |
| R10 | Near-dup: exact already flagged | Exact duplicates are not also flagged as near-duplicates |
| R11 | Near-dup: dissimilar paths | Tabs with low path overlap on same domain not flagged |
| R12 | Stale: exceeds threshold | Tab with `lastAccessed` > N days flagged as stale |
| R13 | Stale: recent access | Tab accessed recently not flagged |
| R14 | Stale: undefined lastAccessed | Tab with no `lastAccessed` not flagged |
| R15 | Stale: custom threshold | Threshold parameter respected |
| R16 | Stale: multiple stale tabs | All stale tabs counted correctly |
| R17 | domainGroup | `ruleFlags.domainGroup` set to tab's domain |
| R18 | Invalid URL | No exception thrown for non-URL string |
| R19 | Invalid URL near-dup | Invalid URL tab not flagged as near-duplicate of valid tab |

### 3.3 Python — FastAPI server (23 tests)

| ID | Endpoint | Description |
|---|---|---|
| P01 | `GET /health` | Returns `{ status: "ok" }` |
| P02 | `GET /settings` | Response contains `settings` key with `serverAiProvider` and `fallbackAiProvider` |
| P03 | `POST /settings` | Persists and returns updated settings |
| P04 | `POST /settings` | Response immediately reflects saved values |
| P05 | `POST /tab-analysis-status` | Two tabs with empty cache → both pending, summary correct |
| P06 | `POST /tab-analysis-status` | Tab appears cached after `/url-analysis/import` |
| P07 | `POST /tab-analysis-status` | Empty tab list → empty statuses, total = 0 |
| P08 | `POST /url-analysis/import` | Single result saved (saved ≥ 1) |
| P09 | `POST /url-analysis/import` | Empty payload returns `{ saved: 0 }` |
| P10 | `POST /url-analysis/import` | Multiple results counted correctly |
| P11 | `GET /clusters` | Empty database returns `{ clusters: [] }` |
| P12 | `POST /clusters/merge` | Creates a new cluster, visible in list |
| P13 | `PUT /clusters/{id}` | Renames cluster, name reflected in list |
| P14 | `DELETE /clusters/{id}` | Deleted cluster absent from list |
| P15 | `POST /clusters/merge` | Same-name merge deduplicates (no double insert) |
| P16 | `GET /snapshots` | Empty database returns `{ snapshots: [] }` |
| P17 | `POST /snapshots` + `GET /snapshots` | Created snapshot appears in list with correct id |
| P18 | `DELETE /snapshots/{id}` | Deleted snapshot absent from list |
| P19 | `DELETE /snapshots/{id}` | Non-existent snapshot returns 404 |
| P20 | `POST /snapshots` (×3) | All three snapshots listed |
| P21 | `GET /cache-stats` | Returns `totalUrls: 0` on empty database |
| P22 | `GET /cache/urls` | Returns `{ entries: [], total: 0 }` on empty database |
| P23 | `GET /cache-stats` | `totalUrls` increments after import |

---

## 4. Entry Points / Commands

```bash
# TypeScript unit tests
cd extension
pnpm test               # run once
pnpm test:watch         # watch mode
pnpm test:coverage      # coverage report

# Python integration tests
pytest tests/ -v                  # verbose
pytest tests/ -v -k "Settings"    # filter by class
pytest tests/ --tb=short          # compact tracebacks
```

---

## 5. Test Infrastructure

### conftest.py (Python)
- Creates an `aiosqlite` in-memory connection and runs `init_db()` to apply the full schema
- Replaces `app.router.lifespan_context` with a test lifespan that injects the in-memory DB
- Restores the original lifespan and closes the DB after each test function

### fixtures.ts (TypeScript)
- `makeTab(overrides)` — factory for `TabRecord` with safe defaults and auto-increment IDs
- `resetIdCounter()` — called in `beforeEach` to keep test IDs deterministic

---

## 6. What Is Not Tested Here

| Excluded area | Reason | How to test manually |
|---|---|---|
| `/analyze` endpoint | Requires live CLI subprocess (Claude Code or Codex) | `curl -X POST localhost:8765/analyze` with real tabs |
| `/chat` endpoint | Requires live CLI subprocess | Use the Search panel in the extension |
| `/analytics/refresh` | Requires live CLI subprocess | Use the Analytics ↻ button in the AI panel |
| Chrome Extension UI | No headless Chrome driver set up | Load unpacked → manual walkthrough per SETUP.md |
| Obsidian export | Requires File System Access API | Manual test per SETUP.md §Testing Obsidian Integration |
| Auto-snapshot alarm | Chrome Alarms API, needs browser | Manual test per SETUP.md §Testing Snapshots |
