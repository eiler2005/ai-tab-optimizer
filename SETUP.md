# SETUP — AI Tab Optimizer Development Guide

## Prerequisites

### Required Tools
| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20+ | JS runtime |
| pnpm | 9+ | Package manager (preferred over npm) |
| TypeScript | 5.4+ | Type checking |
| Chrome / Chromium | 114+ | MV3 + Side Panel support |
| Python | 3.11+ | AI server backend |
| Git | any | Version control |

### Optional Tools
| Tool | Purpose |
|---|---|
| Obsidian | Testing vault integration locally |
| VS Code | Recommended editor |
| Chrome DevTools | Extension debugging |

### Install pnpm (if not installed)
```bash
npm install -g pnpm
```

---

## Project Structure

```
firstai_agentproj/
├── extension/               # Chrome Extension source
│   ├── src/
│   │   ├── background/      # Service worker (Chrome API bridge, AI proxy, history)
│   │   ├── side-panel/      # React side panel app (primary UI)
│   │   ├── popup/           # Popup (minimal — opens side panel)
│   │   ├── content/         # Content script (on-demand page extraction)
│   │   └── shared/          # Shared types, utils, i18n
│   ├── public/              # Static assets (icons, manifest.json)
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts       # 4 entry points build config
├── package.json             # Root workspace scripts (build, dev, server, typecheck)
├── agent.py                 # FastAPI local AI server (Claude Code CLI + Codex CLI)
├── requirements.txt         # Python deps
├── PROJECT.md
├── SETUP.md
├── MVP_FEATURES.md
└── OBSIDIAN_INTEGRATION.md
```

---

## Initial Setup

### 1. Install Extension Dependencies
```bash
pnpm --dir extension install
```

### 2. Install Python Dependencies (for AI server)
```bash
.venv/bin/pip install -r requirements.txt
```

### 3. Build the Extension
```bash
pnpm build    # from repo root; delegates to extension/
# or
pnpm dev      # watch mode for development
```

### 4. Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder
5. The extension icon appears in the toolbar

### 5. Start the AI Server
```bash
pnpm server
```
This starts a FastAPI server on `http://localhost:8765`. The server orchestrates local AI CLIs, persists state in SQLite, and can fail over from Claude Code CLI to Codex CLI without separate API billing.

### 6. Configure the Extension
1. Open the extension side panel
2. Go to **Settings**
3. Set AI Provider to **Local Server (CLI providers)**
4. Server URL should be `http://localhost:8765` (default)
5. Primary provider can stay **Claude Code**, fallback can stay **Codex CLI**
6. Click **Test Connection** to verify

---

## Development Build

```bash
pnpm dev
```

This starts Vite in watch mode and outputs to `dist/`. Every file change triggers a rebuild.

---

## Loading the Extension in Chrome

### After Code Changes
When using `pnpm dev` (watch mode):
- Most changes apply automatically after Vite rebuilds
- For service worker changes: click the **reload** icon on the extension card at `chrome://extensions`
- For manifest changes: click **Remove**, then **Load unpacked** again

### Opening the Side Panel
- Click the extension icon in the toolbar
- OR right-click the icon → "Open side panel"

---

## Production Build

```bash
pnpm build
```

Output is in `extension/dist/`. This folder can be loaded as an unpacked extension or packaged for the Chrome Web Store.

### Package as .zip for Chrome Web Store
```bash
cd extension/dist
zip -r ../tab-optimizer.zip .
```

---

## AI Server (agent.py)

The AI server is a FastAPI application that proxies tab analysis requests to local AI CLIs and keeps SQLite-backed state in `tab_analysis.db` (10 tables):
- `url_analysis` — per-URL AI cache with 7-day TTL
- `analysis_sessions` — analysis run metadata and cost tracking
- `analysis_runs` — full analysis run state snapshots for stop/resume (pending tabs, per-tab statuses, result, metadata)
- `tab_history_events` — browser tab lifecycle events
- `snapshots` — session snapshots
- `app_settings` — persisted user/server configuration
- `runtime_logs` — provider/analysis/database diagnostic logs
- `llm_call_logs` — individual LLM API call records (provider, model, tokens, duration, status)
- `recommendation_actions` — cleanup action tracking (accepted/skipped/modified per tab)
- `topic_clusters` — persistent topic clusters that survive across AI analyses

### Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Connection test (returns `{ status: "ok" }`) |
| GET | `/db-status` | Database statistics (table counts, DB size, timestamps) |
| GET | `/runtime-logs` | Recent provider/analysis/database log entries |
| GET | `/cache-stats` | SQLite cache diagnostics (URL count + oldest/newest timestamps) |
| GET | `/settings` | Load persisted extension/server settings from SQLite |
| POST | `/settings` | Save merged extension/server settings to SQLite |
| POST | `/analyze` | Accepts tab list, returns `{ result, metadata, cacheStats }` |
| POST | `/analyze/cancel` | Cancel a running analysis (kills CLI subprocess, returns `{ cancelled }`) |
| POST | `/analysis-runs` | Persist a new server-backed analysis run snapshot |
| PUT | `/analysis-runs/{id}` | Update partial/final analysis run state in SQLite |
| GET | `/analysis-runs/{id}` | Read one persisted analysis run |
| GET | `/analysis-runs/latest` | Read the latest persisted analysis run (optionally by fingerprint) |
| POST | `/url-analysis/import` | Import heuristic/client-side per-URL analysis results back into SQLite |
| POST | `/tab-analysis-status` | Return per-tab SQLite-backed analysis coverage for the current tab set |
| GET | `/stats` | Cumulative statistics (total analyses, total cost, total tokens, avg duration) |
| GET | `/tab-history?timeframe=day|week|month` | Aggregated tab history stats persisted in SQLite |
| POST | `/tab-history/events` | Append a tab history event (`opened` / `closed` / `activated`) |
| POST | `/tab-history/import` | Flush locally buffered history events into SQLite |
| POST | `/tab-history/prune` | Prune old tab history rows based on retention days |
| GET | `/snapshots` | List saved snapshots from SQLite |
| GET | `/snapshots/{id}` | Get a single snapshot by ID |
| POST | `/snapshots` | Save a snapshot to SQLite |
| POST | `/snapshots/import` | Flush locally buffered snapshots into SQLite |
| DELETE | `/snapshots/{id}` | Delete a saved snapshot |
| POST | `/db/clear` | Clear all tables (optionally preserve settings) |
| GET | `/llm-call-logs` | Individual LLM call log entries (provider, model, tokens, duration, status) |
| GET | `/cache/urls` | List cached per-URL AI analysis entries |
| DELETE | `/cache/urls` | Delete cached URL analysis entries |
| GET | `/sessions` | List analysis session records |
| DELETE | `/sessions/{id}` | Delete a specific analysis session |
| GET | `/insights` | Tab insights dashboard (top domains, avg stats, snapshot trend) |
| GET | `/habits-score` | Composite tab habits/health score with trend and weighted components |
| POST | `/recommendation-actions` | Log accepted / skipped / modified cleanup recommendations |
| GET | `/recommendation-stats` | Aggregate recommendation acceptance and confidence stats |
| GET | `/activity-heatmap` | 7x24 activity heatmap built from persisted tab history events |
| GET | `/clusters` | List persistent topic clusters saved across analyses |
| POST | `/clusters/merge` | Merge AI topic clusters into persistent storage |
| PUT | `/clusters/{id}` | Rename a persistent cluster |
| DELETE | `/clusters/{id}` | Delete a persistent cluster |
| POST | `/chat` | SQLite-backed dialog search over AI results, history, and persistent clusters using the same configured provider chain as AI analysis (20s LLM timeout, 6-keyword UNION ALL query) |
| POST | `/analytics/refresh` | Sends aggregated SQLite analytics (top domains, habits, clusters, recommendation stats) to LLM, returns AI insight card data |

