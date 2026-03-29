# Obsidian Integration — AI Tab Optimizer

## Role of Obsidian in the Product

Obsidian serves as the **long-term memory layer** for the browser. While the Chrome Extension manages the live session, Obsidian stores everything worth keeping:

- A searchable archive of URLs and why they mattered
- Topic clusters that emerge from browsing sessions
- A history of past browser states (session snapshots)
- A structured reading list
- Named work contexts tied to specific projects

The relationship is **one-way at MVP**: the extension writes to Obsidian. The extension does not read from Obsidian at MVP. In v2+, read-back can enable features like "you've saved this URL before" warnings.

---

## Entity Types

### 1. LinkNote
A single saved URL with context.

**File location:** `TabOptimizer/Links/{domain}/{slug}.md`

**Example filename:** `TabOptimizer/Links/github.com/openai-openai-cookbook.md`

**Template:**
```markdown
---
title: "OpenAI Cookbook"
url: "https://github.com/openai/openai-cookbook"
domain: "github.com"
savedAt: "2024-01-15T14:32:00Z"
source: "tab-optimizer"
status: "keep"
tags:
  - "#github"
  - "#machine-learning"
  - "#reference"
aiSummary: "Collection of practical examples and guides for using the OpenAI API."
saveReason: "Useful reference for API usage patterns"
sessionId: "snap_20240115_143200"
---

# OpenAI Cookbook

**URL:** https://github.com/openai/openai-cookbook
**Domain:** github.com
**Saved:** 2024-01-15

## AI Summary
Collection of practical examples and guides for using the OpenAI API.

## Notes
<!-- Add personal notes here -->

## Related
- [[TabOptimizer/Topics/machine-learning]]
- [[TabOptimizer/Sessions/2024-01-15-afternoon]]
```

**Status values:**
- `keep` — explicitly marked as important
- `later` — deferred for reading
- `archived` — read and no longer active
- `reference` — useful reference document
- `review` — needs follow-up
- `close_candidate` — flagged for possible deletion

---

### 2. TopicCluster
A group of related links organized by theme.

**File location:** `TabOptimizer/Topics/{topic-slug}.md`

**Example filename:** `TabOptimizer/Topics/machine-learning-papers.md`

**Template:**
```markdown
---
topic: "Machine Learning Papers"
createdAt: "2024-01-15T14:32:00Z"
updatedAt: "2024-01-15T14:32:00Z"
source: "tab-optimizer-ai"
linkCount: 5
tags:
  - "#machine-learning"
  - "#research"
  - "#papers"
aiSummary: "Collection of recent ML research papers focused on LLM alignment and efficiency."
---

# Machine Learning Papers

**Generated:** 2024-01-15 | **Links:** 5

## AI Summary
Collection of recent ML research papers focused on LLM alignment and efficiency.

## Links

| Title | URL | Domain | Status |
|-------|-----|--------|--------|
| Attention Is All You Need | https://arxiv.org/abs/1706.03762 | arxiv.org | keep |
| Constitutional AI | https://arxiv.org/abs/2212.08073 | arxiv.org | keep |
| ... | ... | ... | ... |

## Notes
<!-- Personal notes about this topic cluster -->

## Related Sessions
- [[TabOptimizer/Sessions/2024-01-15-afternoon]]
- [[TabOptimizer/Sessions/2024-01-10-morning]]
```

---

### 3. TabSessionSnapshot
A full record of a browser state at a point in time.

**File location:** `TabOptimizer/Sessions/{date}-{name-slug}.md`

**Example filename:** `TabOptimizer/Sessions/2024-01-15-afternoon-research.md`

