import { useMemo, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { WorkspaceData } from '@shared/types/workspace';
import { buildLibrary, searchLibrary } from '@shared/utils/library';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';
import { LibraryReview } from './LibraryReview';
import { LibraryRulesPanel } from './LibraryRulesPanel';

export function LibraryPanel({ workspace, busy, run }: { workspace: WorkspaceData | null; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const pages = useMemo(() => buildLibrary(windows, workspace?.collections ?? []), [windows, workspace]);
  const results = useMemo(() => searchLibrary(pages, query), [pages, query]);
  return <section className="space-y-3 text-xs">
    <h3 className="font-semibold">{tr('Библиотека: открытое и сохранённое', 'Library: open and saved pages')}</h3>
    <input aria-label={tr('Поиск по библиотеке', 'Search library')} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} placeholder={tr('Тема, заметка, collection:Название, status:later', 'Topic, note, collection:Name, status:later')} className="w-full border rounded p-2" />
    <p className="text-gray-500">{tr('Фильтры', 'Filters')}: collection:, domain:, status:open / now / later / reference. {tr('Корзина исключена. Открывается одна страница; существующая вкладка получает фокус.', 'Trash is excluded. Opens one page or focuses an existing tab.')}</p>
    <p role="status">{tr('Найдено', 'Found')}: {results.length} / {pages.length}</p>
    <LibraryReview selectedUrls={selectedUrls} />
    <LibraryRulesPanel workspace={workspace} busy={busy} run={run} />
    {results.slice(0, limit).map((page) => <article key={page.key} className="border rounded p-2 space-y-2">
      <h4 className="font-medium break-words">{page.title || page.url}</h4><p className="break-all text-gray-500">{page.url}</p>
      <label className="flex gap-2"><input type="checkbox" aria-label={tr('Сравнить страницу', 'Compare page') + ' ' + page.url} checked={selectedUrls.includes(page.url)} disabled={!selectedUrls.includes(page.url) && selectedUrls.length >= 2} onChange={() => setSelectedUrls((current) => current.includes(page.url) ? current.filter((url) => url !== page.url) : [...current, page.url])} />{tr('Выбрать для углублённого сравнения', 'Select for deep comparison')}</label>
      <p>{tr('Открытых копий', 'Open copies')}: {page.liveTabIds.length} · {page.saved.map((saved) => saved.name).join(', ')}</p>
      {page.notes.length > 0 && <p className="whitespace-pre-wrap break-words">{page.notes.join('\n').slice(0, 500)}</p>}
      <button disabled={busy} className="border rounded p-2" onClick={() => void run(async () => {
        if (page.liveTabIds.length) await workspaceMessage({ type: 'FOCUS_TAB', tabId: page.liveTabIds[0] });
        else if (page.saved[0]) await workspaceMessage({ type: 'OPEN_COLLECTION_ITEM', collectionId: page.saved[0].collectionId, itemId: page.saved[0].itemId });
      })}>{page.liveTabIds.length ? tr('Перейти к открытой', 'Focus open page') : tr('Открыть страницу', 'Open page')}</button>
    </article>)}
    {results.length > limit && <button className="border rounded p-2" onClick={() => setLimit(limit + 50)}>{tr('Показать ещё', 'Show more')}</button>}
  </section>;
}
