# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres loosely to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Detailed feature breakdowns by version live in [MVP_FEATURES.md](MVP_FEATURES.md).

## [Unreleased]

### Added
- Documentation polish for public release: `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.env.example`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/IMPROVEMENTS.md`, GitHub issue/PR templates.
- README rewritten for an external audience: tightened hero section, Mermaid architecture diagram, privacy-and-security table, expanded documentation map.

### Changed
- `LICENSE` copyright year bumped to `2025-2026`.

---

## [0.2.1] — Analytics & Focus Mode

### Added
- **Tab Habits Score** — composite score with 4 weighted components (closable %, cleanup frequency, average tab age, count trend). Trend detection vs. 7-day baseline. Surfaced in the AI panel Tab Insights card.
- **Recommendation Tracking** — every Accept / Skip / Change-Action in a cleanup session is logged to the `recommendation_actions` SQLite table, with acceptance rate and per-action breakdown shown in Tab Insights.
- **Activity Heatmap** — 7×24 grid (days × hours) built from `tab_history_events`, with a per-domain filter.
- **Persistent Topic Clusters** — `topic_clusters` table; AI clusters are auto-merged across analyses by case-insensitive name match → 2+ shared tags → otherwise new entry. Saved Clusters section can rename, delete, or focus a cluster.
- **Focus Mode** — focuses Chrome on tabs that match a saved cluster: creates a tab group from matching tabs and collapses everything else; one click to exit.
- **Resumable Analysis** — `analysis_runs` SQLite table stores full run state (pending tabs, per-tab statuses, partial result, metadata). The user can stop a long analysis and resume later with the same fingerprint, surviving extension reloads.
- **Per-tab analysis status** — `TabStatusCoverageCard` shows which open tabs are cached, freshly analyzed, pending, or failed, including pending-tab domains.
- **Search dialog (`/chat`)** — dedicated Search side-panel tab; conversational retrieval over `url_analysis`, `tab_history_events`, and `topic_clusters` via a single UNION ALL query (up to 6 keyword patterns, 20-second LLM timeout). Falls back to SQLite-only ranking if the model is unavailable. Input stays active while a query runs.
- **Refresh buttons** — amber `↻` on Analysis (forces full LLM re-analysis ignoring SQLite cache, with confirmation) and `↻` on Analytics (sends aggregated SQLite analytics to the LLM via `POST /analytics/refresh` and renders an AI Insight card).
- **Suggested next steps** — cards for "finish analysis", "review close candidates", "group cluster", "process reading queue".
- **Theme comparison** — current AI clusters matched against persistent ones by shared tags; loading state prevents false "new theme" flashes before persistent clusters load.
- 4 new request types (`OPEN_URL`, `FOCUS_TAB`, `CHAT_SEARCH`, `REFRESH_ANALYTICS`) on top of the analytics/focus-mode requests added earlier.

### Changed
- AI panel split into Analysis / Analytics sections via `activeSection` state.
- `AIProgressPhase` extended with `stopping` and `stopped` phases; `AIProgress.tabsRemaining` added for resume tracking.
- Recommendation list collapsed by action with per-tab status badges; only `close` recommendations get a destructive button.
- Theme tokenization is now title/path/query/group-aware instead of relying on raw hostnames, so theme-first clustering works across multiple-domain topics.

---

## [0.2] — AI analysis, history, cleanup, advanced exports

### Added
- **FastAPI AI server (`agent.py`)** with CLI provider layer (`claude_code`, `codex_cli`), CORS for the extension, and structured prompt + JSON-schema output.
- **Endpoints** — `/health`, `/analyze`, `/analyze/cancel`, `/stats`, `/history`, `/cache-stats`, `/settings` (GET/POST), `/db-status`, `/runtime-logs`, plus tab-history, snapshot, and analysis-run endpoints.
- **SQLite-backed cache** — per-URL AI analysis cached in `tab_analysis.db` with a 180-day TTL, namespaced by provider/model so settings changes bust the cache correctly.
- **SQLite-backed settings** — extension/server config persisted in `app_settings`.
- **Automatic provider failover** — primary CLI → fallback CLI → heuristic recommendations; per-provider timeouts so a stuck CLI is abandoned.
- **Incremental batch analysis** — service worker sends tabs in batches of 30 and updates the UI after each completed batch; fire-and-forget so 1000+ tabs don't hit the message-channel timeout.
- **Stop/resume with cancel** — `POST /analyze/cancel` kills the CLI subprocess server-side, the extension persists partial state, the user can resume later. 8-second force-stop safety net in the UI.
- **Topic clusters** — AI generates named clusters with descriptions and tags; collapsible UI; export to Obsidian; one-click create Chrome Tab Groups via `chrome.tabs.group()`.
- **Tab Insights dashboard** — top domains, average stats, snapshot trend.
- **LLM call logging** — `llm_call_logs` SQLite table with provider, model, tokens, duration, status; viewer in Settings.
- **AI analytics record management** — URL cache browser, analysis-sessions list, with delete actions.
- **Tab History panel** — events tracked (`opened` / `closed` / `activated`), persisted to SQLite (with local fallback buffer), timeframe filters, search, sort, per-URL stats.
- **Cleanup Session** — pre-cleanup auto-snapshot, step-by-step guided flow, summary screen, Export Cleanup Report to Obsidian.
- **Auto-snapshots** — Chrome Alarms API, configurable 1-24h interval.
- **Content script (`page-extractor.ts`)** — on-demand meta description / H1 / 500-char text excerpt; injected via `chrome.scripting.executeScript`.
- **Advanced Obsidian exports** — `TopicCluster` → `Topics/{slug}.md`, `TabSessionSnapshot` → `Sessions/{date}-{slug}.md`, `CleanupReview` → `Cleanups/{date}-cleanup.md`.
- **Settings additions** — `local_server` provider, server URL + Test Connection, primary/fallback CLI selection, Codex model + optional CLI path overrides, SQLite tools (refresh DB info, sync local data, clear DB, recent runtime logs), auto-snapshot toggle/interval, history retention input.

### Changed
- Manifest bumped to 0.2.0 with `scripting` permission and `http://localhost/*` host permission.
- Vite build now has 4 entry points (added the content script).
- 29 request types and 8 broadcast events; Zustand store gained 3 new slices (history, AI, cleanup).
- 7 views in the side panel (added History, AI Recommendations, Cleanup Session).