### How It Works
1. Extension service worker first asks `/tab-analysis-status` which current tabs already have fresh SQLite results
2. Server loads persisted settings from SQLite to determine the primary CLI provider, fallback provider, and model
3. Server checks `tab_analysis.db` for fresh per-URL cache hits (7-day TTL, namespaced by provider/model settings)
4. Only tabs without fresh SQLite coverage are sent to the configured CLI provider, in batches of 30, unless `Re-analyze` is used
5. If the primary provider fails or hits a usage limit, the server automatically tries the fallback CLI provider
6. After each batch, the extension persists partial/final analysis run state in SQLite (`analysis_runs`) with per-tab statuses so stop/resume survives extension reloads
7. If a batch finishes through the client-side heuristic fallback, those per-URL results are imported back into SQLite through `/url-analysis/import`, so coverage stays accurate
8. Server stores per-URL results + session metrics in SQLite, then returns the aggregated result, metadata, and cache stats
9. Service worker also persists tab history events, snapshots, and settings to the same SQLite database so they survive extension reload/removal
10. The Search tab uses `/chat` to retrieve SQLite candidates from URL analysis and history via a consolidated UNION ALL query (up to 6 keyword patterns, 20s LLM timeout), plus persistent clusters, then ranks/summarizes them through the same provider/model chain configured in Settings

### Running the Server
```bash
# Default port 8765
pnpm server

# Custom port
PORT=9000 .venv/bin/python agent.py
```

### Prerequisites
- At least one local AI CLI must be available:
  - Claude Code (`claude` CLI authenticated), or
  - Codex CLI (`codex login` completed)
- For automatic failover, configure both CLIs
- Python 3.11+ with dependencies from `requirements.txt`

---

## Testing Tab Management

### Set Up a Test Tab Set
```bash
open -a "Google Chrome" \
  "https://github.com" \
  "https://github.com" \
  "https://stackoverflow.com/questions/1234" \
  "https://stackoverflow.com/questions/5678" \
  "https://notion.so" \
  "https://docs.google.com" \
  "https://arxiv.org/abs/2301.00001" \
  "https://arxiv.org/abs/2301.00002"
```

This gives you duplicate URLs and related domains to test deduplication logic.

### Testing Tab Events
Use the Chrome DevTools for the service worker:
1. Go to `chrome://extensions`
2. Find the extension → click **Service worker** link
3. DevTools opens for the background context
4. Monitor `console.log` output

### Testing the Side Panel
1. Open the side panel
2. Right-click anywhere → **Inspect**
3. Regular DevTools opens for the side panel React app

---

## Testing Tab History

1. Open the extension side panel
2. Navigate to the **History** tab
3. Open, close, and switch between a few tabs
4. History entries appear (may need to refresh — switch timeframe filters)
5. Test search and sort modes

History is stored primarily in SQLite via the local server. `chrome.storage.local.tabHistory` is only used as a temporary offline buffer if the server is unavailable. To inspect the server-backed history quickly:
```bash
curl "http://127.0.0.1:8765/tab-history?timeframe=week"
```

To inspect the local offline buffer (normally empty when the server is reachable):
```javascript
// Run in service worker DevTools console
chrome.storage.local.get('tabHistory', (data) => console.log(data.tabHistory?.length, 'entries'))
```

---

## Testing AI Analysis

### With Local Server (Recommended)
1. Start the AI server: `pnpm server`
2. In extension settings: set AI Provider to "Local Server (CLI providers)"
3. Click "Test Connection" — should show "Connected"
4. Go to the **AI** tab in the side panel
5. Click **Analyze Tabs**
6. Review results: recommendations, clusters, session stats, habits score, recommendation history, activity heatmap, and the runtime provider status card (current CLI/model, failover, errors)
7. Use the persistent clusters section to rename, delete, or focus on a saved cluster in Chrome
8. In **Settings**, you can also inspect SQLite counts, sync local data to the DB, clear server-side DB state, and review recent model logs

### Testing Search Dialog
1. Open the **Search** tab in the side panel
2. Ask a natural-language question, for example:
   - `Покажи вкладки про Claude Code и что стоит разобрать первым`
   - `Which tabs are relevant to my current project?`
3. Verify the response includes:
   - a short answer grounded in SQLite-backed memory,
   - result cards from `url_analysis`, `tab_history_events`, and/or persistent clusters,
   - provider/model metadata matching the same Settings provider chain used by AI Analysis,
   - follow-up suggestion chips
