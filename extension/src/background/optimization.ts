import type { OptimizationPlan } from '@shared/types/optimization';
import type { TabOperation } from '@shared/types/workspace';
import { buildDuplicatePreview } from '@shared/utils/duplicates';
import { buildOptimizationPlan } from '@shared/utils/optimization';
import { readBrowserState } from './browser-state';
import { readContentPreview } from './content-review';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { closeOperationItems } from './workspace-operations';

const KEY = 'aitab.optimization-plan';
export async function previewOptimization(windowId?: number, reviewId?: string): Promise<OptimizationPlan> {
  return withWorkspaceLock(async () => {
    const tabs = (await readBrowserState()).filter((window) => windowId === undefined || window.windowId === windowId).flatMap((window) => window.tabs);
    const stored = await chrome.storage.local.get('settings');
    const domains = (stored.settings as { protectedDomains?: string[] } | undefined)?.protectedDomains ?? [];
    const plan = buildOptimizationPlan(tabs, buildDuplicatePreview(tabs, domains), reviewId ? await readContentPreview(reviewId) : undefined);
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
      failed: operation.items.filter((item) => item.state === 'failed').length };
    await saveWorkspace(workspace); return operation;
  });
}
