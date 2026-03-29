# AI Tab Optimizer — Claude Code Guide

## Strict Rules

- Never use the `any` type. Use `unknown` with type narrowing instead.
- Do not add comments or JSDoc unless the logic is non-obvious. Never restate what the code already says.
- Run `cd extension && pnpm typecheck` after every significant change. Do not continue if there are type errors.
- When working from a plan file: do not stop until all tasks are completed. Mark each completed task as `- [x]` in the plan file.
- Follow existing patterns in the codebase: Zustand store actions, discriminated unions for messages, Tailwind utility classes, `@shared/*` imports.
- Do not create new abstractions, helpers, or utilities unless there are 3+ use sites.
- After implementing features, always update all project documentation to match the code.

## Workflow

Every non-trivial feature follows three phases:

### 1. Research
Read all relevant source files and project docs. Write findings to `docs/research/<topic-slug>.md` using the template in `docs/templates/research.md`. Use command: `/research <topic>`.

### 2. Plan
Create an implementation plan in `docs/plans/<feature-slug>.md` using the template in `docs/templates/plan.md`. Include file paths, code snippets, task checklist, trade-offs. Do NOT write code until the plan is reviewed and approved. Use command: `/plan <feature>`.

### 3. Implement
Execute the approved plan task by task. After each task: run typecheck, mark task done in the plan file. Do not stop until all tasks are completed. Use command: `/implement <path-to-plan>`.

## Reference Docs

Read these before working on a feature:
- `PROJECT.md` — full product spec, architecture, data model, AI pipeline
- `MVP_FEATURES.md` — what's in/out of scope per version
- `OBSIDIAN_INTEGRATION.md` — vault export entity types, templates, folder structure
- `SETUP.md` — dev environment, testing, Chrome loading, AI server setup

## Project Overview

Chrome Extension (Manifest V3) for intelligent tab management with AI analysis and Obsidian integration. React side panel UI, Zustand state management, Vite build system. AI analysis runs through a local Python server that can use Claude Code CLI and Codex CLI with automatic failover.

## Quick Reference

- **Docs:** PROJECT.md (full spec), MVP_FEATURES.md (scope), SETUP.md (dev guide), OBSIDIAN_INTEGRATION.md (vault export)
- **Extension source:** extension/src/
- **Build output:** extension/dist/
- **AI server:** agent.py (FastAPI on localhost:8765)

## Build & Run

```bash
# Extension
cd extension
pnpm install          # install deps
pnpm dev              # watch mode (outputs to dist/)
pnpm build            # production build (typecheck + vite build)
pnpm typecheck        # TypeScript check only

# AI Server
.venv/bin/pip install -r requirements.txt
pnpm server           # starts FastAPI server on localhost:8765
```

Load in Chrome: chrome://extensions → Developer mode → Load unpacked → select `extension/dist/`

## Project Structure

