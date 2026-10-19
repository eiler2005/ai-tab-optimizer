import { afterEach, expect, it, vi } from 'vitest';
import { mockBrowser } from './mock-browser';
import { makeTab } from '@shared/utils/__tests__/fixtures';
import { previewContentReview, readContentPreview } from '../content-review';
import { getReviewJob } from '../review-jobs';
import { previewOptimization } from '../optimization';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps expired explanations readable while rejecting them as action evidence', async () => {
  const browser = mockBrowser([makeTab({ id: 1 })]);
  const options = { useAi: false, readContent: false };
  const preview = await previewContentReview(options);
  browser.session['aitab.review-job'] = { id: 'job', status: 'completed', phase: 'complete', options, startedAt: preview.createdAt, updatedAt: preview.createdAt, phaseStartedAt: preview.createdAt, processed: 1, total: 1, previewId: preview.id };
  vi.spyOn(Date, 'now').mockReturnValue(preview.createdAt + 300_001);
  expect(await readContentPreview(preview.id)).toBeUndefined();
  const job = await getReviewJob();
  expect(job?.preview?.id).toBe(preview.id); expect(job?.previewExpired).toBe(true);
  await expect(previewOptimization(undefined, preview.id)).rejects.toThrow('expired');
});
