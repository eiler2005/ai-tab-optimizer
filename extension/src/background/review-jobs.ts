import type { PageExtraction } from '@shared/types';
import type { ContentReviewJob, ContentReviewOptions } from '@shared/types/content-review';
import { previewContentReview, readContentPreview } from './content-review';
import { withWorkspaceLock } from './workspace-storage';

const KEY = 'aitab.review-job';
let active: { job: ContentReviewJob; controller: AbortController } | undefined;

export async function getReviewJob(): Promise<ContentReviewJob | null> {
  const stored = await chrome.storage.session.get(KEY);
  const job = stored[KEY] as ContentReviewJob | undefined;
  if (!job) return null;
  if (job.status === 'running' && active?.job.id !== job.id) {
    job.status = 'interrupted'; job.error = 'Review interrupted by a worker restart. Start again.';
    job.updatedAt = Date.now(); await chrome.storage.session.set({ [KEY]: job });
  }
  const preview = job.previewId ? await readContentPreview(job.previewId, true) : undefined;
  return { ...job, preview, previewExpired: preview ? Date.now() - preview.createdAt > 300_000 : undefined };
}

export async function startReviewJob(options: ContentReviewOptions, extract?: (id: number) => Promise<PageExtraction>): Promise<ContentReviewJob> {
  return withWorkspaceLock(async () => {
    if (active?.job.status === 'running') return { ...active.job };
    const job: ContentReviewJob = { id: crypto.randomUUID(), options, status: 'running', phase: 'capture',
      startedAt: Date.now(), updatedAt: Date.now(), phaseStartedAt: Date.now(), processed: 0, total: 0 };
    const controller = new AbortController();
    active = { job, controller };
    try { await chrome.storage.session.set({ [KEY]: job }); }
    catch (error) { active = undefined; throw error; }
    void runJob(job, controller, extract).catch((error) => console.error('Could not persist review job outcome', error));
    return { ...job };
  });
}

async function runJob(job: ContentReviewJob, controller: AbortController, extract?: (id: number) => Promise<PageExtraction>) {
  try {
    const preview = await previewContentReview(job.options, extract, controller.signal, async (progress) => {
      controller.signal.throwIfAborted();
      if (job.phase !== progress.phase) job.phaseStartedAt = Date.now();
      Object.assign(job, progress, { updatedAt: Date.now() });
      await chrome.storage.session.set({ [KEY]: { ...job } });
    });
    controller.signal.throwIfAborted();
    job.previewId = preview.id; job.status = 'completed';
  } catch (error) {
    job.status = controller.signal.aborted ? 'cancelled' : 'failed';
    if (!controller.signal.aborted) job.error = String(error);
  }
  job.updatedAt = Date.now();
  // A newer job may have started while the old one was being cancelled.
  if (active?.job.id === job.id) {
    try { await chrome.storage.session.set({ [KEY]: { ...job } }); }
    finally { if (active?.job.id === job.id) active = undefined; }
  }
}

export async function cancelReviewJob(id: string): Promise<ContentReviewJob | null> {
  if (active?.job.id === id) {
    active.controller.abort(); active.job.status = 'cancelled'; active.job.updatedAt = Date.now();
    await chrome.storage.session.set({ [KEY]: { ...active.job } });
  }
  return getReviewJob();
}
