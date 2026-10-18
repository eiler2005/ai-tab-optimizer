import type { TabRecord } from '@shared/types';
import type { CloseDecision, DuplicatePreview, OperationItem, TabOperation } from '@shared/types/workspace';
import { buildDuplicatePreview } from '@shared/utils/duplicates';
import { normalizeUrl } from '@shared/utils/url';
import { tabProtectionReason } from '@shared/utils/rules';
import { readBrowserState } from './browser-state';
import { undoWindowMove } from './window-operations';
import { browserSessionId, PREVIEW_KEY, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';

export async function previewDuplicates(windowId?: number): Promise<DuplicatePreview> {
  return withWorkspaceLock(async () => {
    const windows = await readBrowserState();
    const settings = await localProtection();
    const preview = buildDuplicatePreview(windows.filter((window) => windowId === undefined || window.windowId === windowId)
      .flatMap((window) => window.tabs), settings);
    await chrome.storage.local.set({ [PREVIEW_KEY]: preview });
    return preview;
  });
}

async function localProtection(): Promise<string[]> {
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings as { protectedDomains?: string[] } | undefined;
  return (settings?.protectedDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean);
}

async function liveRecord(tab: TabRecord): Promise<TabRecord> {
  const live = await chrome.tabs.get(tab.id);
  if (live.incognito || live.url !== tab.url || live.windowId !== tab.windowId
    || live.groupId !== (tab.groupId ?? -1)) throw new Error('Tab navigated or moved since preview');
  const stored = await chrome.storage.local.get('userFlagsV2');
  const flags = stored.userFlagsV2 as Record<string, TabRecord['userFlag']> | undefined;
  return { ...tab, windowId: live.windowId, index: live.index, pinned: live.pinned,
    active: live.active, audible: live.audible, userFlag: flags?.[tab.url] };
}

export async function executeDuplicateClose(previewId: string, decisions: CloseDecision[]): Promise<TabOperation> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const previous = workspace.operations.find((operation) => operation.id === previewId);
    if (previous) return previous;
    const stored = await chrome.storage.local.get(PREVIEW_KEY);
    const preview = stored[PREVIEW_KEY] as DuplicatePreview | undefined;
    if (!preview || preview.id !== previewId || Date.now() - preview.createdAt > 300_000) throw new Error('Preview expired. Scan again.');
    if (!decisions.length) throw new Error('Select at least one duplicate');
    const selected = new Set(decisions.map((decision) => decision.tabId));
    if (selected.size !== decisions.length) throw new Error('Duplicate selection');
    const items: OperationItem[] = decisions.map((decision) => {
      const group = preview.groups.find((candidate) => candidate.tabs.some((tab) => tab.id === decision.tabId)
        && candidate.tabs.some((tab) => tab.id === decision.keepTabId));
      const tab = group?.tabs.find((candidate) => candidate.id === decision.tabId);
      const keep = group?.tabs.find((candidate) => candidate.id === decision.keepTabId);
      if (!tab || !keep || selected.has(keep.id) || tab.id === keep.id || normalizeUrl(tab.url) !== normalizeUrl(keep.url)) {
        throw new Error('Invalid duplicate selection. A surviving copy is required.');
      }
      return { tab, keep, state: 'pending' };
    });
    const operation: TabOperation = { id: preview.id, kind: 'close', createdAt: Date.now(),
      browserSessionId: await browserSessionId(), status: 'running', items };
    workspace.operations.push(operation);
    await saveWorkspace(workspace);
    for (const item of operation.items) {
      try {
        const tab = await liveRecord(item.tab);
        await liveRecord(item.keep!);
        const protectedReason = tabProtectionReason(tab, await localProtection());
        if (protectedReason) throw new Error('Protected: ' + protectedReason);
        item.tab = { ...tab, index: item.tab.index };
      } catch (error) {
        item.state = 'skipped'; item.error = String(error);
        await saveWorkspace(workspace);
        continue;
      }
      item.state = 'applying';
      await saveWorkspace(workspace);
      try { await chrome.tabs.remove(item.tab.id); item.state = 'done'; }
      catch (error) { item.state = 'failed'; item.error = String(error); }
      await saveWorkspace(workspace);
    }
    operation.status = operation.items.every((item) => item.state === 'done') ? 'completed' : 'partial';
    await saveWorkspace(workspace);
    return operation;
  });
}

