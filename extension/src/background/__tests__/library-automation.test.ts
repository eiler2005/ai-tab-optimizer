import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLibraryRule, savePageToCollection, saveUrlRules } from '../library-automation';
import { readWorkspace } from '../workspace-storage';
import { previewCollection, saveCollection, updateCollection } from '../collections';
import { exportWorkspaceBackup, parseBackup } from '../workspace-backup';
import { previewContentReview } from '../content-review';
import { invalidateEvidence } from '../content-evidence';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';

afterEach(() => vi.unstubAllGlobals());
describe('library automation', () => {
  it('saves to Inbox idempotently and never closes pages', async () => {
    const browser = mockBrowser([makeTab({ id: 1, url: 'https://a.test/' })]);
    expect((await savePageToCollection(1)).added).toBe(true);
    expect((await savePageToCollection(1)).added).toBe(false);
    expect((await readWorkspace()).collections[0].windows[0].tabs).toHaveLength(1);
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
    browser.tabs.get(1)!.url = 'https://chatgpt.com/';
    await expect(savePageToCollection(1)).rejects.toThrow('stateful');
  });
  it('applies exact-host rules once, skips deleted destinations and imports rules as suggestions', async () => {
    const browser = mockBrowser([makeTab({ id: 1, url: 'https://a.test/1' })]);
    const collection = (await saveCollection((await previewCollection('Rules')).id, false)).collection;
    const rules = [{ id: 'r', hostname: 'a.test', collectionId: collection.id, mode: 'save' as const }];
    await saveUrlRules(rules);
    browser.tabs.get(1)!.url = 'https://a.test/2';
    await applyLibraryRule(await chrome.tabs.get(1)); await applyLibraryRule(await chrome.tabs.get(1));
    expect((await readWorkspace()).collections[0].windows[0].tabs).toHaveLength(2);
    const imported = parseBackup(await exportWorkspaceBackup());
    expect(imported.urlRules?.[0]).toMatchObject({ mode: 'suggest', collectionId: imported.collections[0].id });
    await updateCollection(collection.id, { deleted: true });
    browser.tabs.get(1)!.url = 'https://a.test/3';
    await applyLibraryRule(await chrome.tabs.get(1));
    expect((await readWorkspace()).collections[0].windows[0].tabs).toHaveLength(2);
    await expect(saveUrlRules([{ ...rules[0], hostname: 'https://a.test/' }])).rejects.toThrow('Invalid');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('reuses unchanged excerpt evidence and re-reads invalidated pages', async () => {
    mockBrowser([makeTab({ id: 1 })]);
    const extract = vi.fn(async () => ({ tabId: 1, h1: 'Main', metaDescription: '', excerpt: 'Verified body' }));
    const options = { readContent: true, useAi: false };
    await previewContentReview(options, extract); await previewContentReview(options, extract);
    expect(extract).toHaveBeenCalledTimes(1);
    await invalidateEvidence(makeTab({ id: 1 }).url);
    await previewContentReview(options, extract);
    expect(extract).toHaveBeenCalledTimes(2);
  });
});
