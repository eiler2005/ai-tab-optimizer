import type { TabRecord, WindowGroup } from '@shared/types';
import type { CollectionChange, CollectionDetails, CollectionMergePreview, CollectionPreview, CollectionWindow, SavedCollection, SavedTab, TabOperation } from '@shared/types/workspace';
import { collectionDetails } from '@shared/utils/library';
import { isStatefulChat } from '@shared/utils/page-safety';
import { readBrowserState } from './browser-state';
import { closeOperationItems } from './workspace-operations';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { isRestorableUrl, restoreWindows } from './session-actions';

const SAVE_PREVIEW_KEY = 'aitab.collection-preview.v1';
const MERGE_PREVIEW_KEY = 'aitab.collection-merge-preview.v1';

function collectionName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new Error('Collection name must contain 1–120 characters');
  return name;
}

export function detachWindows(windows: WindowGroup[]): CollectionWindow[] {
  return windows.map((window) => {
    const groups = new Map<number, string>();
    return { id: crypto.randomUUID(), focused: window.focused, tabs: window.tabs.filter((tab) => isRestorableUrl(tab.url)).map((tab) => {
      let groupKey: string | undefined;
      if (tab.groupId !== undefined) {
        groupKey = groups.get(tab.groupId) ?? crypto.randomUUID();
        groups.set(tab.groupId, groupKey);
      }
      return { itemId: crypto.randomUUID(), savedAt: Date.now(), url: tab.url, title: tab.title,
        domain: tab.domain, pinned: tab.pinned, active: tab.active, userFlag: tab.userFlag,
        favIconUrl: tab.favIconUrl, groupKey, groupName: tab.groupName, groupColor: tab.groupColor,
        groupCollapsed: tab.groupCollapsed };
    }) };
  }).filter((window) => window.tabs.length);
}

export async function previewCollection(name: string, tabIds?: number[]): Promise<CollectionPreview> {
  return withWorkspaceLock(async () => {
    const selected = tabIds ? new Set(tabIds) : null;
    const windows = (await readBrowserState()).map((window) => ({ ...window,
      tabs: window.tabs.filter((tab) => (!selected || selected.has(tab.id)) && isRestorableUrl(tab.url)) })).filter((window) => window.tabs.length);
    if (!windows.length) throw new Error('No restorable tabs selected');
    const preview: CollectionPreview = { id: crypto.randomUUID(), name: collectionName(name), createdAt: Date.now(), windows };
    await chrome.storage.session.set({ [SAVE_PREVIEW_KEY]: preview });
    return preview;
  });
}

export async function saveCollection(previewId: string, closeAfter: boolean, details: CollectionDetails = {}): Promise<{ collection: SavedCollection; operation?: TabOperation }> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const previous = workspace.collections.find((collection) => collection.id === previewId);
    if (previous) return { collection: previous, operation: workspace.operations.find((operation) => operation.id === previewId) };
    const stored = await chrome.storage.session.get(SAVE_PREVIEW_KEY);
    const preview = stored[SAVE_PREVIEW_KEY] as CollectionPreview | undefined;
    if (!preview || preview.id !== previewId || Date.now() - preview.createdAt > 300_000) throw new Error('Collection preview expired');
    const now = Date.now();
    const collection: SavedCollection = { id: preview.id, name: preview.name, createdAt: now, updatedAt: now,
      revision: 1, purpose: 'later', ...collectionDetails(details), windows: detachWindows(preview.windows) };
    workspace.collections.push(collection);
    const operation: TabOperation | undefined = closeAfter ? { id: preview.id, kind: 'close', createdAt: now,
      browserSessionId: await browserSessionId(), status: 'running',
      items: preview.windows.flatMap((window) => window.tabs.map((tab) => ({ tab, state: 'pending' as const }))) } : undefined;
    if (operation) workspace.operations.push(operation);
    // Both the saved collection and its recovery journal must exist before any close.
    await saveWorkspace(workspace);
    if (operation) await closeOperationItems(workspace, operation);
    return { collection, operation };
  });
}

export async function openCollection(id: string) {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const collection = workspace.collections.find((entry) => entry.id === id && !entry.deletedAt);
    if (!collection) throw new Error('Collection not found');
    const result = await restoreWindows(collection.windows.map((window) => ({ ...window, windowId: 0 })));
    try {
      const stored = await chrome.storage.local.get('userFlagsV2');
      const flags = (stored.userFlagsV2 ?? {}) as Record<string, TabRecord['userFlag']>;
      const restored = new Set((await Promise.all(result.restoredTabIds.map((tabId) => chrome.tabs.get(tabId)))).map((tab) => tab.url));
      for (const tab of collection.windows.flatMap((window) => window.tabs)) {
        if (restored.has(tab.url) && tab.userFlag && !flags[tab.url]) flags[tab.url] = tab.userFlag;
      }
      await chrome.storage.local.set({ userFlagsV2: flags });
    } catch (error) { result.errors.push('Pages opened; restoring page flags failed: ' + String(error)); }
    return result;
  });
}