```
firstai_agentproj/
├── CLAUDE.md                    # This file
├── PROJECT.md                   # Full product spec & architecture
├── MVP_FEATURES.md              # Scope definition per version
├── SETUP.md                     # Development setup guide
├── OBSIDIAN_INTEGRATION.md      # Obsidian export spec
├── package.json                 # Root workspace scripts (build, dev, server, typecheck, health)
├── agent.py                     # FastAPI AI server (Claude Code CLI + Codex CLI)
├── requirements.txt             # Python deps (fastapi, uvicorn, claude-agent-sdk, aiosqlite)
├── docs/
│   ├── templates/               # research.md and plan.md templates
│   ├── research/                # Research documents
│   └── plans/                   # Implementation plans
└── extension/                   # Chrome Extension
    ├── src/
    │   ├── background/          # Service worker (Chrome API bridge, AI proxy, history logging)
    │   │   └── service-worker.ts
    │   ├── side-panel/          # React app (primary UI)
    │   │   ├── components/      # React components (see below)
    │   │   ├── store.ts         # Zustand store (tabs, history, AI, cleanup, snapshots, search)
    │   │   ├── App.tsx          # Root component (view routing)
    │   │   └── main.tsx         # Entry point
    │   ├── popup/               # Minimal popup (opens side panel)
    │   ├── content/             # Content scripts (on-demand injection)
    │   │   └── page-extractor.ts
    │   ├── shared/
    │   │   ├── types/           # TypeScript interfaces
    │   │   │   ├── tab.ts       # TabRecord, RuleFlags, WindowGroup
    │   │   │   ├── snapshot.ts  # SnapshotRecord, WindowSnapshot, TabSnapshot
    │   │   │   ├── messages.ts  # MessageRequest union, UserSettings, BroadcastEvent
    │   │   │   ├── ai.ts        # AIAnalysisResult, TabRecommendation, TopicCluster, CleanupReviewData, LLMCallLogEntry, UrlCacheEntry, AnalysisSessionEntry, TabInsights
    │   │   │   ├── history.ts   # TabHistoryEntry, TabHistoryStats, HistoryTimeframe
    │   │   │   └── index.ts     # Re-exports
    │   │   ├── utils/           # Utility functions
    │   │   │   ├── url.ts       # extractDomain, normalizeUrl, slugify
    │   │   │   ├── rules.ts     # Rule engine (duplicates, stale, domain grouping)
    │   │   │   └── obsidian.ts  # Vault access, LinkNote/TopicCluster/Session/Cleanup exports
    │   │   └── i18n/            # Internationalization (en/ru)
    │   └── styles.css           # Tailwind entry
    ├── public/
    │   └── manifest.json        # MV3 manifest (v0.2.0)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts            # 4 entry points: side-panel, popup, service-worker, content script
    ├── tailwind.config.js
    └── postcss.config.js
```

### Side Panel Components

| Component | File | Purpose |
|---|---|---|
| Header | `Header.tsx` | Navigation bar (Tabs, History, AI, Search, Snapshots, Settings) |
| StatsBar | `StatsBar.tsx` | Live stats, top domains, search input |
| TabList | `TabList.tsx` | Main tab listing with filters and window grouping |
| TabItem | `TabItem.tsx` | Single tab row with badges, quick actions, Obsidian export |
| BulkActions | `BulkActions.tsx` | Multi-select toolbar (select all, close selected) |
| HistoryPanel | `HistoryPanel.tsx` | Tab browsing history (day/week/month), search, sort |
| AIRecommendations | `AIRecommendations.tsx` | AI analysis results, per-tab recommendations, topic clusters, Smart Tab Groups button, Tab Insights dashboard |
| ChatSearch | `ChatSearch.tsx` | SQLite-backed conversational tab search using the same provider chain as AI analysis |
| CleanupSession | `CleanupSession.tsx` | Step-by-step guided cleanup flow |
| SnapshotsList | `SnapshotsList.tsx` | Snapshot history with manual create |
| SnapshotDetail | `SnapshotDetail.tsx` | Snapshot preview, restore, Obsidian export |
| SettingsView | `SettingsView.tsx` | All settings (language, AI server, auto-snapshots, protected domains, Obsidian), LLM call logs viewer, URL cache browser, analysis sessions list |
| RecentlyClosed | `RecentlyClosed.tsx` | Recently closed tabs recovery |

## Architecture

### Component Communication
```
Side Panel (React/Zustand) ←→ Service Worker ←→ Chrome APIs (tabs, tabGroups, sessions, storage, alarms)
                                    ↕                        ↕
                            Content Scripts          Local AI Server
                            (on-demand)              (localhost:8765)
```