4. Click a result title/URL or the action button to focus the existing tab or open the URL
5. If all relevant URLs are already obvious from SQLite ranking alone, the dialog may skip the model and show `SQLite ranking only`

### Inspecting Cached AI Results
```javascript
// Run in service worker DevTools console
chrome.storage.local.get('lastAIResult', (data) => console.log(data.lastAIResult))
```

---

## Testing Snapshots

### Manual Snapshot Test Flow
1. Open 5–10 tabs
2. Open the extension side panel
3. Click "Save Snapshot"
4. Close 2–3 tabs manually
5. Go to Snapshots History
6. Click the saved snapshot → Restore
7. Verify the closed tabs reopen

### Auto-Snapshot Test
1. Go to Settings → enable Auto-snapshots
2. Set interval to 1 hour (minimum in production)
3. For dev testing, temporarily set a shorter alarm in service-worker.ts
4. Verify snapshots appear in Snapshots list

### Inspect Persisted Snapshots
Primary storage is SQLite on the local server:
```bash
curl "http://127.0.0.1:8765/snapshots"
```

### Inspect Local Fallback Buffer
```javascript
// Run in service worker DevTools console
chrome.storage.local.get(null, (data) => console.log(JSON.stringify(data, null, 2)))
```

---

## Testing Obsidian Integration

### Step 1: Create a Test Vault
1. Open Obsidian
2. Create a new vault, e.g. `~/Documents/TestVault`

### Step 2: Test LinkNote Export
1. Click the Obsidian icon on any tab in the side panel
2. Grant file system permission (first time only)
3. Verify `.md` file appears in `TestVault/TabOptimizer/Links/{domain}/`

### Step 3: Test TopicCluster Export
1. Run AI analysis
2. In the topic clusters section, click "Export to Obsidian"
3. Verify file in `TestVault/TabOptimizer/Topics/`

### Step 4: Test Session Snapshot Export
1. Go to a snapshot detail view
2. Click "Export to Obsidian"
3. Verify file in `TestVault/TabOptimizer/Sessions/`

### Step 5: Test Cleanup Report Export
1. Complete a cleanup session
2. Click "Export Cleanup Report"
3. Verify file in `TestVault/TabOptimizer/Cleanups/`

---

## Testing Content Script

The page extractor content script is injected on demand:
1. Open any webpage
2. Trigger page extraction (used internally by AI analysis for enriched context)
3. Check the DevTools console of that page for script injection

---

## Mandatory Steps Before First Run

1. Enable Developer Mode in `chrome://extensions`
2. Build the project: `cd extension && pnpm build`
3. Load unpacked extension from `dist/` folder
4. Start AI server: `pnpm server`
5. Open extension settings:
   - Set AI Provider to "Local Server (CLI providers)"
   - Keep Primary Provider = Claude Code and Fallback Provider = Codex CLI
   - Optionally set Obsidian vault path
6. Open the side panel
7. Test with a handful of tabs before using on a real session

---

## Common Issues

| Problem | Solution |
|---|---|
| Side panel doesn't open | Check `sidePanel` permission in manifest and Chrome version ≥ 114 |
| Service worker shows inactive | Normal — MV3 workers sleep. They wake on events. |
| AI analysis fails | Verify `pnpm server` is running, "Test Connection" is green, and at least one CLI provider is available |
| AI falls back from Claude | Claude Code likely hit a usage limit; keep Codex CLI as fallback or wait for the reset time shown in the UI/server logs |
| AI server won't start | Ensure `pip install -r requirements.txt` succeeded and required CLIs (`claude`, `codex`) are installed as needed |
| Obsidian export no file | Check file system permission was granted (first export shows a folder picker) |
| Content script not injecting | Verify `scripting` in permissions and `<all_urls>` in optional_host_permissions |
| Storage quota exceeded | Enable `unlimitedStorage` optional permission or reduce max snapshots |
| Tab history empty | History starts recording from when the extension is loaded. Open/close/switch tabs to populate. |
