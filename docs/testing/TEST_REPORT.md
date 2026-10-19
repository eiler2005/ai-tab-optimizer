# AITab workspace and UX verification

Date: 2026-10-19 (Europe/Moscow). macOS, Node 22.14.0, Python 3.12.13,
pnpm 10.32.1, Vitest 4.1.2, pytest 9.0.2, Playwright 1.64.1 / Chromium 156.

| Check | Result |
|---|---|
| Strict TypeScript and production build | Pass |
| Vitest | 178 passed across 31 files |
| Python API/runtime/security/review/backup tests | 56 passed |
| Real Chromium extension E2E | 21 passed |
| Large isolated workload | 600 synthetic live tabs, 1,000 saved materials, 40 collections/topics |
| Layout matrix | 360/420/600 px, 100%/200% text; additional Russian 360 px/200% |
| Whitespace and documentation links/fences | Pass |

## Before/after measurement

Baseline: product commit `01dc077`; after: the new six-stage UX implementation.
Both builds ran sequentially on the same local machine in separate temporary
headless Chromium profiles. HTTP was restricted to synthetic `.test` pages; live
tabs were loaded then discarded, with identical saved collections/notes. No real
user tabs, browser profile, account or provider request was used.

| Observation | Before | After |
|---|---|---|
| Initially rendered tab rows | 602 | 100 |
| First useful Tabs render after reload | 148 ms | 58 ms |
| Search input-to-result p95, 12 inputs | 57 ms | 92 ms |
| Navigation clicks to saved-material search | 2 | 1 |
| Automated saved-note retrieval | 82 ms | 116 ms |
| Open one saved page, then focus without a duplicate | Pass | Pass |

Raw data: [usability-measurements.json](usability-measurements.json). Reproduce with
`node scripts/measure-usability.mjs` from `extension/`; `AITAB_BASELINE_DIST` selects
the old independently built `dist`. Input-to-DOM timing includes Playwright and
two animation frames. This single local observation demonstrates the 200 ms search
budget, bounded initial DOM and fewer navigation transitions. The richer new search
was slower in this run; no universal speedup or human task-completion claim is made.

The workload passed 21 view/width/text combinations without root horizontal overflow.
Screenshots were inspected; Russian navigation at doubled text was then improved
to wrap whole controls into rows. The final layout was rechecked on the same saved
corpus with a smaller 120-live-tab fixture and by the keyboard E2E matrix.

## Browser coverage

- A held real tab-close call exposes live journal progress while scrolled to the
  bottom. Releasing it closes four selected fixture tabs, saves three beforehand,
  displays actual outcomes/Undo in the footer and restores the four tabs once.
  Completion replaces the disabled Apply label; workspace updates do not queue
  an overview request for every journal write. Errors appear in the fixed header.

- Similar content with only complementary sources and zero selected closures shows
  its expanded group before the forecast, explains the distinction, exposes source
  links and a jump-to-results action, collapses finished setup and retains both tabs.

- Tabs first, shared query, scoped filtered selection and visible hidden-selection
  counts; permanent row menus and recovery/settings remain reachable.
- Reveal-current clears obstructing filters, renders a target beyond the initial
  100 rows, scrolls it into view and returns keyboard focus. More closes on Escape
  with focus returned to its trigger and on an outside pointer click.
- Shared search finds saved notes from Tabs, opens one missing page and focuses it
  without duplication. Local search and cached topics remain available offline.
- Topic names/tasks survive reload. Delete retains sources; structural Undo restores
  the topic. Merge preserves unique material/notes; Undo and split never close tabs.
- Pair AI comparison is explicit, scoped and cancellable after navigating away;
  local work remains available. Provider output is synthetic in automated suites.
- One selected-tab review excludes unrelated copies and survives category/navigation
  changes. A hidden plan cannot leak its footer into a topic screen.
- Content review separates complementary material, redundancy and topical obsolescence;
  changed sources, protected keepers and expired plans cannot silently execute.
- Optimization retains same-address ChatGPT states, reports actual closes/skips/failures,
  exports Markdown and supports repeated Undo without extra tabs.
- Worker restart preserves/reconciles close history. Window/group moves and Undo
  retain live IDs, pinning, order, colour and collapse state; empty source windows
  can be recreated without duplicate pages.
- Collections preserve notes, group layout and source sets; JSON append import
  never opens tabs. Single-item opening and collection reopening are idempotent.
- URL rules/Inbox capture are idempotent and never close tabs.
- An actual isolated FastAPI process and temporary SQLite create a checksum-verified
  full backup, retain extension data and configure the real Chrome backup alarm.

## Regression boundaries

Unit/API suites cover meaningful URL case/query/fragment identity; stateful chats;
write-before-effect failures; source/keeper changes; partial and interrupted actions;
scope ID/URL binding; saved IDs isolated from live IDs; remembered decisions tied to
evidence/focus; prompt-data isolation and supplied-quote validation; provider timeout,
disconnect cancellation and owned subprocess termination; bounded excerpts that do
not wake discarded pages; origin/token guards; secret-free checksummed backups,
rotation and concurrent SQLite writers.

Topic regressions cover idempotent source adaptation, Chrome storage property-order
changes, separate manual revisions, lineage after merge/split, membership exclusions,
distinct decisions invalidated by material changes, guarded structural Undo and
backup remapping of collection/topic/saved-chat relationships. Full backup sanitization
explicitly retains `topicCatalog` while excluding provider secrets. Optimization
reports retain signed unrelated tab-count changes through export/import.

## Deployment and compatibility

The final production build was synchronized to the owned real legacy loader;
all 15 build files matched. A symlink is not used because a changed loader path can
change unpacked extension identity. Reload the existing extension card; do not remove
and reinstall it. See [MIGRATION.md](../MIGRATION.md).

The owned loopback server was identified by command/cwd, restarted and checked for
health, `/topic-review`, backup routes and the 8,000-character deep-excerpt schema.
Existing Codex GPT-5.6 Terra settings were retained. No user database was replaced.
GitHub Actions passed independently for stages 1–5; the final pushed revision uses
the same TypeScript/Vitest/Python/Chromium gates. Its run is available in repository CI.

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

## Limits

Tests establish mechanics and conservative guards, not corpus-wide semantic accuracy.
Closed pages may have metadata/cached text only; excerpts are not whole-document
equivalence. No external relevance verification or full incremental semantic-group
recomputation is implemented. AI coverage/sampling is shown explicitly. Running
jobs/plans and derived evidence are outside portable backup scope. URL recovery
does not recover arbitrary unsent application state.

Current automated suites stub provider output. Earlier live smoke checks on
2026-10-18 used synthetic pages and the AITab-specific Codex 0.163.0 authenticated
through ChatGPT: overlapping articles, an expired event and a useful old reference
were distinguished; videos from different authors were retained as complementary.
Those small checks are historical evidence, not a live-provider 600-page benchmark.