export async function workspaceOverview() {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const session = await browserSessionId();
    let changed = false;
    for (const operation of workspace.operations) {
      if (operation.status !== 'running' && operation.status !== 'undoing') continue;
      for (const item of operation.items) {
        if (item.state === 'applying' && operation.browserSessionId === session) {
          try {
            const live = await chrome.tabs.get(item.tab.id);
            item.state = operation.kind === 'move' && live.windowId === operation.targetWindowId && live.url === item.tab.url ? 'done' : 'skipped';
          }
          catch (error) {
            item.state = operation.kind === 'close' && /no tab with id/i.test(String(error)) ? 'done' : 'uncertain';
          }
        } else if (item.state === 'applying' || item.state === 'restoring') {
          item.state = 'uncertain';
        } else if (item.state === 'pending') item.state = 'skipped';
      }
      operation.status = 'interrupted'; changed = true;
    }
    if (changed) await saveWorkspace(workspace);
    return workspace;
  });
}

export async function undoTabOperation(id: string): Promise<TabOperation> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const operation = workspace.operations.find((candidate) => candidate.id === id);
    if (!operation) throw new Error('Operation not found');
    if (operation.status === 'undone') return operation;
    if (operation.kind === 'move') return undoWindowMove(workspace, operation);
    operation.status = 'undoing';
    await saveWorkspace(workspace);
    const session = await browserSessionId();
    if (operation.undoBrowserSessionId !== session) operation.undoWindows = {};
    operation.undoBrowserSessionId = session;
    const currentWindows = await chrome.windows.getAll();
    const groups = new Map<string, number>();
    operation.undoWindows ??= {};
    for (const item of [...operation.items].sort((a, b) => a.tab.windowId - b.tab.windowId || a.tab.index - b.tab.index)) {
      if (item.state !== 'done') continue;
      item.state = 'restoring';
      await saveWorkspace(workspace);
      try {
        const original = item.tab;
        let windowId: number | undefined = operation.undoWindows[String(original.windowId)];
        if (windowId === undefined && operation.browserSessionId === session
          && currentWindows.some((window) => window.id === original.windowId && !window.incognito)) windowId = original.windowId;
        let restored: chrome.tabs.Tab | undefined;
        if (windowId === undefined) {
          const window = await chrome.windows.create({ url: original.url, focused: false });
          windowId = window?.id; restored = window?.tabs?.[0];
          if (windowId !== undefined) operation.undoWindows[String(original.windowId)] = windowId;
        } else restored = await chrome.tabs.create({ windowId, url: original.url, index: original.index, pinned: original.pinned, active: false });
        if (restored?.id === undefined) throw new Error('Browser did not return a restored tab');
        item.restoredTabId = restored.id;
        await saveWorkspace(workspace);
        await chrome.tabs.update(restored.id, { pinned: original.pinned });
        item.state = 'undone';
        if (!original.pinned && original.groupId !== undefined) {
          try {
            const key = original.windowId + ':' + original.groupId;
            let groupId = groups.get(key);
            if (groupId === undefined && operation.browserSessionId === session) {
              try {
                const oldGroup = await chrome.tabGroups.get(original.groupId);
                if (oldGroup.windowId === windowId) groupId = oldGroup.id;
              } catch { /* The group may have disappeared with its last tab. */ }
            }
            if (groupId === undefined) {
              groupId = await chrome.tabs.group({ tabIds: [restored.id] });
              await chrome.tabGroups.update(groupId, { title: original.groupName ?? '', color: original.groupColor ?? 'grey', collapsed: original.groupCollapsed ?? false });
            } else await chrome.tabs.group({ tabIds: [restored.id], groupId });
            groups.set(key, groupId);
          } catch (error) { item.error = 'URL restored; group restore failed: ' + String(error); }
        }
      } catch (error) {
        item.state = item.restoredTabId === undefined ? 'done' : 'undone';
        item.error = String(error);
      }
      await saveWorkspace(workspace);
    }
    operation.status = operation.items.some((item) => item.state === 'done' || item.state === 'uncertain') ? 'partial' : 'undone';
    await saveWorkspace(workspace);
    return operation;
  });
}
