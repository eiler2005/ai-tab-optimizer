# Feature Scope — AI Tab Optimizer

## v0.1 (MVP) — Complete

### Goal
Deliver a working Chrome Extension that solves the core problem: **helping a user with 100+ tabs understand what's open, clean it up safely, and not lose valuable context**.

### Tab Viewing
- [x] List all open tabs across all windows
- [x] Group by window (collapsible)
- [x] Show: title, URL, domain, favicon, pinned state, active state
- [x] Show Chrome tab group name if tab belongs to a group
- [x] Basic search/filter by title or domain

### Tab Management Actions
- [x] Close a single tab from the extension UI
- [x] Close multiple selected tabs (checkbox + bulk close)
- [x] Pin / unpin a tab
- [x] Mark tab as "important" (local flag, persists in storage)
- [x] Restore recently closed tab (using `chrome.sessions` API)

### Rule-Based Analysis (no AI required)
- [x] Detect exact duplicate URLs
- [x] Detect near-duplicate URLs (same domain, similar paths — simple heuristic)
- [x] Flag stale tabs (not accessed in N days, configurable threshold)
- [x] Group tabs by domain
- [x] Show badge on each tab indicating detected issues

### Overview / Stats Bar
- [x] Total tab count
- [x] Number of detected duplicates
- [x] Number of stale tabs
- [x] Number of tabs marked important
- [x] Top 5 domains by tab count

### Snapshots (MVP scope)
- [x] Manual "Save Snapshot" button
- [x] Auto-generate snapshot name from date/time
- [x] Optional user-provided snapshot name
- [x] Store snapshots in server-side SQLite (with local fallback buffer)
- [x] Snapshots History screen (list view)
- [x] Snapshot detail view (list of tabs in the snapshot)
- [x] Restore all tabs from a snapshot (open in new window)
- [x] Restore selected tabs from a snapshot
- [x] Delete a snapshot