---

## [0.1] — MVP

### Added
- Side panel as the primary UI; minimal popup that opens the side panel.
- Tab list across all windows, grouped by window, with title / URL / domain / favicon / pinned / active / Chrome group name; search by title or domain.
- Tab actions — close single, close selected (bulk), pin/unpin, mark important, restore recently closed via `chrome.sessions`.
- Rule-based analysis — exact duplicate URL detection, near-duplicate (same domain + path similarity > 0.8), stale tabs (configurable threshold), domain grouping; badges on each tab.
- Overview stats bar — total / duplicate / stale / important counts and top-5 domains.
- Manual snapshots — create with optional name, snapshot history list, snapshot detail with restore-all/restore-selected/delete; max-snapshot cap with auto-pruning.
- Obsidian export — `LinkNote` to `TabOptimizer/Links/{domain}/{slug}.md` with YAML frontmatter; vault path configurable; File System Access API; dedup guard against re-exporting the same URL.
- Settings — Obsidian vault path, AI provider selection, AI mode (`none` / `local_server`), protected domains, stale-day threshold, max-snapshot count.
- Service worker with message routing (11 request types in v0.1), tab event listeners (`onCreated`, `onRemoved`, `onUpdated`).
- i18n — English + Russian translations.
- Manifest V3 compliance.

[Unreleased]: https://github.com/eiler2005/ai-tab-optimizer/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/eiler2005/ai-tab-optimizer/releases/tag/v0.2.1
[0.2]: https://github.com/eiler2005/ai-tab-optimizer/releases/tag/v0.2.0
[0.1]: https://github.com/eiler2005/ai-tab-optimizer/releases/tag/v0.1.0
