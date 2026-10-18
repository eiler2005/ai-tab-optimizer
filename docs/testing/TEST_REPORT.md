# AITab 0.3 workspace verification

Date: 2026-10-18 (Europe/Moscow). Local environment: macOS, Node 22.14.0, Python 3.12.13, pnpm 10.32.1, Vitest 4.1.2, pytest 9.0.2, Playwright 1.64.1 with Chromium 156.

| Check | Result |
|---|---|
| TypeScript strict check and production build | Pass |
| Vitest unit/integration tests | 150 passed across 25 files |
| Python API/runtime/security/prompt/backup tests | 51 passed |
| Real Chromium extension E2E | 11 passed |
| Whitespace/conflict-marker check | Pass |

## Browser scenarios

1. Load the actual built MV3 extension into a temporary Chromium profile. Close exact duplicates through the UI, stop the service worker through CDP, verify persisted history, undo, and verify a repeated undo creates no extra tabs.
2. Move pinned tabs and an intact Chrome group between normal windows; verify preserved metadata, recreate the emptied source window on Undo, and verify the original live tab IDs/order/group colour/collapse state.
3. Save a collection through the UI, edit a note, download JSON, preview/confirm append import, preserve notes and verify no tabs open automatically. Check English and Russian layouts at 420 px width and capture screenshots.
4. Group related tabs in separate windows without moving them, save a collection, close the fixture tabs, restore into separate windows with pinning/group metadata, and verify reopening only skips existing URLs.
5. Use a synthetic AI response in the real content-review UI. Verify current-focus transmission, initially empty selection, protected survivor, separate overlap/obsolescence lists, clearing hidden selections, keeping the replacement page open and Undo. Capture the 420 px layout.
   Verify an unused group's survivor does not silently disable selection in another group.
6. Prepare/apply a local optimization plan with two same-address synthetic ChatGPT pages. Verify chats are retained, the action footer stays in the viewport after scrolling, actual reduction is reported, Markdown downloads include actual outcomes and Undo restores closed copies.
7. Hold a synthetic AI response pending, observe the AI phase, switch to duplicates and verify selection/closing controls stay enabled. Cancel the review and verify review controls become available again.
8. Search saved notes with a purpose filter in Library, open one missing page, focus it again without duplication and preserve task/review metadata in JSON. Inspect the 420 px screenshot.
9. Use Topics to retain a working page, collapse a browser group, preview/save/close the remainder and Undo. Verify source collections remain.
10. Save a page to Inbox twice, enable a hostname save rule, navigate/reload and verify only one saved copy per exact URL with live tabs retained.
11. Launch an actual FastAPI subprocess with temporary SQLite/backup roots. Read two live loopback pages through the real deep-extraction Chrome API. Create a JSON + SQLite bundle, run the read-only checksum/integrity verifier, append its collections without opening tabs and configure the actual Chrome backup alarm. Stop and remove the isolated server/profile afterward.

The browser harness uses actual Chrome APIs, isolated `.test` pages and temporary profiles removed after each test. It does not use the user's browser profile, browsing data or live AI account.

## Regression coverage

- Full URL identity preserves path case, fragments, meaningful query parameters and trailing slashes.
- Tracking variants require explicit selection; current protections and the surviving copy are revalidated.
- Durable journal writes precede browser effects; storage failure prevents closing/moving.
- Partial failures, stale previews, repeated confirmations, interrupted workers and changed browser-session IDs are covered.
- Collections retain source sets, notes, stable IDs and group metadata; revisions prevent stale merges.
- Backup validation rejects executable URLs, unknown versions and oversized data; excludes credentials and isolates imported live IDs.
- API tests cover browser-origin rejection, optional token enforcement and explicit extension-origin allowlists. Prompt tests verify JSON-quoted untrusted page data.
- Content-review tests reject hallucinated IDs/evidence/replacements, separate content overlap from merely related titles, keep discarded pages asleep, reject excerpts captured after navigation, cap AI input at 600 tabs and send large prompts through stdin. Old last-access timestamps never generate topical-obsolescence suggestions.
- Chat roots and distinct conversation IDs are handled conservatively; automatic closes refuse chat state. Missing AI relation labels default to complementary material. Planning requires excerpts for default AI redundancy selection and leaves obsolete material to manual choice.
- Review-job tests cover immediate acknowledgement, persisted completion, cancellation, local actions during an AI wait and interruption after worker restart. Python tests cover client-disconnect cancellation and termination of the owned Codex subprocess.
- Optimization tests cover partial outcomes, survivor preservation, storage failure before effects, idempotent confirmation and Undo, changed-title rejection and forecast/report generation.
- Library tests cover note/task search, purpose filters, separate chat states, single-item focus/open, optional old-schema metadata and portable task fields.
- Saved-source review IDs never serve as live close proof, even if Chrome later allocates a matching numeric ID. Saved collection revisions are revalidated for manual archive candidates.
- Review decisions are keyed to URL/title/evidence/focus, expire after 30 days, survive backup and do not suppress materially changed reviews.
- Evidence tests cover excerpt reuse, invalidation, deep URL selection and payload bounds; saved pages are never opened for extraction.
- Rule/Inbox tests cover idempotence, exact-host matching, deleted targets, imported-rule remapping to suggestion mode, and chat exclusion.
- Full backup tests verify SQLite integrity, provider-setting removal without changing the source DB, SHA-256 mismatch rejection, version rotation without touching unrelated folders, invalid requests and an uncommitted concurrent writer. Schedule tests preserve an existing matching alarm across worker restarts and surface failed attempts while retaining last success.

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

The product-workspace package was built and synchronized to the owned legacy Chrome
loader. The detached loopback server was restarted and its health, backup routes and
8,000-character deep-excerpt schema verified. The README now contains three Mermaid
diagrams; Markdown links, code fences and protocol counts (76 requests / 9 broadcasts)
were checked. English library and Russian review screenshots were visually inspected.

Automated checks establish mechanics and conservative guards, not semantic accuracy
on the user's entire corpus. Closed pages can have only metadata/cached evidence;
there is no external web verification or full-document equivalence guarantee. The
600-entry library AI budget balances unique live/saved URLs; remaining coverage is
explicit. Excerpt reuse is not full incremental recomputation of semantic AI groups.

Live Claude/Codex calls and recovery of arbitrary unsaved form/application state are outside the automated checks. Provider orchestration remains covered by stubbed-provider tests. The historical pre-workspace report is available in Git history.

Manual live verification on 2026-10-18: the globally installed Codex 0.147.0 failed
with the retired GPT-5.4 model. An AITab-specific Codex 0.163.0 installation,
authenticated through the existing ChatGPT session, successfully returned
GPT-5.6 Terra recommendations. A separate four-page synthetic content review
identified two overlapping release articles and one expired 2024 event, while
retaining a useful algorithms reference published in 2012. No real browser pages
were sent during these checks. This small smoke check does not establish quality
for every user corpus or verify live performance on 600 pages.

After the UI revision, a live loopback request to GPT-5.6 Terra compared synthetic
videos from different authors: the response classified them as complementary,
explained each author's unique method and retained the supplied ChatGPT draft.
This check used synthetic metadata only, not the user's pages.