### Obsidian Export (MVP scope)
- [x] Export a single tab as a **LinkNote** Markdown file
- [x] LinkNote includes: title, URL, domain, date saved, basic tags
- [x] Vault path configurable in Settings
- [x] File System Access API for writing to vault
- [x] Dedup check (don't export same URL twice without user confirmation)

### Settings Screen
- [x] Obsidian vault path input
- [x] AI provider selection
- [x] AI mode selection (`none` / `local_server`)
- [x] Protected domains list (tabs from these domains are never suggested for closing)
- [x] Stale tab threshold (days, default: 7)
- [x] Max snapshots to keep (default: 30)

### Extension Infrastructure
- [x] Side Panel as primary UI
- [x] Popup (minimal — just opens side panel + shows tab count)
- [x] Service worker with message routing (11 request types in v0.1)
- [x] Zustand state management in side panel
- [x] Chrome tab event listeners (created, removed, updated)
- [x] Manifest V3 compliant
- [x] i18n (English / Russian)

### Definition of Done — v0.1
- [x] Extension loads from `dist/` as unpacked in Chrome 114+
- [x] Side panel opens and lists all current tabs
- [x] Tab close/pin/select actions work from the UI
- [x] Rule-based badges visible on duplicate and stale tabs
- [x] Overview stats bar shows accurate counts
- [x] Manual snapshot can be created, viewed, and restored
- [x] Single-tab Obsidian export writes a valid `.md` file to the vault
- [x] Settings are saved and loaded correctly across sessions
- [x] No tabs are closed without user confirmation

---

## v0.2 — Complete

### Goal
Add AI-powered analysis, tab browsing history, guided cleanup, and advanced Obsidian exports. AI runs through a local Python server using subscribed local CLIs (Claude Code CLI and Codex CLI), so no separate API billing is required.

### Tab History
- [x] Track tab events: opened, closed, activated
- [x] In-memory tab info cache for `onRemoved` (tab data unavailable after close)
- [x] Store events in server-side SQLite (with local fallback buffer under `tabHistory`)
- [x] History panel with timeframe filters (day / week / month)
- [x] Search history by title / domain
- [x] Sort by recent or visit count
- [x] Per-URL stats: activation count, first/last seen, last opened time, still open badge
- [x] Daily cleanup alarm to prune old entries
- [x] Configurable retention period (default: 30 days)

### AI Analysis (via Local Server)
- [x] FastAPI server (`agent.py`) with CLI provider layer (`claude_code`, `codex_cli`)
- [x] `POST /analyze` — accepts tab list, returns `AIAnalysisResult` + metadata + cache stats JSON (`tabsFromCache`, `tabsAnalyzed`, `tabsSaved`)
- [x] `GET /health` — connection test
- [x] `GET /stats` — cumulative analysis statistics (total cost, tokens, duration)
- [x] `GET /history` — last 50 analyses with metadata
- [x] `GET /cache-stats` — SQLite cache diagnostics
- [x] `GET /settings` / `POST /settings` — persist provider/model/settings in SQLite
- [x] CORS enabled for Chrome extension
- [x] Structured prompt: system instructions + compact tab list + JSON output schema
- [x] Server-side logging: tab count, cache hits/misses, duration, tokens, cost per request
- [x] Service worker proxies requests to localhost:8765
- [x] SQLite per-URL analysis cache in `tab_analysis.db` with 7-day TTL
- [x] SQLite-backed settings in `app_settings`
- [x] Automatic provider failover from primary CLI to fallback CLI
- [x] Provider timeouts so a stuck CLI can fail over and the batch can finish via another model
- [x] Incremental batch analysis: service worker processes tabs in batches of 30 and updates UI after each batch
- [x] Fire-and-forget message pattern: no message channel timeout on 1000+ tabs
- [x] Force refresh option to bypass server-side URL cache
- [x] AI result + metadata cached in `chrome.storage.local`
- [x] Broadcast events: `AI_ANALYSIS_COMPLETE`, `AI_ANALYSIS_ERROR`, `AI_ANALYSIS_PROGRESS`, `AI_ANALYSIS_PARTIAL`

### AI Recommendations Panel
- [x] "Analyze Tabs" button triggers analysis
- [x] Progress UI: phase indicator, progress bar, elapsed timer, processed/cached/saved/total counts, current batch
- [x] Runtime provider status: current CLI/model, configured chain, failover/errors for the current run
- [x] 5 progress phases: preparing → sending → analyzing → persisting → processing
- [x] Metadata bar: duration, input/output tokens, cost, "From cache" badge
- [x] "Re-analyze" button to force refresh (bypass all caches)
- [x] "Stop analysis" button aborts the in-flight request and sends `POST /analyze/cancel` to kill CLI subprocess server-side (8s force-stop safety net in UI)
- [x] Intermediate AI recommendations appear after each completed batch
- [x] Last analysis timestamp ("5m ago")
- [x] Loading spinner + error state with retry
- [x] Session summary and stats (estimated closable, main themes)
- [x] Per-tab recommendations grouped by action (keep/close/group/archive/read_later)
- [x] Each recommendation shows: favicon, title, domain, action badge, confidence, reason
- [x] Accept button per recommendation (executes action)

### Topic Clusters
- [x] AI generates topic clusters (name, description, tab IDs, tags)
- [x] Collapsible cluster list in AI panel
- [x] Expand to see individual tabs
- [x] "Export to Obsidian" button per cluster

### Cleanup Session
- [x] Pre-cleanup auto-snapshot (trigger: `pre-cleanup`)
- [x] Step-by-step guided flow (one recommendation at a time)
- [x] Step indicator + progress bar
- [x] Buttons: Accept, Skip, Change Action (alternative actions)
- [x] Completion screen with summary (closed, grouped, saved, skipped)
- [x] "Export Cleanup Report" button

### Content Script
- [x] On-demand page extraction (`page-extractor.ts`)
- [x] Extracts: meta description, first H1, text excerpt (500 chars)
- [x] Injected via `chrome.scripting.executeScript`
- [x] Vite builds as 4th entry point

### Auto-Snapshots
- [x] Chrome Alarms API (`auto-snapshot` alarm)
- [x] Configurable interval (1–24 hours)
- [x] Enable/disable toggle in Settings
- [x] Snapshot trigger type: `manual` | `auto` | `pre-cleanup`
- [x] Alarms reconfigured on settings change

### Advanced Obsidian Exports
- [x] **TopicCluster** → `TabOptimizer/Topics/{topic-slug}.md`
  - Frontmatter: topic, tags, aiSummary, linkCount
  - Links table, notes section
- [x] **TabSessionSnapshot** → `TabOptimizer/Sessions/{date}-{name-slug}.md`
  - Frontmatter: snapshotId, name, trigger, totalTabs, topDomains
  - AI summary, top domains, per-window tab tables
- [x] **CleanupReview** → `TabOptimizer/Cleanups/{date}-cleanup.md`
  - Frontmatter: before/after stats, tags
  - Closed tabs table, saved tabs table, grouped tabs table
- [x] Export buttons in: AIRecommendations, CleanupSession, SnapshotDetail

### Settings (v0.2 additions)
- [x] AI provider: `local_server` option (with `none` as the only other visible mode)
- [x] Local server URL input (default: `http://localhost:8765`)
- [x] "Test Connection" button with status indicator
- [x] Primary/fallback CLI provider selection for the local server
- [x] Codex model input + optional CLI path overrides
- [x] Settings persisted to server-side SQLite with local mirror in `chrome.storage.local`
- [x] SQLite tools in Settings: refresh DB info (`GET_SERVER_DB_STATUS`), sync local data (`SYNC_SERVER_PERSISTENCE`), clear server-side DB (`CLEAR_SERVER_DB`), recent runtime logs (`GET_SERVER_RUNTIME_LOGS`)
- [x] Auto-snapshot toggle + interval input
- [x] History retention days input (7–90)

### Smart Tab Groups
- [x] `GROUP_TABS_BY_CLUSTER` message type to create Chrome Tab Groups from AI topic clusters
- [x] `chrome.tabs.group()` integration in service worker
- [x] "Group Tabs" button in topic cluster section of AI Recommendations panel

### Tab Insights Dashboard
- [x] `GET /insights` server endpoint with top domains, average stats, snapshot trend
- [x] `GET_TAB_INSIGHTS` message type
- [x] Insights section in AIRecommendations panel

### LLM Call Logging
- [x] `llm_call_logs` SQLite table for per-call details (provider, model, tokens, duration, status)
- [x] Instrumented `analyze_batch_via_provider` in `agent.py`
- [x] `GET /llm-call-logs` server endpoint
- [x] `GET_LLM_CALL_LOGS` message type
- [x] LLM call logs viewer in SettingsView

### AI Analytics Record Management
- [x] `GET /cache/urls` and `DELETE /cache/urls` server endpoints for URL cache browsing
- [x] `GET /sessions` and `DELETE /sessions/{id}` server endpoints for analysis sessions
- [x] `GET_URL_CACHE_LIST`, `DELETE_URL_CACHE`, `GET_ANALYSIS_SESSIONS`, `DELETE_ANALYSIS_SESSION` message types
- [x] URL cache browser and analysis sessions list in SettingsView

### Richer AI Summary UI
- [x] Action breakdown pills in AI summary section
- [x] Model display during and after analysis
- [x] Yellow banner after stopping analysis with partial results review

### Extension Infrastructure (v0.2 additions)
- [x] 29 request types (18 new: `GET_SERVER_DB_STATUS`, `GET_SERVER_RUNTIME_LOGS`, `SYNC_SERVER_PERSISTENCE`, `CLEAR_SERVER_DB`, `GET_TAB_HISTORY`, `ANALYZE_TABS`, `STOP_AI_ANALYSIS`, `GET_AI_RESULT`, `EXTRACT_PAGE`, `START_CLEANUP_SESSION`, `APPLY_CLEANUP_ACTION`, `GET_LLM_CALL_LOGS`, `GET_URL_CACHE_LIST`, `DELETE_URL_CACHE`, `GET_ANALYSIS_SESSIONS`, `DELETE_ANALYSIS_SESSION`, `GROUP_TABS_BY_CLUSTER`, `GET_TAB_INSIGHTS`) + 8 broadcast events (6 new)
- [x] Zustand store: 3 new state slices (history, AI, cleanup)
- [x] 7 views (3 new: history, ai-recommendations, cleanup-session)
- [x] Navigation: 5 tabs (History and AI added)
- [x] Vite: 4 entry points (content script added)
- [x] Manifest v0.2.0: `scripting` permission, `http://localhost/*` host permission

### Definition of Done — v0.2
- [x] Tab history records events and displays stats with filters
- [x] AI analysis returns recommendations via local server
- [x] Cleanup session guided flow completes end-to-end
- [x] Topic clusters display and export to Obsidian
- [x] Auto-snapshots create on schedule when enabled
- [x] Content script extracts page metadata
- [x] All 3 new Obsidian export types write valid Markdown
- [x] Settings persist and affect behavior (server URL, auto-snapshots, retention)
- [x] Build passes: `pnpm typecheck && pnpm build`

---

## v0.2.1 — Analytics & Focus Mode — Complete

### Goal
Deeper analytics to surface tab management habits, persistent knowledge from AI analysis, and focus tools to reduce mental overhead.

### Tab Habits Score
- [x] `GET /habits-score` server endpoint with 4-component weighted scoring
- [x] Components: closable % (30), cleanup frequency (20), avg tab age (25), tab count trend (25)
- [x] Trend detection: improving / stable / declining vs 7 days ago
- [x] `GET_HABITS_SCORE` message type
- [x] Habits Score card in AI panel Tab Insights (circular score, color, trend arrow, component bars)

### Recommendation Tracking
- [x] `recommendation_actions` SQLite table (url, title, ai action, user action, confidence)
- [x] `POST /recommendation-actions` and `GET /recommendation-stats` server endpoints
- [x] `TRACK_RECOMMENDATION` and `GET_RECOMMENDATION_STATS` message types
- [x] Instrumented CleanupSession: Accept → accepted, Skip → skipped, Alt → modified
- [x] Recommendation stats card in Tab Insights (acceptance rate, per-action breakdown, confidence correlation)

### Activity Heatmap
- [x] `GET /activity-heatmap` server endpoint (7×24 grid from tab_history_events)
- [x] `GET_ACTIVITY_HEATMAP` message type with domain filter
- [x] CSS heatmap in Tab Insights (HSL color interpolation, day/hour labels, domain dropdown)

### Persistent Topic Clusters
- [x] `topic_clusters` SQLite table (name, description, tags, URLs, timestamps)
- [x] `GET /clusters`, `POST /clusters/merge`, `PUT /clusters/{id}`, `DELETE /clusters/{id}` server endpoints
- [x] Merge strategy: case-insensitive name match → tag overlap (2+) → create new
- [x] `GET_PERSISTENT_CLUSTERS`, `MERGE_AI_CLUSTERS`, `RENAME_CLUSTER`, `DELETE_CLUSTER` message types
- [x] Auto-merge on AI analysis complete (convert tabIds → URLs, fire-and-forget merge)
- [x] Saved Clusters section in AI panel (collapsible, rename, delete, tags)
- [x] Theme-first clustering and comparison: topic tokens come from title/path/query/group context, not raw hostnames

### Focus Mode
- [x] `FOCUS_ON_CLUSTER`, `EXIT_FOCUS_MODE`, `GET_CLUSTER_TAB_MATCHES` message types
- [x] Service worker: match open tab URLs against persistent cluster URLs
- [x] Focus: create Chrome tab group, collapse other groups
- [x] Exit: ungroup tabs, uncollapse all groups
- [x] Zustand store: `focusClusterId`, `focusClusterName`, `focusMatchedTabIds`
- [x] Focus button in Saved Clusters section
- [x] Dismissible focus mode banner at top of AI panel

### Resumable Analysis & Per-Tab Status
- [x] `analysis_runs` SQLite table for full analysis state persistence (pending tabs, per-tab statuses, result, metadata)
- [x] `POST/PUT/GET /analysis-runs` server endpoints for state snapshots
- [x] `POST /tab-analysis-status` server endpoint for per-tab SQLite-backed coverage
- [x] `GET_TAB_ANALYSIS_STATUS` message type
- [x] `ANALYZE_TABS` extended with `resume?: boolean` parameter
- [x] Stop/resume workflow: snapshot state on stop, restore from latest run on resume
- [x] Per-tab `TabAnalysisStatus` with state (pending/cached/analyzed/failed) and source (database/provider/heuristic)
- [x] `TabStatusCoverageCard` in AI panel showing coverage gaps with pending tab domains
- [x] `AIProgressPhase` extended with `stopping` and `stopped` phases
- [x] `AIProgress.tabsRemaining` field for resume tracking
- [x] Zustand store: `aiResumeAvailable`, `aiRunId`, `aiTabStatuses`, `aiStatusSummary`, `resumeAIAnalysis()`, `loadAITabStatuses()`

### Enhanced AI Panel UI
- [x] Analysis/Analytics section toggle (`activeSection: 'analysis' | 'analytics'`)
- [x] Refresh (↻) button on Analysis header — amber-styled, shows confirmation dialog before calling `analyzeTabs(true)` to force full LLM re-analysis ignoring SQLite URL cache
- [x] Refresh (↻) button on Analytics section — sends aggregated SQLite data to LLM via `POST /analytics/refresh`, displays AI Insight card (browsing patterns, suggestions, cluster insights, habits commentary) + refreshes raw analytics, with `analyticsRefreshing` loading indicator
- [x] `AnalyticsSnapshotCard` — compact metrics summary (top theme, health score, sessions, acceptance rate)
- [x] `SuggestedNextSteps` — actionable cards (finish analysis, review close candidates, group cluster, process reading queue)
- [x] `ThemeComparisonCard` — matches current AI topic clusters against persistent clusters by shared tags
- [x] `RecommendationList` — collapsible sections grouped by action type with per-tab status badges
- [x] `openOrFocusTab()` — click any tab to switch to it or open it
- [x] Yellow banner with resume button after stopping analysis with partial results
- [x] Only `close` recommendations render a destructive close button; non-close rows stay non-destructive
- [x] Theme comparison loading/empty states prevent false “new theme” flashes before persistent clusters load

### SQLite-backed Search Dialog
- [x] Dedicated `Search` side-panel tab with conversational UI
- [x] `POST /chat` server endpoint for SQLite-backed dialog search (20s LLM timeout, up to 6 keyword patterns)
- [x] Search retrieval sources: `url_analysis`, `tab_history_events`, `topic_clusters` (consolidated UNION ALL query)
- [x] Search uses the same provider chain/model from Settings as AI Analysis
- [x] Search request includes recent conversation history + previous result URLs for lightweight RAG context
- [x] Fallback to SQLite-only ranking when the model is disabled/unavailable
- [x] Answer text + ranked URLs + follow-up suggestions in the UI
- [x] Result cards can focus existing tabs, open URLs, or close matching open tabs
- [x] Search input stays active while query is processing — user can type next query without waiting

### Extension Infrastructure (v0.2.1 additions)
- [x] 44 request types (adds `OPEN_URL`, `FOCUS_TAB`, `CHAT_SEARCH` on top of the earlier analytics/focus-mode requests)
- [x] 3 new SQLite tables (`recommendation_actions`, `topic_clusters`, `analysis_runs`)
- [x] Zustand store: focus mode slice, resume state, per-tab analysis status, search dialog state
- [x] 50+ new i18n keys (habits, recommendations, heatmap, persistent clusters, focus mode, per-tab status, next steps, theme comparison, analytics snapshot, search dialog)

---

## Not Yet Implemented (v0.3+)

### Additional AI Providers (v0.3)
- Provider health/status endpoint and UI
- More local CLI adapters beyond Claude Code CLI and Codex CLI
- Local-model integration path for self-hosted tooling
- Richer provider selection/ordering UX

### Advanced Tab Management (v0.3)
- Drag and drop tab reordering

### Snapshot Features (v0.3)
- Snapshot comparison view (diff two snapshots)
- Search across snapshot history
- Snapshot tagging / labels

### Additional Obsidian Entities (v0.3)
- ReadingList (append-only rolling list)
- WorkContext (named tab collection for a project)

### Polish (v1.0)
- Onboarding flow
- Keyboard shortcuts
- Options page (standalone)
- Chrome Web Store packaging

### Future (v2.0)
- Broader local-model ecosystem support
- Cross-device snapshot sync
- Obsidian plugin (read-back dashboard)

---

## Rule-Based vs AI-Powered Features

### Rule-Based (v0.1, no AI)

| Feature | Rule |
|---|---|
| Exact duplicates | String equality on normalized URL |
| Near duplicates | Same domain + path similarity scoring (>0.8 threshold) |
| Stale tabs | `lastAccessed` timestamp > N days ago |
| Domain grouping | Extract hostname from URL |
| Protected tabs | Check domain against user's protected list |
| Tab count stats | Count + group operations |
| Pinned tab detection | `tab.pinned === true` |

### AI-Powered (v0.2, via local server)

| Feature | Why AI |
|---|---|
| Topic cluster detection | Requires semantic understanding of titles/content |
| Tab utility scoring | Subjective, context-dependent |
| Session summary | Requires synthesis across many tabs |
| Cleanup recommendations with reasons | Requires reasoning about relevance |
| Confidence scoring | Probabilistic assessment |
