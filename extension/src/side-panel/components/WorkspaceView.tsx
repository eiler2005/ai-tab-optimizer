import { useEffect, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { DuplicatePreview, TabOperation, WorkspaceData } from '@shared/types/workspace';
import { tabProtectionReason } from '@shared/utils/rules';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';
import { WindowMergePanel } from './WindowMergePanel';
import { CollectionsPanel } from './CollectionsPanel';

export function WorkspaceView() {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [preview, setPreview] = useState<DuplicatePreview | null>(null);
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [section, setSection] = useState<'duplicates' | 'windows' | 'collections' | 'history'>('duplicates');

  const refresh = async () => setWorkspace(await workspaceMessage<WorkspaceData>({ type: 'WORKSPACE_OVERVIEW' }));
  useEffect(() => { void refresh().catch((failure) => setError(String(failure))); }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null); setFeedback(null);
    try { await action(); }
    catch (failure) { setError(String(failure)); }
    finally {
      try { await refresh(); await useStore.getState().loadTabs(); }
      catch (failure) { setError(String(failure)); }
      setBusy(false);
    }
  }

  function showResult(operation: TabOperation) {
    setSection('history');
    const count = (state: string) => operation.items.filter((item) => item.state === state).length;
    setFeedback(`${tr('Выполнено', 'Completed')}: ${count('done')}; ${tr('пропущено', 'skipped')}: ${count('skipped')}; ${tr('ошибок', 'failed')}: ${count('failed')}; ${tr('восстановлено', 'restored')}: ${count('undone')}`);
  }

  async function scan() {
    const next = await workspaceMessage<DuplicatePreview>({ type: 'PREVIEW_DUPLICATES', windowId: scope === 'all' ? undefined : Number(scope) });
    setPreview(next);
    setKeepers(Object.fromEntries(next.groups.map((group) => [group.id, group.keepTabId])));
    setSelected(new Set(next.groups.filter((group) => group.kind === 'exact').flatMap((group) => group.tabs
      .filter((tab) => tab.id !== group.keepTabId && !tabProtectionReason(tab, next.protectedDomains)).map((tab) => tab.id))));
  }

  async function closeSelected() {
    if (!preview) return;
    const decisions = [...selected].map((tabId) => {
      const group = preview.groups.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId) && keepers[candidate.id] !== tabId);
      if (!group) throw new Error('Choose a surviving copy');
      return { tabId, keepTabId: keepers[group.id] };
    });
    showResult(await workspaceMessage<TabOperation>({ type: 'EXECUTE_DUPLICATES', previewId: preview.id, decisions }));
    setPreview(null); setSelected(new Set());
  }

  return <div className="flex-1 overflow-y-auto p-3 space-y-4">
    <h2 className="font-semibold text-sm">{tr('Очистка вкладок', 'Tab cleanup')}</h2>
    <p className="text-xs text-gray-500">{tr('Работает без AI и сервера. Просмотрите копии перед закрытием. История позволяет отменить операцию.', 'Works offline without AI. Review copies before closing. Use history to undo an operation.')}</p>
    {error && <p role="alert" className="text-xs text-red-700 bg-red-50 p-2 rounded">{error}</p>}
    {feedback && <p role="status" className="text-xs text-green-800 bg-green-50 p-2 rounded">{feedback}</p>}
    <nav className="flex gap-1 flex-wrap" aria-label={tr('Раздел очистки', 'Cleanup section')}>
      {([['duplicates', tr('Повторы', 'Duplicates')], ['windows', tr('Окна', 'Windows')], ['collections', tr('Коллекции', 'Collections')], ['history', tr('История', 'History')]] as const).map(([value, label]) => <button key={value} onClick={() => setSection(value)} aria-pressed={section === value} className={`px-2 py-1 rounded text-xs ${section === value ? 'bg-accent text-white' : 'bg-gray-100'}`}>{label}</button>)}
    </nav>
    {section === 'duplicates' && <>
    <div className="flex gap-2">
      <select aria-label={tr('Область поиска', 'Scan scope')} value={scope} onChange={(event) => setScope(event.target.value)} className="border rounded text-xs min-w-0 flex-1">
        <option value="all">{tr('Все обычные окна', 'All normal windows')}</option>
        {windows.map((window, index) => <option key={window.windowId} value={window.windowId}>{tr('Окно', 'Window')} {index + 1} ({window.tabs.length})</option>)}
      </select>
      <button disabled={busy} onClick={() => void run(scan)} className="px-3 py-2 bg-accent text-white rounded text-xs disabled:opacity-50">{tr('Найти повторы', 'Find duplicates')}</button>
    </div>
    {preview && preview.groups.length === 0 && <p className="text-sm">{tr('Повторов не найдено.', 'No duplicates found.')}</p>}
    {preview?.groups.map((group) => <section key={group.id} className="border rounded p-2 space-y-2">
      <h3 className="text-xs font-semibold">{group.kind === 'exact' ? tr('Точные повторы', 'Exact duplicates') : tr('Отличаются tracking-параметрами — проверьте вручную', 'Tracking variants — manual review')}</h3>
      <p className="text-[10px] text-gray-500">{tr('Радиокнопка выбирает сохраняемую копию. Галочка отмечает вкладку на закрытие.', 'Radio selects the survivor. Checkbox selects a tab to close.')}</p>
      {group.tabs.map((tab) => {
        const protectedReason = tabProtectionReason(tab, preview.protectedDomains);
        const keep = keepers[group.id] === tab.id;
        return <div key={tab.id} className="text-xs flex gap-2 items-start">
          <input type="radio" aria-label={tr('Сохранить копию', 'Keep copy') + ' ' + tab.id} name={group.id} checked={keep} disabled={busy} onChange={() => {
            setKeepers({ ...keepers, [group.id]: tab.id });
            setSelected((previous) => { const next = new Set(previous); next.delete(tab.id); return next; });
          }} />
          <input type="checkbox" aria-label={tr('Закрыть вкладку', 'Close tab') + ' ' + tab.id} checked={!keep && selected.has(tab.id)} disabled={busy || keep || Boolean(protectedReason)} onChange={(event) => {
            const checked = event.target.checked;
            setSelected((previous) => { const next = new Set(previous); if (checked) next.add(tab.id); else next.delete(tab.id); return next; });
          }} />
          <div className="min-w-0 flex-1"><div className="truncate">{tab.title || tab.url}</div><div className="text-[10px] text-gray-500 break-all">{tab.url}</div>
            <span className="text-[10px]">{tr('Окно', 'Window')} {tab.windowId}{keep ? ' · ' + tr('сохранить', 'keep') : ''}{protectedReason ? ' · ' + protectedReason : ''}</span></div>
        </div>;
      })}
    </section>)}
    {preview && selected.size > 0 && <button disabled={busy} onClick={() => void run(closeSelected)} className="w-full p-2 bg-red-600 text-white rounded text-xs disabled:opacity-50">
      {tr('Закрыть выбранные копии', 'Close selected copies')} ({selected.size})
    </button>}
    </>}
    {section === 'windows' && <WindowMergePanel busy={busy} run={run} onResult={showResult} />}
    {section === 'collections' && <CollectionsPanel workspace={workspace} busy={busy} run={run} onResult={showResult} onFeedback={setFeedback} />}
    {section === 'history' && <section className="space-y-2 border-t pt-3">
      <h3 className="font-semibold text-xs">{tr('История операций', 'Operation history')}</h3>
      <p className="text-[10px] text-gray-500">{tr('Сохраняются 50 последних завершённых операций. Undo восстанавливает URL и расположение; несохранённые формы могут не восстановиться.', 'Keeps 50 recent finished operations. Undo restores URLs and layout; unsaved forms may not recover.')}</p>
      {workspace?.operations.slice().reverse().map((operation) => <details key={operation.id} className="border rounded p-2 text-xs">
        <summary>{new Date(operation.createdAt).toLocaleString()} · {operation.kind} · {operation.status} ({operation.items.length})</summary>
        <ul className="my-2 space-y-1">{operation.items.map((item) => <li key={item.tab.id} className="break-all">{item.state}: {item.tab.url}{item.error && <span className="text-red-700"> · {item.error}</span>}</li>)}</ul>
        {operation.items.some((item) => item.state === 'uncertain') && <p className="text-amber-800">{tr('Результат части действий не подтверждён. Проверьте эти вкладки вручную.', 'Some results could not be confirmed. Review these tabs manually.')}</p>}
        {operation.items.some((item) => item.state === 'done') && <button disabled={busy} onClick={() => void run(async () => showResult(await workspaceMessage<TabOperation>({ type: 'UNDO_TAB_OPERATION', operationId: operation.id })))} className="px-2 py-1 bg-gray-100 rounded">{tr('Отменить выполненные действия', 'Undo completed actions')}</button>}
      </details>)}
      {workspace?.operations.length === 0 && <p className="text-xs text-gray-400">{tr('История пока пуста.', 'No operations yet.')}</p>}
    </section>}
  </div>;
}