export async function openCollectionItem(id: string, itemId: string): Promise<{ tabId: number; reused: boolean }> {
  return withWorkspaceLock(async () => {
    const collection = (await readWorkspace()).collections.find((entry) => entry.id === id && !entry.deletedAt);
    const item = collection?.windows.flatMap((window) => window.tabs).find((tab) => tab.itemId === itemId);
    if (!item || !isRestorableUrl(item.url)) throw new Error('Saved page not found');
    // Chat addresses may represent different unsaved sessions; never silently choose a copy.
    const existing = !isStatefulChat(item.url) ? (await readBrowserState()).flatMap((window) => window.tabs).find((tab) => tab.url === item.url) : undefined;
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      return { tabId: existing.id, reused: true };
    }
    if (item.userFlag) {
      const stored = await chrome.storage.local.get('userFlagsV2');
      const flags = stored.userFlagsV2 as Record<string, TabRecord['userFlag']> ?? {};
      if (!flags[item.url]) await chrome.storage.local.set({ userFlagsV2: { ...flags, [item.url]: item.userFlag } });
    }
    const tab = await chrome.tabs.create({ url: item.url, active: true, pinned: item.pinned });
    if (tab.id === undefined) throw new Error('Browser did not return a tab ID');
    return { tabId: tab.id, reused: false };
  });
}

export async function updateCollection(id: string, change: CollectionChange): Promise<void> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const collection = workspace.collections.find((entry) => entry.id === id);
    if (!collection) throw new Error('Collection not found');
    if (change.permanent) {
      if (!collection.deletedAt) throw new Error('Move the collection to trash first');
      workspace.collections = workspace.collections.filter((entry) => entry.id !== id);
    } else {
      Object.assign(collection, collectionDetails(change));
      if (change.name !== undefined) collection.name = collectionName(change.name);
      if (change.deleted !== undefined) collection.deletedAt = change.deleted ? Date.now() : undefined;
      if (change.itemId !== undefined) {
        const tab = collection.windows.flatMap((window) => window.tabs).find((item) => item.itemId === change.itemId);
        if (!tab || change.note === undefined || change.note.length > 20_000) throw new Error('Invalid note');
        tab.note = change.note;
      }
      collection.updatedAt = Date.now(); collection.revision += 1;
    }
    await saveWorkspace(workspace);
  });
}

function mergePageMetadata(kept: SavedTab, incoming: SavedTab): void {
  if (incoming.note && incoming.note !== kept.note) kept.note = [kept.note, incoming.note].filter(Boolean).join('\n\n---\n\n');
  if ((kept.note?.length ?? 0) > 20_000) throw new Error('Merged notes exceed 20,000 characters; keep the source collections separate');
  kept.pinned ||= incoming.pinned;
  const priority: Record<NonNullable<TabRecord['userFlag']>, number> = { protected: 3, important: 2, read_later: 1 };
  if (incoming.userFlag && priority[incoming.userFlag] > (kept.userFlag ? priority[kept.userFlag] : 0)) kept.userFlag = incoming.userFlag;
}

export async function previewCollectionMerge(ids: string[], name: string): Promise<CollectionMergePreview> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const selected = [...new Set(ids)].map((id) => workspace.collections.find((entry) => entry.id === id && !entry.deletedAt));
    if (!selected.length || selected.some((entry) => !entry)) throw new Error('Choose existing collections');
    const windows: CollectionWindow[] = [];
    const seen = new Map<string, SavedTab>();
    let inputTabs = 0;
    for (const collection of selected) {
      for (const window of collection!.windows) {
        const copies: SavedTab[] = [];
        for (const tab of window.tabs) {
          inputTabs += 1;
          const key = new URL(tab.url).href;
          const kept = seen.get(key);
          if (kept) { mergePageMetadata(kept, tab); continue; }
          const copy = { ...structuredClone(tab), itemId: crypto.randomUUID() };
          seen.set(key, copy); copies.push(copy);
        }
        if (copies.length) windows.push({ id: crypto.randomUUID(), focused: window.focused, tabs: copies });
      }
    }
    const preview: CollectionMergePreview = { id: crypto.randomUUID(), name: collectionName(name), createdAt: Date.now(),
      sourceRevisions: Object.fromEntries(selected.map((collection) => [collection!.id, collection!.revision])),
      windows, inputTabs, duplicatesRemoved: inputTabs - seen.size };
    await chrome.storage.session.set({ [MERGE_PREVIEW_KEY]: preview });
    return preview;
  });
}

export async function executeCollectionMerge(previewId: string): Promise<SavedCollection> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const previous = workspace.collections.find((collection) => collection.id === previewId);
    if (previous) return previous;
    const stored = await chrome.storage.session.get(MERGE_PREVIEW_KEY);
    const preview = stored[MERGE_PREVIEW_KEY] as CollectionMergePreview | undefined;
    if (!preview || preview.id !== previewId || Date.now() - preview.createdAt > 300_000) throw new Error('Merge preview expired');
    for (const [id, revision] of Object.entries(preview.sourceRevisions)) {
      const source = workspace.collections.find((collection) => collection.id === id && !collection.deletedAt);
      if (!source || source.revision !== revision) throw new Error('A source collection changed. Preview the merge again.');
    }
    const now = Date.now();
    const collection: SavedCollection = { id: preview.id, name: preview.name, createdAt: now, updatedAt: now,
      revision: 1, sourceCollectionIds: Object.keys(preview.sourceRevisions), windows: preview.windows };
    workspace.collections.push(collection);
    await saveWorkspace(workspace);
    return collection;
  });
}