**Template:**
```markdown
---
snapshotId: "snap_20240115_143200"
name: "Afternoon Research Session"
createdAt: "2024-01-15T14:32:00Z"
trigger: "manual"
totalTabs: 47
totalWindows: 2
mainTopics:
  - "machine learning"
  - "productivity tools"
  - "API documentation"
topDomains:
  - "github.com"
  - "arxiv.org"
  - "notion.so"
tags:
  - "#session/2024-01-15"
  - "#machine-learning"
  - "#productivity"
aiSummary: "Heavy research session focused on LLM tooling and productivity automation."
---

# Afternoon Research Session

**Date:** 2024-01-15 14:32 | **Tabs:** 47 | **Windows:** 2

## AI Summary
Heavy research session focused on LLM tooling and productivity automation.

## Main Topics
- Machine Learning (18 tabs)
- Productivity Tools (12 tabs)
- API Documentation (9 tabs)
- Miscellaneous (8 tabs)

## Top Domains
1. github.com — 15 tabs
2. arxiv.org — 8 tabs
3. notion.so — 4 tabs

## Duplicates Found
- 3 exact duplicates
- 5 near-duplicates

## Window 1 (Main) — 35 tabs

| # | Title | URL | Domain | Flags |
|---|-------|-----|--------|-------|
| 1 | OpenAI Cookbook | https://github.com/openai/openai-cookbook | github.com | keep |
| 2 | ... | ... | ... | ... |

## Window 2 (Reference) — 12 tabs

| # | Title | URL | Domain | Flags |
|---|-------|-----|--------|-------|
| 1 | ... | ... | ... | ... |

## Actions Taken
- Closed 8 duplicate tabs
- Grouped "ML Papers" cluster (5 tabs)
- Saved 12 tabs to reading list

## Notes
<!-- Post-session notes -->

## Related Topics
- [[TabOptimizer/Topics/machine-learning-papers]]
- [[TabOptimizer/Topics/productivity-tools]]
```

---

### 4. CleanupReview
A report of a specific cleanup operation.

**File location:** `TabOptimizer/Cleanups/{date}-cleanup.md`

**Template:**
```markdown
---
cleanupId: "cleanup_20240115_150000"
date: "2024-01-15T15:00:00Z"
sessionSnapshotId: "snap_20240115_143200"
tabsBefore: 47
tabsAfter: 31
tabsClosed: 16
tabsSaved: 8
tabsGrouped: 12
tags:
  - "#cleanup/2024-01"
---

# Cleanup Review — 2024-01-15

**Before:** 47 tabs | **After:** 31 tabs | **Closed:** 16 | **Saved:** 8

## Summary
Removed 16 tabs: 8 duplicates, 5 stale, 3 low-value.
Saved 8 important tabs to Obsidian.
Grouped 12 tabs into 2 Chrome tab groups.

## Closed Tabs
| Title | URL | Reason |
|-------|-----|--------|
| ... | ... | Exact duplicate |
| ... | ... | Stale (14 days) |

## Saved to Obsidian
| Title | URL | Note |
|-------|-----|------|
| ... | ... | [[TabOptimizer/Links/...]] |

## Grouped
| Group Name | Tabs |
|------------|------|
| ML Papers | 5 |
| Productivity | 7 |
```

---

### 5. ReadingList
An append-only rolling list of deferred tabs.

**File location:** `TabOptimizer/ReadingList.md`

**Template:**
```markdown
---
updatedAt: "2024-01-15T14:32:00Z"
totalItems: 23
tags:
  - "#reading-list"
---

# Reading List

> Updated: 2024-01-15 | 23 items

## Unread

- [ ] [Article Title](https://example.com) — example.com — *Added 2024-01-15*
- [ ] [Another Article](https://another.com) — another.com — *Added 2024-01-14*

## Read

- [x] [Completed Article](https://done.com) — *Read 2024-01-13*
```

---

### 6. WorkContext
A named collection of tabs for a specific project or task.

**File location:** `TabOptimizer/Contexts/{context-slug}.md`

