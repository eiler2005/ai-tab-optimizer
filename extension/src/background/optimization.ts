import type { OptimizationPlan } from '@shared/types/optimization';
import type { TabOperation } from '@shared/types/workspace';
import { buildDuplicatePreview } from '@shared/utils/duplicates';
import { buildOptimizationPlan } from '@shared/utils/optimization';
import { readBrowserState } from './browser-state';
import { readContentPreview } from './content-review';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { closeOperationItems } from './workspace-operations';
import { isStatefulChat } from '@shared/utils/page-safety';
import { tabProtectionReason } from '@shared/utils/rules';

const KEY = 'aitab.optimization-plan';
export async function previewOptimization(windowId?: number, reviewId?: string): Promise<OptimizationPlan> {
  return withWorkspaceLock(async () => {
    const tabs = (await readBrowserState()).filter((window) => windowId === undefined || window.windowId === windowId).flatMap((window) => window.tabs);
    const stored = await chrome.storage.local.get('settings');
    const domains = (stored.settings as { protectedDomains?: string[] } | undefined)?.protectedDomains ?? [];
    const plan = buildOptimizationPlan(tabs, buildDuplicatePreview(tabs, domains), reviewId ? await readContentPreview(reviewId) : undefined);
    const candidates = new Set(plan.candidates.map((item) => item.tab.id));
    const saved = new Map((await readWorkspace()).collections.filter((collection) => !collection.deletedAt && collection.purpose !== 'now')
      .flatMap((collection) => collection.windows.flatMap((window) => window.tabs.map((item) => [item.url, { collectionId: collection.id, itemId: item.itemId, revision: collection.revision, name: collection.name }] as const))));
    for (const tab of tabs) {
      const savedIn = saved.get(tab.url);
      if (savedIn && !candidates.has(tab.id) && !isStatefulChat(tab.url) && !tabProtectionReason(tab, domains)) {
        plan.candidates.push({ tab, category: 'saved', recommended: false, savedIn, reason: 'Already preserved in collection: ' + savedIn.name });
      }
    }
    plan.windowId = windowId;
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
    const count = async () => (await readBrowserState()).filter((window) => plan.windowId === undefined || window.windowId === plan.windowId).reduce((sum, window) => sum + window.tabs.length, 0);
    const before = await count();
    const operation: TabOperation = { id: plan.id, kind: 'close', status: 'running', createdAt: Date.now(), browserSessionId: await browserSessionId(),
      items: candidates.map((candidate) => ({ tab: candidate.tab, keep: candidate.keep, state: 'pending' })) };
    workspace.operations.push(operation); await saveWorkspace(workspace);
    await closeOperationItems(workspace, operation);
    operation.optimizationReport = { tabsBefore: before, tabsAfter: await count(), requested: candidates.length,
      closed: operation.items.filter((item) => item.state === 'done').length,
      skipped: operation.items.filter((item) => item.state === 'skipped').length,
      failed: operation.items.filter((item) => item.state === 'failed').length,
      archived: operation.items.filter((item) => item.state === 'done' && candidates.find((candidate) => candidate.tab.id === item.tab.id)?.category === 'saved').length,
      duplicatesClosed: operation.items.filter((item) => item.state === 'done' && ['exact', 'tracking', 'redundant'].includes(candidates.find((candidate) => candidate.tab.id === item.tab.id)?.category ?? '')).length,
      outdatedClosed: operation.items.filter((item) => item.state === 'done' && candidates.find((candidate) => candidate.tab.id === item.tab.id)?.category === 'outdated').length };
    await saveWorkspace(workspace); return operation;
  });
}
