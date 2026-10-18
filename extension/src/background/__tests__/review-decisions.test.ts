import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionKey, applyReviewDecisions } from '../review-decisions';
import { previewContentReview, rememberReviewDecision } from '../content-review';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import { exportWorkspaceBackup, parseBackup } from '../workspace-backup';

afterEach(() => vi.unstubAllGlobals());
describe('remembered review decisions', () => {
  it('remembers complementary sources, survives portable backup and rechecks changed context or evidence', async () => {
    mockBrowser([makeTab({ id: 1, url: 'https://a.test/', title: 'React server components practical migration guide' }), makeTab({ id: 2, url: 'https://b.test/', title: 'React server components practical migration guide' })]);
    const options = { useAi: false, readContent: false, focus: 'React' };
    const preview = await previewContentReview(options);
    expect(preview.similarGroups).toHaveLength(1);
    await rememberReviewDecision(preview.id, 'complementary', [1, 2]);
    expect(parseBackup(await exportWorkspaceBackup()).reviewDecisions).toHaveLength(1);
    const next = await previewContentReview(options);
    expect(next.retainedByUser).toBe(1); expect(next.similarGroups).toEqual([]);
    expect((await previewContentReview({ ...options, focus: 'Other task' })).similarGroups).toHaveLength(1);
    const before = await decisionKey(preview, [1, 2]);
    preview.evidence = { 1: { text: 'New unique information', capturedAt: 1, cached: false } };
    expect(await decisionKey(preview, [2, 1])).not.toBe(before);
  });
  it('expires decisions and rejects arbitrary IDs', async () => {
    mockBrowser([makeTab({ id: 1 })]);
    const preview = await previewContentReview({ useAi: false, readContent: false });
    await expect(rememberReviewDecision(preview.id, 'keep', [999])).rejects.toThrow('existing suggestion');
    preview.outdatedTabs = [{ tabId: 1, reason: 'Replaced', evidence: 'example', confidence: .9 }];
    const key = await decisionKey(preview, [1]);
    await applyReviewDecisions(preview, [{ key, kind: 'keep', createdAt: Date.now() - 31 * 86_400_000 }]);
    expect(preview.outdatedTabs).toHaveLength(1);
    await applyReviewDecisions(preview, [{ key, kind: 'keep', createdAt: Date.now() }]);
    expect(preview.outdatedTabs).toHaveLength(0);
  });
});
