import type { Topic } from '@shared/types/topics';
import type { TopicAdvice, TopicAdviceJob } from '@shared/types/topic-review';
import { compareTopics } from '@shared/utils/topics';
import { isStatefulChat } from '@shared/utils/page-safety';
import { readWorkspace, withWorkspaceLock } from './workspace-storage';
import { readEvidence } from './content-evidence';
import { getSettings } from './persistence';
import { fetchServerJson } from './transport';

const KEY = 'aitab.topic-advice-job';
let active: { job: TopicAdviceJob; controller: AbortController } | undefined;

export async function getTopicAdviceJob(): Promise<TopicAdviceJob | null> {
  const stored = await chrome.storage.session.get(KEY); const job = stored[KEY] as TopicAdviceJob | undefined;
  if (!job) return null;
  if (job.status === 'running' && active?.job.id !== job.id) {
    job.status = 'interrupted'; job.error = 'Topic comparison interrupted by a worker restart. Start again.';
    job.updatedAt = Date.now(); await chrome.storage.session.set({ [KEY]: job });
  }
  return job;
}

function sample(topic: Topic, other: Topic) {
  const comparison = compareTopics(topic, other);
  const common = comparison.common.filter((item) => !isStatefulChat(item.url)); const unique = comparison.onlyA.filter((item) => !isStatefulChat(item.url));
  const result: Topic['materials'] = [];
  for (let index = 0; result.length < 60 && index < Math.max(common.length, unique.length); index++) {
    if (unique[index]) result.push(unique[index]);
    if (common[index] && result.length < 60) result.push(common[index]);
  }
  return result;
}

export async function startTopicAdvice(ids: string[], readContent: boolean): Promise<TopicAdviceJob> {
  return withWorkspaceLock(async () => {
    if (active?.job.status === 'running') return { ...active.job };
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error('Choose two distinct topics');
    const catalog = (await readWorkspace()).topicCatalog;
    const topics = ids.map((id) => catalog?.topics.find((topic) => topic.id === id && !topic.deletedAt && !topic.mergedInto));
    if (!topics[0] || !topics[1]) throw new Error('Topic changed. Refresh comparison.');
    const selected = topics as Topic[]; const cache = readContent ? await readEvidence() : {};
    let evidenceCount = 0;
    const payload = { topics: selected.map((topic, index) => ({ id: topic.id, name: topic.name, focus: topic.focus,
      totalMaterials: topic.materials.length, materials: sample(topic, selected[1 - index]).map((material) => {
        const evidence = cache[material.url]; const excerpt = evidence && evidence.title === material.title && Date.now() - evidence.capturedAt < 86_400_000 ? evidence.text.slice(0, 1200) : '';
        if (excerpt) evidenceCount++;
        return { key: material.key, title: material.title.slice(0, 1000), url: material.url, excerpt };
      }) })) };
    const job: TopicAdviceJob = { id: crypto.randomUUID(), topicIds: ids, revisions: Object.fromEntries(selected.map((topic) => [topic.id, topic.revision])),
      status: 'running', startedAt: Date.now(), updatedAt: Date.now(), sampled: payload.topics.map((topic) => topic.materials.length), totals: selected.map((topic) => topic.materials.length), evidenceCount };
    const controller = new AbortController(); active = { job, controller };
    try { await chrome.storage.session.set({ [KEY]: job }); } catch (error) { active = undefined; throw error; }
    void (async () => {
      try {
        const settings = await getSettings();
        const advice = await fetchServerJson<TopicAdvice>('/topic-review', { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]) }, settings.localServerUrl);
        controller.signal.throwIfAborted();
        if (!advice || !['same_task', 'related', 'different', 'uncertain'].includes(advice.relation) || typeof advice.reason !== 'string'
          || typeof advice.suggestedName !== 'string' || !['commonGround', 'uniqueA', 'uniqueB'].every((key) => Array.isArray(advice[key as 'commonGround']) && advice[key as 'commonGround'].every((item) => typeof item === 'string')) || !Array.isArray(advice.evidence)) throw new Error('Invalid topic advice response');
        advice.reason = advice.reason.slice(0, 1600); advice.suggestedName = advice.suggestedName.slice(0, 120);
        for (const key of ['commonGround', 'uniqueA', 'uniqueB'] as const) advice[key] = advice[key].slice(0, 12).map((item) => item.slice(0, 800));
        advice.provider = typeof advice.provider === 'string' ? advice.provider.slice(0, 120) : undefined;
        advice.model = typeof advice.model === 'string' ? advice.model.slice(0, 120) : undefined;
        advice.evidence = advice.evidence.filter((item) => {
          if (!item || typeof item.topicId !== 'string' || typeof item.materialKey !== 'string' || typeof item.quote !== 'string' || item.quote.trim().length < 3 || item.quote.length > 500) return false;
          const material = payload.topics.find((topic) => topic.id === item.topicId)?.materials.find((material) => material.key === item.materialKey);
          return material && `${material.title}\n${material.url}\n${material.excerpt}`.toLocaleLowerCase().includes(item.quote.trim().toLocaleLowerCase());
        }).slice(0, 12);
        const current = (await readWorkspace()).topicCatalog;
        if (selected.some((topic) => current?.topics.find((item) => item.id === topic.id)?.revision !== topic.revision)) throw new Error('Topics changed during comparison. Refresh before reviewing the advice.');
        job.advice = advice; job.status = 'completed';
      } catch (error) { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; if (!controller.signal.aborted) job.error = String(error); }
      job.updatedAt = Date.now();
      if (active?.job.id === job.id) { try { await chrome.storage.session.set({ [KEY]: { ...job } }); } finally { if (active?.job.id === job.id) active = undefined; } }
    })().catch((error) => console.error('Could not persist topic comparison outcome', error));
    return { ...job };
  });
}

export async function cancelTopicAdvice(id: string): Promise<TopicAdviceJob | null> {
  if (active?.job.id === id) { active.controller.abort(); active.job.status = 'cancelled'; active.job.updatedAt = Date.now(); await chrome.storage.session.set({ [KEY]: { ...active.job } }); }
  return getTopicAdviceJob();
}
