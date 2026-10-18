import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { DuplicatePreview, TabOperation, WorkspaceData } from '@shared/types/workspace';
import { tabProtectionReason } from '@shared/utils/rules';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';
import { WindowMergePanel } from './WindowMergePanel';
import { CollectionsPanel } from './CollectionsPanel';
import { LibraryPanel } from './LibraryPanel';
import { TopicsPanel } from './TopicsPanel';
import { AIWorkspacePanel } from './AIWorkspacePanel';
import { ContentReviewPanel } from './ContentReviewPanel';
import { OptimizationPanel } from './OptimizationPanel';
import { ReviewContext, useReviewController } from '../review-controller';
import { ReviewProgress } from './ReviewProgress';
import { WorkspaceActionBar, WorkspaceFooterContext } from './WorkspaceActionBar';

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
  const busyRef = useRef(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const review = useReviewController();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [section, setSection] = useState<'optimize' | 'duplicates' | 'similar' | 'outdated' | 'windows' | 'collections' | 'library' | 'ai' | 'history'>('optimize');

  const refresh = async () => setWorkspace(await workspaceMessage<WorkspaceData>({ type: 'WORKSPACE_OVERVIEW' }));
  useEffect(() => {
    const reload = () => { void refresh().catch((failure) => setError(String(failure))); };
    const listener = (message: { type?: string }) => { if (message.type === 'TAB_OPERATION_COMPLETE') reload(); };
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => { if (changes['aitab.workspace.v1']) reload(); };
    reload(); chrome.runtime.onMessage.addListener(listener);
    chrome.storage.onChanged.addListener(changed);
    return () => { chrome.runtime.onMessage.removeListener(listener); chrome.storage.onChanged.removeListener(changed); };
  }, []);

  const stateLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      running: ['Выполняется', 'In progress'], completed: ['Завершено', 'Completed'], partial: ['Выполнено частично', 'Partly completed'],
      interrupted: ['Прервано', 'Interrupted'], undoing: ['Восстанавливается', 'Restoring'], undone: ['Восстановлено', 'Restored'],
      pending: ['Ожидает', 'Waiting'], applying: ['Выполняется', 'In progress'], done: ['Выполнено', 'Completed'],
      failed: ['Ошибка', 'Failed'], skipped: ['Пропущено', 'Skipped'], restoring: ['Восстанавливается', 'Restoring'], uncertain: ['Требует проверки', 'Needs review'],
    };
    return labels[value] ? tr(...labels[value]) : value;
  };
  const protectionLabel = (reason: string) => {
    const labels: Record<string, string> = { 'marked important or protected': 'важная или защищённая', pinned: 'закреплена', active: 'активна', 'playing audio': 'воспроизводит звук', 'protected domain': 'защищённый домен' };
    return locale === 'ru' ? labels[reason] ?? reason : reason;
  };

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null); setFeedback(null);
    try { await action(); }
    catch (failure) { setError(String(failure)); }
    finally {
      busyRef.current = false;
      setBusy(false);
      void refresh().catch((failure) => setError(String(failure)));
      void useStore.getState().loadTabs().catch((failure) => setError(String(failure)));
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

  return <ReviewContext.Provider value={review}><WorkspaceFooterContext.Provider value={footer}><div className="flex-1 min-h-0 flex flex-col">
    <div className="flex-none p-3 space-y-2 border-b bg-white">
    <h2 className="font-semibold text-sm">{tr('Очистка и оптимизация', 'Cleanup and optimization')}</h2>
    <nav className="flex gap-1 flex-wrap" aria-label={tr('Раздел очистки', 'Cleanup section')}>
      {([['optimize', tr('Оптимизация', 'Optimize')], ['duplicates', tr('Повторы', 'Duplicates')], ['similar', tr('Похожий контент', 'Similar content')], ['outdated', tr('Устарело по смыслу', 'Outdated content')], ['windows', tr('Окна', 'Windows')], ['collections', tr('Коллекции', 'Collections')], ['library', tr('Библиотека', 'Library')], ['ai', 'AI'], ['history', tr('История', 'History')]] as const).map(([value, label]) => <button key={value} onClick={() => setSection(value)} aria-pressed={section === value} className={`px-2 py-1 rounded text-xs ${section === value ? 'bg-accent text-white' : 'bg-gray-100'}`}>{label}</button>)}
    </nav>
    <ReviewProgress />
    {busy && <p role="status" className="text-xs text-blue-800">{tr('Выполняем действие и сохраняем результат…', 'Applying action and saving the result…')}</p>}
    </div>
    <div data-testid="workspace-view" className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
    {error && <p role="alert" className="text-xs text-red-700 bg-red-50 p-2 rounded">{error}</p>}
    {feedback && <p role="status" className="text-xs text-green-800 bg-green-50 p-2 rounded">{feedback}</p>}
    {section === 'optimize' && <OptimizationPanel busy={busy} run={run} />}
    {section === 'duplicates' && <>
    <div className="flex gap-2">
      <select disabled={busy} aria-label={tr('Область поиска', 'Scan scope')} value={scope} onChange={(event) => { setScope(event.target.value); setPreview(null); setSelected(new Set()); }} className="border rounded text-xs min-w-0 flex-1">
        <option value="all">{tr('Все обычные окна', 'All normal windows')}</option>
        {windows.map((window, index) => <option key={window.windowId} value={window.windowId}>{tr('Окно', 'Window')} {index + 1} ({window.tabs.length})</option>)}
      </select>
      <button disabled={busy} onClick={() => void run(scan)} className="px-3 py-2 bg-accent text-white rounded text-xs disabled:opacity-50">{tr('Найти повторы', 'Find duplicates')}</button>
    </div>
    {preview && preview.groups.length === 0 && <p className="text-sm">{tr('Повторов не найдено.', 'No duplicates found.')}</p>}
    {preview?.groups.map((group) => <section key={group.id} className="border rounded p-2 space-y-2">
      <h3 className="text-xs font-semibold">{group.kind === 'exact' ? tr('Точные повторы', 'Exact duplicates') : group.kind === 'stateful' ? tr('Чаты с одинаковым адресом — ручная проверка', 'Chats sharing an address — manual review') : tr('Отличаются tracking-параметрами — проверьте вручную', 'Tracking variants — manual review')}</h3>
      {group.kind === 'stateful' && <p className="text-xs text-amber-800">{tr('Это могут быть разные чаты или черновики. Откройте каждую вкладку перед выбором. Восстановление URL не возвращает несохранённый текст.', 'These may contain different chats or drafts. Open each tab before selecting it. Restoring a URL does not restore unsent text.')}</p>}
      <p className="text-[10px] text-gray-500">{tr('Радиокнопка выбирает сохраняемую копию. Галочка отмечает вкладку на закрытие.', 'Radio selects the survivor. Checkbox selects a tab to close.')}</p>
      {group.tabs.map((tab) => {
        const protectedReason = tabProtectionReason(tab, preview.protectedDomains);
        const keep = keepers[group.id] === tab.id;
        const neededSurvivor = preview.groups.some((other) => other.id !== group.id && keepers[other.id] === tab.id
          && other.tabs.some((copy) => selected.has(copy.id)));
        return <div key={tab.id} className="text-xs flex gap-2 items-start">
          <input type="radio" aria-label={tr('Сохранить копию', 'Keep copy') + ' ' + tab.id} name={group.id} checked={keep} disabled={busy} onChange={() => {
            setKeepers({ ...keepers, [group.id]: tab.id });
            setSelected((previous) => { const next = new Set(previous); next.delete(tab.id); return next; });
          }} />
          <input type="checkbox" aria-label={tr('Закрыть вкладку', 'Close tab') + ' ' + tab.id} title={keep ? tr('Выберите другую сохраняемую копию, чтобы закрыть эту.', 'Choose another copy to keep before closing this one.') : protectedReason ? protectionLabel(protectedReason) : neededSurvivor ? tr('Нужна для других выбранных копий.', 'Needed by other selected copies.') : tr('Выбрать для закрытия', 'Select for closing')} checked={!keep && selected.has(tab.id)} disabled={busy || keep || Boolean(protectedReason) || neededSurvivor} onChange={(event) => {
            const checked = event.target.checked;
            setSelected((previous) => { const next = new Set(previous); if (checked) next.add(tab.id); else next.delete(tab.id); return next; });
          }} />
          <div className="min-w-0 flex-1"><button className="text-accent text-left break-words" onClick={() => void workspaceMessage({ type: 'FOCUS_TAB', tabId: tab.id }).catch((failure) => setError(String(failure)))}>{tab.title || tab.url}</button><div className="text-[10px] text-gray-500 break-all">{tab.url}</div>
            <span className="text-[10px]">{tr('Окно', 'Window')} {windows.findIndex((window) => window.windowId === tab.windowId) + 1}{keep ? ' · ' + tr('сохранить', 'keep') : ''}{protectedReason ? ' · ' + protectionLabel(protectedReason) : ''}{neededSurvivor ? ' · ' + tr('сначала очистите точные повторы', 'clean exact copies first') : ''}</span></div>
        </div>;
      })}
    </section>)}
    <WorkspaceActionBar>
    <div className="flex gap-2 text-xs"><button disabled={busy || !preview} onClick={() => {
      if (preview) setSelected(new Set(preview.groups.filter((group) => group.kind === 'exact').flatMap((group) => group.tabs.filter((tab) => tab.id !== keepers[group.id] && !tabProtectionReason(tab, preview.protectedDomains)).map((tab) => tab.id))));
    }} className="border rounded px-2 py-1 disabled:opacity-50">{tr('Выбрать точные копии', 'Select exact copies')}</button><button disabled={busy || !selected.size} onClick={() => setSelected(new Set())} className="border rounded px-2 py-1 disabled:opacity-50">{tr('Снять выбор', 'Clear selection')}</button></div>
    <button disabled={busy || selected.size === 0} onClick={() => void run(closeSelected)} className="w-full p-2 bg-red-600 text-white rounded text-xs disabled:opacity-50">
      {tr('Закрыть выбранные копии', 'Close selected copies')} ({selected.size})
    </button>
    <p className="text-[10px] text-gray-500">{tr('Отмена закрытия — в Истории. Сохраняемую копию выбирайте радиокнопкой.', 'Undo is in History. Use the radio button to choose the retained copy.')}</p>
    </WorkspaceActionBar>
    </>}
    {section === 'windows' && <WindowMergePanel busy={busy} run={run} onResult={showResult} />}
    {(section === 'similar' || section === 'outdated') && <ContentReviewPanel mode={section} busy={busy} run={run} onResult={showResult} />}
    {section === 'collections' && <CollectionsPanel workspace={workspace} busy={busy} run={run} onResult={showResult} onFeedback={setFeedback} />}
    {section === 'library' && <LibraryPanel workspace={workspace} busy={busy} run={run} />}
    {section === 'ai' && <><TopicsPanel workspace={workspace} busy={busy} run={run} onResult={showResult} onFeedback={setFeedback} /><details><summary className="text-xs">{tr('AI-анализ и новые темы', 'AI analysis and new topics')}</summary><AIWorkspacePanel busy={busy} run={run} onFeedback={setFeedback} onReviewDuplicates={() => setSection('duplicates')} /></details></>}
    {section === 'history' && <section className="space-y-2 border-t pt-3">
      <h3 className="font-semibold text-xs">{tr('История операций', 'Operation history')}</h3>
      <p className="text-[10px] text-gray-500">{tr('Сохраняются 50 последних завершённых операций. Undo восстанавливает URL и расположение; несохранённые формы могут не восстановиться.', 'Keeps 50 recent finished operations. Undo restores URLs and layout; unsaved forms may not recover.')}</p>
      {workspace?.operations.slice().reverse().map((operation) => <details key={operation.id} className="border rounded p-2 text-xs">
        <summary>{new Date(operation.createdAt).toLocaleString()} · {operation.kind === 'close' ? tr('Закрытие', 'Closing tabs') : tr('Перенос', 'Moving tabs')} · {stateLabel(operation.status)} ({operation.items.length})</summary>
        {operation.optimizationReport && <p className="mt-2 font-medium">{tr('Оптимизация', 'Optimization')}: {operation.optimizationReport.tabsBefore} → {operation.optimizationReport.tabsAfter} · {tr('закрыто', 'closed')}: {operation.optimizationReport.closed} · {tr('пропущено', 'skipped')}: {operation.optimizationReport.skipped} · {tr('ошибок', 'failed')}: {operation.optimizationReport.failed}</p>}
        <ul className="my-2 space-y-1">{operation.items.map((item) => <li key={item.tab.id} className="break-all">{stateLabel(item.state)}: {item.tab.url}{item.error && <span className="text-red-700"> · {item.error}</span>}</li>)}</ul>
        {operation.items.some((item) => item.state === 'uncertain') && <p className="text-amber-800">{tr('Результат части действий не подтверждён. Проверьте эти вкладки вручную.', 'Some results could not be confirmed. Review these tabs manually.')}</p>}
        {operation.items.some((item) => item.state === 'done') && <button disabled={busy} onClick={() => void run(async () => showResult(await workspaceMessage<TabOperation>({ type: 'UNDO_TAB_OPERATION', operationId: operation.id })))} className="px-2 py-1 bg-gray-100 rounded">{tr('Отменить выполненные действия', 'Undo completed actions')}</button>}
      </details>)}
      {workspace?.operations.length === 0 && <p className="text-xs text-gray-400">{tr('История пока пуста.', 'No operations yet.')}</p>}
    </section>}
    </div>
    <div ref={setFooter} className="flex-none max-h-[35vh] overflow-y-auto border-t bg-white shadow-lg empty:hidden" />
  </div></WorkspaceFooterContext.Provider></ReviewContext.Provider>;
}
