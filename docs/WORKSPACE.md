# Offline workspace

## Duplicate review

Open **Cleanup**, choose all normal windows or one window, and click **Find duplicates**. Exact groups compare full HTTP(S) URLs. Tracking variants only strip a small list of known analytics parameters; fragments, `ref`, `source`, path case and trailing slashes remain meaningful.

The radio button chooses the surviving copy; checkboxes choose copies to close. Protected/important, pinned, active, audible and protected-domain tabs are excluded from automatic closing. Tracking variants start unselected. A preview expires after five minutes; execution rechecks each URL, window/group, survivor and current protection. Changed or missing targets are skipped. Selecting a survivor for deletion is rejected.

Offline workspace mutations run in the service worker through a serialized queue. Exact duplicate cleanup, window moves, collections and Undo need no AI server or network request. Optional content review uses the configured AI server. Before each close, the operation and original tab metadata are persisted to `chrome.storage.local` under `aitab.workspace.v1` (version 1). Repeating a preview execution returns its existing operation, preventing repeated closes.

## Similar content and topical obsolescence

In **Cleanup → Similar content / Outdated content**, enter an optional current
focus and click **AI: review content and relevance**. For example: "I am moving
to React 19; registration for the 2025 conference is no longer relevant."
The same review produces two separate lists and a count summary. Nothing is
selected initially. Choose the version to keep, select individual candidates
or **Select candidates in this section**, and confirm **Close selected with
Undo**. Switching lists clears the selection. History reports actual outcomes
and restores successful closes.

Content overlap can span different URLs and domains. Sharing a broad topic is
insufficient: the prompt asks for overlapping information and differences that
might make both pages useful. Topical obsolescence uses expired events/deadlines,
material superseded by an open replacement, and the explicit current focus.
**Time since last visit is never sent or used for this classification.** Old
publication dates or version numbers alone do not establish obsolescence.
Every obsolete-content suggestion needs an explanation, confidence of at least
0.8, and a short quote verified against that page's supplied title/URL/excerpt.
Replacement IDs must refer to supplied pages; a replacement cannot itself appear
in the obsolete list. These checks establish grounding, not factual certainty:
review the reasons before closing.

The optional excerpt checkbox requests HTTP(S) page permission on the scan click.
The extractor reads H1, description and up to 500 characters of page text,
combined and bounded to 1,200 characters per page. Extraction runs five pages at
a time, skips discarded pages without waking them, and drops excerpts if the
URL changes during capture. Inaccessible pages are explicitly counted and use
title/URL evidence only. Enabled excerpts, titles, URLs and focus are sent to the
configured AI provider. Full documents, login state and visit-age history are not
supplied. AI/extraction covers at most the first 600 normal non-private HTTP(S)
tabs in the chosen scope; the UI reports the total and AI coverage and suggests
choosing another window above that limit. Content can change at a stable URL,
so short excerpts do not guarantee full-page equivalence.

**Compare locally without AI** uses distinctive-title or substantial excerpt
word overlap and labels the evidence accordingly; at most 200 candidate pairs
are shown. It does not invent obsolete-content recommendations. If the AI server
fails, local matches remain available with an explicit warning. AI suggestions
are capped at 100 content groups. Review previews expire after five minutes.
Selected pages and surviving/replacement pages are revalidated before closing,
and existing protections, write-before-close journaling and idempotent Undo apply.

The local server uses `POST /workspace-review` and the same configured CLI chain
as analysis. A current Codex CLI signed in with ChatGPT can use the subscription;
GPT-5.6 Terra with low reasoning is the AITab default. See [SETUP.md](../SETUP.md).

## Window consolidation

In Cleanup → Merge windows, choose a target and explicitly select source windows or individual tabs. Preview lists the exact pages and group labels. Execution moves existing live tabs instead of closing/reopening pages. Entire selected groups move as a unit through `chrome.tabGroups.move`; subsets are regrouped in the target with their original name, colour and collapsed state. Pinned tabs stay in the pinned section and the target's existing active tab is retained.

