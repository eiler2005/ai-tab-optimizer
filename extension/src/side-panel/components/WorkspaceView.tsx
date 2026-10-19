import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { TabOperation, WorkspaceData } from '@shared/types/workspace';
import { useStore } from '../store';
import { useTopics } from '../topic-store';
import { workspaceMessage } from '../workspace-api';
import { WindowMergePanel } from './WindowMergePanel';
import { CollectionsPanel } from './CollectionsPanel';
import { LibraryPanel } from './LibraryPanel';
import { FullBackupsPanel } from './FullBackupsPanel';
import { TopicHistory } from './TopicHistory';
import { TopicsPanel } from './TopicsPanel';
import { OptimizationPanel } from './OptimizationPanel';
import { WorkspaceFooterContext } from './WorkspaceActionBar';

export function WorkspaceView() {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { view, workspaceSection, librarySection } = useStore();
  const topicId = useTopics((state) => state.activeId);
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const scrollKey = `${view}:${workspaceSection}:${librarySection}:${view === 'topics' ? topicId ?? 'catalog' : ''}`;
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = scrollPositions.current.get(scrollKey) ?? 0;
  }, [scrollKey]);
  const section = view === 'topics' ? 'ai' : view === 'library' ? librarySection : view === 'tabs' && useStore.getState().searchScope !== 'open' ? 'library' : workspaceSection;
  const setSection = (next: import('../store').WorkspaceSection) => useStore.setState({ workspaceSection: next });

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
    useStore.getState().openWorkspace('history');
    const count = (state: string) => operation.items.filter((item) => item.state === state).length;
    setFeedback(`${tr('Выполнено', 'Completed')}: ${count('done')}; ${tr('пропущено', 'skipped')}: ${count('skipped')}; ${tr('ошибок', 'failed')}: ${count('failed')}; ${tr('восстановлено', 'restored')}: ${count('undone')}`);
  }

  return <WorkspaceFooterContext.Provider value={footer}><div className="flex-1 min-h-0 flex flex-col">
    <div className="flex-none p-3 space-y-2 border-b bg-white">
    <h2 className="font-semibold text-sm">{view === 'topics' ? tr('Темы', 'Topics') : section === 'library' || view === 'library' ? tr('Библиотека', 'Library') : section === 'history' ? tr('Журнал и Undo', 'Journal and Undo') : section === 'backups' ? tr('Восстановление и бэкапы', 'Recovery and backups') : tr('Разбор вкладок', 'Review tabs')}</h2>
    {view === 'library' && <div className="flex gap-2">{(['library', 'collections'] as const).map((value) => <button className="border rounded p-2 text-xs" key={value} aria-pressed={librarySection === value} onClick={() => useStore.setState({ librarySection: value })}>{value === 'library' ? tr('Материалы', 'Materials') : tr('Коллекции', 'Collections')}</button>)}</div>}
    {view === 'workspace' && !['history', 'windows', 'backups'].includes(section) && <nav className="flex gap-1 flex-wrap" aria-label={tr('Раздел очистки', 'Cleanup section')}>
      {([['optimize', tr('Оптимизация', 'Optimize')], ['duplicates', tr('Повторы', 'Duplicates')], ['similar', tr('Похожий контент', 'Similar content')], ['outdated', tr('Устарело по смыслу', 'Outdated content')], ] as const).map(([value, label]) => <button key={value} onClick={() => setSection(value)} aria-pressed={section === value} className={`px-2 py-1 rounded text-xs ${section === value ? 'bg-accent text-white' : 'bg-gray-100'}`}>{label}</button>)}
    </nav>}
    {busy && <p role="status" className="text-xs text-blue-800">{tr('Выполняем действие и сохраняем результат…', 'Applying action and saving the result…')}</p>}
    </div>
    <div ref={scrollArea} data-testid="workspace-view" className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4" onScroll={(event) => scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop)}>
    {error && <p role="alert" className="text-xs text-red-700 bg-red-50 p-2 rounded">{error}</p>}
    {feedback && <p role="status" className="text-xs text-green-800 bg-green-50 p-2 rounded">{feedback}</p>}
    <div className={['optimize', 'duplicates', 'similar', 'outdated'].includes(section) ? 'block' : 'hidden'}><OptimizationPanel busy={busy} run={run} filter={section} /></div>
    {section === 'backups' && <FullBackupsPanel busy={busy} run={run} onFeedback={setFeedback} />}
    {section === 'windows' && <WindowMergePanel busy={busy} run={run} onResult={showResult} />}
    {section === 'collections' && <CollectionsPanel workspace={workspace} busy={busy} run={run} onResult={showResult} onFeedback={setFeedback} />}
    {section === 'library' && <LibraryPanel workspace={workspace} busy={busy} run={run} />}
    {section === 'ai' && <TopicsPanel workspace={workspace} busy={busy} run={run} onResult={showResult} onFeedback={setFeedback} />}
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
      <TopicHistory catalog={workspace?.topicCatalog} busy={busy} run={run} />
      {workspace?.operations.length === 0 && <p className="text-xs text-gray-400">{tr('История пока пуста.', 'No operations yet.')}</p>}
    </section>}
    </div>
    <div ref={setFooter} className="flex-none max-h-[35vh] overflow-y-auto border-t bg-white shadow-lg empty:hidden" />
  </div></WorkspaceFooterContext.Provider>;
}
