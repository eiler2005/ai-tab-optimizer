import type { TopicCatalog } from '@shared/types/topics';
import type { TopicPairSuggestion } from '@shared/types/topic-review';
import { compareTopics, topicPairFingerprint } from './topics';

const ignored = new Set(['ai', 'ии', 'the', 'and', 'for', 'with', 'как', 'это', 'для', 'или', 'что']);
const words = (name: string) => [...new Set((name.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3 && !ignored.has(word)))];
export async function suggestTopicPairs(catalog: TopicCatalog): Promise<TopicPairSuggestion[]> {
  const topics = catalog.topics.filter((topic) => !topic.deletedAt && !topic.mergedInto);
  const index = new Map<string, number[]>(); const pairs = new Set<string>();
  topics.forEach((topic, position) => {
    const keys = new Set([...topic.materials.map((material) => 'page:' + material.key), ...words(topic.name).map((word) => 'name:' + word)]);
    for (const key of keys) {
      for (const previous of index.get(key) ?? []) pairs.add(`${previous}:${position}`);
      const entries = index.get(key) ?? []; entries.push(position); index.set(key, entries);
    }
  });
  const candidates: (TopicPairSuggestion & { ai: number; bi: number })[] = [];
  for (const key of pairs) {
    const [ai, bi] = key.split(':').map(Number); const a = topics[ai]; const b = topics[bi];
    const comparison = compareTopics(a, b); const shared = comparison.common.length;
    const namesA = new Set(words(a.name)); const namesB = new Set(words(b.name));
    const sharedNames = [...namesA].filter((word) => namesB.has(word)).length;
    const nameScore = sharedNames / Math.max(1, namesA.size + namesB.size - sharedNames);
    const overlap = shared / Math.max(1, a.materials.length + b.materials.length - shared);
    if (!shared && nameScore < .5) continue;
    candidates.push({ a: a.id, b: b.id, ai, bi, shared, onlyA: comparison.onlyA.length, onlyB: comparison.onlyB.length,
      reason: shared > 0 && overlap === 1 ? 'same_materials' : shared ? 'overlap' : 'name', score: overlap * 2 + nameScore });
  }
  const result: TopicPairSuggestion[] = [];
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    const decision = catalog.distinct.find((entry) => entry.a === item.a && entry.b === item.b || entry.a === item.b && entry.b === item.a);
    if (decision && decision.fingerprint === await topicPairFingerprint(topics[item.ai], topics[item.bi])) continue;
    const { ai: _a, bi: _b, ...suggestion } = item; result.push(suggestion);
    if (result.length >= 100) break;
  }
  return result;
}
