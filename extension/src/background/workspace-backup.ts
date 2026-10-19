import type { SnapshotRecord, TabRecord, UserSettings } from '@shared/types';
import type { CollectionWindow, SavedCollection, SavedTab, TabOperation, WorkspaceData } from '@shared/types/workspace';
import { extractDomain } from '@shared/utils/url';
import { isRestorableUrl } from './session-actions';
import { readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { collectionDetails } from '@shared/utils/library';
import type { CollectionDetails } from '@shared/types/workspace';

import { topicPairFingerprint } from '@shared/utils/topics';
import { parseTopicBackup } from './topic-backup';

const IMPORT_PREVIEW_KEY = 'aitab.import-preview.v1';
const LEGACY_KEYS = ['settings', 'snapshots', 'tabHistory', 'userFlagsV2', 'exportedUrls', 'locale', 'aitab.review-focus'];
const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
const FLAGS = ['protected', 'important', 'read_later'] as const;

export interface ImportPreview {
  id: string;
  createdAt: number;
  collections: SavedCollection[];
  operations: TabOperation[];
  legacy: Record<string, unknown>;
  skipped: number;
  reviewDecisions?: WorkspaceData['reviewDecisions'];
  urlRules?: WorkspaceData['urlRules'];
  topicCatalog?: WorkspaceData['topicCatalog'];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Date.now();
}
function text(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  if (value.length > max) throw new Error('An imported text field exceeds its size limit');
  return value;
}

function parseOptimizationReport(raw: unknown): TabOperation['optimizationReport'] {
  if (!record(raw)) return undefined;
  const keys = ['tabsBefore', 'tabsAfter', 'requested', 'closed', 'skipped', 'failed'] as const;
  if (!keys.every((key) => typeof raw[key] === 'number' && Number.isSafeInteger(raw[key]) && (raw[key] as number) >= 0 && (raw[key] as number) <= 1_000_000)) return undefined;
  return { tabsBefore: raw.tabsBefore as number, tabsAfter: raw.tabsAfter as number,
    requested: raw.requested as number, closed: raw.closed as number,
    skipped: raw.skipped as number, failed: raw.failed as number,
    ...Object.fromEntries(['archived', 'duplicatesClosed', 'outdatedClosed'].flatMap((key) => typeof raw[key] === 'number' && Number.isSafeInteger(raw[key]) && (raw[key] as number) >= 0 && (raw[key] as number) <= 1_000_000 ? [[key, raw[key]]] : [])) };
}

function parseTab(raw: unknown, groups: Map<string, string>): SavedTab | null {
  if (!record(raw) || typeof raw.url !== 'string' || raw.url.length > 65_536 || !isRestorableUrl(raw.url)) return null;
  const oldGroup = typeof raw.groupKey === 'string' ? raw.groupKey : typeof raw.groupId === 'number' ? String(raw.groupId) : typeof raw.groupName === 'string' ? raw.groupName : undefined;
  let groupKey: string | undefined;
  if (oldGroup !== undefined) {
    groupKey = groups.get(oldGroup) ?? crypto.randomUUID(); groups.set(oldGroup, groupKey);
  }
  const userFlag = FLAGS.find((flag) => flag === raw.userFlag);
  return { itemId: crypto.randomUUID(), savedAt: timestamp(raw.savedAt), url: raw.url,
    title: text(raw.title, 4000, raw.url), domain: extractDomain(raw.url), pinned: raw.pinned === true,
    active: raw.active === true, userFlag, note: text(raw.note, 20_000), groupKey,
    groupName: typeof raw.groupName === 'string' ? text(raw.groupName, 120) : undefined,
    groupColor: COLORS.find((color) => color === raw.groupColor), groupCollapsed: raw.groupCollapsed === true };
}

function parseWindows(raw: unknown, counter: { skipped: number; tabs: number }): CollectionWindow[] {
  if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Invalid window list');
  const result: CollectionWindow[] = [];
  for (const window of raw) {
    if (!record(window) || !Array.isArray(window.tabs)) { counter.skipped += 1; continue; }
    const groups = new Map<string, string>();
    const tabs: SavedTab[] = [];
    for (const entry of window.tabs) {
      counter.tabs += 1;
      if (counter.tabs > 20_000) throw new Error('Backup exceeds 20,000 tab entries');
      const tab = parseTab(entry, groups);
      if (tab) tabs.push(tab); else counter.skipped += 1;
    }
    if (tabs.length) result.push({ id: crypto.randomUUID(), focused: window.focused === true, tabs });
  }
  return result;
}

function safeSettings(raw: unknown): Partial<UserSettings> | undefined {
  if (!record(raw)) return undefined;
  const result: Partial<UserSettings> = {};
  if (Array.isArray(raw.protectedDomains)) result.protectedDomains = raw.protectedDomains.filter((domain): domain is string => typeof domain === 'string' && /^[a-z0-9.-]{1,253}$/i.test(domain));
  const limits = { staleDaysThreshold: [1, 365], maxStoredSnapshots: [1, 500], autoSnapshotIntervalHours: [1, 24], historyRetentionDays: [7, 90] } as const;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = raw[key]; const [min, max] = limits[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) result[key] = value;
  }
  if (typeof raw.autoSnapshotEnabled === 'boolean') result.autoSnapshotEnabled = raw.autoSnapshotEnabled;
  return result;
}