**Template:**
```markdown
---
contextName: "API Redesign Project"
createdAt: "2024-01-15T14:32:00Z"
updatedAt: "2024-01-15T14:32:00Z"
status: "active"
tabCount: 8
tags:
  - "#project/api-redesign"
  - "#work-context"
---

# API Redesign Project

**Status:** Active | **Tabs:** 8 | **Created:** 2024-01-15

## Description
<!-- What this context is about -->

## Tabs

| Title | URL | Notes |
|-------|-----|-------|
| REST API Best Practices | https://... | Core reference |
| ... | ... | ... |

## Sessions Using This Context
- [[TabOptimizer/Sessions/2024-01-15-afternoon-research]]
```

---

## Folder Structure Inside Vault

```
{VaultRoot}/
└── TabOptimizer/
    ├── Links/
    │   ├── github.com/
    │   │   ├── openai-openai-cookbook.md
    │   │   └── ...
    │   ├── arxiv.org/
    │   │   └── ...
    │   └── notion.so/
    │       └── ...
    ├── Topics/
    │   ├── machine-learning-papers.md
    │   ├── productivity-tools.md
    │   └── ...
    ├── Sessions/
    │   ├── 2024-01-15-afternoon-research.md
    │   ├── 2024-01-14-morning.md
    │   └── ...
    ├── Cleanups/
    │   ├── 2024-01-15-cleanup.md
    │   └── ...
    ├── Contexts/
    │   ├── api-redesign-project.md
    │   └── ...
    └── ReadingList.md
```

---

## Naming Conventions

### File Names
- All lowercase
- Words separated by hyphens
- Domain subdirectories inside `Links/` use the exact domain as folder name
- Slugs derived from title: strip special chars, replace spaces with hyphens, max 60 chars

### Slug Generation Examples
```
"OpenAI Cookbook" → "openai-cookbook"
"React 18 – What's New?" → "react-18-whats-new"
"https://arxiv.org/abs/2301.00001" → "arxiv-2301-00001"
```

### Session File Names
Pattern: `{YYYY-MM-DD}-{time-of-day}-{optional-name}.md`

Time of day: `morning` (6–12), `afternoon` (12–18), `evening` (18–24), `night` (0–6)

Examples:
- `2024-01-15-afternoon.md` (auto-generated name)
- `2024-01-15-afternoon-api-research.md` (user-provided name)

---

## Tags Strategy

### System Tags (auto-applied)
| Tag Pattern | Source |
|---|---|
| `#domain/{domain}` | Extracted from URL |
| `#session/{YYYY-MM-DD}` | From snapshot date |
| `#status/{status}` | From tab status field |
| `#cleanup/{YYYY-MM}` | Applied to cleanup reviews |

### Topic Tags (AI-generated, v0.2+)
Applied to LinkNotes and TopicClusters. Examples:
`#machine-learning`, `#productivity`, `#documentation`, `#research`, `#reference`

### Manual Tags
Users can add free-form tags via the extension or directly in Obsidian. The extension reads these back in v2+.

---

## Integration Options — Comparison

### Option A: File System Access API (Recommended MVP)

**How it works:**
User grants permission to a directory (the vault) via Chrome's built-in file picker. The extension uses `showDirectoryPicker()` / `FileSystemDirectoryHandle` to write `.md` files directly.

**Pros:**
- No external dependencies
- Works offline
- No Obsidian plugin required
- Files appear in Obsidian automatically (Obsidian watches the vault folder)
- Standard web API, well-supported in Chrome

**Cons:**
- User must re-grant permission each browser session (unless persisted via `IndexedDB`)
- No read-back without additional permission grants
- Cannot write to paths outside the selected root
- Permission handle can be stored in IndexedDB to avoid re-picking each time

**Verdict:** Best choice for MVP. Simple, no setup required beyond selecting the vault folder once.

---

### Option B: Obsidian Local REST API Plugin

**How it works:**
User installs the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin in Obsidian. It exposes a local HTTP server. The extension calls it to create/update files.

**Pros:**
- Full read + write capability
- Can query vault contents (existing notes, tags)
- Enables "you've saved this before" deduplication
- More robust than File System API for complex operations

