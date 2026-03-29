# AI Tab Optimizer — Claude Code Guide

> Full product spec: @PROJECT.md | Dev setup: @SETUP.md | Feature scope: @MVP_FEATURES.md

## Core Rules

- **No `any`** — use `unknown` with type narrowing.
- **Typecheck after every change** — `cd extension && pnpm typecheck`. Stop on errors.
- **No speculative abstractions** — don't create helpers unless there are 3+ call sites.
- **No comments** unless logic is non-obvious. Never restate what code already says.
- **Follow existing patterns** — Zustand actions, discriminated union messages, Tailwind classes, `@shared/*` imports.
- **Update docs** when feature behavior changes.

## Commands

```bash
# Extension
cd extension && pnpm install    # install deps
pnpm dev                        # watch mode → dist/
pnpm build                      # typecheck + vite build
pnpm typecheck                  # TS check only

# AI Server
pnpm server                     # FastAPI on localhost:8765
pnpm health                     # curl health check

# Load in Chrome
# chrome://extensions → Developer mode → Load unpacked → extension/dist/
# After service worker changes: click Reload on extension card
```

## Workflow

Every non-trivial feature follows three phases — do not skip:

**1. Research** — `/research <topic>` — reads code, writes `docs/research/<slug>.md`

**2. Plan** — `/plan <feature>` — creates `docs/plans/<slug>.md` with task checklist. Do NOT code until approved.

**3. Implement** — `/implement <path-to-plan>` — executes tasks, typechecks, marks done.

For small changes (typo, rename, single-line fix): skip planning, implement directly.

## Skills (`.claude/skills/`)

| Skill | Trigger | Purpose |
|---|---|---|
| `/research` | Manual | Deep-research a topic, output to `docs/research/` |
| `/plan` | Manual | Create implementation plan in `docs/plans/` |
| `/implement` | Manual | Execute an approved plan task by task |

## Subagents (`.claude/agents/`)

| Agent | Model | Use case |
|---|---|---|
| `code-reviewer` | Sonnet | Review code for patterns, edge cases, project conventions |
| `security-reviewer` | Opus | Scan for injection, secrets, XSS, OWASP top 10 |
| `test-writer` | Sonnet | Generate Vitest / pytest tests for given files |

Usage: `"Use the code-reviewer agent to review store.ts"` or `"Use a subagent to review this for security issues"`

## Hooks (`.claude/settings.json`)

| Hook | Trigger | Action |
|---|---|---|
| PostToolUse (Edit/Write) | After `.ts`/`.tsx` file changes | Auto-runs `pnpm typecheck` |

## Pre-commit (`.husky/pre-commit`)

- TypeScript typecheck on staged `.ts`/`.tsx` files
- Secret detection scan (blocks commit if potential secrets found)

## CI/CD (`.github/workflows/ci.yml`)

Runs on push/PR to `master`:
- TypeScript check
- Extension build
- Python syntax check (`py_compile agent.py`)

## Key Architectural Constraints

- **Service worker is ephemeral** (MV3) — no persistent in-memory state. All state goes through `chrome.storage.local` or the AI server SQLite.
- **All server calls** must originate from the service worker, not the side panel (CSP).
- **Message types** are a discriminated union in `shared/types/messages.ts` — add new types there first.
- **Tab IDs are ephemeral** — Chrome reassigns them on restart. Always use URLs as stable keys; remap IDs on load.
- **`@shared/*`** is the path alias for `src/shared/*` — never use relative `../../shared/` imports.

## Common Gotchas

- `cluster.tabUrls` may be undefined in old cached results — always use optional chaining (`cluster.tabUrls?.[i]`).
- `GET_TAB_ANALYSIS_STATUS` returns run statuses only for active runs (status `running` or `stopped`); otherwise fetches fresh from server.
- After renaming/deleting a persistent cluster, always call `store.loadPersistentClusters()` to sync.
- `pnpm typecheck` runs from `extension/` directory, not root.

## Context Management

- Use `/clear` between unrelated tasks to reset context.
- Delegate large file explorations to subagents to keep main context clean.
- If Claude repeats the same mistake twice, clear context and write a better prompt.
- Use Plan Mode for multi-file changes or unfamiliar code areas.
