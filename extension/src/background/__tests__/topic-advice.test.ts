import { afterEach, expect, it, vi } from 'vitest';
import { mockBrowser } from './mock-browser';
import { changeTopics } from '../topic-catalog';
import { startTopicAdvice, getTopicAdviceJob, cancelTopicAdvice } from '../topic-advice';
import { topicMaterial } from '@shared/utils/topics';

vi.mock('../persistence', () => ({ getSettings: async () => ({ localServerUrl: 'http://localhost:8765' }) }));
const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../transport', () => ({ fetchServerJson: transport.fetch }));
afterEach(async () => { const job = await getTopicAdviceJob().catch(() => null); if (job?.status === 'running') await cancelTopicAdvice(job.id); vi.unstubAllGlobals(); transport.fetch.mockReset(); });
const advice = { relation: 'related', reason: 'Common subject, independent tasks', commonGround: [], uniqueA: [], uniqueB: [], suggestedName: '', evidence: [] };
async function topics() {
  const first = await changeTopics({ action: 'create', name: 'Task A', materials: Array.from({ length: 80 }, (_, index) => topicMaterial(`https://a.test/${index}`, 'Article ' + index, 'a' + index)) });
  const second = await changeTopics({ action: 'create', name: 'Task B', materials: [topicMaterial('https://b.test/', 'Guide', 'b'), topicMaterial('https://chatgpt.com/', 'Draft', 'live:s:1')] });
  return [first.topics[0], second.topics[1]];
}
it('bounds and labels samples, excludes chats and does not trigger browser effects', async () => {
  const browser = mockBrowser([]); const pair = await topics();
  transport.fetch.mockResolvedValue(advice);
  const started = await startTopicAdvice(pair.map((topic) => topic.id), false);
  await vi.waitFor(async () => expect((await getTopicAdviceJob())?.status).toBe('completed'));
  expect(started.sampled).toEqual([60, 1]); expect(started.totals).toEqual([80, 2]);
  const payload = JSON.parse(transport.fetch.mock.calls[0][1].body);
  expect(payload.topics[1].materials).toHaveLength(1);
  expect(browser.api.tabs.remove).not.toHaveBeenCalled(); expect(browser.api.tabs.create).not.toHaveBeenCalled();
});
it('acknowledges quickly, reuses the owned job, supports cancellation and prevents stale advice', async () => {
  mockBrowser([]); const pair = await topics();
  let finish: (value: typeof advice) => void = () => {};
  transport.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = await startTopicAdvice(pair.map((topic) => topic.id), true);
  expect(first.status).toBe('running');
  expect((await startTopicAdvice(pair.map((topic) => topic.id), true)).id).toBe(first.id);
  await cancelTopicAdvice(first.id); finish(advice);
  await vi.waitFor(async () => expect((await getTopicAdviceJob())?.status).toBe('cancelled'));
  transport.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const next = await startTopicAdvice(pair.map((topic) => topic.id), false);
  expect(next.id).not.toBe(first.id);
  await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(2));
  await changeTopics({ action: 'update', id: pair[0].id, revision: pair[0].revision, focus: 'Changed while reviewing' });
  finish(advice);
  await vi.waitFor(async () => expect((await getTopicAdviceJob())?.status).toBe('failed'));
  const result = await getTopicAdviceJob();
  expect(result?.error).toContain('changed');
});
