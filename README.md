# AI Tab Optimizer

> Intelligent Chrome extension that turns tab chaos into structured knowledge — powered by **local AI**, no data leaves your machine.

[![Version](https://img.shields.io/badge/version-0.2.1-blue)](https://github.com/eiler2005/ai-tab-optimizer/releases)
[![Chrome](https://img.shields.io/badge/Chrome-114%2B-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange)](https://developer.chrome.com/docs/extensions/mv3/)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)

---

## Table of Contents

- [Screenshots](#screenshots)
- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development](#development)
- [AI Providers](#ai-providers)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Screenshots

> Screenshots coming soon — see [docs/screenshots/README.md](docs/screenshots/README.md) for naming conventions and how to contribute them.

**Views in the extension:**

| View | Description |
|---|---|
| **Tab List** | All open tabs across windows — filter, bulk close, duplicate badges |
| **AI Analysis** | Per-tab recommendations (keep / group / read later / close) with confidence scores |
| **Topic Clusters** | AI-grouped tabs, expandable with Go to / Close actions, Smart Tab Groups |
| **Analytics** | Habits score, activity heatmap (7×24), LLM-generated browsing insights |
| **Chat Search** | Conversational search over your entire tab history and AI analysis results |
| **Cleanup Session** | Guided step-by-step flow: review recommendations, accept/skip, close in bulk |
| **Snapshots** | Save and restore full browser sessions |
| **Settings** | AI provider, LLM call logs, URL cache browser, Obsidian vault path |

---

## What it does

AI Tab Optimizer helps you regain control of 100+ open tabs without losing context. It combines rule-based analysis with AI-powered topic clustering, guided cleanup sessions, and long-term analytics — all running locally on your machine.

| Feature | Description |
|---|---|
| **AI Analysis** | Batch-analyze all open tabs using Claude Code CLI or Codex CLI. Each tab gets an action recommendation (keep / group / read later / archive / close) with a confidence score and reason. |
| **Topic Clusters** | AI groups tabs into named theme clusters. One click creates Chrome Tab Groups from them. |
| **Persistent Cache** | Analysis results cached in local SQLite (180-day TTL). Revisit insights without re-running expensive AI calls. |
| **Tab Analytics** | Habits score, recommendation tracking, activity heatmap, LLM-generated browsing insights. |
| **Guided Cleanup** | Step-by-step session mode: review recommendations, accept/skip, close in bulk, export a summary. |
| **Obsidian Export** | Export tab links, topic clusters, session snapshots, and cleanup reports to your Obsidian vault. |
| **Chat Search** | Conversational search over your entire tab history and analysis results via SQLite-backed RAG. |
| **Tab History** | Full event log (opened/closed/activated) with stats, search, and timeframe filters. |

---

## How it works

```
Side Panel (React + Zustand)
        │  chrome.runtime.sendMessage  (45 request types, 8 broadcast events)
        ▼
Service Worker  (MV3 background)
        │  fetch → localhost:8765
        ▼
FastAPI AI Server  (agent.py)
        │  subprocess                   SQLite  (tab_analysis.db)
        ├─────────────────────────┐     ├── url_analysis        (per-URL AI results)
        ▼                         ▼     ├── analysis_runs       (resumable sessions)
Claude Code CLI            Codex CLI    ├── tab_history_events
   (primary)               (fallback)   ├── snapshots
                                        ├── llm_call_logs
                                        └── topic_clusters
```

**Key design decisions:**

- All AI inference runs **locally** via CLI subprocesses — no external API calls, no cloud storage
- Automatic **provider failover**: if Claude Code CLI times out or errors mid-batch, Codex CLI takes over
- **URL-based caching** (180-day TTL) makes previously-analyzed tabs instant on the next run
- Extension ↔ server communication passes only through the service worker (Chrome MV3 CSP requirement)
- **Tab IDs are ephemeral** — the extension stores URLs as stable keys and remaps IDs on each session

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

At least **one** AI provider CLI must be installed and authenticated. The extension runs without a CLI, but AI analysis features will be unavailable.

- [Install Claude Code CLI →](https://docs.anthropic.com/en/docs/claude-code)
- [Install Codex CLI →](https://github.com/openai/codex)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/eiler2005/ai-tab-optimizer.git
cd ai-tab-optimizer

# 2. Install extension dependencies
cd extension && pnpm install && cd ..

# 3. Build the extension
pnpm build
# → output: extension/dist/

# 4. Load in Chrome
# Open chrome://extensions → enable Developer mode → Load unpacked → select extension/dist/

# 5. Set up and start the AI server
python -m venv .venv
.venv/bin/pip install -r requirements.txt
pnpm server
# → FastAPI server starts at http://localhost:8765
```

Open the side panel by clicking the extension icon in the Chrome toolbar.

---

## Development

```bash
pnpm dev          # watch mode — rebuilds extension on file change
pnpm typecheck    # TypeScript check only (runs in extension/)
pnpm server       # start AI server (FastAPI + uvicorn)
pnpm health       # check server: curl http://localhost:8765/health
pnpm build        # production build (typecheck + vite)
```

After changing `service-worker.ts`, click **Reload** on the extension card in `chrome://extensions`.

For a full dev environment guide including troubleshooting, see [SETUP.md](SETUP.md).

---

## AI Providers

The server supports two local CLI providers with automatic failover:

| Provider | CLI binary | Default role | Config |
|---|---|---|---|
| Claude Code | `claude` | Primary | Settings → AI Provider → Primary |
| Codex CLI | `codex` | Fallback | Settings → AI Provider → Fallback |

The server logs every provider attempt with timing, token counts, and cost estimates. View them in **Settings → LLM Call Logs**.

**Privacy guarantee:** The AI server runs entirely on `localhost`. Tab URLs, titles, and page excerpts are passed only to the local CLI subprocess — never sent to a remote server or third-party API.

---

## Project Structure

```
ai-tab-optimizer/
├── agent.py                    # FastAPI AI server — CLI orchestration, SQLite, provider failover
├── requirements.txt            # Python deps: fastapi, uvicorn, aiosqlite, claude-agent-sdk
├── package.json                # Root workspace scripts
├── extension/
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.ts      # Chrome API bridge, message routing, AI proxy
│   │   ├── side-panel/
│   │   │   ├── store.ts               # Zustand store (all global state)
│   │   │   ├── App.tsx                # View router
│   │   │   └── components/            # React components (AIRecommendations, ChatSearch, …)
│   │   ├── content/
│   │   │   └── page-extractor.ts      # On-demand meta/H1/excerpt extraction
│   │   └── shared/
│   │       ├── types/                 # TypeScript interfaces (tab, ai, messages, snapshot, …)
│   │       ├── utils/                 # URL, rule engine, Obsidian export helpers
│   │       └── i18n/                  # English / Russian translations
│   └── public/
│       └── manifest.json              # MV3 manifest
├── docs/
│   ├── screenshots/                   # UI screenshots for README
│   └── templates/                     # Research & plan templates
├── PROJECT.md                         # Full product spec & architecture
├── SETUP.md                           # Detailed dev environment guide
└── OBSIDIAN_INTEGRATION.md            # Vault export entity spec
```

---

## Roadmap

| Version | Status | Focus |
|---|---|---|
| v0.1 | ✅ Complete | Tab list, rule-based analysis, manual snapshots, basic Obsidian export |
| v0.2 | ✅ Complete | AI analysis, tab history, topic clusters, cleanup session, auto-snapshots |
| v0.2.1 | ✅ Complete | Analytics, focus mode, resumable analysis, per-tab status, Chat Search |
| **v0.3** | Planned | Test suite, provider health UI, snapshot comparison, additional local model adapters |
| v1.0 | Planned | Onboarding, keyboard shortcuts, Chrome Web Store release |
| v2.0 | Planned | Cross-device sync, Obsidian plugin, richer local model support |

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and create a feature branch: `git checkout -b feat/your-feature`
2. **Set up** the dev environment following [SETUP.md](SETUP.md)
3. **Read** [CLAUDE.md](CLAUDE.md) for coding conventions and workflow rules
4. **Implement** your change — run `pnpm typecheck` before committing
5. **Submit** a pull request with a clear description of what and why

**Before opening a PR:**
- [ ] `pnpm typecheck` passes with no errors
- [ ] `pnpm build` produces a working extension
- [ ] New features are reflected in `PROJECT.md` and `MVP_FEATURES.md`
- [ ] No secrets, API keys, or personal data in commits

For larger features, open an issue first to discuss the approach.

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">Built with <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> · React · FastAPI · SQLite</p>