export function parseBackup(json: string): ImportPreview {
  if (new TextEncoder().encode(json).length > 8_000_000) throw new Error('Backup exceeds 8 MB');
  const raw: unknown = JSON.parse(json);
  if (!record(raw) || raw.format !== 'aitab-backup' || raw.version !== 1 || !Array.isArray(raw.collections)) throw new Error('Expected an AITab backup version 1');
  if (raw.collections.length > 200) throw new Error('Backup exceeds 200 collections');
  const counter = { skipped: 0, tabs: 0 };
  const collections: SavedCollection[] = [];
  const collectionIds = new Map<string, string>();
  const itemKeys = new Map<string, string>();
  for (const entry of raw.collections) {
    if (!record(entry) || typeof entry.name !== 'string' || !entry.name.trim()) { counter.skipped += 1; continue; }
    const windows = parseWindows(entry.windows, counter);
    if (!windows.length) { counter.skipped += 1; continue; }
    collections.push({ id: crypto.randomUUID(), name: text(entry.name, 120), createdAt: timestamp(entry.createdAt),
      updatedAt: Date.now(), revision: 1, deletedAt: typeof entry.deletedAt === 'number' ? timestamp(entry.deletedAt) : undefined,
      ...collectionDetails({ purpose: entry.purpose, reason: entry.reason, focus: entry.focus, reviewAt: entry.reviewAt } as CollectionDetails), windows });
    if (typeof entry.id === 'string') {
      const id = collections[collections.length - 1].id; collectionIds.set(entry.id, id);
      const originals: Record<string, unknown>[] = [];
      if (Array.isArray(entry.windows)) for (const window of entry.windows) if (record(window) && Array.isArray(window.tabs)) for (const item of window.tabs) {
        if (record(item) && typeof item.url === 'string' && item.url.length <= 65_536 && isRestorableUrl(item.url)) originals.push(item);
      }
      const detached = windows.flatMap((window) => window.tabs);
      originals.forEach((item, index) => { if (typeof item.itemId === 'string' && detached[index]) itemKeys.set(`saved:${entry.id}:${item.itemId}`, `saved:${id}:${detached[index].itemId}`); });
    }
  }
  const operations: TabOperation[] = [];
  if (Array.isArray(raw.operations)) {
    if (raw.operations.length > 100) throw new Error('Backup exceeds 100 operations');
    for (const entry of raw.operations) {
      if (!record(entry) || !['close', 'move'].includes(String(entry.kind)) || !Array.isArray(entry.items)) { counter.skipped += 1; continue; }
      const groups = new Map<string, string>();
      const items: TabOperation['items'] = [];
      for (const [index, item] of entry.items.entries()) {
        counter.tabs += 1;
        if (counter.tabs > 20_000) throw new Error('Backup exceeds 20,000 tab entries');
        if (!record(item)) { counter.skipped += 1; continue; }
        const saved = parseTab(item.tab, groups);
        if (!saved || !record(item.tab)) { counter.skipped += 1; continue; }
        const original = item.tab;
        const tab: TabRecord = { id: -(index + 1), windowId: typeof original.windowId === 'number' && Number.isSafeInteger(original.windowId) ? original.windowId : 0,
          index: typeof original.index === 'number' && Number.isInteger(original.index) && original.index >= 0 ? original.index : index,
          url: saved.url, title: saved.title, domain: saved.domain, pinned: saved.pinned, active: saved.active ?? false,
          userFlag: saved.userFlag, groupName: saved.groupName, groupColor: saved.groupColor, groupCollapsed: saved.groupCollapsed };
        if (saved.groupKey) tab.groupId = -2 - [...groups.values()].indexOf(saved.groupKey);
        const state = item.state === 'done' ? 'done' : item.state === 'undone' ? 'undone' : item.state === 'failed' ? 'failed' : 'uncertain';
        items.push({ tab, state, error: typeof item.error === 'string' ? text(item.error, 4000) : undefined });
      }
      if (items.length) operations.push({ id: crypto.randomUUID(), kind: entry.kind === 'move' ? 'move' : 'close', createdAt: timestamp(entry.createdAt),
        browserSessionId: 'imported:' + crypto.randomUUID(), status: items.some((item) => item.state === 'uncertain') ? 'interrupted' : items.some((item) => item.state === 'done') ? 'completed' : 'undone', items,
        optimizationReport: parseOptimizationReport(entry.optimizationReport) });
    }
  }
  const legacy: Record<string, unknown> = {};
  if (record(raw.legacy)) {
    if (typeof raw.legacy['aitab.review-focus'] === 'string') legacy['aitab.review-focus'] = text(raw.legacy['aitab.review-focus'], 1000);
    const settings = safeSettings(raw.legacy.settings); if (settings) legacy.settings = settings;
    if (raw.legacy.locale === 'ru' || raw.legacy.locale === 'en') legacy.locale = raw.legacy.locale;
    if (Array.isArray(raw.legacy.exportedUrls)) legacy.exportedUrls = raw.legacy.exportedUrls.filter((url): url is string => typeof url === 'string' && isRestorableUrl(url));
    if (record(raw.legacy.userFlagsV2)) legacy.userFlagsV2 = Object.fromEntries(Object.entries(raw.legacy.userFlagsV2).filter(([url, flag]) => isRestorableUrl(url) && FLAGS.some((value) => value === flag)));
    if (Array.isArray(raw.legacy.snapshots)) {
      if (raw.legacy.snapshots.length > 100) throw new Error('Backup exceeds 100 local snapshots');
      const snapshots: SnapshotRecord[] = [];
      for (const entry of raw.legacy.snapshots) {
        if (!record(entry)) { counter.skipped += 1; continue; }
        const windows = parseWindows(entry.windows, counter).map((window) => ({ ...window, windowId: 0 }));
        if (!windows.length) continue;
        snapshots.push({ id: crypto.randomUUID(), name: text(entry.name, 120, 'Imported snapshot'), createdAt: timestamp(entry.createdAt), trigger: 'manual', windows,
          stats: { totalTabs: windows.reduce((sum, window) => sum + window.tabs.length, 0), totalWindows: windows.length, topDomains: [] } });
      }
      legacy.snapshots = snapshots;
    }
    if (Array.isArray(raw.legacy.tabHistory)) {
      if (raw.legacy.tabHistory.length > 20_000) throw new Error('Backup exceeds 20,000 local history events');
      legacy.tabHistory = raw.legacy.tabHistory.flatMap((entry) => {
        if (!record(entry) || typeof entry.url !== 'string' || !isRestorableUrl(entry.url) || !['opened', 'closed', 'activated'].includes(String(entry.event))) { counter.skipped += 1; return []; }
        return [{ tabId: 0, url: entry.url, title: text(entry.title, 4000, entry.url), domain: extractDomain(entry.url), event: entry.event, timestamp: timestamp(entry.timestamp) }];
      });
    }
  }
  const reviewDecisions: NonNullable<WorkspaceData['reviewDecisions']> = [];
  if (Array.isArray(raw.reviewDecisions)) for (const item of raw.reviewDecisions.slice(-500)) {
    if (record(item) && typeof item.key === 'string' && /^[a-f0-9]{64}$/.test(item.key) && (item.kind === 'keep' || item.kind === 'complementary')
      && typeof item.createdAt === 'number' && Number.isSafeInteger(item.createdAt) && item.createdAt > 0 && item.createdAt <= Date.now()) {
      reviewDecisions.push({ key: item.key, kind: item.kind, createdAt: item.createdAt });
    }
  }
  const urlRules: NonNullable<WorkspaceData['urlRules']> = [];
  if (Array.isArray(raw.urlRules)) for (const rule of raw.urlRules.slice(0, 50)) {
    if (!record(rule) || typeof rule.hostname !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(rule.hostname) || typeof rule.collectionId !== 'string') continue;
    const collectionId = collectionIds.get(rule.collectionId);
    if (collectionId) urlRules.push({ id: crypto.randomUUID(), hostname: rule.hostname.toLowerCase(), collectionId, mode: 'suggest' });
  }
  const topicCatalog = parseTopicBackup(raw.topicCatalog, collectionIds, itemKeys);
  return { id: crypto.randomUUID(), createdAt: Date.now(), collections, operations, legacy, reviewDecisions, urlRules, topicCatalog, skipped: counter.skipped };
}

