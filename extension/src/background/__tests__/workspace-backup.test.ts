import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportWorkspaceBackup, parseBackup, previewBackupImport, executeBackupImport } from '../workspace-backup';
import { previewCollection, saveCollection, updateCollection } from '../collections';
import { WORKSPACE_KEY } from '../workspace-storage';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';
import type { WorkspaceData } from '@shared/types/workspace';

afterEach(() => vi.unstubAllGlobals());
const backup = (extra: object = {}) => JSON.stringify({ format: 'aitab-backup', version: 1, collections: [{ name: 'Imported', windows: [{ focused: true, tabs: [{ url: 'https://example.test/#/one', title: 'Saved', pinned: true, note: 'User notes' }] }] }], ...extra });

describe('portable backup boundary', () => {
  it('preserves numeric optimization summaries while excluding malformed report fields', () => {
    const report = { tabsBefore: 10, tabsAfter: 8, requested: 3, closed: 2, skipped: 1, failed: 0, otherChanges: -1 };
    const operation = { kind: 'close', optimizationReport: report, items: [{ state: 'done', tab: { url: 'https://example.test/' } }] };
    expect(parseBackup(backup({ operations: [operation] })).operations[0].optimizationReport).toEqual(report);
    expect(parseBackup(backup({ operations: [{ ...operation, optimizationReport: { ...report, closed: -1 } }] })).operations[0].optimizationReport).toBeUndefined();
  });
  it('round-trips notes, regenerates identities and never exports credentials', async () => {
    const browser = mockBrowser([makeTab({ id: 1 })]);
    browser.local.settings = { apiKey: 'sensitive-provider-secret', protectedDomains: ['example.com'] };
    browser.local.localServerToken = 'sensitive-loopback-secret';
    const saved = (await saveCollection((await previewCollection('Mine')).id, false)).collection;
    await updateCollection(saved.id, { itemId: saved.windows[0].tabs[0].itemId, note: 'Keep my notes' });
    const json = await exportWorkspaceBackup();
    expect(json).not.toContain('sensitive-');
    const parsed = parseBackup(json);
    expect(parsed.collections[0].id).not.toBe(saved.id);
    expect(parsed.collections[0].windows[0].tabs[0].note).toBe('Keep my notes');
    expect(parsed.collections[0].windows[0].tabs[0]).not.toHaveProperty('id');
  });
  it('previews imports, appends to existing data and prevents repeated confirmation', async () => {
    const browser = mockBrowser([makeTab({ id: 1 })]);
    await saveCollection((await previewCollection('Existing')).id, false);
    const preview = await previewBackupImport(backup());
    expect((browser.local[WORKSPACE_KEY] as WorkspaceData).collections).toHaveLength(1);
    expect((await executeBackupImport(preview.id)).imported).toBe(1);
    expect((await executeBackupImport(preview.id)).imported).toBe(0);
    expect((browser.local[WORKSPACE_KEY] as WorkspaceData).collections).toHaveLength(2);
    expect(browser.api.tabs.create).not.toHaveBeenCalled();
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
  });
  it('rejects invalid formats, executable URLs and unsafe imported settings', () => {
    expect(() => parseBackup('{oops')).toThrow();
    expect(() => parseBackup(backup({ version: 999 }))).toThrow('version 1');
    const parsed = parseBackup(backup({ collections: [{ name: 'Safe', windows: [{ tabs: [{ url: 'javascript:alert(1)' }, { url: 'https://safe.test/', note: 'kept' }] }] }],
      legacy: { localServerToken: 'evil', settings: { localServerUrl: 'https://evil.test/', codexCliPath: '/evil', apiKey: 'secret', protectedDomains: ['safe.test'] } } }));
    expect(parsed.skipped).toBe(1);
    expect(parsed.collections[0].windows[0].tabs).toHaveLength(1);
    expect(parsed.legacy).not.toHaveProperty('localServerToken');
    expect(parsed.legacy.settings).toEqual({ protectedDomains: ['safe.test'] });
  });
  it('does not import data when the storage write fails', async () => {
    const browser = mockBrowser([]);
    const preview = await previewBackupImport(backup());
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Storage quota exceeded'));
    await expect(executeBackupImport(preview.id)).rejects.toThrow('quota');
    expect(browser.local[WORKSPACE_KEY]).toBeUndefined();
    expect((await executeBackupImport(preview.id)).imported).toBe(1);
  });
  it('isolates imported operation IDs from live browser tabs', async () => {
    const browser = mockBrowser([makeTab({ id: 1 })]);
    const preview = await previewBackupImport(backup({ operations: [{ kind: 'move', id: 'injected', browserSessionId: 'current', status: 'running', items: [{ state: 'done', tab: { id: 1, windowId: 1, index: 0, url: 'https://example.test/' } }] }] }));
    await executeBackupImport(preview.id);
    const imported = (browser.local[WORKSPACE_KEY] as WorkspaceData).operations[0];
    expect(imported.id).not.toBe('injected');
    expect(imported.browserSessionId).toMatch(/^imported:/);
    expect(imported.items[0].tab.id).toBeLessThan(0);
    expect(browser.api.tabs.move).not.toHaveBeenCalled();
  });
  it('preserves existing flags and preferences when appending a backup', async () => {
    const browser = mockBrowser([]);
    browser.local.userFlagsV2 = { 'https://safe.test/': 'important' };
    browser.local.settings = { protectedDomains: ['current.test'] };
    const preview = await previewBackupImport(backup({ legacy: { userFlagsV2: { 'https://safe.test/': 'read_later' }, settings: { protectedDomains: ['imported.test'] } } }));
    await executeBackupImport(preview.id);
    expect(browser.local.userFlagsV2).toEqual({ 'https://safe.test/': 'important' });
    expect(browser.local.settings).toEqual({ protectedDomains: ['current.test'] });
  });
});
