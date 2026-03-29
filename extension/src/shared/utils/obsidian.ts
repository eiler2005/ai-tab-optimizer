import type { TabRecord, TopicCluster, SnapshotRecord, AIAnalysisResult, CleanupReviewData } from '@shared/types';
import { slugify } from './url';

// IndexedDB helpers for storing FileSystemDirectoryHandle
const DB_NAME = 'tab-optimizer';
const STORE_NAME = 'handles';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('vaultHandle');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, 'vaultHandle');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  // queryPermission and requestPermission are Chrome-specific extensions
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission(opts: { mode: string }): Promise<string>;
    requestPermission(opts: { mode: string }): Promise<string>;
  };
  if (await h.queryPermission(opts) === 'granted') return true;
  if (await h.requestPermission(opts) === 'granted') return true;
  return false;
}

export async function getVaultHandle(): Promise<FileSystemDirectoryHandle> {
  const stored = await getStoredHandle();
  if (stored && await verifyPermission(stored)) return stored;

  // @ts-expect-error showDirectoryPicker is available in Chrome
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    id: 'obsidian-vault',
    mode: 'readwrite',
  });
  await storeHandle(handle);
  return handle;
}

async function ensureDir(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

function renderLinkNote(tab: TabRecord): string {
  const now = new Date().toISOString();
  const tags = [`#domain/${tab.domain}`];
  if (tab.userFlag === 'important') tags.push('#status/keep');
  if (tab.userFlag === 'read_later') tags.push('#status/later');

  return `---
title: "${tab.title.replace(/"/g, '\\"')}"
url: "${tab.url}"
domain: "${tab.domain}"
savedAt: "${now}"
source: "tab-optimizer"
status: "${tab.userFlag === 'important' ? 'keep' : tab.userFlag === 'read_later' ? 'later' : 'reference'}"
tags:
${tags.map((t) => `  - "${t}"`).join('\n')}
---

# ${tab.title}

**URL:** ${tab.url}
**Domain:** ${tab.domain}
**Saved:** ${now.slice(0, 10)}

## Notes
<!-- Add personal notes here -->
`;
}

export async function exportLinkNote(tab: TabRecord): Promise<string> {
  const vault = await getVaultHandle();
  const tabOptDir = await ensureDir(vault, 'TabOptimizer');
  const linksDir = await ensureDir(tabOptDir, 'Links');
  const domainDir = await ensureDir(linksDir, tab.domain);

  const filename = slugify(tab.title || tab.domain) + '.md';
  const fileHandle = await domainDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  const content = renderLinkNote(tab);
  await writable.write(content);
  await writable.close();

  return `TabOptimizer/Links/${tab.domain}/${filename}`;
}

// Track exported URLs in chrome.storage.local
export async function isAlreadyExported(url: string): Promise<boolean> {
  const result = await chrome.storage.local.get('exportedUrls');
  const exported = (result.exportedUrls ?? []) as string[];
  return exported.includes(url);
}

export async function markExported(url: string): Promise<void> {
  const result = await chrome.storage.local.get('exportedUrls');
  const exported = (result.exportedUrls ?? []) as string[];
  if (!exported.includes(url)) {
    exported.push(url);
    await chrome.storage.local.set({ exportedUrls: exported });
  }
}

// ─── TopicCluster Export ─────────────────────────────────

function renderTopicCluster(cluster: TopicCluster, tabs: TabRecord[]): string {
  const now = new Date().toISOString();
  const tags = cluster.tags.map((t) => `  - "${t}"`).join('\n');

  const linksTable = tabs
    .map((tab) => `| ${tab.title} | ${tab.url} | ${tab.domain} | ${tab.userFlag ?? 'reference'} |`)
    .join('\n');

  return `---
topic: "${cluster.name.replace(/"/g, '\\"')}"
createdAt: "${now}"
updatedAt: "${now}"
source: "tab-optimizer-ai"
linkCount: ${tabs.length}
tags:
${tags}
aiSummary: "${cluster.description.replace(/"/g, '\\"')}"
---

# ${cluster.name}

**Generated:** ${now.slice(0, 10)} | **Links:** ${tabs.length}

## AI Summary
${cluster.description}

## Links

| Title | URL | Domain | Status |
|-------|-----|--------|--------|
${linksTable}

## Notes
<!-- Personal notes about this topic cluster -->
`;
}

export async function exportTopicCluster(cluster: TopicCluster, tabs: TabRecord[]): Promise<string> {
  const vault = await getVaultHandle();
  const tabOptDir = await ensureDir(vault, 'TabOptimizer');
  const topicsDir = await ensureDir(tabOptDir, 'Topics');

  const filename = slugify(cluster.name) + '.md';
  const fileHandle = await topicsDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(renderTopicCluster(cluster, tabs));
  await writable.close();

  return `TabOptimizer/Topics/${filename}`;
}

// ─── TabSessionSnapshot Export ───────────────────────────

function renderSessionSnapshot(snapshot: SnapshotRecord, aiResult?: AIAnalysisResult): string {
  const date = new Date(snapshot.createdAt);
  const dateStr = date.toISOString();

  const windowSections = snapshot.windows
    .map((w, i) => {
      const tabRows = w.tabs
        .map((t, j) => `| ${j + 1} | ${t.title} | ${t.url} | ${t.domain} | ${t.pinned ? 'pinned' : ''} |`)
        .join('\n');
      return `## Window ${i + 1}${w.focused ? ' (Active)' : ''} — ${w.tabs.length} tabs

| # | Title | URL | Domain | Flags |
|---|-------|-----|--------|-------|
${tabRows}`;
    })
    .join('\n\n');

  const topDomains = snapshot.stats.topDomains
    .map((d, i) => `${i + 1}. ${d}`)
    .join('\n');

  return `---
snapshotId: "${snapshot.id}"
name: "${snapshot.name.replace(/"/g, '\\"')}"
createdAt: "${dateStr}"
trigger: "${snapshot.trigger}"
totalTabs: ${snapshot.stats.totalTabs}
totalWindows: ${snapshot.stats.totalWindows}
tags:
  - "#session/${dateStr.slice(0, 10)}"
${aiResult ? `aiSummary: "${aiResult.summary.replace(/"/g, '\\"')}"` : ''}
---

