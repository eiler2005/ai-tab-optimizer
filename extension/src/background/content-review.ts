import type { PageExtraction, TabRecord } from '@shared/types';
import type { ContentReviewOptions, ContentReviewPreview, ReviewCloseDecision, ReviewProgress } from '@shared/types/content-review';
import type { OperationItem, TabOperation } from '@shared/types/workspace';
import { chooseContentSurvivor, findSimilarContent, validateAiContentGroups, validateOutdatedTabs } from '@shared/utils/content-review';
import { readBrowserState } from './browser-state';
import { fetchServerJson } from './transport';
import { closeOperationItems } from './workspace-operations';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { isStatefulChat } from '@shared/utils/page-safety';
import { readEvidence, storeEvidence } from './content-evidence';
import { extractDeepText } from './deep-extraction';

const KEY = 'aitab.content-review.preview';
const MAX_AI_TABS = 600;

export async function previewContentReview(options: ContentReviewOptions, extract?: (id: number) => Promise<PageExtraction>,
  signal?: AbortSignal, onProgress?: (progress: ReviewProgress) => Promise<void>): Promise<ContentReviewPreview> {
  signal?.throwIfAborted();
  if (options.deepUrls && (options.deepUrls.length !== 2 || new Set(options.deepUrls).size !== 2)) throw new Error('Choose two distinct page URLs');
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings as { protectedDomains?: string[]; localServerUrl?: string } | undefined;
  const domains = (settings?.protectedDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  const tabs = (await readBrowserState()).filter((window) => options.windowId === undefined || window.windowId === options.windowId)
    .flatMap((window) => window.tabs).filter((tab) => /^https?:\/\//i.test(tab.url) && (!options.deepUrls || options.deepUrls.includes(tab.url)));
  const preview: ContentReviewPreview = { id: crypto.randomUUID(), createdAt: Date.now(), tabs,
    similarGroups: [], outdatedTabs: [], protectedDomains: domains,
    extractedCount: 0, extractionFailed: 0, aiTabCount: 0 };
  preview.evidence = {};
  if (options.includeSaved) {
    preview.savedSources = {};
    let nextId = Math.max(0, ...tabs.map((tab) => tab.id)) + 1;
    for (const collection of (await readWorkspace()).collections.filter((entry) => !entry.deletedAt)) {
      for (const window of collection.windows) for (const item of window.tabs) {
        if (!/^https?:\/\//i.test(item.url) || (options.deepUrls && !options.deepUrls.includes(item.url))) continue;
        const id = nextId++;
        preview.savedSources[id] = { collectionId: collection.id, itemId: item.itemId, revision: collection.revision, collectionName: collection.name };
        tabs.push({ id, windowId: -1, index: 0, url: item.url, title: item.title, domain: item.domain, active: false, pinned: item.pinned, userFlag: item.userFlag });
      }
    }
  }
  const excerpts: Record<number, string> = {};
  const cache = await readEvidence();
  // Bound extraction and AI payloads; local title scanning covers all tabs.
  const batch = tabs.filter((tab) => !isStatefulChat(tab.url)).slice(0, MAX_AI_TABS);
  for (const tab of batch) {
    const cached = cache[tab.url];
    if (options.readContent && cached && cached.title === tab.title && Date.now() - cached.capturedAt < 86_400_000) {
      excerpts[tab.id] = cached.text.slice(0, options.deepUrls ? 8000 : 1200);
      preview.evidence[tab.id] = { text: excerpts[tab.id], capturedAt: cached.capturedAt, cached: true };
    }
  }
  preview.excludedChats = tabs.filter((tab) => isStatefulChat(tab.url)).length;
  await onProgress?.({ phase: options.readContent ? 'extract' : 'compare', processed: 0, total: batch.length });
  if (options.readContent && extract) {
    for (let offset = 0; offset < batch.length; offset += 5) {
      signal?.throwIfAborted();
      await Promise.all(batch.slice(offset, offset + 5).map(async (tab) => {
      if (preview.savedSources?.[tab.id]) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const before = await chrome.tabs.get(tab.id);
        if (before.discarded || before.url !== tab.url) throw new Error('Unavailable page');
        const data = await Promise.race([options.deepUrls ? extractDeepText(tab.id).then((excerpt) => ({ excerpt })) : extract(tab.id), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Extraction timed out')), 3000); })]);
        const after = await chrome.tabs.get(tab.id);
        if (after.url !== tab.url || after.incognito) throw new Error('Page changed');
        const fields = data as Partial<PageExtraction>;
        const text = `${fields.h1 ?? ''}\n${fields.metaDescription ?? ''}\n${fields.excerpt ?? ''}`.trim().slice(0, options.deepUrls ? 8000 : 1200);
        if (!text) throw new Error('No accessible excerpt');
        excerpts[tab.id] = text; preview.extractedCount++;
        preview.evidence![tab.id] = { text, capturedAt: Date.now(), cached: false };
      } catch { delete excerpts[tab.id]; delete preview.evidence![tab.id]; preview.extractionFailed++; }
      finally { if (timeout !== undefined) clearTimeout(timeout); }
      }));
      signal?.throwIfAborted();
      await onProgress?.({ phase: 'extract', processed: Math.min(offset + 5, batch.length), total: batch.length });
    }
  }
  signal?.throwIfAborted();
  await storeEvidence(batch.filter((tab) => !preview.savedSources?.[tab.id]), Object.fromEntries(Object.entries(excerpts).filter(([id]) => !preview.evidence?.[Number(id)]?.cached)), options.deepUrls ? 'deep' : 'excerpt');
  preview.excerptTabIds = Object.keys(excerpts).map(Number);
  await onProgress?.({ phase: 'compare', processed: batch.length, total: batch.length });
  preview.similarGroups = findSimilarContent(tabs, excerpts);
  if (options.useAi && batch.length) {
    try {
      await onProgress?.({ phase: 'ai', processed: 0, total: batch.length });
      const result = await fetchServerJson<{ similarGroups: unknown; outdatedTabs: unknown; provider: string }>('/workspace-review', {
        method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(100_000)]) : AbortSignal.timeout(100_000), body: JSON.stringify({ tabs: batch.map((tab) => ({
          id: tab.id, url: tab.url.slice(0, 8192), title: tab.title.slice(0, 1000), excerpt: excerpts[tab.id] ?? '',
        })), focus: (options.focus ?? '').slice(0, 1000) }),
      }, settings?.localServerUrl ?? 'http://localhost:8765');
      preview.similarGroups = validateAiContentGroups(result.similarGroups, batch);
      preview.outdatedTabs = validateOutdatedTabs(result.outdatedTabs, batch, excerpts);
      const outdated = new Set(preview.outdatedTabs.map((item) => item.tabId));
      for (const group of preview.similarGroups) {
        const current = batch.filter((tab) => group.tabIds.includes(tab.id) && !outdated.has(tab.id));
        if (current.length) group.keepTabId = chooseContentSurvivor(current);
      }
      preview.aiTabCount = batch.length; preview.provider = result.provider;
    } catch (error) { signal?.throwIfAborted(); preview.warning = String(error); }
  }
  signal?.throwIfAborted();
  preview.createdAt = Date.now();
  await chrome.storage.session.set({ [KEY]: preview });
  await onProgress?.({ phase: 'complete', processed: batch.length, total: batch.length });
  return preview;
}

export async function readContentPreview(id: string): Promise<ContentReviewPreview | undefined> {
  const stored = await chrome.storage.session.get(KEY);
  const preview = stored[KEY] as ContentReviewPreview | undefined;
  return preview?.id === id && Date.now() - preview.createdAt <= 300_000 ? preview : undefined;
}

export async function executeContentReviewClose(previewId: string, decisions: ReviewCloseDecision[]): Promise<TabOperation> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const previous = workspace.operations.find((operation) => operation.id === previewId);
    if (previous) return previous;
    const stored = await chrome.storage.session.get(KEY);
    const preview = stored[KEY] as ContentReviewPreview | undefined;
    if (!preview || preview.id !== previewId || Date.now() - preview.createdAt > 300_000) throw new Error('Preview expired. Scan again.');
    const selected = new Set(decisions.map((decision) => decision.tabId));
    if (preview.savedSources) throw new Error('Library review is read-only. Save selected live pages through a collection preview.');
    if (!selected.size || selected.size !== decisions.length) throw new Error('Select distinct review candidates');
    const items: OperationItem[] = decisions.map((decision) => {
      const tab = preview.tabs.find((item) => item.id === decision.tabId);
      let keep: TabRecord | undefined;
      if (decision.keepTabId !== undefined) {
        const group = preview.similarGroups.find((candidate) => candidate.tabIds.includes(decision.tabId) && candidate.tabIds.includes(decision.keepTabId!));
        keep = preview.tabs.find((item) => item.id === decision.keepTabId);
        if (!group || !keep || keep.id === tab?.id || selected.has(keep.id)) throw new Error('A surviving related page is required');
      } else {
        const outdated = preview.outdatedTabs.find((item) => item.tabId === decision.tabId);
        if (!outdated) throw new Error('Tab was not an outdated candidate');
        if (outdated.replacementTabId !== undefined) {
          keep = preview.tabs.find((item) => item.id === outdated.replacementTabId);
          if (!keep || selected.has(keep.id)) throw new Error('Keep the replacement page open');
        }
      }
      if (!tab) throw new Error('Unknown review tab');
      return { tab, keep, state: 'pending' };
    });
    const operation: TabOperation = { id: preview.id, kind: 'close', createdAt: Date.now(), browserSessionId: await browserSessionId(), status: 'running', items };
    workspace.operations.push(operation); await saveWorkspace(workspace);
    return closeOperationItems(workspace, operation);
  });
}
