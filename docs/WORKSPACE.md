# Offline workspace

## Duplicate review

Open **Cleanup**, choose all normal windows or one window, and click **Find duplicates**. Exact groups compare full HTTP(S) URLs. Tracking variants only strip a small list of known analytics parameters; fragments, `ref`, `source`, path case and trailing slashes remain meaningful.

The radio button chooses the surviving copy; checkboxes choose copies to close. Protected/important, pinned, active, audible and protected-domain tabs are excluded from automatic closing. Tracking variants start unselected. A preview expires after five minutes; execution rechecks each URL, window/group, survivor and current protection. Changed or missing targets are skipped. Selecting a survivor for deletion is rejected.

All workspace actions run in the service worker through a serialized queue. No AI server or network request is needed. Before each close, the operation and original tab metadata are persisted to `chrome.storage.local` under `aitab.workspace.v1` (version 1). Repeating a preview execution returns its existing operation, preventing repeated closes.

## History and undo

The history shows each tab's actual outcome. Undo restores only successful closes, preserving original windows when still available, pinning, order and groups. Retrying a completed Undo creates no additional tabs. The most recent 50 finished operations are retained; interrupted operations are kept separately. Workspace data is limited to 7 MB to leave room for other extension storage. Storage failure before an action prevents that action.

A browser-session identifier in `chrome.storage.session` distinguishes worker restarts from a full browser restart. On recovery the extension reconciles unfinished actions without repeating side effects. Results that cannot be safely inferred are marked `uncertain` for manual review. Browser API calls and storage writes cannot be one atomic transaction, so an interrupted restore can require manual inspection. URLs/layout can be recovered; arbitrary unsaved page state cannot.

Private/incognito windows are excluded from workspace capture. Existing snapshot, history and Obsidian stores remain compatible. Workspace data has one authority in Chrome local storage; the Python database continues to serve analysis/history and existing snapshots.
