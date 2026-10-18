import { useEffect, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { BackupSettings, BackupStatus } from '@shared/types/backup';
import type { ImportPreview } from '../../background/workspace-backup';
import { workspaceMessage } from '../workspace-api';

export function FullBackupsPanel({ busy, run, onFeedback }: { busy: boolean; run: (action: () => Promise<void>) => Promise<void>; onFeedback: (message: string) => void }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [settings, setSettings] = useState<BackupSettings>({ enabled: false, intervalHours: 24, retention: 10 });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  async function refresh() { const state = await workspaceMessage<BackupStatus>({ type: 'GET_FULL_BACKUP_STATUS' }); setStatus(state); return state; }
  useEffect(() => { void refresh().then((state) => setSettings(state.settings)).catch((failure) => setError(String(failure))); }, []);
  return <section className="space-y-2 border-t pt-3 text-xs">
    <h3 className="font-semibold">{tr('Полный локальный бэкап: коллекции + SQLite', 'Full local backup: collections + SQLite')}</h3>
    <p className="text-gray-500">{tr('Нужен локальный сервер. Сохраняет workspace.json, согласованную database.sqlite и manifest.json с контрольными суммами на компьютере сервера. Ключи, настройки провайдеров, кэш фрагментов и черновики страниц исключены.', 'Requires the local server. Saves workspace.json, a consistent database.sqlite and a checksum manifest on the server computer. Keys, provider settings, evidence cache and unsaved page state are excluded.')}</p>
    <label className="flex gap-2"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />{tr('Автоматические копии', 'Automatic backups')}</label>
    <label className="block">{tr('Интервал в часах (1–168)', 'Interval in hours (1–168)')}<input type="number" min={1} max={168} value={settings.intervalHours} onChange={(event) => setSettings({ ...settings, intervalHours: Number(event.target.value) })} className="block w-full border rounded p-2" /></label>
    <label className="block">{tr('Хранить версий (1–30)', 'Versions to retain (1–30)')}<input type="number" min={1} max={30} value={settings.retention} onChange={(event) => setSettings({ ...settings, retention: Number(event.target.value) })} className="block w-full border rounded p-2" /></label>
    <div className="flex gap-2 flex-wrap"><button disabled={busy} className="border rounded p-2" onClick={() => void run(async () => { await workspaceMessage({ type: 'CONFIGURE_BACKUPS', settings }); await refresh(); onFeedback(tr('Расписание сохранено.', 'Backup schedule saved.')); })}>{tr('Сохранить расписание', 'Save schedule')}</button><button disabled={busy} className="bg-accent text-white rounded p-2" onClick={() => void run(async () => { try { await workspaceMessage({ type: 'CREATE_FULL_BACKUP' }); } finally { await refresh(); } })}>{tr('Создать полный бэкап сейчас', 'Create full backup now')}</button><button disabled={busy} className="border rounded p-2" onClick={() => void run(async () => { await refresh(); })}>{tr('Обновить статус', 'Refresh backup status')}</button></div>
    <p>{tr('Последняя успешная копия', 'Last successful backup')}: {status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : tr('ещё нет', 'none yet')}</p>
    {status?.lastBackup && <p className="break-all">{status.lastBackup.path}</p>}
    {(error || status?.error || status?.serverError) && <p role="alert" className="text-amber-800">{error || status?.error || status?.serverError}</p>}
    {status?.backups?.map((backup) => <div key={backup.id} className="border rounded p-2 space-y-1"><p>{new Date(backup.createdAt).toLocaleString()} · {backup.collections} {tr('коллекций', 'collections')}</p><p className="break-all text-gray-500">{backup.path}</p><button disabled={busy} className="border rounded p-2" onClick={() => void run(async () => setPreview(await workspaceMessage<ImportPreview>({ type: 'PREVIEW_FULL_BACKUP_RESTORE', backupId: backup.id })))}>{tr('Просмотреть восстановление коллекций', 'Preview restoring collections')}</button></div>)}
    {preview && <div className="border border-blue-300 rounded p-2 space-y-2"><p>{tr('Добавить коллекций', 'Append collections')}: {preview.collections.length}. {tr('Текущие данные сохранятся; вкладки не открываются. SQLite этим действием не заменяется.', 'Current data is retained; tabs do not open. This action does not replace SQLite.')}</p><button disabled={busy} className="bg-accent text-white rounded p-2" onClick={() => void run(async () => { await workspaceMessage({ type: 'IMPORT_WORKSPACE_BACKUP', previewId: preview.id }); setPreview(null); onFeedback(tr('Коллекции восстановлены из бэкапа.', 'Collections restored from backup.')); })}>{tr('Добавить данные из копии', 'Append backup data')}</button></div>}
    <p className="text-gray-500">{tr('Для восстановления SQLite остановите сервер и используйте database.sqlite из выбранного комплекта по инструкции в docs/WORKSPACE.md. Папку копий желательно также сохранять на другой носитель.', 'To restore SQLite, stop the server and use database.sqlite from the chosen bundle as described in docs/WORKSPACE.md. Keep another copy of the backup folder on separate storage.')}</p>
  </section>;
}
