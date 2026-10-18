import type { TabRecord } from '@shared/types';
import type { WorkspaceData } from '@shared/types/workspace';
import { isStatefulChat } from '@shared/utils/page-safety';
import { extractDomain } from '@shared/utils/url';
import { detachWindows } from './collections';
import { readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { invalidateEvidence } from './content-evidence';

export async function saveUrlRules(rules: NonNullable<WorkspaceData['urlRules']>) {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    if (!Array.isArray(rules) || rules.length > 50) throw new Error('At most 50 URL rules are supported');
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error('Rule IDs must be distinct');
    for (const rule of rules) {
      if (!/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(rule.hostname) || new URL('https://' + rule.hostname).hostname !== rule.hostname.toLowerCase()
        || !['suggest', 'save'].includes(rule.mode) || !workspace.collections.some((collection) => collection.id === rule.collectionId && !collection.deletedAt)) throw new Error('Invalid URL rule or missing collection');
    }
    workspace.urlRules = rules.map((rule) => ({ id: rule.id.slice(0, 100), hostname: rule.hostname.toLowerCase(), collectionId: rule.collectionId, mode: rule.mode }));
    await saveWorkspace(workspace);
  });
}

export async function savePageToCollection(tabId: number, collectionId?: string, expectedUrl?: string): Promise<{ collectionId: string; added: boolean }> {
  return withWorkspaceLock(async () => {
    const live = await chrome.tabs.get(tabId);
    const window = await chrome.windows.get(live.windowId);
    if (!live.url || !/^https?:\/\//i.test(live.url) || live.incognito || window.type !== 'normal' || window.incognito || isStatefulChat(live.url)
      || (expectedUrl !== undefined && expectedUrl !== live.url)) throw new Error('Page is unavailable, stateful or changed');
    const workspace = await readWorkspace();
    let collection = collectionId ? workspace.collections.find((entry) => entry.id === collectionId && !entry.deletedAt) : workspace.collections.find((entry) => entry.name === 'Inbox' && !entry.deletedAt);
    if (collectionId && !collection) throw new Error('Collection not found');
    if (!collection) {
      collection = { id: crypto.randomUUID(), name: 'Inbox', createdAt: Date.now(), updatedAt: Date.now(), revision: 1, purpose: 'later', windows: [] };
      workspace.collections.push(collection);
    }
    if (collection.windows.some((saved) => saved.tabs.some((tab) => tab.url === live.url))) return { collectionId: collection.id, added: false };
    const record: TabRecord = { id: tabId, windowId: live.windowId, index: live.index, url: live.url, title: live.title ?? live.url, domain: extractDomain(live.url), pinned: live.pinned, active: live.active };
    const saved = detachWindows([{ windowId: live.windowId, focused: window.focused, tabs: [record] }])[0];
    if (collection.windows[0]) collection.windows[0].tabs.push(...saved.tabs); else collection.windows.push(saved);
    collection.updatedAt = Date.now(); collection.revision += 1;
    await saveWorkspace(workspace);
    return { collectionId: collection.id, added: true };
  });
}

export async function applyLibraryRule(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.url || tab.id === undefined || tab.incognito || isStatefulChat(tab.url) || !/^https?:\/\//i.test(tab.url)) return;
  const workspace = await readWorkspace();
  const rule = workspace.urlRules?.find((entry) => entry.hostname === new URL(tab.url!).hostname
    && workspace.collections.some((collection) => collection.id === entry.collectionId && !collection.deletedAt));
  if (rule?.mode === 'save') await savePageToCollection(tab.id, rule.collectionId, tab.url);
}

export function registerLibraryAutomation() {
  const save = async (tabId: number) => {
    try { await savePageToCollection(tabId); }
    catch (error) { await chrome.storage.local.set({ 'aitab.automation-error': String(error) }); }
  };
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'aitab-save-page', title: 'AITab: save page to Inbox', contexts: ['page'] }));
  chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'aitab-save-page' && tab?.id !== undefined) void save(tab.id); });
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'save-current-to-library') void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { if (tab?.id !== undefined) return save(tab.id); });
  });
  chrome.tabs.onUpdated.addListener((_id, change, tab) => {
    if (tab.url && (change.url || change.status === 'loading' || change.title)) void invalidateEvidence(tab.url).catch(() => {});
    if (change.status === 'complete') void applyLibraryRule(tab).catch((error) => chrome.storage.local.set({ 'aitab.automation-error': String(error) }));
  });
}
