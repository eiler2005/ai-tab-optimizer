import type { TabRecord } from '@shared/types';
import type { ContentReviewPreview } from '@shared/types/content-review';
import type { DuplicatePreview, TabOperation } from '@shared/types/workspace';
import type { OptimizationCandidate, OptimizationPlan } from '@shared/types/optimization';
import { isStatefulChat } from './page-safety';
import { tabProtectionReason } from './rules';
import { chooseContentSurvivor } from './content-review';

export function buildOptimizationPlan(tabs: TabRecord[], duplicates: DuplicatePreview, review?: ContentReviewPreview): OptimizationPlan {
  const candidates = new Map<number, OptimizationCandidate>();
  const defaults = new Set<number>();
  const roots = new Set<number>();
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const add = (candidate: OptimizationCandidate) => {
    if (candidates.has(candidate.tab.id) || isStatefulChat(candidate.tab.url) || tabProtectionReason(candidate.tab, duplicates.protectedDomains)) return;
    if (candidate.recommended && (roots.has(candidate.tab.id) || (candidate.keep && defaults.has(candidate.keep.id)))) candidate.recommended = false;
    candidates.set(candidate.tab.id, candidate);
    if (candidate.recommended) { defaults.add(candidate.tab.id); if (candidate.keep) roots.add(candidate.keep.id); }
  };
  for (const group of duplicates.groups) {
    if (group.kind === 'stateful') continue;
    const keep = byId.get(group.keepTabId);
    if (!keep) continue;
    for (const tab of group.tabs) if (tab.id !== keep.id) add({ tab, keep,
      category: group.kind, reason: group.reason, recommended: group.kind === 'exact' });
  }
  if (review) {
    const unchanged = (id: number) => {
      const live = byId.get(id); const old = review.tabs.find((tab) => tab.id === id);
      return live && old && live.url === old.url && live.title === old.title ? live : undefined;
    };
    for (const group of review.similarGroups) {
      if (group.relation !== 'redundant' || group.source !== 'ai') continue;
      const members = group.tabIds.map(unchanged).filter((tab): tab is TabRecord => Boolean(tab));
      const remaining = members.filter((tab) => !defaults.has(tab.id));
      if (remaining.length < 1 || members.length !== group.tabIds.length) continue;
      const keep = remaining.find((tab) => tab.id === group.keepTabId) ?? remaining.find((tab) => tab.id === chooseContentSurvivor(remaining))!;
      const verifiedExcerpts = members.every((tab) => review.excerptTabIds?.includes(tab.id));
      for (const tab of members) if (tab.id !== keep.id) add({ tab, keep, category: 'redundant', reason: group.reason,
        recommended: group.confidence >= .95 && verifiedExcerpts });
    }
    for (const item of review.outdatedTabs) {
      const tab = unchanged(item.tabId); const keep = item.replacementTabId === undefined ? undefined : unchanged(item.replacementTabId);
      if (tab && (item.replacementTabId === undefined || keep)) add({ tab, keep, category: 'outdated', reason: item.reason, recommended: false });
    }
  }
  return { id: crypto.randomUUID(), createdAt: Date.now(), tabsBefore: tabs.length, candidates: [...candidates.values()],
    protectedCount: tabs.filter((tab) => tabProtectionReason(tab, duplicates.protectedDomains)).length,
    chatCount: tabs.filter((tab) => isStatefulChat(tab.url)).length,
    relatedGroups: review?.similarGroups.filter((group) => group.relation !== 'redundant').length ?? 0,
    aiCompared: review?.aiTabCount ?? 0, warning: review?.warning };
}

export function optimizationMarkdown(plan: OptimizationPlan, selected: number[], operation?: TabOperation): string {
  const lines = ['# AITab — план оптимизации / Optimization report', '', new Date(plan.createdAt).toLocaleString(), '',
    `До / Before: ${operation?.optimizationReport?.tabsBefore ?? plan.tabsBefore}`,
    `Выбрано / Selected: ${selected.length}`,
    `Прогноз после / Forecast after: ${plan.tabsBefore - selected.length}`,
    `Чаты сохранены / Chats retained: ${plan.chatCount}`,
    `Групп альтернатив / Related groups retained: ${plan.relatedGroups}`, ''];
  if (operation?.optimizationReport) {
    const report = operation.optimizationReport;
    lines.push(`Фактически после / Actual after: ${report.tabsAfter}`, `Закрыто / Closed: ${report.closed}`,
      `Сохранены в коллекциях / Archived in collections: ${report.archived ?? 0}`, `Повторы закрыты / Duplicates closed: ${report.duplicatesClosed ?? 0}`, `Устаревшие закрыты / Outdated closed: ${report.outdatedClosed ?? 0}`,
      `Пропущено / Skipped: ${report.skipped}`, `Ошибок / Failed: ${report.failed}`, '');
  }
  for (const candidate of plan.candidates.filter((item) => selected.includes(item.tab.id))) {
    const outcome = operation?.items.find((item) => item.tab.id === candidate.tab.id);
    lines.push(`- ${candidate.category}: ${candidate.tab.title.replace(/\s+/g, ' ')} — ${candidate.tab.url}`,
      `  ${candidate.reason.replace(/\s+/g, ' ')}`, candidate.keep ? `  Остаётся / Retained: ${candidate.keep.url}` : '',
      candidate.savedIn ? `  Коллекция / Collection: ${candidate.savedIn.name}` : '',
      outcome ? `  Результат / Outcome: ${outcome.state}${outcome.error ? ': ' + outcome.error : ''}` : '');
  }
  return lines.filter((line, index, all) => line || all[index - 1]).join('\n');
}
