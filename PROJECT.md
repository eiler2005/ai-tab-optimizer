# AI Tab Optimizer — Project Documentation

## Product Vision

AI Tab Optimizer is a Chrome Extension that acts as an intelligent browser workspace manager. It helps users with 100+ open tabs regain control of their browser without losing valuable context. The tool combines tab management, AI-driven analysis, and a persistent knowledge base in Obsidian to turn browser chaos into an organized, searchable archive of past work sessions.

The core promise: **you can safely clean up your browser because nothing important will be lost.**

---

## User Problems & Use Cases

### Primary Problems
1. **Cognitive overload** — 100+ tabs create mental overhead and slow down focus
2. **Fear of closing** — users hesitate to close tabs because they might need them later
3. **Lost context** — after closing a session, users forget what they were working on
4. **Duplicate waste** — same or similar pages open multiple times
5. **No structure** — unrelated topics mixed together with no grouping
6. **No memory** — browser has no searchable history of past work sessions

### Use Cases
| Use Case | Description |
|---|---|
| Daily cleanup | User wants to reduce tab count at end of day |
| Topic grouping | User wants to organize research by theme |
| Session handoff | User saves context before going offline |
| Recovery | User reopens a work context from last week |
| Knowledge capture | User turns a set of tabs into an Obsidian note cluster |
| Deduplication | User removes near-identical tabs automatically |
| Read later | User defers tabs without losing them |
| Conversational recall | User asks the extension to find and summarize tabs from SQLite-backed memory |

---

## Implemented Features (v0.2)

### Tab Visibility
- List all open tabs across all windows, grouped by window (collapsible)
- Display: title, URL, domain, favicon, pinned state, active state, Chrome tab group name
- Search/filter by title or domain

### Tab Management Actions
- Close single tab or multiple selected tabs (bulk action)
- Pin / unpin tab
- Mark tab as "important" (local flag, persisted in `chrome.storage.local`)
- Restore recently closed tabs (via `chrome.sessions` API)

### Rule-Based Analysis (no AI)
- Detect exact duplicate URLs (string equality on normalized URL)
- Detect near-duplicate URLs (same domain + path similarity > 0.8)
- Flag stale tabs (not accessed in N days, configurable threshold)
- Group tabs by domain
- Badges on each tab indicating detected issues

### Overview / Stats Bar
- Total tab count, duplicate count, stale count, important count
- Top 5 domains by tab count

### AI Analysis (via Local Server)
- FastAPI server (`agent.py`) orchestrating local AI CLIs (`claude_code`, `codex_cli`)
- Per-tab recommendations: keep / close / group / read_later / archive
- Theme-first topic clusters with names, descriptions, tags
- Session summary and stats (estimated closable, main themes)
- **SQLite-backed per-URL caching**: results stored in `tab_analysis.db` with a 7-day TTL
- **SQLite-backed settings**: provider choice, fallback chain, model, and retention settings persist server-side in `app_settings`
- Already-analyzed URLs are skipped server-side; only uncached tabs are sent to AI
- Automatic provider failover: the server can retry a batch with Codex CLI if Claude Code CLI is unavailable or rate-limited
- Provider timeouts ensure a stuck CLI is abandoned and the batch can continue through the next provider
- **Incremental batch analysis**: the service worker sends tabs in batches of 30 and updates the UI after every completed batch
- **Fire-and-forget**: `ANALYZE_TABS` returns immediately, results come via broadcast events (no message channel timeout on 1000+ tabs)
- Progress UI: phase indicator, progress bar, elapsed timer, cached/new/saved/processed counts, current batch
- Runtime provider status card: active CLI/model, configured chain, and recorded failover errors during the current analysis run
- Per-tab coverage UI shows which current tabs are cached, newly analyzed, still pending, or failed
- Metadata tracking: accumulated duration, input/output tokens, cost across all batches
- "From cache" badge, "Re-analyze" button and amber ↻ Refresh button with confirmation dialog to force full re-analysis (bypasses server-side URL cache)
- Analytics section: ↻ Refresh button sends aggregated SQLite data (top domains, habits, clusters, recommendation stats) to LLM via `POST /analytics/refresh`, displays AI Insight card with browsing patterns summary, improvement suggestions, cluster insights, and habits commentary
- "Stop analysis" persists partial run state in SQLite and can resume later for the same tab fingerprint
- Intermediate recommendations appear as each completed batch is saved
- Client-side heuristic fallback results are imported back into SQLite so per-URL coverage remains accurate
- Server-side logging in `runtime_logs` SQLite table + persisted session history in `analysis_sessions`
- LLM call logging in `llm_call_logs` SQLite table with per-call details (provider, model, tokens, duration, status)
- Server endpoints: `GET /stats`, `GET /cache-stats`, `GET /db-status`, `GET /runtime-logs`, `GET /tab-history`, `GET /snapshots`, `POST /snapshots/import`, `POST /tab-history/import`, `POST /db/clear`, `GET /llm-call-logs`, `GET /cache/urls`, `DELETE /cache/urls`, `GET /sessions`, `DELETE /sessions/{id}`, `GET /insights`, `GET /habits-score`, `POST /recommendation-actions`, `GET /recommendation-stats`, `GET /activity-heatmap`, `GET /clusters`, `POST /clusters/merge`, `PUT /clusters/{id}`, `DELETE /clusters/{id}`, `POST /analysis-runs`, `PUT /analysis-runs/{id}`, `GET /analysis-runs/{id}`, `GET /analysis-runs/latest`, `POST /tab-analysis-status`, `POST /url-analysis/import`, `POST /chat`, `POST /analytics/refresh`

