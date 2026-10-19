import type { Topic, TopicCatalog } from '@shared/types/topics';
import { emptyTopicCatalog, topicMaterial } from '@shared/utils/topics';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid topic backup text');
  return value;
}
function strings(value: unknown, max: number, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid topic backup list');
  return value.map((item) => text(item, max));
}
export function parseTopicBackup(raw: unknown, collectionIds: Map<string, string>): TopicCatalog | undefined {
  if (raw === undefined) return undefined;
  if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.topics) || raw.topics.length > 500) throw new Error('Unsupported topic catalog backup');
  const catalog = emptyTopicCatalog(); const remap = new Map<string, string>();
  let count = 0;
  for (const entry of raw.topics) {
    if (!object(entry) || typeof entry.id !== 'string' || remap.has(entry.id)) throw new Error('Invalid or repeated topic ID');
    remap.set(entry.id, crypto.randomUUID());
  }
  for (const entry of raw.topics) {
    if (!object(entry) || !Array.isArray(entry.materials) || entry.materials.length > 2000) throw new Error('Invalid topic materials');
    const id = remap.get(String(entry.id))!;
    const topic: Topic = { id, name: text(entry.name, 120), focus: text(entry.focus, 1000), accepted: entry.accepted === true,
      revision: 1, createdAt: Date.now(), updatedAt: Date.now(), aliases: strings(entry.aliases, 120, 500),
      sourceKeys: strings(entry.sourceKeys, 9000, 2000).map((key) => key.startsWith('collection:') && collectionIds.has(key.slice(11)) ? 'collection:' + collectionIds.get(key.slice(11)) : `imported:${id}:${key}`),
      relatedIds: strings(entry.relatedIds, 200, 500).flatMap((old) => remap.has(old) ? [remap.get(old)!] : []),
      excludedKeys: [], materials: [], deletedAt: entry.deletedAt ? Date.now() : undefined,
      mergedInto: typeof entry.mergedInto === 'string' ? remap.get(entry.mergedInto) : undefined };
    for (const item of entry.materials) {
      if (++count > 20_000) throw new Error('Topic backup exceeds 20,000 material entries');
      if (!object(item)) throw new Error('Invalid topic material');
      const url = text(item.url, 8192); if (!/^https?:\/\//i.test(url)) throw new Error('Invalid topic URL'); new URL(url);
      const key = text(item.key, 9000);
      const locations = strings(item.collectionIds, 200, 200).flatMap((old) => collectionIds.has(old) ? [collectionIds.get(old)!] : []);
      // Imported chat entries remain distinct and cannot inherit a live tab ID.
      topic.materials.push(topicMaterial(url, text(item.title, 4000), `imported:${id}:${key}`, locations));
    }
    topic.excludedKeys = strings(entry.excludedKeys, 9000, 2000).filter((key) => /^https?:\/\//i.test(key));
    catalog.topics.push(topic);
  }
  if (catalog.topics.some((topic) => topic.mergedInto === topic.id)) throw new Error('Cyclic topic alias');
  for (const topic of catalog.topics) {
    let current: Topic | undefined = topic; const visited = new Set<string>();
    while (current?.mergedInto) { if (visited.has(current.id)) throw new Error('Cyclic topic alias'); visited.add(current.id); current = catalog.topics.find((item) => item.id === current!.mergedInto); }
  }
  // Imported structural history and old-session source identities are not executable.
  return catalog;
}
