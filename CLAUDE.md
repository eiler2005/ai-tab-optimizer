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

**1. Research** — read relevant files, check existing patterns. Never assume.

**2. Plan** — enter Plan Mode (`/plan`), create `docs/plans/<slug>.md` from `@docs/templates/plan.md`. Do NOT write code until plan is reviewed.

**3. Implement** — execute task by task. After each task: run typecheck, mark `- [x]` in plan. Do not stop until all tasks done.

For small changes (typo, rename, single-line fix): skip planning, implement directly.

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

## Skills & Hooks

Available slash commands (skills):
- `/research <topic>` — explore codebase, write findings to `docs/research/<slug>.md`
- `/plan <feature>` — create implementation plan in `docs/plans/<slug>.md`
- `/implement <path-to-plan>` — execute an approved plan file

Hooks (configured in `.claude/settings.json`):
- Post-edit: run `pnpm typecheck` automatically after TypeScript file changes