The same operation journal records each result. Changed URLs, windows, group membership or pinning invalidate individual preview targets. Errors are reported per tab; successful moves can be undone independently. Undo moves the original live tab IDs back, recreating a source window with its existing tab if Chrome automatically closed that now-empty window. It creates no duplicate pages or placeholder tabs. Undo restores source groups and active tabs. After a full browser restart, live-ID move undo is refused rather than applying old IDs to unrelated tabs; use a saved collection or snapshot for URL restoration.

## Saved collections

Cleanup → Collections saves all normal windows, one window, or tabs selected in the tab list. Preview names the exact URLs. Save and close persists the collection and recovery journal together before closing any unprotected tab. Changed/failed/protected tabs remain open and their outcomes are reported. Archive in the guided cleanup now creates a collection before closing the page.

Saved pages have independent UUIDs, notes, timestamps, page flags and logical group keys; they never address live Chrome tab IDs. Opening a collection only opens missing URLs and restores layout/group metadata. Same-URL page flags are reapplied to newly opened pages without replacing current flags.

Select one collection to create a deduplicated copy, or several collections to combine them. Preview reports before/after counts and resulting URLs. Only full URL matches are merged. Different notes are combined, stronger flags and pinning are retained, and all source collections remain unchanged. Source revisions are checked again on confirmation. Collections can be renamed, edited and moved to reversible trash. Permanent deletion requires a separate confirmation from trash.

## Portable JSON backups

Download a version-1 AITab JSON backup from Collections. It contains saved collections (including trash), operation history, safe UI preferences, page flags and local snapshot/history buffers. The server's canonical SQLite data is separate; back up `tab_analysis.db` with SQLite's backup API. Existing Obsidian directory handles cannot be transferred and must be granted again on another extension installation. AI credentials, local API tokens, provider executable paths and server URLs are excluded.

Import first validates and previews a file; confirmation appends data with new stable IDs instead of replacing existing collections. It never opens or closes tabs. Existing flags/preferences take precedence. Script URLs and malformed entries are skipped and counted; unknown schema versions and oversized fields are rejected. Imported operation IDs are isolated from the current browser session, so old live tab IDs cannot target new tabs. Closed-page history can still restore validated URLs through explicit Undo.

Limits: 8 MB input JSON, 200 imported collections, 100 imported operation records, 20,000 saved/history tab entries, 20,000 characters per note. Canonical workspace storage is capped at 7 MB and imported legacy buffers at 2 MB. Previews use session storage, separate from durable workspace data, and expire after five minutes.

## AI assistance

The AI tab reuses the existing analysis workflow on explicit request. It shows topic descriptions and current matching pages, then offers a separate collection preview and save action. Suggestions match exact live URLs and include all current copies. Stale numeric IDs, hallucinated URLs and groups with fewer than two live tabs are ignored. AI prompts JSON-quote page metadata and instruct the provider to treat titles, URLs, group names and excerpts as untrusted data. AI suggestions never initiate closing; duplicate deletion always uses the deterministic review flow.

Manual closes from the regular tab list and guided cleanup also enter the durable operation journal. Explicit manual closing may close a protected tab; automatic cleanup continues to honor protections. AI cleanup checks its original expected URL again before acting. Grouping related pages preserves separate windows by explicitly specifying each group's destination window.

## History and undo

The history shows each tab's actual outcome. Undo restores only successful closes, preserving original windows when still available, pinning, order and groups. Retrying a completed Undo creates no additional tabs. The most recent 50 finished operations are retained; interrupted operations are kept separately. Workspace data is limited to 7 MB to leave room for other extension storage. Storage failure before an action prevents that action.

A browser-session identifier in `chrome.storage.session` distinguishes worker restarts from a full browser restart. On recovery the extension reconciles unfinished actions without repeating side effects. Results that cannot be safely inferred are marked `uncertain` for manual review. Browser API calls and storage writes cannot be one atomic transaction, so an interrupted restore can require manual inspection. URLs/layout can be recovered; arbitrary unsaved page state cannot.

Obsidian exports use a fresh UUID suffix for each version, avoiding collisions across multiple side-panel contexts.

Private/incognito windows are excluded from workspace capture. Existing snapshot, history and Obsidian stores remain compatible. Workspace data has one authority in Chrome local storage; the Python database continues to serve analysis/history and existing snapshots.
