import { useEffect } from 'react';
import { useI18n } from '@shared/i18n';
import { useStore } from '../store';
import { useTopics } from '../topic-store';
import { useLibraryPages } from '../library-sources';
import { scopedSearch, type SearchScope } from '../library-index';

export function GlobalSearch() {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { searchQuery, searchScope, view, setSearchQuery, setView, windowGroups } = useStore();
  const pages = useLibraryPages();
  useEffect(() => { void useTopics.getState().refresh(); }, [windowGroups]);
  useEffect(() => {
    if (useTopics.getState().query !== searchQuery) useTopics.setState({ query: searchQuery });
    const results = scopedSearch(pages, searchQuery, searchScope);
    const ids = searchQuery.trim() || searchScope !== 'open' ? results.flatMap((page) => page.liveTabIds) : null;
    if (JSON.stringify(ids) !== JSON.stringify(useStore.getState().searchMatchIds)) useStore.setState({ searchMatchIds: ids });
    const topicIds = searchQuery.trim() ? [...new Set([...results.flatMap((page) => page.topicIds ?? []), ...useTopics.getState().catalog.topics.filter((topic) => !topic.deletedAt && !topic.mergedInto && !searchQuery.includes(':') && [topic.name, topic.focus, ...topic.aliases].join('\n').toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase())).map((topic) => topic.id)])] : null;
    if (JSON.stringify(topicIds) !== JSON.stringify(useTopics.getState().matchedIds)) useTopics.setState({ matchedIds: topicIds });
  }, [pages, searchQuery, searchScope]);
  if (!['tabs', 'topics', 'library', 'chat'].includes(view)) return null;
  return <div className="border-b bg-white p-3 space-y-2 text-xs flex-none">
    <input aria-label={tr('Поиск материалов', 'Find materials')} value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); useTopics.setState({ query: event.target.value }); }} placeholder={tr('Вкладка, тема, заметка…', 'Tab, topic or note…')} className="border rounded p-2 w-full" />
    <div className="flex gap-2 items-center flex-wrap">{view !== 'chat' && <select aria-label={tr('Где искать', 'Search scope')} value={searchScope} onChange={(event) => useStore.setState({ searchScope: event.target.value as SearchScope })} className="border rounded p-2"><option value="open">{tr('Открытые', 'Open')}</option><option value="saved">{tr('Сохранённые', 'Saved')}</option><option value="all">{tr('Всё', 'Everything')}</option></select>}
      <button className="border rounded p-2" onClick={() => setView(view === 'chat' ? 'tabs' : 'chat')}>{view === 'chat' ? tr('Локальный поиск', 'Local search') : tr('По смыслу / задать вопрос', 'By meaning / ask a question')}</button>
    </div>
    {view === 'chat' && <p>{tr('Поиск в истории и результатах анализа; локальные фильтры не ограничивают эту область.', 'Searches history and analysis results; local filters do not restrict this scope.')}</p>}
    {searchQuery && <p className="text-gray-500">{tr('Фильтры', 'Filters')}: domain:, collection:, topic:, window:, status:</p>}
  </div>;
}
