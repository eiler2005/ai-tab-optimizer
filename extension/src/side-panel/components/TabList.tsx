import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import { filteredWindows } from '../tab-filter';
import { TabItem } from './TabItem';
import { RecentlyClosed } from './RecentlyClosed';

export function TabList() {
  const state = useStore(); const { t, locale } = useI18n();
  const [collapsedWindows, setCollapsedWindows] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(100);
  const ref = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => filteredWindows(state.windowGroups, state), [state.windowGroups, state.searchQuery, state.tabScope, state.tabTopicUrls, state.showSelectedOnly, state.selectedTabIds, state.searchMatchIds]);
  const total = groups.reduce((sum, window) => sum + window.tabs.length, 0);
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = useStore.getState().tabsScrollTop; }, []);
  let shown = 0;
  return <div ref={ref} className="flex-1 min-h-0 overflow-y-auto" onScroll={(event) => useStore.setState({ tabsScrollTop: event.currentTarget.scrollTop })}>
    {state.loading && <p className="p-3 text-xs">{t('tabs.loading')}</p>}
    {!state.loading && !total && <p className="p-3 text-xs">{state.searchQuery ? t('tabs.noMatch') : t('tabs.noTabs')}</p>}
    {groups.map((window) => {
      const rows = window.tabs.slice(0, Math.max(0, limit - shown)); shown += rows.length;
      return <section key={window.windowId}>
        <button onClick={() => setCollapsedWindows((current) => { const next = new Set(current); if (next.has(window.windowId)) next.delete(window.windowId); else next.add(window.windowId); return next; })} className="w-full text-left sticky top-0 z-[1] bg-gray-50 border-b px-3 py-2 text-xs font-medium">{collapsedWindows.has(window.windowId) ? '▸' : '▾'} {t('tabs.window')} {window.windowId}{window.focused ? ` · ${t('tabs.active')}` : ''} · {window.tabs.length}</button>
        {!collapsedWindows.has(window.windowId) && rows.map((tab) => <TabItem key={tab.id} tab={tab} />)}
      </section>;
    })}
    {total > limit && <button className="m-3 border rounded p-2 text-xs" onClick={() => setLimit(limit + 100)}>{locale === 'ru' ? 'Показать ещё' : 'Show more'} ({total - limit})</button>}
    <RecentlyClosed />
  </div>;
}
