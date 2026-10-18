import type { ContentReviewPreview } from '@shared/types/content-review';
import type { WorkspaceData } from '@shared/types/workspace';

export async function decisionKey(preview: ContentReviewPreview, ids: number[]): Promise<string> {
  const pages = ids.map((id) => {
    const tab = preview.tabs.find((page) => page.id === id);
    if (!tab) throw new Error('Review page missing');
    return [tab.url, tab.title, preview.evidence?.[id]?.text ?? ''];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([preview.focus ?? '', pages])));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function applyReviewDecisions(preview: ContentReviewPreview, decisions: WorkspaceData['reviewDecisions']) {
  const active = (decisions ?? []).filter((entry) => Date.now() - entry.createdAt < 30 * 86_400_000);
  const keys = new Set(active.map((entry) => `${entry.kind}:${entry.key}`));
  const groups = await Promise.all(preview.similarGroups.map(async (group) => keys.has('complementary:' + await decisionKey(preview, group.tabIds)) ? null : group));
  const outdated = await Promise.all(preview.outdatedTabs.map(async (item) => keys.has('keep:' + await decisionKey(preview, [item.tabId])) ? null : item));
  preview.retainedByUser = groups.filter((group) => !group).length + outdated.filter((item) => !item).length;
  preview.similarGroups = groups.filter((group): group is NonNullable<typeof group> => Boolean(group));
  preview.outdatedTabs = outdated.filter((item): item is NonNullable<typeof item> => Boolean(item));
}
