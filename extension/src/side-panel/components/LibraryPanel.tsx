import { useMemo, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { WorkspaceData } from '@shared/types/workspace';
import { useStore } from '../store';
import { useTopics } from '../topic-store';
import { useLibraryPages } from '../library-sources';
import { scopedSearch } from '../library-index';
import { workspaceMessage } from '../workspace-api';
import { LibraryReview } from './LibraryReview';
import { LibraryRulesPanel } from './LibraryRulesPanel';

export function LibraryPanel({ workspace, busy, run }: { workspace: WorkspaceData | null; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { searchQuery, searchScope } = useStore();
  const pages = useLibraryPages();
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState(false);
  const results = useMemo(() => scopedSearch(pages, searchQuery, searchScope), [pages, searchQuery, searchScope]);
  const chosen = pages.filter((page) => selected.has(page.key));
  const selectedUrls = [...new Set(chosen.map((page) => page.url))];
  const hidden = chosen.filter((page) => !results.some((item) => item.key === page.key)).length;
  return <section className="space-y-3 text-xs">
    <h3 className="font-semibold">{tr('Материалы', 'Materials')}</h3>
    <p role="status">{tr('Найдено', 'Found')}: {results.length} / {pages.length}</p>
    <p className="text-gray-500">{tr('Корзина исключена. Открывается одна страница; доступная открытая копия получает фокус.', 'Trash is excluded. Opens one page or focuses an available live copy.')}</p>
    <details><summary>{tr('Инструменты библиотеки', 'Library tools')}</summary><LibraryRulesPanel workspace={workspace} busy={busy} run={run} /><button className="border rounded p-2 mt-2" onClick={() => setCompare(!compare)}>{tr('Сравнить открытое и сохранённое', 'Compare open and saved')}</button></details>
    {chosen.length > 0 && <aside className="border rounded p-2 bg-blue-50 space-y-2"><p>{tr('Выбрано материалов', 'Materials selected')}: {chosen.length} · {tr('Вне фильтра', 'Outside filter')}: {hidden}</p><div className="flex gap-2 flex-wrap"><button className="border rounded p-2" disabled={selectedUrls.length !== 2} title={tr('Для подробного сравнения выберите два разных URL.', 'Select two different URLs for detailed comparison.')} onClick={() => setCompare(true)}>{tr('Сравнить пару', 'Compare pair')}</button><button disabled={!chosen.some((page) => page.liveTabIds.length)} className="border rounded p-2" onClick={() => { const ids = chosen.flatMap((page) => page.liveTabIds); useStore.setState({ selectedTabIds: new Set(ids), selectedTabUrls: Object.fromEntries(chosen.flatMap((page) => page.liveTabIds.map((id) => [id, page.url]))), librarySection: 'collections', view: 'library' }); }}>{tr('Сохранить выбранное…', 'Save selected…')}</button><button className="border rounded p-2" onClick={() => { setSelected(new Set()); setCompare(false); }}>{tr('Снять выбор', 'Clear selection')}</button></div></aside>}
    {compare && <LibraryReview selectedUrls={selectedUrls} />}
    {results.slice(0, limit).map((page) => <article key={page.key} className="border rounded p-3 space-y-2">
      <label className="flex gap-2 items-start"><input aria-label={tr('Выбрать материал', 'Select material') + ' ' + page.title} type="checkbox" checked={selected.has(page.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(page.key)) next.delete(page.key); else next.add(page.key); return next; })} /><span className="font-medium break-words line-clamp-2">{page.title || page.url}</span></label>
      <p className="break-all text-gray-500">{page.url}</p>
      <p>{tr('Открытых копий', 'Open copies')}: {page.liveTabIds.length} · {page.saved.map((saved) => saved.name).join(', ')}</p>
      {page.topicIds?.length ? <div className="flex flex-wrap gap-2">{page.topicIds.map((id, index) => <button key={id} className="text-accent" onClick={() => { useTopics.setState({ activeId: id }); useStore.getState().setView('topics'); }}>{page.topicNames?.[index]}</button>)}</div> : null}
      {page.notes.length > 0 && <details><summary>{tr('Заметки и контекст', 'Notes and context')}</summary><p className="whitespace-pre-wrap break-words">{page.notes.join('\n')}</p></details>}
      <button disabled={busy} className="border rounded p-2" onClick={() => void run(async () => {
        if (page.liveTabIds.length) await workspaceMessage({ type: 'FOCUS_TAB', tabId: page.liveTabIds[0] });
        else if (page.saved[0]) await workspaceMessage({ type: 'OPEN_COLLECTION_ITEM', collectionId: page.saved[0].collectionId, itemId: page.saved[0].itemId });
      })}>{page.liveTabIds.length ? tr('Перейти к открытой', 'Focus open page') : tr('Открыть страницу', 'Open page')}</button>
      {page.liveTabIds.length > 1 && <details><summary>{tr('Показать открытые копии', 'Show open copies')} ({page.liveTabIds.length})</summary>{page.liveTabIds.map((id) => <button className="border rounded p-2 m-1" key={id} onClick={() => void run(async () => { await workspaceMessage({ type: 'FOCUS_TAB', tabId: id }); })}>{tr('Перейти к вкладке', 'Focus tab')} {id}</button>)}</details>}
    </article>)}
    {results.length > limit && <button className="border rounded p-2" onClick={() => setLimit(limit + 50)}>{tr('Показать ещё', 'Show more')}</button>}
  </section>;
}
