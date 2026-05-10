# Security Policy

AI Tab Optimizer is a desktop-only tool that runs entirely on the user's machine. There is no hosted backend, no cross-user state, and no telemetry. This document explains the security model, the trust boundaries, and how to report a vulnerability.

## Reporting a vulnerability

Please report security issues **privately** — do **not** open a public GitHub issue.

- Open a private security advisory via GitHub: https://github.com/eiler2005/ai-tab-optimizer/security/advisories/new
- Or contact the maintainer through a GitHub direct mention on a non-public channel.

When reporting, include:

1. A clear description of the vulnerability and its impact.
2. Steps to reproduce, with the relevant file paths and line numbers if possible.
3. The affected version (`extension/public/manifest.json` → `version`).
4. Your suggested remediation, if any.

You will receive an acknowledgement within a few days. Coordinated disclosure is appreciated; please give the maintainer reasonable time to ship a fix before publishing details.

## Supported versions

This is an early-stage project (current version: `0.2.x`). Only the latest released minor version receives security fixes.

| Version | Supported |
|---|---|
| `0.2.x` | Yes |
| `< 0.2` | No |

## Threat model

The project assumes a **single-user, trusted local machine** running on `localhost`. Specifically:

| Asset | Owner | Trust |
|---|---|---|
| Browser tabs and history | The user | Trusted input from the user's own session |
| `tab_analysis.db` (SQLite) | Local filesystem | Trusted; the user owns the file |
| FastAPI server (`agent.py`) | Localhost process | Trusted; runs only while the user starts it |
| Claude Code CLI / Codex CLI | External processes | Trusted to the same level as the user's shell |
| Other processes on the same machine | — | **Untrusted** for the purposes of network-bound services |
| Remote network actors | — | **Out of scope** unless the user exposes the server beyond loopback |

The extension never sends tab data to any non-localhost endpoint. The localhost server may invoke external CLIs (`claude`, `codex`); when the Codex CLI is used, prompts may be relayed to OpenAI through that CLI's own authenticated session. This is documented to the user in **Settings → AI Provider** and in the [README privacy section](README.md#ai-providers).

## Trust boundaries

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                    User's machine (trusted)                      │
   │                                                                  │
   │   ┌────────────────┐     IPC    ┌────────────────────────┐       │
   │   │ Chrome extens. │◄──────────►│ Service worker (MV3)   │       │
   │   └────────────────┘            └─────────┬──────────────┘       │
   │                                           │ HTTP (loopback)       │
   │                                           ▼                       │
   │                                 ┌────────────────────────┐       │
   │                                 │ FastAPI on 127.0.0.1   │       │
   │                                 │  + SQLite              │       │
   │                                 └─────────┬──────────────┘       │
   │                                           │ subprocess            │
   │                                           ▼                       │
   │                                 ┌────────────────────────┐       │
   │                                 │ Claude / Codex CLIs    │       │
   │                                 └─────────┬──────────────┘       │
   └───────────────────────────────────────────┼──────────────────────┘
                                               │  ↘ Codex CLI may
                                               │     relay prompts
                                               ▼     to OpenAI servers
                                          (cloud, only if Codex enabled)
```

Any path that crosses the boundary out of the trusted machine is documented and gated by the user's CLI configuration.

## Permissions and data

### Chrome permissions (`manifest.json`)

| Permission | Why we ask | Risk if abused |
|---|---|---|
| `tabs`, `tabGroups`, `sessions` | Read open/recently-closed tabs, group them | Reads URLs and titles |
| `storage` | Persist user flags, draft buffers | Writes to `chrome.storage.local` only |
| `alarms` | Auto-snapshot scheduling | None |
| `sidePanel` | Render the main UI | None |
| `scripting` | Inject the content script for on-demand page extraction | Only fires when the user opts in to extracting a page |
| `host_permissions: http://localhost/*` | Talk to the local FastAPI server | Loopback only |
| `optional_host_permissions: <all_urls>` | Page extraction (opt-in) | Granted only when the user triggers an extraction |

We deliberately keep `<all_urls>` as an **optional** permission, not a default one.

### Local data

- `tab_analysis.db` — SQLite database in the project root, holds tab analysis cache, history events, snapshots, settings, and LLM call logs. It is **not** committed (see `.gitignore`) and never leaves the machine.
- `chrome.storage.local` — small local KV used as an offline buffer when the server is unavailable.
- `.env` files — excluded from git via `.gitignore`. The repo ships `.env.example` with placeholders only.

## What we already do

- Pre-commit hook (`.husky/pre-commit`) runs TypeScript type-check on staged files and a basic secret scan to catch obvious leaks before they're committed.
- The extension uses Manifest V3 with the default strict CSP — no inline scripts.
- The Chrome extension communicates with the server only through the service worker, which keeps the side panel inside the MV3 CSP.
- Python dependencies are pinned in [`requirements.txt`](requirements.txt).
- TypeScript is `strict: true` with zero `any` types in the extension source.

## Known limitations and ongoing work

This is an early-stage project; some hardening is intentionally deferred. The current backlog of security improvements is tracked openly in [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md). Highlights:

- The FastAPI server currently binds permissively for development convenience and has no authentication on its endpoints. It is designed to be reached only over loopback; do not expose it to a network without first restricting bind address and adding auth.
- CORS is permissive for the same reason. Restricting it to the extension origin is on the roadmap.
- LLM prompts include user-controlled tab titles/URLs; prompt-injection hardening is on the backlog.

If you find an issue not yet listed there, please report it privately as described above.

## Out of scope

- Vulnerabilities that require physical access to an unlocked machine.
- Issues caused by user-installed third-party CLIs misbehaving (Claude Code, Codex). Report those to their respective vendors.
- Issues in dependencies that don't have a downstream impact on this project.
- Theoretical issues without a demonstrated practical impact.

Thanks for helping keep AI Tab Optimizer safe.
