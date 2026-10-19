import { expect, it } from 'vitest';
import { emptyTopicCatalog, reconcileTopics, topicMaterial, topicPairFingerprint } from '../topics';
import { suggestTopicPairs } from '../topic-pairs';

const page = (url: string) => topicMaterial(url, url, url);
function catalog() {
  return reconcileTopics(emptyTopicCatalog(), [
    { key: 'a', name: 'React migration', focus: 'Migrate', accepted: true, materials: [page('https://a.test/'), page('https://common.test/')] },
    { key: 'b', name: 'Frontend task', focus: 'Research', accepted: true, materials: [page('https://b.test/'), page('https://common.test/')] },
    { key: 'c', name: 'AI unrelated', focus: '', accepted: true, materials: [page('https://c.test/')] },
    { key: 'd', name: 'AI independent', focus: '', accepted: true, materials: [page('https://d.test/')] },
  ]);
}
it('ranks shared sources and separates unique membership without using a broad AI label', async () => {
  const source = catalog(); const pairs = await suggestTopicPairs(source);
  expect(pairs).toHaveLength(1);
  expect(pairs[0]).toMatchObject({ a: source.topics[0].id, b: source.topics[1].id, shared: 1, onlyA: 1, onlyB: 1, reason: 'overlap' });
});
it('remembers distinct tasks only while their membership, titles and focus remain unchanged', async () => {
  const source = catalog(); const [a, b] = source.topics;
  source.distinct = [{ a: a.id, b: b.id, fingerprint: await topicPairFingerprint(a, b) }];
  expect(await suggestTopicPairs(source)).toHaveLength(0);
  source.topics[0].focus = 'New task';
  expect(await suggestTopicPairs(source)).toHaveLength(1);
});
it('attaches evolved AI source lineage to a manually renamed topic rather than recreating it', () => {
  const source = reconcileTopics(emptyTopicCatalog(), [{ key: 'ai:old', name: 'React migration', focus: '', accepted: false, materials: Array.from({ length: 5 }, (_, index) => page(`https://a.test/${index}`)) }]);
  const topic = source.topics[0]; topic.aliases = [topic.name]; topic.name = 'My task'; topic.accepted = true;
  const next = reconcileTopics(source, [{ key: 'ai:new', name: 'React migration', focus: '', accepted: false, materials: Array.from({ length: 6 }, (_, index) => page(`https://a.test/${index}`)) }]);
  expect(next.topics).toHaveLength(1); expect(next.topics[0].name).toBe('My task'); expect(next.topics[0].materials).toHaveLength(6);
});

it('keeps an evolved source attached after its topic was merged into a much larger workspace', () => {
  const source = reconcileTopics(emptyTopicCatalog(), [{ key: 'ai:old', name: 'Small source', focus: '', accepted: false, materials: Array.from({ length: 5 }, (_, index) => page(`https://a.test/${index}`)) }]);
  const topic = source.topics[0]; topic.aliases = [topic.name]; topic.name = 'Combined workspace';
  topic.materials.push(...Array.from({ length: 50 }, (_, index) => page(`https://other.test/${index}`)));
  source.topics.push({ ...structuredClone(topic), id: 'old-merged-source', mergedInto: topic.id });
  const next = reconcileTopics(source, [{ key: 'ai:new', name: 'Small source', focus: '', accepted: false, materials: Array.from({ length: 6 }, (_, index) => page(`https://a.test/${index}`)) }]);
  expect(next.topics.filter((topic) => !topic.mergedInto)).toHaveLength(1); expect(next.topics[0].name).toBe('Combined workspace'); expect(next.topics[0].materials).toHaveLength(56);
});
