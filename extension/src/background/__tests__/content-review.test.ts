import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewContentReview, executeContentReviewClose } from '../content-review';
import { undoTabOperation } from '../workspace-operations';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import { mockBrowser } from './mock-browser';
import { previewCollection, saveCollection, updateCollection } from '../collections';
import { storeEvidence } from '../content-evidence';

afterEach(() => vi.unstubAllGlobals());
const seed = () => [1, 2, 3].map((id) => makeTab({ id, url: `https://test.test/${id}`, title: 'React server components practical migration guide', windowId: 1 }));
const options = { useAi: false, readContent: false };

describe('reviewed content closes', () => {
  it('does not discard local candidates when a successful AI response omits them', async () => {
    mockBrowser(seed());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ provider: 'codex_cli', similarGroups: [], outdatedTabs: [] }))));
    const preview = await previewContentReview({ ...options, useAi: true });
    expect(preview.similarGroups.length).toBeGreaterThan(0);
    expect(preview.similarGroups.every((group) => group.source !== 'ai' && group.relation === 'related')).toBe(true);
    expect(preview.aiTabCount).toBe(3);
  });
  it('retains partial coverage and limits concurrent requests when one batch fails', async () => {
    mockBrowser(Array.from({ length: 140 }, (_, index) => makeTab({ id: index + 1, url: `https://site-${index}.test/`, title: `Independent material ${index}` })));
    let inFlight = 0; let maximum = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      inFlight++; maximum = Math.max(maximum, inFlight);
      await Promise.resolve();
      const tabs = JSON.parse(String(init.body)).tabs as { id: number }[];
      inFlight--;
      if (tabs.some((tab) => tab.id === 1)) return new Response('Provider unavailable', { status: 503 });
      return new Response(JSON.stringify({ provider: 'codex_cli', similarGroups: [], outdatedTabs: [] }));
    }));
    const preview = await previewContentReview({ ...options, useAi: true });
    expect(maximum).toBeLessThanOrEqual(3);
    expect(preview.aiTabCount).toBeGreaterThan(0); expect(preview.aiTabCount).toBeLessThan(140);
    expect(preview.aiFailedBatches).toBe(1); expect(preview.aiCompletedBatches).toBe(3);
    expect(preview.warning).toContain('batches failed');
  });
  it('reviews saved and live sources with isolated IDs, cached evidence, no hidden opens and no library closes', async () => {
    const browser = mockBrowser(seed());
    const saved = (await saveCollection((await previewCollection('Saved research')).id, false)).collection;
    const trash = (await saveCollection((await previewCollection('Trash')).id, false)).collection;
    await updateCollection(trash.id, { deleted: true });
    await storeEvidence(seed(), { 1: 'Cached article body' });
    browser.tabs.delete(1);
    const extract = vi.fn(async (id: number) => ({ tabId: id, h1: 'Current article', metaDescription: '', excerpt: 'Live evidence' }));
    const preview = await previewContentReview({ useAi: false, readContent: true, includeSaved: true }, extract);
    expect(preview.tabs).toHaveLength(5);
    expect(preview.reviewEligibleCount).toBe(3);
    expect(new Set(preview.tabs.map((tab) => tab.id)).size).toBe(5);
    expect(extract).toHaveBeenCalledTimes(2);
    const savedId = Number(Object.keys(preview.savedSources!)[0]);
    expect(preview.savedSources![savedId].collectionId).toBe(saved.id);
    expect(preview.evidence![savedId]).toMatchObject({ text: 'Cached article body', cached: true });
    expect(browser.api.tabs.create).not.toHaveBeenCalled();
    await expect(executeContentReviewClose(preview.id, [{ tabId: savedId }])).rejects.toThrow('read-only');
    const titlesOnly = await previewContentReview({ useAi: false, readContent: false, includeSaved: true });
    expect(titlesOnly.excerptTabIds).toEqual([]);
  });
  it('deep-compares only the chosen URLs and bounds extracted text', async () => {
    const browser = mockBrowser(seed());
    vi.stubGlobal('chrome', { ...browser.api, scripting: { executeScript: vi.fn(async () => [{ result: 'Detailed body '.repeat(1000).slice(0, 8000) }]) } });
    const preview = await previewContentReview({ useAi: false, readContent: true, deepUrls: [seed()[0].url, seed()[1].url] }, vi.fn());
    expect(preview.tabs).toHaveLength(2);
    expect(preview.extractedCount).toBe(2);
    expect(preview.evidence![1].text.length).toBe(8000);
    await expect(previewContentReview({ ...options, deepUrls: ['https://a.test/'] })).rejects.toThrow('two distinct');
  });
  it('skips discarded pages and rejects excerpts captured after navigation', async () => {
    const browser = mockBrowser(seed());
    Object.assign(browser.tabs.get(3)!, { discarded: true });
    const extract = vi.fn(async (id: number) => {
      if (id === 2) browser.tabs.get(2)!.url = 'https://changed.test/';
      return { tabId: id, h1: 'Read-only example', metaDescription: '', excerpt: 'An accessible excerpt' };
    });
    const preview = await previewContentReview({ ...options, readContent: true }, extract);
    expect(preview.extractedCount).toBe(1); expect(preview.extractionFailed).toBe(2);
    expect(extract.mock.calls.map(([id]) => id)).toEqual([1, 2]);
  });
  it('bounds the AI payload to 600 while reporting total coverage', async () => {
    mockBrowser(Array.from({ length: 602 }, (_, index) => makeTab({ id: index + 1, url: `https://test.test/${index}` })));
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ provider: 'codex_cli', similarGroups: [], outdatedTabs: [] })));
    vi.stubGlobal('fetch', fetch);
    const preview = await previewContentReview({ ...options, useAi: true });
    expect(preview.tabs).toHaveLength(602); expect(preview.aiTabCount).toBe(600);
    expect(preview.aiBatchCount).toBe(14); expect(preview.aiCompletedBatches).toBe(14);
    const requests = fetch.mock.calls.map((call) => JSON.parse(call[1].body).tabs as { id: number }[]);
    expect(requests.every((tabs) => tabs.length <= 65)).toBe(true);
    expect(new Set(requests.flatMap((tabs) => tabs.map((tab) => tab.id))).size).toBe(600);
  });
  it('never infers topical obsolescence from an old lastAccessed timestamp', async () => {
    const browser = mockBrowser(seed());
    browser.tabs.get(2)!.lastAccessed = 1000;
    const preview = await previewContentReview(options);
    expect(preview.outdatedTabs).toEqual([]);
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('requires a surviving page, validates navigation, journals closes and supports idempotent Undo', async () => {
    const browser = mockBrowser(seed());
    const preview = await previewContentReview(options);
    await expect(executeContentReviewClose(preview.id, [{ tabId: 2, keepTabId: 1 }, { tabId: 1, keepTabId: 2 }])).rejects.toThrow('surviving');
    browser.tabs.get(3)!.url = 'https://changed.test/';
    const operation = await executeContentReviewClose(preview.id, [{ tabId: 2, keepTabId: 1 }, { tabId: 3, keepTabId: 1 }]);
    expect(operation.items.map((item) => item.state)).toEqual(['done', 'skipped']);
    await executeContentReviewClose(preview.id, [{ tabId: 2, keepTabId: 1 }]);
    expect(browser.api.tabs.remove).toHaveBeenCalledTimes(1);
    await undoTabOperation(operation.id); await undoTabOperation(operation.id);
    expect(browser.api.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('retains local suggestions and reports provider failure', async () => {
    mockBrowser(seed());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const preview = await previewContentReview({ ...options, useAi: true });
    expect(preview.warning).toContain('Could not connect');
    expect(preview.similarGroups.length).toBeGreaterThan(0);
    expect(preview.outdatedTabs).toEqual([]);
  });
  it('honors changed protection and prevents closes when journal persistence fails', async () => {
    const browser = mockBrowser(seed());
    const preview = await previewContentReview(options);
    browser.tabs.get(2)!.pinned = true;
    expect((await executeContentReviewClose(preview.id, [{ tabId: 2, keepTabId: 1 }])).items[0].state).toBe('skipped');
    const next = await previewContentReview(options);
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(executeContentReviewClose(next.id, [{ tabId: 3, keepTabId: 1 }])).rejects.toThrow('Quota');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('keeps a newer replacement open and rejects unsupported close targets', async () => {
    const browser = mockBrowser(seed());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ provider: 'codex_cli', similarGroups: [], outdatedTabs: [
      { tabId: 2, reason: 'Replaced for current focus', evidence: 'migration guide', confidence: .9, replacementTabId: 1 },
    ] }), { status: 200 })));
    const preview = await previewContentReview({ ...options, useAi: true });
    await expect(executeContentReviewClose(preview.id, [{ tabId: 3 }])).rejects.toThrow('outdated candidate');
    const operation = await executeContentReviewClose(preview.id, [{ tabId: 2 }]);
    expect(operation.items[0].keep?.id).toBe(1);
    expect(browser.tabs.has(1)).toBe(true);
  });
});
