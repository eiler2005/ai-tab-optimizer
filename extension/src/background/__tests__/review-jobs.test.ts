import { afterEach, describe, expect, it, vi } from 'vitest';
import { startReviewJob, cancelReviewJob, getReviewJob } from '../review-jobs';
import { previewDuplicates, executeDuplicateClose } from '../workspace-operations';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import { mockBrowser } from './mock-browser';

afterEach(() => vi.unstubAllGlobals());

describe('background review jobs', () => {
  it('returns immediately, records AI phase, permits duplicate actions and cancels the pending request', async () => {
    const browser = mockBrowser([1, 2].map((id) => makeTab({ id, url: 'https://same.test/', windowId: 1 })));
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    })));
    const job = await startReviewJob({ useAi: true, readContent: false });
    expect(job.status).toBe('running');
    await vi.waitFor(async () => expect((await getReviewJob())?.phase).toBe('ai'));
    const preview = await previewDuplicates();
    expect((await executeDuplicateClose(preview.id, [{ tabId: 2, keepTabId: 1 }])).status).toBe('completed');
    expect((await cancelReviewJob(job.id))?.status).toBe('cancelled');
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(browser.tabs.has(1)).toBe(true);
  });
  it('persists a completed result for panel reopen without starting a second analysis', async () => {
    mockBrowser([makeTab({ id: 1 })]);
    const job = await startReviewJob({ useAi: false, readContent: false });
    await vi.waitFor(async () => expect((await getReviewJob())?.status).toBe('completed'));
    const loaded = await getReviewJob();
    expect(loaded?.id).toBe(job.id); expect(loaded?.preview?.tabs).toHaveLength(1);
  });
  it('marks orphaned running jobs interrupted after worker restart', async () => {
    const browser = mockBrowser([]);
    browser.session['aitab.review-job'] = { id: 'orphan', status: 'running', startedAt: Date.now(), options: { useAi: true, readContent: false } };
    expect((await getReviewJob())?.status).toBe('interrupted');
  });
});