**Cons:**
- Requires user to install and configure an Obsidian plugin
- Requires Obsidian to be open and running
- Extension needs `http://localhost/*` host permission
- More setup friction for new users

**Verdict:** Good for v0.3+ as an advanced option. Too much friction for MVP.

---

### Option C: Obsidian URI Scheme

**How it works:**
Obsidian supports `obsidian://` URI calls for creating notes. The extension can call `window.open('obsidian://new?vault=...&name=...&content=...')`.

**Pros:**
- No plugin required
- Works with any Obsidian installation
- Simple to implement

**Cons:**
- URL-length limitations for large content
- Opens Obsidian in foreground (disruptive UX)
- Cannot write to specific folder paths reliably
- No confirmation of success/failure
- Not suitable for bulk exports

**Verdict:** Useful only as a fallback for single-note quick saves. Not suitable as primary integration method.

---

### Option D: Sync via Cloud Folder (Dropbox / iCloud / Git)

**How it works:**
The extension writes files to a local folder that is also synced to the cloud. Obsidian vault is in the same synced folder.

**Pros:**
- Works if vault is in iCloud, Dropbox, or any synced folder
- No extra setup beyond pointing to the right local folder

**Cons:**
- Depends on File System Access API (same as Option A)
- Sync latency means files may not appear immediately
- Adds infrastructure complexity

**Verdict:** This is a natural consequence of Option A — if the user's vault is in a synced folder, it just works. No special implementation needed.

---

## Recommended MVP Integration: Option A

**File System Access API**

Implementation steps:
1. User opens Settings → enters vault path hint (for display only)
2. On first Obsidian export action, call `showDirectoryPicker({ id: 'obsidian-vault', mode: 'readwrite' })`
3. Store the `FileSystemDirectoryHandle` in IndexedDB for reuse
4. On export: navigate directory tree to correct subfolder (create if missing), write `.md` file
5. Show success toast with file path

Code outline:
```typescript
// store handle in IndexedDB
async function getVaultHandle(): Promise<FileSystemDirectoryHandle> {
  const stored = await idb.get('vaultHandle');
  if (stored && await verifyPermission(stored, 'readwrite')) return stored;
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idb.set('vaultHandle', handle);
  return handle;
}

async function writeLinkNote(tab: TabRecord): Promise<void> {
  const vault = await getVaultHandle();
  const linksDir = await vault.getDirectoryHandle('TabOptimizer', { create: true });
  const domainDir = await linksDir.getDirectoryHandle('Links', { create: true });
  const tabDir = await domainDir.getDirectoryHandle(tab.domain, { create: true });
  const filename = slugify(tab.title) + '.md';
  const fileHandle = await tabDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(renderLinkNoteTemplate(tab));
  await writable.close();
}
```

---

## Backlinks & Cross-Referencing

Obsidian's `[[wikilink]]` syntax enables navigation between notes.

### Auto-applied backlinks
- Each LinkNote references its parent session: `[[TabOptimizer/Sessions/2024-01-15-afternoon]]`
- Each TopicCluster lists its sessions
- Each Session references its topic clusters and cleanup reviews

### Tag-based navigation
- All notes in a topic share the same tag (e.g. `#machine-learning`)
- Obsidian's tag pane shows all notes with that tag
- This provides a "poor man's graph" without explicit wikilinks

### Graph View
With consistent tagging and wikilinks, Obsidian's Graph View will naturally show:
- Session nodes connecting to many Link nodes
- Topic nodes connecting to related Link nodes
- Theme clusters emerging naturally

---

## Read-Back from Obsidian (v2+)

For v2, the extension should read back from the vault to enable:
- "You've already saved this URL" warning on export
- Auto-suggest tags based on existing tag usage
- Show related past sessions when viewing a tab
- "Last saved" date shown in tab list

Implementation requires either Option B (Local REST API) or scanning the vault directory via File System Access API.
