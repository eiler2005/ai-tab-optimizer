import type { TabRecord } from '@shared/types';
import type { OperationItem, TabOperation, WindowMergePreview, WorkspaceData } from '@shared/types/workspace';
import { readBrowserState } from './browser-state';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';

const MERGE_PREVIEW_KEY = 'aitab.window-preview.v1';

export async function previewWindowMerge(targetWindowId: number, tabIds: number[]): Promise<WindowMergePreview> {
  return withWorkspaceLock(async () => {
    const windows = await readBrowserState();
    const target = windows.find((window) => window.windowId === targetWindowId);
    if (!target) throw new Error('Choose an open normal target window');
    const selected = new Set(tabIds);
    const tabs = windows.filter((window) => window.windowId !== targetWindowId).flatMap((window) => window.tabs)
      .filter((tab) => selected.has(tab.id));
    if (tabs.length !== selected.size || !tabs.length) throw new Error('Choose current tabs from other normal windows');
    const preview: WindowMergePreview = { id: crypto.randomUUID(), createdAt: Date.now(), targetWindowId, tabs,
      originalFocusedWindowId: windows.find((window) => window.focused)?.windowId,
      targetActiveTabId: target.tabs.find((tab) => tab.active)?.id };
    await chrome.storage.session.set({ [MERGE_PREVIEW_KEY]: preview });
    return preview;
  });
}

async function checkOriginal(tab: TabRecord): Promise<void> {
  const current = await chrome.tabs.get(tab.id);
  if (current.url !== tab.url || current.windowId !== tab.windowId || current.incognito
    || current.groupId !== (tab.groupId ?? -1) || current.pinned !== tab.pinned) {
    throw new Error('Tab changed after preview; scan again');
  }
}

async function restoreGroup(tab: TabRecord, tabId: number, windowId: number, groups: Map<string, number>): Promise<void> {
  if (tab.pinned || tab.groupId === undefined) return;
  const key = tab.windowId + ':' + tab.groupId;
  let groupId = groups.get(key);
  if (groupId === undefined) {
    try {
      const existing = await chrome.tabGroups.get(tab.groupId);
      if (existing.windowId === windowId) groupId = existing.id;
    } catch { /* Original group may have disappeared. */ }
  }
  if (groupId === undefined) {
    groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: tab.groupName ?? '', color: tab.groupColor ?? 'grey', collapsed: tab.groupCollapsed ?? false });
  } else await chrome.tabs.group({ tabIds: [tabId], groupId });
  groups.set(key, groupId);
}

export async function executeWindowMerge(previewId: string): Promise<TabOperation> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const previous = workspace.operations.find((operation) => operation.id === previewId);
    if (previous) return previous;
    const stored = await chrome.storage.session.get(MERGE_PREVIEW_KEY);
    const preview = stored[MERGE_PREVIEW_KEY] as WindowMergePreview | undefined;
    if (!preview || preview.id !== previewId || Date.now() - preview.createdAt > 300_000) throw new Error('Preview expired. Preview the merge again.');
    const target = await chrome.windows.get(preview.targetWindowId);
    if (target.incognito || target.type !== 'normal') throw new Error('Target must be a normal non-private window');
    const items: OperationItem[] = [...preview.tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned)
      || a.windowId - b.windowId || a.index - b.index).map((tab) => ({ tab, state: 'pending' }));
    const operation: TabOperation = { id: preview.id, createdAt: Date.now(), browserSessionId: await browserSessionId(),
      kind: 'move', status: 'running', items, targetWindowId: preview.targetWindowId,
      originalFocusedWindowId: preview.originalFocusedWindowId, targetActiveTabId: preview.targetActiveTabId };
    workspace.operations.push(operation);
    await saveWorkspace(workspace);
    const targetGroups = new Map<string, number>();
    for (const item of operation.items) {
      if (item.state !== 'pending') continue;
      let batch = [item];
      try {
        await checkOriginal(item.tab);
        if (item.tab.groupId !== undefined) {
          const groupTabs = (await readBrowserState()).flatMap((window) => window.tabs).filter((tab) => tab.groupId === item.tab.groupId);
          const selected = operation.items.filter((candidate) => candidate.state === 'pending' && candidate.tab.groupId === item.tab.groupId);
          if (groupTabs.length === selected.length && selected.every((candidate) => groupTabs.some((tab) => tab.id === candidate.tab.id))) {
            for (const candidate of selected) await checkOriginal(candidate.tab);
            batch = selected;
          }
        }
      } catch (error) {
        item.state = 'skipped'; item.error = String(error); await saveWorkspace(workspace); continue;
      }
      for (const candidate of batch) candidate.state = 'applying';
      await saveWorkspace(workspace);
      try {
        if (item.tab.groupId !== undefined && batch.length > 1) {
          await chrome.tabGroups.move(item.tab.groupId, { windowId: preview.targetWindowId, index: -1 });
          for (const candidate of batch) { candidate.state = 'done'; candidate.movedGroupId = (await chrome.tabs.get(candidate.tab.id)).groupId; }
        } else {
          const pinnedCount = (await chrome.tabs.query({ windowId: preview.targetWindowId })).filter((tab) => tab.pinned).length;
          await chrome.tabs.move(item.tab.id, { windowId: preview.targetWindowId, index: item.tab.pinned ? pinnedCount : -1 });
          item.state = 'done';
          await chrome.tabs.update(item.tab.id, { pinned: item.tab.pinned });
          await restoreGroup(item.tab, item.tab.id, preview.targetWindowId, targetGroups);
          item.movedGroupId = (await chrome.tabs.get(item.tab.id)).groupId;
        }
      } catch (error) {
        for (const candidate of batch) {
          try {
            const current = await chrome.tabs.get(candidate.tab.id);
            candidate.state = current.windowId === preview.targetWindowId && current.url === candidate.tab.url ? 'done' : 'failed';
          } catch { candidate.state = 'uncertain'; }
          candidate.error = String(error);
        }
      }
      await saveWorkspace(workspace);
    }
    try {
      if (preview.targetActiveTabId !== undefined) await chrome.tabs.update(preview.targetActiveTabId, { active: true });
      await chrome.windows.update(preview.targetWindowId, { focused: true });
    } catch (error) { operation.items[0].error = 'Target focus changed: ' + String(error); }
    operation.status = operation.items.every((item) => item.state === 'done' && !item.error) ? 'completed' : 'partial';
    await saveWorkspace(workspace);
    return operation;
  });
}

