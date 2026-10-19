import { useEffect, useRef } from 'react';
import { useI18n } from '@shared/i18n';
import type { OptimizationPlan } from '@shared/types/optimization';
import type { OperationItem, TabOperation, WorkspaceData } from '@shared/types/workspace';
import { useStore } from '../store';

export function OptimizationOutcome({ plan, operation, workspace }: { plan: OptimizationPlan; operation: TabOperation; workspace: WorkspaceData | null }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'start' }); }, [operation.id, operation.status]);
  const closed = operation.items.filter((item) => item.state === 'done');
  const restored = operation.items.filter((item) => item.state === 'undone');
  const remaining = operation.items.filter((item) => !['done', 'undone'].includes(item.state));
  const skipped = operation.items.filter((item) => item.state === 'skipped').length;
  const failed = operation.items.filter((item) => ['failed', 'uncertain'].includes(item.state)).length;
  function savedLocation(item: OperationItem) {
    const candidate = plan.candidates.find((entry) => entry.tab.id === item.tab.id);
    const id = candidate?.savedIn?.collectionId ?? (candidate?.category === 'defer' ? `${operation.id}-saved` : undefined);
    return workspace?.collections.find((collection) => collection.id === id && !collection.deletedAt && collection.windows.some((window) => window.tabs.some((tab) => tab.url === item.tab.url)));
  }
  function showSaved(url: string) {
    useStore.getState().setView('library');
    useStore.setState({ librarySection: 'library', searchScope: 'saved', searchQuery: url, searchMatchIds: null });
  }
  return <section ref={ref} data-testid="optimization-outcome" className="space-y-3 text-xs">
    <div className="rounded border bg-green-50 p-3 space-y-2" role="status">
      <h3 className="font-semibold text-base">{operation.status === 'undoing' ? tr('Восстанавливаем вкладки…', 'Restoring tabs…') : operation.status === 'undone' ? tr('Вкладки восстановлены', 'Tabs restored') : remaining.length ? tr('Очистка завершена — есть пропуски', 'Cleanup finished — inspect remaining items') : tr('Очистка завершена', 'Cleanup complete')}</h3>
      {operation.status === 'undoing' || operation.status === 'undone' ? <p>{tr('Восстановлено', 'Restored')}: {restored.length}{operation.status === 'undoing' ? ` / ${operation.items.length}` : ''}. {tr('Сохранённые материалы остаются в библиотеке.', 'Saved materials remain in the library.')}</p> : <>
        <p>{tr('Закрыто', 'Closed')}: {closed.length} · {tr('Пропущено', 'Skipped')}: {skipped} · {tr('Ошибок', 'Failed')}: {failed}</p>
        {operation.optimizationReport && <p>{tr('Открытых вкладок в области', 'Open tabs in scope')}: {operation.optimizationReport.tabsBefore} → {operation.optimizationReport.tabsAfter}</p>}
        <p>{tr('Ниже показаны именно обработанные вкладки. Для следующей порции нажмите «Продолжить очистку».', 'These are the tabs handled by this operation. Choose Continue cleanup for the next batch.')}</p>
      </>}
    </div>
    {closed.length > 0 && <div className="space-y-2"><h4 className="font-semibold">{tr('Какие вкладки закрыты', 'Tabs that were closed')}</h4>{closed.map((item) => {
      const collection = savedLocation(item);
      return <article key={item.tab.id} className="rounded border p-3 space-y-1" data-closed-tab-id={item.tab.id}>
        <strong className="break-words">{item.tab.title || item.tab.url}</strong><p className="text-gray-500 break-all">{item.tab.url}</p>
        <p className="font-medium text-green-800">{collection ? tr('Сохранена и закрыта', 'Saved and closed') : tr('Закрыта', 'Closed')}</p>
        {collection && <><p>{tr('Сохранена в коллекции', 'Saved in collection')}: <strong>{collection.name}</strong></p><button className="text-accent underline" onClick={() => showSaved(item.tab.url)}>{tr('Найти сохранённую страницу', 'Find saved page')}</button></>}
      </article>;
    })}</div>}
    {restored.length > 0 && <div className="space-y-1"><h4 className="font-semibold">{tr('Восстановлены', 'Restored')}</h4>{restored.map((item) => <p key={item.tab.id} className="break-words">{item.tab.title || item.tab.url}</p>)}</div>}
    {remaining.length > 0 && <div className="space-y-2"><h4 className="font-semibold">{tr('Не закрыты или требуют проверки', 'Not closed or need inspection')}</h4>{remaining.map((item) => <article key={item.tab.id} className="border rounded p-3 break-words"><p>{item.tab.title || item.tab.url}</p><p>{item.error ?? tr('Результат не подтверждён; проверьте вкладку.', 'Outcome is unconfirmed; inspect this tab.')}</p></article>)}</div>}
  </section>;
}
