# Pull Request

## Summary

<!-- One paragraph: what does this PR change and why? -->

## Motivation

<!-- The problem this solves, the bug it fixes, or the user need it addresses.
     Link to the issue if there is one: "Fixes #123" / "Refs #456". -->

## What changed

<!-- Bullet list of concrete changes. Mention new files, renamed types, new
     SQLite tables, new message types, new endpoints. -->

-
-
-

## Screenshots / recordings

<!-- For UI changes, attach a before/after screenshot or short clip.
     Capture from the side panel at 360x720 (the project's default width). -->

## Test plan

<!-- How did you verify the change? Use checkboxes; check what you actually ran. -->

- [ ] `cd extension && pnpm typecheck` passes with no errors
- [ ] `pnpm build` produces a working extension
- [ ] `cd extension && pnpm test` passes (Vitest)
- [ ] `.venv/bin/pytest` passes (Python integration)
- [ ] Loaded the unpacked extension in Chrome and exercised the affected views
- [ ] If touching `agent.py` or `server_core/`: started `pnpm server` and verified `/health`

## Risk and rollback

<!-- What could break? What's the rollback plan?
     Examples:
       - "Adds SQLite column with default; old DBs migrate transparently."
       - "If broken, revert this commit; no migration needed." -->

## Documentation

- [ ] Updated `PROJECT.md` if user-visible behaviour changed
- [ ] Updated `MVP_FEATURES.md` if a feature was added/closed/dropped
- [ ] Updated `CHANGELOG.md` under `[Unreleased]`
- [ ] Added/updated tests
- [ ] Added/updated `.env.example` if a new env var was introduced
- [ ] No secrets, API keys, or personal data in the diff

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to.
     Specific files, tricky logic, performance considerations, follow-ups. -->
