# AITab 0.3 workspace verification

Date: 2026-10-18 (Europe/Moscow). Local environment: macOS, Node 22.14.0, Python 3.12.13, pnpm 10.32.1, Vitest 4.1.2, pytest 9.0.2, Playwright 1.64.1 with Chromium 156.

| Check | Result |
|---|---|
| TypeScript strict check and production build | Pass |
| Vitest unit/integration tests | 110 passed across 15 files |
| Python API/runtime/security/prompt tests | 34 passed |
| Real Chromium extension E2E | 4 passed |
| Whitespace/conflict-marker check | Pass |

## Browser scenarios

1. Load the actual built MV3 extension into a temporary Chromium profile. Close exact duplicates through the UI, stop the service worker through CDP, verify persisted history, undo, and verify a repeated undo creates no extra tabs.
2. Move pinned tabs and an intact Chrome group between normal windows; verify preserved metadata, recreate the emptied source window on Undo, and verify the original live tab IDs/order/group colour/collapse state.
3. Save a collection through the UI, edit a note, download JSON, preview/confirm append import, preserve notes and verify no tabs open automatically. Check English and Russian layouts at 420 px width and capture screenshots.
4. Group related tabs in separate windows without moving them, save a collection, close the fixture tabs, restore into separate windows with pinning/group metadata, and verify reopening only skips existing URLs.

The browser harness uses actual Chrome APIs, isolated `.test` pages and temporary profiles removed after each test. It does not use the user's browser profile, browsing data or live AI account.

## Regression coverage

- Full URL identity preserves path case, fragments, meaningful query parameters and trailing slashes.
- Tracking variants require explicit selection; current protections and the surviving copy are revalidated.
- Durable journal writes precede browser effects; storage failure prevents closing/moving.
- Partial failures, stale previews, repeated confirmations, interrupted workers and changed browser-session IDs are covered.
- Collections retain source sets, notes, stable IDs and group metadata; revisions prevent stale merges.
- Backup validation rejects executable URLs, unknown versions and oversized data; excludes credentials and isolates imported live IDs.
- API tests cover browser-origin rejection, optional token enforcement and explicit extension-origin allowlists. Prompt tests verify JSON-quoted untrusted page data.

## Performance observation

On the same local synthetic workload of 1,200 distinct URLs from one domain, the reviewed rule engine took approximately 2,102 ms. The indexed implementation took approximately 2.17 ms. These are single local observations rather than a cross-machine performance guarantee. UI tab/history refresh is also debounced during bulk events.

## Installed-extension compatibility

The original Chrome loader path was found in the installation metadata. Temporary Chromium profiles confirmed that a symlink to the renamed checkout changed the computed extension ID. A real compatibility loader at the original path restores the original ID; successful builds synchronize it through an owned local config. User browser profile data was not edited. See [MIGRATION.md](../MIGRATION.md).

## Reproduce

```sh
pnpm --dir extension install --frozen-lockfile
pnpm --dir extension build
pnpm --dir extension test
.venv/bin/python -m pytest -q
pnpm --dir extension exec playwright install chromium
pnpm --dir extension test:e2e
git diff --check
```

CI runs TypeScript, Vitest, Python and Chromium checks. Browser failure artifacts contain traces/screenshots. The first five implementation commits were independently verified as successful in GitHub Actions; the final workflow run is linked from the repository's CI badge.

Live Claude/Codex calls and recovery of arbitrary unsaved form/application state are outside the automated checks. Provider orchestration remains covered by stubbed-provider tests. The historical pre-workspace report is available in Git history.
