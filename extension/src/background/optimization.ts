import type { CachedAIResult } from '@shared/types';
import type { OptimizationPlan } from '@shared/types/optimization';
import type { TabOperation } from '@shared/types/workspace';
import { buildDuplicatePreview } from '@shared/utils/duplicates';
import { buildOptimizationPlan } from '@shared/utils/optimization';
import { applyTabScope, type ScopeSnapshot } from '@shared/utils/tab-scope';
import { readBrowserState } from './browser-state';
import { readContentPreview } from './content-review';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { closeOperationItems } from './workspace-operations';
import { detachWindows } from './collections';
import { isStatefulChat } from '@shared/utils/page-safety';
import { tabProtectionReason } from '@shared/utils/rules';
import { findSimilarContent } from '@shared/utils/content-review';

const KEY = 'aitab.optimization-plan';
export async function previewOptimization(windowId?: number, reviewId?: string, scope: ScopeSnapshot = {}, keepTabIds: number[] = []): Promise<OptimizationPlan> {
  return withWorkspaceLock(async () => {
    const selection = { ...scope, windowId: windowId ?? scope.windowId };
    const tabs = applyTabScope((await readBrowserState()).flatMap((window) => window.tabs), selection);
    const stored = await chrome.storage.local.get(['settings', 'lastAIResult']);
    const domains = (stored.settings as { protectedDomains?: string[] } | undefined)?.protectedDomains ?? [];
    const duplicates = buildDuplicatePreview(tabs, domains);
    for (const group of duplicates.groups) {
      const choices = group.tabs.filter((tab) => keepTabIds.includes(tab.id));
      if (choices.length === 1) group.keepTabId = choices[0].id;
    }
    const review = reviewId ? await readContentPreview(reviewId) : undefined;
    if (reviewId && !review) throw new Error('Review expired. Refresh the plan.');
    if (review && !review.savedSources) for (const group of review.similarGroups) {
      const choices = group.tabIds.filter((id) => keepTabIds.includes(id));
      if (choices.length === 1) group.keepTabId = choices[0];
    }
    const plan = buildOptimizationPlan(tabs, duplicates, review);
    plan.duplicateGroups = duplicates.groups; plan.review = review?.savedSources ? undefined : review;
    if (!plan.review) { plan.localGroups = findSimilarContent(tabs.filter((tab) => !isStatefulChat(tab.url)), {}); plan.relatedGroups = plan.localGroups.length; }
    plan.scope = selection;
    const candidates = new Set(plan.candidates.map((item) => item.tab.id));
    const workspace = await readWorkspace();
    const saved = new Map(workspace.collections.filter((collection) => !collection.deletedAt && collection.purpose !== 'now')
      .flatMap((collection) => collection.windows.flatMap((window) => window.tabs.map((item) => [item.url, { collectionId: collection.id, itemId: item.itemId, revision: collection.revision, name: collection.name }] as const))));
    const now = new Set(workspace.collections.filter((collection) => !collection.deletedAt && collection.purpose === 'now').flatMap((collection) => collection.windows.flatMap((window) => window.tabs.map((item) => item.url))));
    const roots = new Set(plan.candidates.flatMap((item) => item.keep ? [item.keep.id] : []));
    const cache = stored.lastAIResult as CachedAIResult | undefined;
    for (const tab of tabs) {
      if (candidates.has(tab.id) || roots.has(tab.id) || isStatefulChat(tab.url) || tabProtectionReason(tab, domains) || !/^https?:\/\//i.test(tab.url)) continue;
      const savedIn = saved.get(tab.url);
      const recommendation = cache?.tabs?.some((item) => item.id === tab.id && item.url === tab.url) ? cache.result.tabRecommendations.find((item) => item.tabId === tab.id) : undefined;
      if (savedIn) plan.candidates.push({ tab, category: 'saved', recommended: false, savedIn, reason: 'Already preserved in collection: ' + savedIn.name });
      else if (recommendation?.action === 'close') plan.candidates.push({ tab, category: 'manual', recommended: false, reason: recommendation.reason });
      else if (!now.has(tab.url) && recommendation?.action !== 'keep') plan.candidates.push({ tab, category: 'defer', recommended: false,
        reason: recommendation?.reason ?? 'Optional: save useful material outside current work. This is not evidence of obsolescence.' });
    }
    plan.windowId = selection.windowId;
    await chrome.storage.session.set({ [KEY]: plan }); return plan;
  });
}

export async function executeOptimization(planId: string, tabIds: number[]): Promise<TabOperation> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace();
    const previous = workspace.operations.find((operation) => operation.id === planId);
    if (previous) return previous;
    const stored = await chrome.storage.session.get(KEY);
    const plan = stored[KEY] as OptimizationPlan | undefined;
    if (!plan || plan.id !== planId || Date.now() - plan.createdAt > 300_000) throw new Error('Plan expired. Prepare a new plan.');
    const selected = new Set(tabIds);
    if (!selected.size || selected.size !== tabIds.length) throw new Error('Select distinct candidates');
    const candidates = tabIds.map((id) => {
      const candidate = plan.candidates.find((item) => item.tab.id === id);
      if (!candidate || (candidate.keep && selected.has(candidate.keep.id))) throw new Error('A retained page cannot be closed. Clear its dependent selections first.');
      if (candidate.savedIn) {
        const source = candidate.savedIn;
        const collection = workspace.collections.find((entry) => entry.id === source.collectionId && !entry.deletedAt && entry.purpose !== 'now' && entry.revision === source.revision);
        if (!collection?.windows.some((window) => window.tabs.some((item) => item.itemId === source.itemId && item.url === candidate.tab.url))) throw new Error('Saved collection changed. Prepare a new plan.');
      }
      return candidate;
    });
    const count = async () => applyTabScope((await readBrowserState()).flatMap((window) => window.tabs), { windowId: plan.windowId, tabIds: plan.scope?.tabIds }).length;
    const before = await count();
    const operation: TabOperation = { id: plan.id, kind: 'close', status: 'running', createdAt: Date.now(), browserSessionId: await browserSessionId(),
      items: candidates.map((candidate) => ({ tab: candidate.tab, keep: candidate.keep, state: 'pending' })) };
    const deferred = candidates.filter((candidate) => candidate.category === 'defer').map((candidate) => candidate.tab);
    if (deferred.length) {
      const windows = [...new Set(deferred.map((tab) => tab.windowId))].map((windowId) => ({ windowId, focused: false, tabs: deferred.filter((tab) => tab.windowId === windowId) }));
      workspace.collections.push({ id: plan.id + '-saved', name: (plan.scope?.scopeLabel ?? 'Review') .slice(0, 90) + ' · saved',
        purpose: 'later', reason: 'Saved before closing through a reviewed plan', focus: plan.review?.focus,
        createdAt: Date.now(), updatedAt: Date.now(), revision: 1, windows: detachWindows(windows) });
    }
    workspace.operations.push(operation); await saveWorkspace(workspace);
    await closeOperationItems(workspace, operation);
    const after = await count(); const closed = operation.items.filter((item) => item.state === 'done').length;
    operation.optimizationReport = { tabsBefore: before, tabsAfter: after, requested: candidates.length, closed,
      skipped: operation.items.filter((item) => item.state === 'skipped').length,
      failed: operation.items.filter((item) => item.state === 'failed').length,
      archived: operation.items.filter((item) => item.state === 'done' && ['saved', 'defer'].includes(candidates.find((candidate) => candidate.tab.id === item.tab.id)?.category ?? '')).length,
      duplicatesClosed: operation.items.filter((item) => item.state === 'done' && ['exact', 'tracking', 'redundant'].includes(candidates.find((candidate) => candidate.tab.id === item.tab.id)?.category ?? '')).length,
      outdatedClosed: operation.items.filter((item) => item.state === 'done' && candidates.find((candidate) => candidate.tab.id === item.tab.id)?.category === 'outdated').length,
      ...(after !== before - closed ? { otherChanges: after - before + closed } : {}) };
    await saveWorkspace(workspace); return operation;
  });
}
