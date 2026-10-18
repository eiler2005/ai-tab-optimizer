import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ContentReviewJob, ContentReviewOptions } from '@shared/types/content-review';
import { workspaceMessage } from './workspace-api';

export function useReviewController() {
  const [job, setJob] = useState<ContentReviewJob | null>(null);
  const [options, setOptionsState] = useState<ContentReviewOptions>({ useAi: true, readContent: true, focus: '' });
  const changed = useRef(false);
  function setOptions(next: ContentReviewOptions) { changed.current = true; setOptionsState(next); }
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  useEffect(() => { void chrome.storage.local.get('aitab.review-focus').then((stored) => {
    const focus = stored['aitab.review-focus'];
    if (!changed.current && typeof focus === 'string') setOptionsState((current) => ({ ...current, focus: focus.slice(0, 1000) }));
  }).catch((failure) => setError(String(failure))); }, []);
  useEffect(() => {
    if (!changed.current) return;
    const timer = setTimeout(() => { void chrome.storage.local.set({ 'aitab.review-focus': options.focus ?? '' }).catch((failure) => setError(String(failure))); }, 300);
    return () => clearTimeout(timer);
  }, [options.focus]);
  useEffect(() => {
    let disposed = false; let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await workspaceMessage<ContentReviewJob | null>({ type: 'GET_CONTENT_REVIEW_JOB' });
        if (!disposed) setJob((current) => next && (!current || next.startedAt > current.startedAt
          || (next.id === current.id && next.updatedAt >= current.updatedAt)) ? next : current);
      } catch (failure) { if (!disposed) setError(String(failure)); }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 750);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  async function start(useAi = true, overrides: Partial<ContentReviewOptions> = {}) {
    setError(null);
    let readContent = options.readContent;
    if (readContent) {
      readContent = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
      setPermissionDenied(!readContent);
    }
    const next = await workspaceMessage<ContentReviewJob>({ type: 'START_CONTENT_REVIEW', options: { ...options, includeSaved: false, ...overrides, readContent, useAi } });
    setJob(next); return next;
  }
  async function cancel() {
    if (job) setJob(await workspaceMessage<ContentReviewJob | null>({ type: 'CANCEL_CONTENT_REVIEW', jobId: job.id }));
  }
  return { job, options, setOptions, error, permissionDenied, start, cancel };
}

export const ReviewContext = createContext<ReturnType<typeof useReviewController> | null>(null);
export function useWorkspaceReview() {
  const context = useContext(ReviewContext);
  if (!context) throw new Error('Missing workspace review provider');
  return context;
}