### Search Dialog (SQLite-backed)
- Dedicated **Search** tab with conversational dialog UI
- Retrieves candidates from `url_analysis` and `tab_history_events` via consolidated UNION ALL query, plus persistent topic clusters
- Uses the same provider chain and model configured in Settings for AI Analysis (20s LLM timeout, up to 6 keyword patterns)
- Falls back to SQLite-only ranking if the model is disabled or unavailable
- Response includes a grounded answer, relevant URLs, provider/model metadata, and follow-up prompts
- Result cards can focus an already-open tab, open a URL, or close the matching open tab
- Search input stays active while query is processing — user can type the next query without waiting

### Cleanup Session Mode
- Pre-cleanup auto-snapshot for undo capability
- Step-by-step guided flow: one recommendation at a time
- Accept / Skip / Change Action per recommendation
- Completion screen with summary (closed, grouped, saved, skipped)
- Export cleanup report to Obsidian

### Tab History
- Track tab events: opened, closed, activated
- In-memory tab info cache for `onRemoved` (tab data unavailable after close)
- Persist tab history events in server-side SQLite with local fallback buffering when the server is unavailable
- History panel with timeframe filters (day / week / month)
- Search by title/domain, sort by recent or visit count
- Per-URL stats: activation count, first/last seen, last opened time, still-open badge
- Daily cleanup alarm to prune old entries (configurable retention)

### Snapshots
- Manual snapshot creation with optional name
- Auto-snapshots via Chrome Alarms API (configurable interval 1–24 hours)
- Pre-cleanup snapshots (trigger: `pre-cleanup`)
- Snapshot stores: tab list, window layout, basic stats
- Snapshots persist in server-side SQLite and survive extension reload/removal
- Snapshots history screen (list + detail)
- Restore all tabs or selected tabs from snapshot
- Delete snapshot, max snapshots cap with auto-pruning

