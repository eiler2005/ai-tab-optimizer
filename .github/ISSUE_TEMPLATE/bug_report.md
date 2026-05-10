---
name: Bug report
about: Report something that doesn't work the way it should
title: "[bug] "
labels: bug
assignees: ''
---

## Summary

<!-- One sentence describing the bug. -->

## Steps to reproduce

1.
2.
3.

## What I expected to happen

<!-- The behaviour you thought was correct. -->

## What actually happened

<!-- The actual behaviour. Include error text verbatim where possible. -->

## Environment

- Chrome version: <!-- chrome://version → "Google Chrome" line -->
- OS: <!-- e.g. macOS 14.5, Windows 11, Ubuntu 24.04 -->
- Extension version: <!-- from chrome://extensions or manifest.json -->
- Python version (if backend involved): <!-- python3 --version -->
- Node / pnpm version (if rebuilding): <!-- node -v && pnpm -v -->
- AI provider primary / fallback: <!-- e.g. claude_code / codex_cli / none -->

## Logs

<details>
<summary>Service worker console</summary>

<!--
chrome://extensions → AI Tab Optimizer → "service worker" link → DevTools console.
Paste relevant lines. Redact anything sensitive (URLs, titles).
-->

```
```

</details>

<details>
<summary>Server runtime logs</summary>

<!--
Settings → SQLite tools → "Refresh runtime logs" — or `curl http://localhost:8765/runtime-logs`.
Paste the most recent ~30 lines.
-->

```
```

</details>

## Reproduction rate

- [ ] Always
- [ ] Often
- [ ] Sometimes
- [ ] Once, can't repro

## Anything else?

<!-- Screenshots, related issues, recent changes (e.g. "started after I enabled Codex CLI fallback"). -->