export async function exportWorkspaceBackup(): Promise<string> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const legacy = await chrome.storage.local.get(LEGACY_KEYS);
    legacy.settings = safeSettings(legacy.settings);
    return JSON.stringify({ format: 'aitab-backup', version: 1, exportedAt: Date.now(), collections: workspace.collections, operations: workspace.operations, reviewDecisions: workspace.reviewDecisions, urlRules: workspace.urlRules, topicCatalog: workspace.topicCatalog, legacy }, null, 2);
  });
}

export async function previewBackupImport(json: string): Promise<ImportPreview> {
  return withWorkspaceLock(async () => {
    const preview = parseBackup(json);
    await chrome.storage.session.set({ [IMPORT_PREVIEW_KEY]: preview });
    return preview;
  });
}

export async function executeBackupImport(previewId: string): Promise<{ imported: number; skipped: number }> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const stored = await chrome.storage.session.get(IMPORT_PREVIEW_KEY);
    const preview = stored[IMPORT_PREVIEW_KEY] as ImportPreview | undefined;
    if (!preview || preview.id !== previewId || Date.now() - preview.createdAt > 300_000) throw new Error('Import preview expired');
    if (workspace.importedBackupIds?.includes(previewId)) return { imported: 0, skipped: preview.skipped };
    workspace.collections.push(...preview.collections); workspace.operations.push(...preview.operations);
    if (preview.topicCatalog) {
      const currentTopics = workspace.topicCatalog ?? { version: 1 as const, revision: 0, topics: [], history: [], distinct: [] };
      if (currentTopics.topics.length + preview.topicCatalog.topics.length > 500) throw new Error('Imported catalog exceeds 500 topics');
      currentTopics.topics.push(...preview.topicCatalog.topics);
      for (const decision of preview.topicCatalog.distinct) {
        const a = preview.topicCatalog.topics.find((topic) => topic.id === decision.a);
        const b = preview.topicCatalog.topics.find((topic) => topic.id === decision.b);
        if (a && b) currentTopics.distinct.push({ a: a.id, b: b.id, fingerprint: await topicPairFingerprint(a, b) });
      }
      currentTopics.distinct = currentTopics.distinct.slice(-500);
      currentTopics.revision++; workspace.topicCatalog = currentTopics;
    }
    workspace.reviewDecisions = [...new Map([...(preview.reviewDecisions ?? []), ...(workspace.reviewDecisions ?? [])].map((entry) => [entry.key, entry])).values()].slice(-500);
    workspace.urlRules = [...(workspace.urlRules ?? []), ...(preview.urlRules ?? [])].slice(0, 50);
    workspace.importedBackupIds = [...(workspace.importedBackupIds ?? []), previewId].slice(-100);
    const current = await chrome.storage.local.get(LEGACY_KEYS);
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(preview.legacy)) {
      if (Array.isArray(value)) extra[key] = [...(Array.isArray(current[key]) ? current[key] : []), ...value];
      else if (key === 'userFlagsV2') extra[key] = { ...(value as object), ...(current[key] as object ?? {}) };
      else if (current[key] === undefined) extra[key] = value;
    }
    await saveWorkspace(workspace, extra);
    return { imported: preview.collections.length, skipped: preview.skipped };
  });
}