### Obsidian Integration
- **LinkNote** — single tab export to `TabOptimizer/Links/{domain}/{slug}.md`
- **TopicCluster** — AI cluster export to `TabOptimizer/Topics/{topic-slug}.md`
- **TabSessionSnapshot** — snapshot export to `TabOptimizer/Sessions/{date}-{name-slug}.md`
- **CleanupReview** — cleanup report export to `TabOptimizer/Cleanups/{date}-cleanup.md`
- Vault path configurable in Settings
- File System Access API for writing to vault
- Dedup check (don't export same URL twice)

### Content Script
- On-demand page extraction (`page-extractor.ts`)
- Extracts: meta description, first H1, text excerpt (500 chars)
- Injected via `chrome.scripting.executeScript`

### Settings
- AI provider selection: none / local_server
- Local server URL (default: `http://localhost:8765`) + "Test Connection" button
- Primary server AI provider: Claude Code CLI or Codex CLI
- Fallback server AI provider: none / Claude Code CLI / Codex CLI
- Codex model input (default: `gpt-5.4`)
- Optional CLI path overrides for `claude` and `codex`
- SQLite tools in Settings: refresh DB info, sync local extension buffers, clear server-side DB state, inspect recent runtime logs from `runtime_logs` table
- LLM call logs viewer: browse individual LLM API calls with provider, model, tokens, duration, and status
- URL cache browser: view and delete cached per-URL AI analysis entries
- Analysis sessions list: view and delete past analysis session records
- Obsidian vault path
- Protected domains list
- Stale tab threshold (days, default: 7)
- Max snapshots to keep (default: 30)
- Auto-snapshot toggle + interval (hours)
- History retention days (7–90, default: 30)

### Extension Infrastructure
- Side Panel as primary UI (React + Zustand)
- Popup (minimal — opens side panel + shows tab count)
- Service worker with message routing (44 request types)
- 8 broadcast events
- 8 views in side panel
- 13 React components
- i18n (English / Russian, ~345 keys)
- Manifest V3 compliant

---

## Extension Architecture

### Source Structure

```
extension/src/
├── background/
│   └── service-worker.ts      # Chrome API bridge, AI proxy, history logging, auto-snapshots
├── side-panel/
│   ├── index.html
│   ├── main.tsx               # React app entry
│   ├── App.tsx                # Root component (view routing, broadcast listener)
│   ├── store.ts               # Zustand store (9 state slices incl. Search)
│   └── components/            # 13 React components
│       ├── AIRecommendations.tsx
│       ├── BulkActions.tsx
│       ├── ChatSearch.tsx
│       ├── CleanupSession.tsx
│       ├── Header.tsx
│       ├── HistoryPanel.tsx
│       ├── RecentlyClosed.tsx
│       ├── SettingsView.tsx
│       ├── SnapshotDetail.tsx
│       ├── SnapshotsList.tsx
│       ├── StatsBar.tsx
│       ├── TabItem.tsx
│       └── TabList.tsx
├── popup/
│   ├── index.html
│   └── main.tsx               # Minimal popup (open side panel)
├── content/
│   └── page-extractor.ts      # Extract page metadata on demand
├── shared/
│   ├── types/
│   │   ├── index.ts           # Re-exports
│   │   ├── tab.ts             # TabRecord, RuleFlags, WindowGroup
│   │   ├── snapshot.ts        # SnapshotRecord, WindowSnapshot, TabSnapshot
│   │   ├── messages.ts        # MessageRequest, BroadcastEvent, UserSettings
│   │   ├── ai.ts              # AIAnalysisResult, TopicCluster, TabRecommendation, etc.
│   │   └── history.ts         # TabHistoryEntry, TabHistoryStats, HistoryTimeframe
│   ├── utils/
│   │   ├── url.ts             # URL normalization, domain extraction
│   │   ├── rules.ts           # Rule engine (duplicates, stale, domain grouping)
│   │   └── obsidian.ts        # Obsidian export functions (4 export types)
│   └── i18n/
│       ├── index.ts           # useTranslation hook
│       └── translations.ts    # en/ru translations (~345 keys)
└── styles.css                 # Tailwind entry
```

### Component Responsibilities

| Component | Role |
|---|---|
| `service-worker.ts` | Tab CRUD, Chrome API bridge, tab history logging, AI server proxy, snapshot management, auto-snapshot scheduler, content script injection, Smart Tab Groups via `chrome.tabs.group()`, message router (44 request types), SQLite-backed Search dialog bridge |
| `side-panel` (React) | Primary UI — 8 views, state management via Zustand, 8 broadcast event types, Tab Insights dashboard, Smart Tab Groups, SQLite-backed Search dialog |
| `popup` | Lightweight entry point — opens side panel |
| `page-extractor.ts` | Content script injected on demand — extracts meta description, H1, body text excerpt |
| `agent.py` | FastAPI server — routes AI requests to Claude Code CLI or Codex CLI, persists cache/history/snapshots/settings in SQLite, and powers Search over SQLite memory |

### Message Passing Architecture

```
Side Panel (React/Zustand) ←→ Service Worker ←→ Chrome APIs (tabs, tabGroups, sessions, storage, alarms, scripting)
                                    ↕                        ↕
                            Content Scripts          Local AI Server
                            (on-demand)              (localhost:8765)
```

All communication uses `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. Message types are a discriminated union in `shared/types/messages.ts`.

### Message Types

**Requests (44):**
`GET_ALL_TABS`, `CLOSE_TABS`, `PIN_TAB`, `SET_USER_FLAG`, `CREATE_SNAPSHOT`, `GET_SNAPSHOTS`, `GET_SNAPSHOT`, `DELETE_SNAPSHOT`, `RESTORE_SNAPSHOT`, `GET_SETTINGS`, `SAVE_SETTINGS`, `GET_SERVER_DB_STATUS`, `GET_SERVER_RUNTIME_LOGS`, `SYNC_SERVER_PERSISTENCE`, `CLEAR_SERVER_DB`, `GET_TAB_HISTORY`, `GET_TAB_ANALYSIS_STATUS`, `ANALYZE_TABS`, `STOP_AI_ANALYSIS`, `GET_AI_RESULT`, `EXTRACT_PAGE`, `START_CLEANUP_SESSION`, `APPLY_CLEANUP_ACTION`, `GET_LLM_CALL_LOGS`, `GET_URL_CACHE_LIST`, `DELETE_URL_CACHE`, `GET_ANALYSIS_SESSIONS`, `DELETE_ANALYSIS_SESSION`, `GROUP_TABS_BY_CLUSTER`, `GET_TAB_INSIGHTS`, `GET_HABITS_SCORE`, `TRACK_RECOMMENDATION`, `GET_RECOMMENDATION_STATS`, `GET_ACTIVITY_HEATMAP`, `GET_PERSISTENT_CLUSTERS`, `MERGE_AI_CLUSTERS`, `RENAME_CLUSTER`, `DELETE_CLUSTER`, `FOCUS_ON_CLUSTER`, `EXIT_FOCUS_MODE`, `GET_CLUSTER_TAB_MATCHES`, `OPEN_URL`, `FOCUS_TAB`, `CHAT_SEARCH`

**Broadcasts (8):**
`TABS_UPDATED`, `SNAPSHOT_CREATED`, `AI_ANALYSIS_COMPLETE`, `AI_ANALYSIS_ERROR`, `AI_ANALYSIS_CANCELED`, `AI_ANALYSIS_PROGRESS`, `AI_ANALYSIS_PARTIAL`, `HISTORY_UPDATED`

---

## Service Worker Architecture

The service worker (`service-worker.ts`) is a single file containing all Chrome API logic. It is organized into functional sections:

### Sections
1. **In-memory tab cache** — `Map<number, {url, title, domain}>` for `onRemoved` events (tab data unavailable after close)
2. **Tab helpers** — `getAllTabs()` queries all tabs/windows/groups, normalizes into `WindowGroup[]`
3. **Snapshots** — `createSnapshot()`, `getSnapshots()`, `saveSnapshots()` with max-cap pruning
4. **Settings** — `getSettings()`, `saveSettings()` with defaults merge
5. **User flags** — `getUserFlags()`, `setUserFlag()` for important/read_later/protected marks
6. **Tab history** — `logTabEvent()`, `getTabHistory()`, `cleanupOldHistory()` with timeframe filtering and per-URL stats aggregation
7. **AI analysis** — `analyzeTabsViaServer()` builds `AISessionInput`, POSTs to local server, broadcasts progress, persists analysis runs to SQLite for resume, auto-merges topic clusters on completion
8. **Analysis run persistence** — `analysis_runs` table stores full run state (pending tabs, per-tab statuses, result, metadata) for stop/resume across extension reloads
9. **Per-tab analysis status** — `getTabAnalysisStatus()` returns per-tab coverage from server SQLite, used by TabStatusCoverageCard
10. **Content script injection** — `extractPageContent()` injects and messages the content script
11. **Auto-snapshots** — `setupAutoSnapshot()` manages Chrome Alarm
12. **Analytics helpers** — habits score, recommendation tracking, activity heatmap, persistent clusters, focus mode
13. **Search dialog** — conversational retrieval over SQLite-backed AI results, history, and clusters using the same provider chain as AI analysis
14. **Message handler** — `handleMessage()` switch on 44 request types
15. **Tab event listeners** — `onCreated`, `onRemoved`, `onActivated`, `onUpdated`, `onMoved`, `onAttached`, `onDetached`
16. **Startup** — sets up auto-snapshot alarm + daily history cleanup alarm

---

## Zustand Store (Side Panel)

### Views
`'tabs' | 'snapshots' | 'snapshot-detail' | 'settings' | 'history' | 'ai-recommendations' | 'chat' | 'cleanup-session'`

### State Slices
1. **Navigation** — `currentView`, `setView()`
2. **Tabs** — `windowGroups`, `totalTabs`, `selectedTabIds`, `searchQuery`, `loadTabs()`, `toggleTabSelection()`, `selectAll()`, `deselectAll()`
3. **Snapshots** — `snapshots`, `selectedSnapshot`, `loadSnapshots()`, `selectSnapshot()`
4. **Recently closed** — `recentlyClosed`, `loadRecentlyClosed()`
5. **History** — `historyStats`, `historyTimeframe`, `historySearchQuery`, `historyLoading`, `loadHistory()`, `setHistoryTimeframe()`
6. **AI** — `aiResult`, `aiAnalyzedAt`, `aiLoading`, `aiError`, `aiProgress`, `aiMetadata`, `aiFromCache`, `aiWasCanceled`, `aiResumeAvailable`, `aiRunId`, `aiTabStatuses`, `aiStatusSummary`, `analyzeTabs()`, `resumeAIAnalysis()`, `stopAIAnalysis()`, `loadAIResult()`, `loadAITabStatuses()`, `setAIResult()`, `setAIPartialResult()`, `setAIError()`, `setAIProgress()`, `setAIStopped()`, `setAITabStatuses()`
7. **Cleanup** — `cleanupStep`, `cleanupActions`, `cleanupRecommendations`, `startCleanupSession()`, `applyCleanupAction()`, `skipCleanupStep()`, `finishCleanup()`
8. **Focus Mode** — `focusClusterId`, `focusClusterName`, `focusMatchedTabIds`, `setFocusMode()`, `exitFocusMode()`
9. **Search** — `chatMessages`, `chatLoading`, `sendChatQuery()`, `clearChat()`

---

## Data Model

### Core Types

```typescript
interface TabRecord {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  domain: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  groupId?: number;
  groupName?: string;
  lastAccessed?: number;
  ruleFlags?: RuleFlags;
  userFlag?: 'important' | 'read_later' | 'protected';
}

interface RuleFlags {
  isExactDuplicate: boolean;
  duplicateOfTabId?: number;
  isNearDuplicate: boolean;
  isStale: boolean;
  domainGroup: string;
}

interface WindowGroup {
  windowId: number;
  focused: boolean;
  tabs: TabRecord[];
}
```

### Snapshot Types

```typescript
interface SnapshotRecord {
  id: string;
  name: string;
  createdAt: number;
  trigger: 'manual' | 'auto' | 'pre-cleanup';
  windows: WindowSnapshot[];
  stats: {
    totalTabs: number;
    totalWindows: number;
    topDomains: string[];
  };
}

interface WindowSnapshot {
  windowId: number;
  focused: boolean;
  tabs: TabSnapshot[];
}

interface TabSnapshot {
  url: string;
  title: string;
  domain: string;
  pinned: boolean;
  favIconUrl?: string;
  groupName?: string;
}
```

### AI Types

```typescript
interface AISessionInput {
  tabs: {
    id: number;
    title: string;
    url: string;
    domain: string;
    pinned: boolean;
    active: boolean;
    groupId?: number;
    groupName?: string;
    pageExcerpt?: string;
    metaDescription?: string;
  }[];
}

interface AIAnalysisResult {
  summary: string;
  topicClusters: TopicCluster[];
  tabRecommendations: TabRecommendation[];
  duplicateGroups: DuplicateGroup[];
  staleTabIds: number[];
  sessionStats: {
    estimatedClosable: number;
    mainThemes: string[];
    urgentItems: number;
    actionBreakdown?: Partial<Record<RecommendedAction, number>>;
  };
}

type RecommendedAction = 'keep' | 'group' | 'read_later' | 'archive' | 'close';

interface TabRecommendation {
  tabId: number;
  action: RecommendedAction;
  confidence: number;
  reason: string;
  suggestedGroupName?: string;
}

type AIProviderId = 'claude_code' | 'codex_cli';

interface AIProviderAttempt {
  provider: AIProviderId;
  model: string | null;
  status: 'succeeded' | 'failed';
  error?: string | null;
}

interface AIProviderRuntimeStatus {
  primaryProvider: AIProviderId | 'none';
  fallbackProvider: AIProviderId | 'none';
  currentProvider: AIProviderId | null;
  currentModel: string | null;
  attempts: AIProviderAttempt[];
  lastError: string | null;
  servedFromCacheOnly: boolean;
}

interface AIAnalysisMetadata {
  durationMs: number;
  durationApiMs: number;
  totalCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  tabCount: number;
  providerUsed?: AIProviderId | null;
  modelUsed?: string | null;
  providerAttempts?: AIProviderAttempt[];
  providerStatus?: AIProviderRuntimeStatus;
}

interface AIProgress {
  phase: 'preparing' | 'sending' | 'analyzing' | 'persisting' | 'processing' | 'stopping' | 'stopped';
  tabsTotal: number;
  tabsCached: number;
  tabsNew: number;
  tabsAnalyzed: number;
  tabsProcessed: number;
  tabsRemaining: number;
  tabsSaved: number;
  batchesTotal: number;
  batchesCompleted: number;
  currentBatch: number;
  startedAt: number;
  providerStatus?: AIProviderRuntimeStatus;
}

type TabAnalysisState = 'pending' | 'cached' | 'analyzed' | 'failed';
type TabAnalysisSource = 'pending' | 'database' | 'provider' | 'heuristic';

interface TabAnalysisStatus {
  tabId: number;
  url: string;
  title: string;
  domain: string;
  status: TabAnalysisState;
  source: TabAnalysisSource;
  action?: RecommendedAction | null;
  confidence?: number | null;
  reason?: string | null;
  analyzedAt?: number | null;
  provider?: AIProviderId | null;
  model?: string | null;
}

interface TabAnalysisStatusSummary {
  total: number;
  cached: number;
  analyzed: number;
  pending: number;
  failed: number;
}
```

### Analytics Types

```typescript
interface HabitsScore {
  score: number;
  trend: 'improving' | 'stable' | 'declining';
  components: HabitsScoreComponent[];
  computedAt: number;
}

interface HabitsScoreComponent {
  name: string;
  value: number;
  normalizedScore: number;
  weight: number;
}

interface RecommendationActionStats {
  totalActions: number;
  acceptanceRate: number;
  byAiAction: Record<string, { total: number; accepted: number; skipped: number; modified: number; avgConfidence: number }>;
  confidenceCorrelation: { bucket: string; acceptanceRate: number }[];
}

interface ActivityHeatmapData {
  grid: number[][];  // 7×24 (days × hours)
  domains: string[];
}

interface PersistentCluster {
  id: number;
  name: string;
  description: string;
  tags: string[];
  tabUrls: string[];
  createdAt: number;
  updatedAt: number;
}
```

### Management & Insights Types

```typescript
interface LLMCallLogEntry {
  id: number;
  sessionId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: 'succeeded' | 'failed';
  error?: string;
  createdAt: string;
}

interface UrlCacheEntry {
  url: string;
  domain: string;
  provider: string;
  model: string;
  analyzedAt: string;
  expiresAt: string;
}

interface AnalysisSessionEntry {
  id: string;
  tabCount: number;
  provider: string;
  model: string;
  durationMs: number;
  totalCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

interface TabInsights {
  topDomains: { domain: string; count: number }[];
  avgTabsPerWindow: number;
  avgSessionDuration: number;
  snapshotTrend: { date: string; count: number }[];
}
```

### Settings

```typescript
interface UserSettings {
  obsidianVaultPath: string;
  protectedDomains: string[];
  staleDaysThreshold: number;
  maxStoredSnapshots: number;
  aiProvider: 'anthropic' | 'openai' | 'ollama' | 'local_server' | 'none';
  serverAiProvider: 'none' | 'claude_code' | 'codex_cli';
  fallbackAiProvider: 'none' | 'claude_code' | 'codex_cli';
  apiKey: string;
  ollamaEndpoint: string;
  localServerUrl: string;
  claudeCliPath: string;
  codexCliPath: string;
  codexModel: string;
  autoSnapshotEnabled: boolean;
  autoSnapshotIntervalHours: number;
  historyRetentionDays: number;
}
```

---

## Storage Keys

| Key | Type | Purpose |
|---|---|---|
| `snapshots` | `SnapshotRecord[]` | Temporary offline snapshot buffer before sync to server SQLite |
| `settings` | `UserSettings` | Local mirror of server-backed settings persisted in SQLite |
| `userFlags` | `Record<number, string>` | Per-tab user flags (important/read_later/protected) |
| `tabHistory` | `TabHistoryEntry[]` | Temporary offline history buffer before sync to server SQLite |
| `lastAIResult` | `CachedAIResult` | Cached aggregated AI analysis with fingerprint and metadata |
| `exportedUrls` | `string[]` | Dedup guard for Obsidian exports |

---

## AI Pipeline

### Local Server (`agent.py`)

FastAPI server wrapping local AI CLIs. Runs on port 8765 (configurable via `PORT` env var).

**Endpoints:**
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Connection test → `{ status: "ok" }` |
| GET | `/db-status` | Database statistics (table counts, DB size, timestamps) |
| GET | `/runtime-logs` | Recent provider/analysis/database log entries |
| GET | `/cache-stats` | Current SQLite URL-cache counts and timestamps |
| GET | `/settings` | Load persisted server/extension settings from SQLite |
| POST | `/settings` | Save merged server/extension settings to SQLite |
| POST | `/analyze` | Accepts tab list, returns `{ result, metadata, cacheStats }` with `tabsFromCache`, `tabsAnalyzed`, `tabsSaved` |
| POST | `/analyze/cancel` | Cancel a running analysis — kills CLI subprocess, sets cancel event, returns `{ cancelled }` |
| GET | `/stats` | Cumulative usage stats (total analyses, cost, tokens, avg duration) |
| POST | `/tab-history/events` | Append a single tab history event |
| POST | `/tab-history/import` | Bulk import locally buffered history events |
| GET | `/tab-history` | Aggregated tab history stats by timeframe |
| POST | `/tab-history/prune` | Prune old history entries by retention days |
| GET | `/snapshots` | List all persisted snapshots |
| GET | `/snapshots/{id}` | Get a single snapshot by ID |
| POST | `/snapshots` | Save a snapshot to SQLite |
| POST | `/snapshots/import` | Bulk import locally buffered snapshots |
| DELETE | `/snapshots/{id}` | Delete a snapshot |
| POST | `/db/clear` | Clear all tables (optionally preserve settings) |
| GET | `/llm-call-logs` | Individual LLM call log entries (provider, model, tokens, duration, status) |
| GET | `/cache/urls` | List cached per-URL AI analysis entries |
| DELETE | `/cache/urls` | Delete cached URL analysis entries |
| GET | `/sessions` | List analysis session records |
| DELETE | `/sessions/{id}` | Delete a specific analysis session |
| GET | `/insights` | Tab insights dashboard (top domains, avg stats, snapshot trend) |
| GET | `/habits-score` | Composite tab habits/health score with weighted components and trend |
| POST | `/recommendation-actions` | Log accepted / skipped / modified cleanup actions |
| GET | `/recommendation-stats` | Aggregate recommendation acceptance and confidence stats |
| GET | `/activity-heatmap` | 7x24 activity heatmap from persisted tab history events |
| GET | `/clusters` | List persistent topic clusters |
| POST | `/clusters/merge` | Merge AI clusters into persistent storage |
| PUT | `/clusters/{id}` | Rename a persistent cluster |
| DELETE | `/clusters/{id}` | Delete a persistent cluster |
| POST | `/analysis-runs` | Persist a new partial/final analysis run snapshot |
| PUT | `/analysis-runs/{id}` | Update a server-backed analysis run during batching |
| GET | `/analysis-runs/{id}` | Read one persisted analysis run |
| GET | `/analysis-runs/latest` | Read the latest persisted analysis run |
| POST | `/tab-analysis-status` | Return per-tab SQLite-backed analysis coverage for the current tab set |
| POST | `/url-analysis/import` | Import heuristic/client-side per-URL analysis rows into SQLite |
| POST | `/chat` | Search and summarize SQLite-backed browser memory via the configured provider chain |
| POST | `/analytics/refresh` | Send aggregated SQLite analytics to LLM, returns AI insight (browsing patterns, suggestions, cluster insights, habits commentary) |

**How it works:**
1. Extension service worker preflights `/tab-analysis-status` to learn which current tabs already have fresh SQLite results
2. Server loads persisted app settings from SQLite to determine provider chain and model
3. Server looks up per-URL cache entries in `tab_analysis.db` and filters out fresh hits
4. Only tabs without fresh coverage are formatted into compact prompts and analyzed in batches of 30 via the configured CLI provider
5. If the primary CLI fails or hits a usage limit, the server retries the batch with the fallback CLI provider
6. The extension persists partial/final run state with per-tab statuses in `analysis_runs`, so stop/resume survives reloads
7. If a batch finishes via heuristic fallback in the extension, those per-URL results are imported back through `/url-analysis/import`
8. The server stores per-URL results + session metrics in SQLite, then returns the aggregated `AnalyzeResponse`
9. The Search dialog uses `/chat` to retrieve SQLite candidates and, when useful, summarize/rank them with the same provider/model chain as AI Analysis

**Prompt strategy:**
- System prompt: role definition + exact JSON output schema
- User prompt: compact tab list (not raw JSON, for token efficiency)

---

## Chrome Permissions

### Manifest (actual)
```json
{
  "permissions": [
    "tabs",           // read tab info, close/pin/move tabs
    "tabGroups",      // read and manage tab groups
    "storage",        // store settings, snapshots, history
    "alarms",         // scheduled auto-snapshots + history cleanup
    "sessions",       // access recently closed tabs
    "sidePanel",      // use side panel UI
    "scripting"       // inject content script on demand
  ],
  "host_permissions": [
    "http://localhost/*"   // for local AI server communication
  ],
  "optional_host_permissions": [
    "<all_urls>"           // for content script injection (page extraction)
  ]
}
```

### Privacy Notes
- `<all_urls>` is optional and only used when user explicitly triggers page content extraction
- No tab data is sent anywhere without user action
- AI analysis only goes to localhost (local server)
- API keys stored in `chrome.storage.local` (not sync)
- No analytics or telemetry

---

## UX Structure — Screens

### Screen Map
```
Side Panel
├── Tabs                     # Main tab list with search, filters, bulk actions
├── History                  # Tab activity history with timeframe filters
├── AI Recommendations       # AI analysis results + topic clusters (↻ refresh buttons on both Analysis/Analytics)
│   └── Cleanup Session      # Guided cleanup flow (step-by-step)
├── Search                   # SQLite-backed dialog over AI results, history, and theme clusters (non-blocking input)
├── Snapshots History        # List of saved snapshots
│   └── Snapshot Detail      # View / restore / export individual snapshot
└── Settings                 # AI provider, vault path, preferences
```

### Navigation
Top bar with 6 nav items: Tabs, History, AI, Search, Snapshots, Settings. Sub-views (`snapshot-detail`, `cleanup-session`) alias back to their parent nav item.

### Tab List Item
Each tab shows:
- Favicon + title (truncated) + domain
- Status badges: `duplicate`, `stale`, `pinned`, user flags
- Quick actions: close, pin, flag, Obsidian export
- Checkbox for bulk selection

---

## Obsidian Entity Types

| Entity | Status | Output Path |
|---|---|---|
| `LinkNote` | Implemented | `TabOptimizer/Links/{domain}/{slug}.md` |
| `TopicCluster` | Implemented | `TabOptimizer/Topics/{topic-slug}.md` |
| `TabSessionSnapshot` | Implemented | `TabOptimizer/Sessions/{date}-{name-slug}.md` |
| `CleanupReview` | Implemented | `TabOptimizer/Cleanups/{date}-cleanup.md` |
| `ReadingList` | Planned (v0.3) | — |
| `WorkContext` | Planned (v0.3) | — |

All exports use YAML frontmatter + Markdown body with Obsidian tags.

---

## Roadmap

### MVP (v0.1) — Complete
- Tab list view across all windows
- Rule-based deduplication + stale detection
- Manual snapshot creation + restore
- Basic Obsidian export (LinkNote)
- Settings: vault path, protected domains
- i18n (English / Russian)

### v0.2 — Complete
- Tab History panel (event tracking, stats, timeframe filters)
- AI analysis via local Python server (FastAPI + Claude Code CLI / Codex CLI)
- AI recommendations panel with per-tab actions, action breakdown pills, model display, per-tab coverage, and stop/resume
- Richer AI summary with action breakdown, yellow banner for partial results after stop
- Topic clusters from AI with Obsidian export, theme-first clustering, and tag-based comparison against persistent clusters
- Smart Tab Groups: create Chrome Tab Groups from AI topic clusters via `chrome.tabs.group()`
- Tab Insights dashboard: top domains, average stats, snapshot trend in AI panel
- Analytics & Focus Mode: habits score, recommendation tracking, activity heatmap, persistent clusters, focus mode
- Search dialog over SQLite-backed AI results, history, and saved clusters using the same provider chain as AI analysis
- Cleanup Session mode (guided step-by-step flow)
- Content script for page metadata extraction
- Auto-snapshots via Chrome Alarms
- Obsidian exports: TopicCluster, TabSessionSnapshot, CleanupReview
- LLM call logging with `llm_call_logs` SQLite table and viewer in Settings
- URL cache browser and analysis sessions management in Settings

### v0.3
- Provider health/status view in the UI
- Additional CLI/local-model adapters
- Snapshot comparison view
- ReadingList + WorkContext Obsidian entities
- Drag and drop tab reordering

### v1.0
- Polish + performance optimization
- Onboarding flow
- Keyboard shortcuts
- Options page (standalone)
- Extension packaging + Chrome Web Store submission

### v2.0
- Broader local-model ecosystem support
- Cross-device snapshot sync (chrome.storage.sync)
- Obsidian plugin counterpart (read-only dashboard inside Obsidian)
- Tab usage heatmap + analytics over time
