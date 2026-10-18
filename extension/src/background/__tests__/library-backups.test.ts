import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureBackups, createFullBackup, getFullBackupStatus, setupBackupAlarm } from '../library-backups';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';

afterEach(() => vi.unstubAllGlobals());
describe('full backup lifecycle', () => {
  it('keeps an existing schedule across worker restarts and records success/failure without closing tabs', async () => {
    const browser = mockBrowser([makeTab({ id: 1 })]);
    const alarms = { get: vi.fn(async () => ({ periodInMinutes: 24 * 60 })), clear: vi.fn(), create: vi.fn() };
    vi.stubGlobal('chrome', { ...browser.api, alarms });
    await configureBackups({ enabled: true, intervalHours: 24, retention: 3 });
    await setupBackupAlarm();
    expect(alarms.create).not.toHaveBeenCalled();
    expect(alarms.clear).not.toHaveBeenCalled();
    const backup = { id: '1234567890123-abcdef123456', path: '/local/backup', createdAt: 1, collections: 0, scope: ['extension', 'SQLite'] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ backup, backups: [backup] }))));
    expect(await createFullBackup()).toEqual(backup);
    expect((await getFullBackupStatus()).lastSuccessAt).toBeGreaterThan(0);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server offline')));
    await expect(createFullBackup()).rejects.toThrow('Could not connect');
    expect((await getFullBackupStatus()).error).toContain('Could not connect');
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
    await expect(configureBackups({ enabled: true, intervalHours: 0, retention: 3 })).rejects.toThrow('Invalid');
  });
});