All communication uses `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. Message types are a discriminated union in `shared/types/messages.ts`.

### Message Types (45 requests + 8 broadcasts)

**Requests (Side Panel → Service Worker):**
GET_ALL_TABS, CLOSE_TABS, PIN_TAB, SET_USER_FLAG, CREATE_SNAPSHOT, GET_SNAPSHOTS, GET_SNAPSHOT, DELETE_SNAPSHOT, RESTORE_SNAPSHOT, GET_SETTINGS, SAVE_SETTINGS, GET_SERVER_DB_STATUS, GET_SERVER_RUNTIME_LOGS, SYNC_SERVER_PERSISTENCE, CLEAR_SERVER_DB, GET_TAB_HISTORY, GET_TAB_ANALYSIS_STATUS, ANALYZE_TABS, STOP_AI_ANALYSIS, GET_AI_RESULT, EXTRACT_PAGE, START_CLEANUP_SESSION, APPLY_CLEANUP_ACTION, GET_LLM_CALL_LOGS, GET_URL_CACHE_LIST, DELETE_URL_CACHE, GET_ANALYSIS_SESSIONS, DELETE_ANALYSIS_SESSION, GROUP_TABS_BY_CLUSTER, GET_TAB_INSIGHTS, GET_HABITS_SCORE, TRACK_RECOMMENDATION, GET_RECOMMENDATION_STATS, GET_ACTIVITY_HEATMAP, GET_PERSISTENT_CLUSTERS, MERGE_AI_CLUSTERS, RENAME_CLUSTER, DELETE_CLUSTER, FOCUS_ON_CLUSTER, EXIT_FOCUS_MODE, GET_CLUSTER_TAB_MATCHES, OPEN_URL, FOCUS_TAB, CHAT_SEARCH, REFRESH_ANALYTICS

**Broadcasts (Service Worker → Side Panel, 8 total):**
TABS_UPDATED, SNAPSHOT_CREATED, AI_ANALYSIS_COMPLETE, AI_ANALYSIS_ERROR, AI_ANALYSIS_CANCELED, AI_ANALYSIS_PROGRESS, AI_ANALYSIS_PARTIAL, HISTORY_UPDATED

### Core Modules
- **TabsModule** — tab CRUD via Chrome APIs, tab info cache for history
- **SnapshotsModule** — create/store/restore session snapshots (manual + auto via Chrome Alarms), persisted to server-side SQLite
- **AIModule** — proxy requests to local FastAPI server; server owns SQLite URL cache, persisted app settings, and provider failover, while the extension keeps `lastAIResult` fallback
- **HistoryModule** — log tab events (opened/closed/activated), compute stats, cleanup old entries; persisted to server-side SQLite
- **SearchModule** — conversational retrieval over SQLite-backed AI results, history, and persistent clusters using the configured provider chain
- **ObsidianModule** — render Markdown, write to vault via File System Access API (LinkNote, TopicCluster, SessionSnapshot, CleanupReview)
- **RuleEngine** — deterministic analysis (exact/near duplicates, stale tabs, domain grouping)
- **ContentScript** — on-demand page extraction (meta description, H1, text excerpt)
- **StateModule** — Zustand store with slices: tabs, history, AI (incl. resume + per-tab status), cleanup, snapshots, focus mode, search dialog

### Key Types (defined in shared/types/)
- `TabRecord` — normalized tab with derived fields (ruleFlags, userFlag)
- `SnapshotRecord` — saved session state with trigger type (manual/auto/pre-cleanup)
- `AIAnalysisResult` — summary, topicClusters, tabRecommendations, sessionStats (with actionBreakdown)
- `AIAnalysisMetadata` — durationMs, durationApiMs, tokens, cost, providerUsed, modelUsed, providerAttempts, providerStatus
- `AIProgress` — phase, tabsTotal, tabsCached, tabsNew, tabsProcessed, tabsRemaining, tabsSaved, batchesTotal, batchesCompleted, currentBatch, startedAt, providerStatus
- `AIProgressPhase` — `'preparing' | 'sending' | 'analyzing' | 'persisting' | 'processing' | 'stopping' | 'stopped'`
- `AIProviderId` — `'claude_code' | 'codex_cli'`
- `AIProviderAttempt` — provider call result (provider, model, status, error)
- `AIProviderRuntimeStatus` — current provider chain state (primary, fallback, attempts, errors)
- `TabAnalysisStatus` — per-tab analysis state (tabId, url, status, source, action, confidence, analyzedAt, provider, model)
- `TabAnalysisStatusSummary` — count breakdown (total, cached, analyzed, pending, failed)
- `ServerDbStatus` — database statistics (table counts incl. analysisRuns, DB size, timestamps)
- `ServerRuntimeLogEntry` — runtime log entry (level, category, message)
- `CachedAIResult` — result + metadata + fingerprint for aggregated fallback cache
- `TabRecommendation` — tabId, action (keep/group/read_later/archive/close), confidence, reason
- `TopicCluster` — name, tabIds, description, tags
- `PersistentCluster` — id, name, description, tags, tabUrls, createdAt, updatedAt
- `ChatSearchResult` / `ChatMessage` / `ChatHistoryMessage` — SQLite-backed dialog search results, conversation turns, and lightweight RAG history payload
- `HabitsScore` / `HabitsScoreComponent` — composite tab health score with weighted components and trend
- `RecommendationAction` / `RecommendationActionStats` — cleanup action tracking and aggregated stats
- `ActivityHeatmapData` — 7×24 grid of tab activity events with domain list
- `TabHistoryEntry` / `TabHistoryStats` — tab event tracking and aggregated statistics
- `CleanupReviewData` — cleanup session report for Obsidian export
- `RuleFlags` — rule engine output per tab
- `UserSettings` — extension configuration (AI provider, server URL, auto-snapshots, history retention, etc.)
- `LLMCallLogEntry` — individual LLM API call record (provider, model, tokens, duration, status)
- `UrlCacheEntry` — cached per-URL AI analysis entry (url, action, confidence, analyzedAt, provider, model)
- `AnalysisSessionEntry` — analysis session record (tabCount, tabsFromCache, tabsAnalyzed, duration, cost, tokens)
- `TabInsights` — tab insights dashboard data (topDomains, avgAnalysisStats, snapshotTrend)
- `AnalyticsInsight` — LLM-generated analytics commentary (browsingPatterns, suggestions, clusterInsights, habitsCommentary, providerUsed, modelUsed, refreshedAt)

### Views (7 total)
`tabs` | `history` | `ai-recommendations` | `cleanup-session` | `snapshots` | `snapshot-detail` | `settings`

## Storage Keys (chrome.storage.local)

| Key | Type | Purpose |
|---|---|---|
| `settings` | `UserSettings` | Local mirror of server-backed settings from SQLite |
| `snapshots` | `SnapshotRecord[]` | Temporary offline buffer before snapshots sync to server SQLite |
| `userFlags` | `Record<number, string>` | Tab flags (important, read_later, protected) |
| `exportedUrls` | `string[]` | URLs exported to Obsidian (dedup guard) |
| `tabHistory` | `TabHistoryEntry[]` | Temporary offline buffer before history events sync to server SQLite |
| `lastAIResult` | `CachedAIResult` | Cached aggregated AI analysis with fingerprint + metadata |

## Coding Conventions

### TypeScript
- Strict mode enabled
- Path alias: `@shared/*` → `src/shared/*`
- Use discriminated unions for message types
- Interfaces over type aliases for data shapes
- No `any` — use `unknown` and narrow

### React / UI
- Functional components only
- Zustand for global state (no prop drilling for shared state)
- Tailwind CSS for styling (no CSS modules)
- `clsx` for conditional class names
- Components in `side-panel/components/`

### Chrome Extension
- All server calls (AI server, settings, snapshots, history) go through the service worker, not the side panel (CSP)
- Tab events handled in service worker, forwarded via messages
- CLI selection and server settings persist in SQLite on the local server, with a local mirror in `chrome.storage.local`
- Content scripts injected on-demand only

### File Naming
- Components: PascalCase (`TabItem.tsx`)
- Utils/modules: camelCase (`url.ts`, `rules.ts`)
- Types: camelCase files, PascalCase interfaces

## Current State (v0.2)

### v0.1 (Complete)
- Extension scaffold: side panel, popup, service worker, vite build (3 entry points)
- Type definitions: tab, snapshot, messages
- Components: TabList, TabItem, Header, StatsBar, BulkActions, RecentlyClosed, SnapshotsList, SnapshotDetail, SettingsView
- Zustand store, URL utils, rule engine (exact/near duplicates, stale detection), i18n (en/ru)
- Manual snapshots (create/restore/delete)
- Obsidian LinkNote export via File System Access API
- Tailwind CSS setup

### v0.2 (Complete)
- Tab History panel: event logging (opened/closed/activated), stats view with timeframe filters, search, sort, last-opened timestamps
- AI analysis via local Python server (FastAPI + Claude Code CLI / Codex CLI on localhost:8765)
- AI Recommendations panel: per-tab actions (keep/close/group/archive/read_later), confidence, reasons, start/stop analysis controls, partial per-batch results, progress bar with cache/save counters, and runtime provider/model status with failover errors
- Richer AI summary with action breakdown pills, model display during/after analysis, yellow banner for partial results after stop
- Provider timeouts + automatic failover keep the analysis run moving when one CLI hangs or errors
- Topic Clusters from AI: collapsible clusters with export to Obsidian, theme-first clustering, and tag-based comparison against persistent clusters
- Smart Tab Groups: create Chrome Tab Groups from AI topic clusters via `chrome.tabs.group()`
- Tab Insights dashboard: top domains, average stats, snapshot trend in AI panel
- Search tab: conversational SQLite-backed retrieval using the same configured provider chain as AI analysis, with answer text, follow-up prompts, and tab actions
- Cleanup Session: step-by-step guided flow, pre-cleanup snapshot, export report
- Content script: on-demand page extraction (meta, H1, excerpt)
- Auto-snapshots: Chrome Alarms, configurable interval
- Obsidian exports: TopicCluster, TabSessionSnapshot, CleanupReview (3 new entity types)
- Settings: local server URL + connection test, primary/fallback CLI provider selection, Codex model, optional CLI paths, auto-snapshot toggle, history retention
- Settings also expose SQLite maintenance tools and recent provider logs from the local server
- LLM call logging: `llm_call_logs` SQLite table, `GET /llm-call-logs` endpoint, logs viewer in Settings
- AI analytics management: URL cache browser, analysis sessions list in Settings with browse/delete capabilities
- Vite build: 4 entry points (side-panel, popup, service-worker, content script)

### v0.2.1 (Complete)
- Tab Habits Score: composite health score (closable %, cleanup frequency, avg tab age, tab count trend) with trend detection
- Recommendation Tracking: log accept/skip/modify in cleanup sessions, aggregate stats
- Activity Heatmap: 7×24 CSS grid from tab history events, domain filter
- Persistent Topic Clusters: survive across AI analyses, merge by name/tag overlap, CRUD management
- Focus Mode: group matching tabs from a persistent cluster into Chrome tab group, collapse others
- Resumable analysis: `analysis_runs` SQLite table, stop/resume with pending tab tracking, full state snapshots
- Per-tab analysis status: `TabAnalysisStatus` per tab (pending/cached/analyzed/failed), coverage gap UI
- AI panel split into Analysis/Analytics sections with toggle
- Analysis section: amber ↻ Refresh button with confirmation dialog to force full LLM re-analysis ignoring cache
- Analytics section: ↻ Refresh button sends aggregated SQLite data to LLM via `POST /analytics/refresh`, returns AI Insight card (browsing patterns, suggestions, cluster insights, habits commentary) + refreshes raw analytics data
- Analytics snapshot card, suggested next steps, theme comparison card
- Collapsible recommendation list grouped by action type
- Search input stays active while query is processing (non-blocking typing)
- Progress phases extended: `stopping`, `stopped` added to `AIProgressPhase`

### Not Yet Implemented
- Provider health/status screen in the UI
- Additional local AI adapters beyond Claude Code CLI and Codex CLI
- Options page (standalone)
- Keyboard shortcuts
- Onboarding flow
- ReadingList and WorkContext Obsidian entity types

## Roadmap
- **v0.1 (Complete):** Tab list, rule-based analysis, manual snapshots, basic Obsidian export
- **v0.2 (Complete):** AI analysis via local CLI providers, tab history, topic clusters, cleanup session, auto-snapshots, advanced Obsidian exports
- **v0.2.1 (Complete):** Analytics (habits score, recommendation tracking, activity heatmap), persistent clusters, focus mode, resumable analysis, per-tab status tracking, SQLite-backed Search dialog
- **v0.3:** Provider status UI, additional CLI/local-model adapters, snapshot comparison, reading list, drag-and-drop, WorkContext Obsidian entity
- **v1.0:** Polish, onboarding, keyboard shortcuts, Chrome Web Store
- **v2.0:** Cross-device sync, Obsidian plugin, richer local-model support
