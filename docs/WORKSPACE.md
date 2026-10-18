# Offline workspace

## Duplicate review

Open **Cleanup**, choose all normal windows or one window, and click **Find duplicates**. Exact groups compare full HTTP(S) URLs. Tracking variants only strip a small list of known analytics parameters; fragments, `ref`, `source`, path case and trailing slashes remain meaningful.

The radio button chooses the surviving copy; checkboxes choose copies to close. Protected/important, pinned, active, audible and protected-domain tabs are excluded from automatic closing. Tracking variants start unselected. A preview expires after five minutes; execution rechecks each URL, window/group, survivor and current protection. Changed or missing targets are skipped. Selecting a survivor for deletion is rejected.

All workspace actions run in the service worker through a serialized queue. No AI server or network request is needed. Before each close, the operation and original tab metadata are persisted to `chrome.storage.local` under `aitab.workspace.v1` (version 1). Repeating a preview execution returns its existing operation, preventing repeated closes.

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

## History and undo

The history shows each tab's actual outcome. Undo restores only successful closes, preserving original windows when still available, pinning, order and groups. Retrying a completed Undo creates no additional tabs. The most recent 50 finished operations are retained; interrupted operations are kept separately. Workspace data is limited to 7 MB to leave room for other extension storage. Storage failure before an action prevents that action.

A browser-session identifier in `chrome.storage.session` distinguishes worker restarts from a full browser restart. On recovery the extension reconciles unfinished actions without repeating side effects. Results that cannot be safely inferred are marked `uncertain` for manual review. Browser API calls and storage writes cannot be one atomic transaction, so an interrupted restore can require manual inspection. URLs/layout can be recovered; arbitrary unsaved page state cannot.

Private/incognito windows are excluded from workspace capture. Existing snapshot, history and Obsidian stores remain compatible. Workspace data has one authority in Chrome local storage; the Python database continues to serve analysis/history and existing snapshots.
