# AI Tab Optimizer

> Intelligent Chrome extension that turns tab chaos into structured knowledge — powered by local AI, no data leaves your machine.

![Version](https://img.shields.io/badge/version-0.2.1-blue)
![Chrome](https://img.shields.io/badge/Chrome-114%2B-green?logo=googlechrome)
![Manifest](https://img.shields.io/badge/Manifest-V3-orange)
![Python](https://img.shields.io/badge/Python-3.11%2B-blue?logo=python)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## What it does

AI Tab Optimizer helps you regain control of 100+ open tabs without losing context. It combines rule-based tab analysis with AI-powered topic clustering, guided cleanup sessions, and long-term analytics — all running locally on your machine.

**Key features:**

- **AI Analysis** — batch-analyze all open tabs using Claude Code CLI or Codex CLI; each tab gets an action recommendation (keep / group / read later / archive / close) with a confidence score and reason
- **Topic Clusters** — AI groups tabs into named theme clusters; one click creates Chrome Tab Groups from them
- **Persistent Knowledge** — analysis results cached in local SQLite; revisit insights without re-running expensive AI calls
- **Tab Analytics** — habits score, recommendation tracking, activity heatmap, LLM-generated browsing insights
- **Guided Cleanup** — step-by-step session mode: review AI recommendations, accept/skip, close in bulk, generate a summary
- **Obsidian Integration** — export individual tab links, topic clusters, session snapshots, and cleanup reports directly to your Obsidian vault

---

## How it works

```
Side Panel (React + Zustand)
        │  chrome.runtime.sendMessage (45 request types)
        ▼
Service Worker (MV3)
        │  fetch → localhost:8765
        ▼
FastAPI AI Server (agent.py)
        │  subprocess (CLI)         SQLite (tab_analysis.db)
        ├──────────────────────┐    ├── url_analysis
        ▼                      ▼    ├── analysis_sessions
Claude Code CLI          Codex CLI  ├── analysis_runs
   (primary)             (fallback) ├── tab_history_events
                                    ├── snapshots
                                    ├── llm_call_logs
                                    └── topic_clusters
```

- All AI inference runs **locally** via CLI tools — no external API calls, no cloud storage
- Automatic provider failover: if Claude Code CLI times out or errors, Codex CLI takes over mid-batch
- URL-based caching (180-day TTL by default) means previously analyzed tabs are instant on the next run
- The extension communicates with the server through the service worker only (Chrome MV3 CSP)

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Chrome | 114+ | Side panel support (MV3) |
| Node.js | 20+ | Extension build |
| pnpm | 9+ | Package manager |
| Python | 3.11+ | AI server |
| Claude Code CLI | latest | Primary AI provider |
| Codex CLI | latest | Fallback AI provider (optional) |

You need **at least one** AI provider CLI installed and authenticated. The extension works without a CLI but AI analysis will be unavailable.

- [Install Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Install Codex CLI](https://github.com/openai/codex)

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/eiler2005/ai-tab-optimizer.git
cd ai-tab-optimizer

# 2. Install extension dependencies
cd extension && pnpm install && cd ..

# 3. Build the extension
pnpm build
# Output: extension/dist/

# 4. Load in Chrome
#    chrome://extensions → Developer mode → Load unpacked → select extension/dist/

# 5. Set up and start the AI server
python -m venv .venv
.venv/bin/pip install -r requirements.txt
pnpm server
# Server starts at http://localhost:8765
```

Open the side panel by clicking the extension icon or pressing the configured keyboard shortcut.

---

## Development

```bash
# Watch mode — rebuilds on file changes
pnpm dev

# TypeScript check only
pnpm typecheck

# Start AI server
pnpm server

# Check server health
pnpm health
# → {"status":"ok"}
```

After changing the service worker, click **Reload** on the extension card in `chrome://extensions`.

---

## AI Providers

The server (`agent.py`) supports two local CLI providers with automatic failover:

| Provider | CLI | Default role |
|---|---|---|
| Claude Code | `claude` | Primary |
| Codex CLI | `codex` | Fallback |

Configure the active provider and fallback in the extension **Settings → AI Provider**. The server logs every provider attempt and exposes them in Settings → LLM Call Logs.

**Privacy:** The AI server runs entirely on `localhost`. Tab URLs, titles, and excerpts are passed only to the local CLI process — never to a remote server.

---

## Project Structure

```
ai-tab-optimizer/
├── agent.py                  # FastAPI AI server (local CLI orchestration)
├── requirements.txt          # Python dependencies
├── package.json              # Root workspace (pnpm scripts)
├── extension/
│   ├── src/
│   │   ├── background/       # Service worker (Chrome API bridge)
│   │   ├── side-panel/       # React app + Zustand store
│   │   │   └── components/   # AIRecommendations, ChatSearch, HistoryPanel, …
│   │   ├── content/          # On-demand page extractor
│   │   └── shared/
│   │       ├── types/        # TypeScript interfaces
│   │       ├── utils/        # URL, rules, Obsidian helpers
│   │       └── i18n/         # en / ru
│   └── public/
│       └── manifest.json     # MV3 manifest
├── PROJECT.md                # Full product spec & architecture
├── SETUP.md                  # Detailed dev environment guide
└── OBSIDIAN_INTEGRATION.md   # Vault export entity spec
```

---

## Roadmap

| Version | Focus |
|---|---|
| **v0.2.1** (current) | Analytics, focus mode, resumable analysis, per-tab status, SQLite search |
| **v0.3** | Provider health UI, snapshot comparison, additional local model adapters |
| **v1.0** | Onboarding, keyboard shortcuts, Chrome Web Store release |
| **v2.0** | Cross-device sync, Obsidian plugin, richer local model support |

---

## License

MIT — see [LICENSE](LICENSE).
