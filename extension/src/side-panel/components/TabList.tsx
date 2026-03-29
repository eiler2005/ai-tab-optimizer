import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import { TabItem } from './TabItem';
import { RecentlyClosed } from './RecentlyClosed';

export function TabList() {
  const { windowGroups, loading, searchQuery } = useStore();
  const { t } = useI18n();
  const [collapsedWindows, setCollapsedWindows] = useState<Set<number>>(new Set());

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return windowGroups;

    const q = searchQuery.toLowerCase();
    return windowGroups
      .map((wg) => ({
        ...wg,
        tabs: wg.tabs.filter(
          (tab) =>
            tab.title.toLowerCase().includes(q) ||
            tab.url.toLowerCase().includes(q) ||
            tab.domain.toLowerCase().includes(q)
        ),
      }))
      .filter((wg) => wg.tabs.length > 0);
  }, [windowGroups, searchQuery]);

  const toggleWindow = (windowId: number) => {
    setCollapsedWindows((prev) => {
      const next = new Set(prev);
      if (next.has(windowId)) next.delete(windowId);
      else next.add(windowId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        {t('tabs.loading')}
      </div>
    );
  }

  if (filteredGroups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        {searchQuery ? t('tabs.noMatch') : t('tabs.noTabs')}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {filteredGroups.map((wg) => (
        <div key={wg.windowId}>
          <button
            onClick={() => toggleWindow(wg.windowId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 bg-surface-secondary hover:bg-surface-hover sticky top-0 z-[1]"
          >
            <span className={`transition-transform ${collapsedWindows.has(wg.windowId) ? '' : 'rotate-90'}`}>
              ▶
            </span>
            <span>
              {t('tabs.window')} {wg.focused ? t('tabs.active') : ''} — {wg.tabs.length} {t('tabs.tabsCount')}
            </span>
          </button>

          {!collapsedWindows.has(wg.windowId) && (
            <div>
              {wg.tabs.map((tab) => (
                <TabItem key={tab.id} tab={tab} />
              ))}
            </div>
          )}
        </div>
      ))}

      <RecentlyClosed />
    </div>
  );
}