// Called by the shared operation queue so undo and new mutations cannot overlap.
export async function undoWindowMove(workspace: WorkspaceData, operation: TabOperation): Promise<TabOperation> {
  if (operation.browserSessionId !== await browserSessionId()) throw new Error('These live tab IDs belong to an earlier browser session. Restore URLs from a collection or snapshot instead.');
  operation.status = 'undoing';
  operation.undoWindows ??= {};
  await saveWorkspace(workspace);
  const groups = new Map<string, number>();
  for (const item of [...operation.items].sort((a, b) => a.tab.windowId - b.tab.windowId || a.tab.index - b.tab.index)) {
    if (item.state !== 'done') continue;
    try {
      const live = await chrome.tabs.get(item.tab.id);
      if (live.url !== item.tab.url || live.windowId !== operation.targetWindowId) throw new Error('Tab navigated or moved since the operation');
    } catch (error) { item.state = 'skipped'; item.error = String(error); await saveWorkspace(workspace); continue; }
    item.state = 'restoring';
    await saveWorkspace(workspace);
    try {
      let windowId: number | undefined = operation.undoWindows[String(item.tab.windowId)] ?? item.tab.windowId;
      try { const target = await chrome.windows.get(windowId); if (target.incognito || target.type !== 'normal') windowId = undefined; }
      catch { windowId = undefined; }
      if (windowId === undefined) {
        const created = await chrome.windows.create({ tabId: item.tab.id, focused: false });
        windowId = created?.id;
        if (windowId === undefined) throw new Error('Browser did not return the original window');
        operation.undoWindows[String(item.tab.windowId)] = windowId;
        await saveWorkspace(workspace);
      } else {
        await chrome.tabs.move(item.tab.id, { windowId, index: item.tab.index });
      }
      item.state = 'undone';
      await chrome.tabs.update(item.tab.id, { pinned: item.tab.pinned });
      await restoreGroup(item.tab, item.tab.id, windowId, groups);
    } catch (error) {
      if (item.state === 'restoring') {
        try {
          const live = await chrome.tabs.get(item.tab.id);
          item.state = live.windowId === operation.targetWindowId ? 'done' : 'undone';
        } catch { item.state = 'uncertain'; }
      }
      item.error = String(error);
    }
    await saveWorkspace(workspace);
  }
  for (const item of operation.items.filter((candidate) => candidate.state === 'undone' && candidate.tab.active)) {
    try { await chrome.tabs.update(item.tab.id, { active: true }); } catch { /* Closed during undo. */ }
  }
  if (operation.originalFocusedWindowId !== undefined) {
    try { await chrome.windows.update(operation.undoWindows[String(operation.originalFocusedWindowId)] ?? operation.originalFocusedWindowId, { focused: true }); }
    catch { /* The original focused window may have been closed. */ }
  }
  operation.status = operation.items.some((item) => item.state === 'done' || item.state === 'uncertain') ? 'partial' : 'undone';
  await saveWorkspace(workspace);
  return operation;
}
