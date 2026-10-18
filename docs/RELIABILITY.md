# Reliability and migration contract

## Implemented foundation (2026-10-18)

- The Python API binds to IPv4 loopback. Untrusted browser origins receive 403. Set `AITAB_EXTENSION_ORIGINS` to a comma-separated extension-origin allowlist to pin specific installations. Without it, local development origins and Chrome extension origins are accepted.
- Optional `LOCAL_API_KEY` protects every endpoint except `/health` and CORS preflight. Enter the same value in Settings → Local server token. The token is stored only in Chrome local storage and sent as `X-API-Key`; it is not part of server settings or exported notes. Native loopback clients need the token when configured. Origin checks alone do not authenticate native processes.
- Exact duplicate rules preserve full URL paths, query strings and fragments. Tracking-normalized comparisons are suggestions, never an exact-match deletion rule. Internal URLs are excluded.
- Candidate survivors prioritize protected/important, pinned, active and audible tabs. Automatic cleanup refuses protected tabs and protected domains.
- Snapshot restore preserves separate windows, pinning, active tabs and Chrome group metadata where present. Old snapshots remain readable; missing metadata uses defaults. Restore opens only missing URLs and reports partial failures. It never closes existing windows.
- Partial close results reach the UI; failed selections remain selected. Cleanup actions execute their advertised behaviour: group creates a Chrome group, read-later persists a flag, archive saves a snapshot before closing.
- User flags use URL keys (`userFlagsV2`). Legacy numeric keys are migrated once against currently open tabs and retained as a backup. Same-URL copies share page-level flags. Unavailable old tab IDs cannot be recovered reliably.
- Obsidian filenames support Unicode and URL identity. Existing files are never overwritten; re-export creates another version, preserving user notes. Existing `TabOptimizer` paths and IndexedDB handles remain unchanged.
- Fallback icons are bundled data URLs. AI provider CLIs may transmit prompts to their configured remote model services; local storage does not imply offline model inference.

## Verification

Run `pnpm --dir extension build`, `pnpm --dir extension test` and `.venv/bin/python -m pytest -q`. CI runs the unit/integration suites. Unit tests use a simulated Chrome API; `pnpm --dir extension test:e2e` also validates the built extension in isolated real Chromium. Real-browser acceptance must include two windows, pinned/grouped tabs, a dragging-tab error, protected copies, server-offline operation and restoring an old snapshot.

Browser snapshots restore URLs and layout; they cannot guarantee recovery of unsaved form contents, scroll positions or arbitrary page application state.

The client accepts only HTTP(S) loopback server addresses and same-origin endpoints, preventing a local API token from being forwarded to a remote host. Ordinary requests time out after ten seconds; long AI batches retain their explicit timeout. Tab-list refresh reads local settings so core workspace actions do not wait for the AI server.
