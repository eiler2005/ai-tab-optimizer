import type { BackupSettings, BackupStatus, FullBackup } from '@shared/types/backup';
import { exportWorkspaceBackup, previewBackupImport } from './workspace-backup';
import { fetchServerJson } from './transport';

const KEY = 'aitab.backups';
const DEFAULTS: BackupSettings = { enabled: false, intervalHours: 24, retention: 10 };
let active: Promise<FullBackup> | undefined;
async function localStatus(): Promise<BackupStatus> {
  return (await chrome.storage.local.get(KEY))[KEY] as BackupStatus ?? { settings: { ...DEFAULTS } };
}
async function serverUrl(): Promise<string> {
  return ((await chrome.storage.local.get('settings')).settings as { localServerUrl?: string } | undefined)?.localServerUrl ?? 'http://localhost:8765';
}
export async function getFullBackupStatus(): Promise<BackupStatus> {
  const state = await localStatus();
  try { return { ...state, ...await fetchServerJson<{ backups: FullBackup[] }>('/workspace-backups', {}, await serverUrl()) }; }
  catch (error) { return { ...state, serverError: String(error) }; }
}
export async function configureBackups(settings: BackupSettings): Promise<void> {
  if (typeof settings.enabled !== 'boolean' || !Number.isInteger(settings.intervalHours) || settings.intervalHours < 1 || settings.intervalHours > 168
    || !Number.isInteger(settings.retention) || settings.retention < 1 || settings.retention > 30) throw new Error('Invalid backup schedule');
  const previous = await localStatus();
  await chrome.storage.local.set({ [KEY]: { ...previous, settings } });
  await setupBackupAlarm();
}
export async function setupBackupAlarm(): Promise<void> {
  const { settings } = await localStatus();
  const existing = await chrome.alarms.get('aitab-full-backup');
  if (!settings.enabled) { if (existing) await chrome.alarms.clear('aitab-full-backup'); return; }
  if (existing?.periodInMinutes !== settings.intervalHours * 60) await chrome.alarms.create('aitab-full-backup', { periodInMinutes: settings.intervalHours * 60 });
}
export async function createFullBackup(): Promise<FullBackup> {
  if (active) return active;
  active = (async () => {
    const started = await localStatus();
    await chrome.storage.local.set({ [KEY]: { ...started, lastAttemptAt: Date.now(), error: undefined } });
    try {
      const workspace: unknown = JSON.parse(await exportWorkspaceBackup());
      const result = await fetchServerJson<{ backup: FullBackup }>('/workspace-backups', { method: 'POST', signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ workspace, retention: started.settings.retention }) }, await serverUrl());
      const current = await localStatus();
      await chrome.storage.local.set({ [KEY]: { ...current, lastSuccessAt: Date.now(), lastBackup: result.backup, error: undefined } });
      return result.backup;
    } catch (error) {
      const current = await localStatus();
      await chrome.storage.local.set({ [KEY]: { ...current, error: String(error) } });
      throw error;
    }
  })();
  try { return await active; } finally { active = undefined; }
}
export async function previewFullBackupRestore(id: string) {
  if (!/^[0-9]{13}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid backup ID');
  const result = await fetchServerJson<{ workspace: unknown }>('/workspace-backups/' + id, {}, await serverUrl());
  return previewBackupImport(JSON.stringify(result.workspace));
}
