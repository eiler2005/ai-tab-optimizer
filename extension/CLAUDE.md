# Extension — Claude Code Guide

## Rules

- Always run `pnpm typecheck` after changes. Do not proceed with type errors.
- Use `@shared/*` alias for imports from shared/ (not relative paths like `../../shared/`).
- New message types must go through the discriminated union in `src/shared/types/messages.ts`.
- Never use the `any` type.
- No unnecessary comments or JSDoc.

## Build Commands

```bash
pnpm install          # install dependencies
pnpm dev              # vite build --watch → dist/
pnpm build            # tsc --noEmit && vite build → dist/
pnpm typecheck        # tsc --noEmit
```

## Vite Multi-Entry Build

Three entry points configured in vite.config.ts:
- `side-panel` → src/side-panel/index.html (React app)
- `popup` → src/popup/index.html (minimal)
- `service-worker` → src/background/service-worker.ts (outputs as dist/service-worker.js)

## Path Aliases

`@shared/*` maps to `src/shared/*` (configured in both tsconfig.json and vite.config.ts).

## Adding a New Component

1. Create `src/side-panel/components/ComponentName.tsx`
2. Use functional component with Tailwind classes
3. Import store hooks from `../store` for global state
4. Import types from `@shared/types`

## Adding a New Message Type

1. Add to the discriminated union in `src/shared/types/messages.ts`
2. Handle in service worker (`src/background/service-worker.ts`)
3. Send from side panel via `chrome.runtime.sendMessage`

## Adding a New Shared Type

1. Create or update file in `src/shared/types/`
2. Re-export from `src/shared/types/index.ts`

## Chrome APIs Used

- `chrome.tabs` — query, close, pin, move, events
- `chrome.tabGroups` — read group info
- `chrome.storage.local` — settings, snapshots, flags
- `chrome.sessions` — recently closed tabs
- `chrome.alarms` — scheduled snapshots (v0.2)
- `chrome.sidePanel` — side panel registration
- `chrome.runtime` — message passing

## Testing in Chrome

1. `pnpm build` (or `pnpm dev` for watch)
2. chrome://extensions → Developer mode → Load unpacked → select `dist/`
3. Service worker changes require clicking reload on the extension card
4. Manifest changes require removing and re-loading the extension

## Key Constraints

- Service worker is ephemeral (MV3) — no persistent state in memory
- External fetch calls must originate from service worker (CSP blocks from side panel)
- `chrome.storage.local` default quota: 10MB (request `unlimitedStorage` for more)
- Side Panel requires Chrome 114+
