import type { TabRecord, TopicCluster } from '@shared/types';
import { exactUrlKey } from './url';

export interface WorkspaceSuggestion { name: string; reason: string; tabIds: number[]; urls: string[] }

export function buildWorkspaceSuggestions(clusters: TopicCluster[], tabs: TabRecord[]): WorkspaceSuggestion[] {
  return clusters.flatMap((cluster) => {
    if (typeof cluster.name !== 'string' || !cluster.name.trim() || !Array.isArray(cluster.tabUrls)) return [];
    const urls = new Set(cluster.tabUrls.filter((url) => typeof url === 'string' && exactUrlKey(url)));
    const current = tabs.filter((tab) => urls.has(tab.url) && exactUrlKey(tab.url));
    if (current.length < 2) return [];
    return [{ name: cluster.name.trim().slice(0, 120), reason: typeof cluster.description === 'string' ? cluster.description.slice(0, 2000) : '',
      tabIds: current.map((tab) => tab.id), urls: [...new Set(current.map((tab) => tab.url))] }];
  });
}
