# Contributing to AI Tab Optimizer

Thanks for taking the time to contribute. This guide is meant to be short — it points you to the right place rather than duplicating what already lives in the repo.

## TL;DR

```bash
git clone https://github.com/eiler2005/ai-tab-optimizer.git
cd ai-tab-optimizer
cd extension && pnpm install && cd ..
pnpm build           # builds the extension into extension/dist/
pnpm server          # starts the FastAPI server on http://localhost:8765
```

For a fully detailed setup including Python venv, Chrome unpacked-extension load, and CLI provider authentication — see [SETUP.md](SETUP.md).

## Before you open a PR

| Step | Command |
|---|---|
| Type-check the extension | `cd extension && pnpm typecheck` |
| Build the extension | `pnpm build` |
| Run TypeScript tests | `cd extension && pnpm test` |
| Run Python tests | `.venv/bin/pytest` |
| Confirm Python syntax | `.venv/bin/python -m py_compile agent.py server_core/*.py` |

The repo has a `pre-commit` hook (`.husky/pre-commit`) that runs `pnpm typecheck` on staged TypeScript files and a basic secret scan. Don't bypass it with `--no-verify`.

## Code style

- **No `any` types.** Use `unknown` with narrowing. The extension is `strict: true` and the codebase has zero `any` escape hatches; please keep it that way.
- **No new abstractions** until there are 3+ call sites. We prefer a tiny duplication to a premature helper.
- **Discriminated unions for messages.** New service-worker messages must be added to the union in [`extension/src/shared/types/messages.ts`](extension/src/shared/types/messages.ts) so exhaustiveness checks catch missed cases.
- **No comments restating code.** Comments only when *why* is non-obvious (a workaround, a subtle invariant, a Chrome API quirk).
- **Path alias `@shared/*`** — never use relative `../../shared/` imports.
- **Tailwind classes** for styling. No CSS-in-JS, no styled-components.

## Commit messages

Short, imperative, lowercase prefix when the scope is obvious — e.g.

```
fix: handle empty cluster.tabUrls on cached results
infra: add Vitest setup with coverage thresholds
docs: document resume-after-stop flow in ARCHITECTURE.md
```

We don't strictly enforce Conventional Commits, but recent history follows that shape and matching it keeps the log readable.

## Where to put things

| Change | Location |
|---|---|
| New extension feature | `extension/src/...` plus a corresponding test under `__tests__/` |
| New service-worker message | Add to `messages.ts` union, handle in `service-worker.ts`, add a Zustand action in `store.ts` |
| New shared type | `extension/src/shared/types/<file>.ts`, then re-export from `index.ts` |
| New FastAPI endpoint | `agent.py` (HTTP layer) + helpers in `server_core/` if logic is non-trivial |
| New SQLite migration | Schema changes in `agent.py` startup; document the new table/column in [PROJECT.md](PROJECT.md) |
| Behaviour change visible to users | Update [PROJECT.md](PROJECT.md) and [MVP_FEATURES.md](MVP_FEATURES.md) in the same PR |
| New env var | Add to [`.env.example`](.env.example) and to [SETUP.md](SETUP.md) |

## Tests

Write a test when the change is non-trivial. The repo currently uses:

- **Vitest** for TypeScript — see [`extension/src/**/__tests__/`](extension/src)
- **pytest** for Python — see [`tests/`](tests)

Coverage thresholds are not yet enforced in CI; aim for at least one test per new utility, message handler, or server endpoint. See [docs/TESTING.md](docs/TESTING.md) for the full strategy.

## Pull requests

Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md). Keep PRs small and focused — a single concern per PR.

For larger features (new view, new SQLite table, new provider), open an issue first to align on the approach. Save everyone the back-and-forth on a 600-line PR that needs to be redesigned.

## Reporting issues

- **Bugs** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include Chrome version, server logs from the **Settings → Runtime Logs** view, and reproduction steps.
- **Feature requests** — use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe the problem before the proposed solution.
- **Security issues** — please follow [SECURITY.md](SECURITY.md) for private disclosure. Do **not** open a public issue for security findings.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and assume good intent.

## License

By contributing, you agree your work is licensed under the [MIT License](LICENSE) of this project.