# ${snapshot.name}

**Date:** ${dateStr.slice(0, 16).replace('T', ' ')} | **Tabs:** ${snapshot.stats.totalTabs} | **Windows:** ${snapshot.stats.totalWindows}

${aiResult ? `## AI Summary\n${aiResult.summary}\n` : ''}
## Top Domains
${topDomains}

${windowSections}

## Notes
<!-- Post-session notes -->
`;
}

export async function exportSessionSnapshot(
  snapshot: SnapshotRecord,
  aiResult?: AIAnalysisResult
): Promise<string> {
  const vault = await getVaultHandle();
  const tabOptDir = await ensureDir(vault, 'TabOptimizer');
  const sessionsDir = await ensureDir(tabOptDir, 'Sessions');

  const date = new Date(snapshot.createdAt).toISOString().slice(0, 10);
  const filename = `${date}-${slugify(snapshot.name)}.md`;
  const fileHandle = await sessionsDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(renderSessionSnapshot(snapshot, aiResult));
  await writable.close();

  return `TabOptimizer/Sessions/${filename}`;
}

// ─── CleanupReview Export ────────────────────────────────

function renderCleanupReview(data: CleanupReviewData): string {
  const closedRows = data.closedTabs
    .map((t) => `| ${t.title} | ${t.url} | ${t.reason} |`)
    .join('\n');

  const savedRows = data.savedTabs
    .map((t) => `| ${t.title} | ${t.url} | ${t.note} |`)
    .join('\n');

  const groupedRows = data.groupedTabs
    .map((g) => `| ${g.groupName} | ${g.count} |`)
    .join('\n');

  return `---
date: "${data.date}"
tabsBefore: ${data.tabsBefore}
tabsAfter: ${data.tabsAfter}
tabsClosed: ${data.closedTabs.length}
tabsSaved: ${data.savedTabs.length}
tags:
  - "#cleanup/${data.date.slice(0, 7)}"
---

# Cleanup Review — ${data.date.slice(0, 10)}

**Before:** ${data.tabsBefore} tabs | **After:** ${data.tabsAfter} tabs | **Closed:** ${data.closedTabs.length} | **Saved:** ${data.savedTabs.length}

${data.closedTabs.length > 0 ? `## Closed Tabs
| Title | URL | Reason |
|-------|-----|--------|
${closedRows}
` : ''}
${data.savedTabs.length > 0 ? `## Saved
| Title | URL | Note |
|-------|-----|------|
${savedRows}
` : ''}
${data.groupedTabs.length > 0 ? `## Grouped
| Group Name | Tabs |
|------------|------|
${groupedRows}
` : ''}`;
}

export async function exportCleanupReview(data: CleanupReviewData): Promise<string> {
  const vault = await getVaultHandle();
  const tabOptDir = await ensureDir(vault, 'TabOptimizer');
  const cleanupsDir = await ensureDir(tabOptDir, 'Cleanups');

  const date = data.date.slice(0, 10);
  const filename = `${date}-cleanup.md`;
  const fileHandle = await cleanupsDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(renderCleanupReview(data));
  await writable.close();

  return `TabOptimizer/Cleanups/${filename}`;
}
