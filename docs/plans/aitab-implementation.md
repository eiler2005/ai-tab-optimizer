# AITab implementation

Approved on 2026-10-18. Each milestone includes regression tests, documentation, a commit and a push.

- [x] 1. Reliability: server boundary, conservative URL matching, truthful cleanup results, session restore, stable exports, test gates.
- [x] 2. Rename: AITab branding and `aitab` directory; preserve existing storage and document migration.
- [x] 3. Offline duplicate review: explicit preview, protected survivors, durable operation journal and recovery.
- [x] 4. Window consolidation: preserve tab order, pinning and Chrome groups; report partial failures and support undo.
- [ ] 5. Saved collections: save before close, merge, restore missing tabs and validated JSON backup/import.
- [ ] 6. AI assistance: explainable suggestions, explicit selection, no model-triggered deletion; final integration checks.

Existing SQLite, Chrome storage keys, IndexedDB names and Obsidian directories remain compatible. New data has versioned schemas. TabMerger code is not incorporated.

Validation covers success, partial failure, stale previews, protected tabs, worker restart, duplicate URLs and backward-compatible snapshots. Browser APIs are tested through a simulated Chrome boundary; manual browser validation is documented separately.
