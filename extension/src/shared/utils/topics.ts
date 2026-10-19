import type { Topic, TopicCatalog, TopicMaterial, TopicSource } from '@shared/types/topics';
import type { TabRecord } from '@shared/types';
import { isStatefulChat } from './page-safety';

export const emptyTopicCatalog = (): TopicCatalog => ({ version: 1, revision: 0, topics: [], history: [], distinct: [] });
const materialSignature = (items: TopicMaterial[]) => JSON.stringify(items.map((item) => [item.key, item.url, item.title, [...item.collectionIds].sort()]));
export const topicMaterial = (url: string, title: string, source: string, collectionIds: string[] = []): TopicMaterial => ({
  key: isStatefulChat(url) ? source : url, url, title, collectionIds,
});
export function mergeMaterials(materials: TopicMaterial[]): TopicMaterial[] {
  const result = new Map<string, TopicMaterial>();
  for (const material of materials) {
    const previous = result.get(material.key);
    result.set(material.key, { ...material, title: material.title === material.url && previous ? previous.title : material.title,
      collectionIds: [...new Set([...(previous?.collectionIds ?? []), ...material.collectionIds])] });
  }
  return [...result.values()];
}
export function liveTopicTabs(topic: Topic, tabs: TabRecord[], sessionId?: string): TabRecord[] {
  const urls = new Set(topic.materials.filter((material) => !isStatefulChat(material.url)).map((material) => material.url));
  return tabs.filter((tab) => urls.has(tab.url) || topic.materials.some((material) => material.key === `live:${sessionId}:${tab.id}` && material.url === tab.url));
}
export function reconcileTopics(catalog: TopicCatalog, sources: TopicSource[]): TopicCatalog {
  const next = structuredClone(catalog);
  for (const source of sources) {
    if (!source.materials.length) continue;
    let topic = next.topics.find((item) => item.sourceKeys.includes(source.key));
    const visited = new Set<string>();
    while (topic?.mergedInto && !visited.has(topic.id)) { visited.add(topic.id); topic = next.topics.find((item) => item.id === topic!.mergedInto); }
    if (topic?.deletedAt) continue;
    if (!topic) topic = next.topics.find((item) => !item.deletedAt && !item.mergedInto
      && item.name.trim().toLocaleLowerCase() === source.name.trim().toLocaleLowerCase() && item.focus === source.focus
      && item.materials.length === source.materials.length && source.materials.every((material) => item.materials.some((entry) => entry.key === material.key)));
    if (!topic) {
      if (next.topics.length >= 500) throw new Error('Topic catalog limit reached (500). Export and review old topics.');
      topic = { id: crypto.randomUUID(), name: source.name.slice(0, 120), focus: source.focus.slice(0, 1000), accepted: source.accepted,
        revision: 1, createdAt: Date.now(), updatedAt: Date.now(), sourceKeys: [], aliases: [], materials: [], excludedKeys: [], relatedIds: [] };
      next.topics.push(topic);
    }
    const sourcesBefore = topic.sourceKeys.length;
    if (!topic.sourceKeys.includes(source.key)) topic.sourceKeys.push(source.key);
    const materials = mergeMaterials([...topic.materials, ...source.materials.filter((material) => !topic!.excludedKeys.includes(material.key))]);
    if (materialSignature(materials) !== materialSignature(topic.materials) || sourcesBefore !== topic.sourceKeys.length) {
      topic.materials = materials; topic.revision++; topic.updatedAt = Date.now();
    }
  }
  return next;
}

export async function topicPairFingerprint(a: Topic, b: Topic): Promise<string> {
  const text = [a, b].sort((x, y) => x.id.localeCompare(y.id)).map((topic) => ({ id: topic.id, focus: topic.focus,
    materials: topic.materials.map((material) => [material.key, material.title]).sort() }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(text)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function compareTopics(a: Topic, b: Topic) {
  const aKeys = new Set(a.materials.map((material) => material.key)); const bKeys = new Set(b.materials.map((material) => material.key));
  return { common: a.materials.filter((material) => bKeys.has(material.key)), onlyA: a.materials.filter((material) => !bKeys.has(material.key)), onlyB: b.materials.filter((material) => !aKeys.has(material.key)) };
}
