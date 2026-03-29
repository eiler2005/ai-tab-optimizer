import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import type { HistoryTimeframe, TabRecord } from '@shared/types';

const TIMEFRAMES: HistoryTimeframe[] = ['day', 'week', 'month'];

type SortMode = 'recent' | 'visits';

function findOpenTab(windowGroups: { tabs: TabRecord[] }[], url: string): TabRecord | undefined {
  for (const wg of windowGroups) {
    const found = wg.tabs.find((t) => t.url === url);
    if (found) return found;
  }
  return undefined;
}

export function HistoryPanel() {
  const {
    historyStats,
    historyTimeframe,
    historySearchQuery,
    historyLoading,
    historyHasMore,
    historyTotal,
    historyShowOpenOnly,
    windowGroups,
    setHistoryTimeframe,
    setHistorySearchQuery,
    setHistoryShowOpenOnly,
    loadHistory,
    loadMoreHistory,
  } = useStore();
  const { t } = useI18n();
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (historyStats.length === 0) loadHistory();
  }, []);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && historyHasMore && !historyLoading) {
        void loadMoreHistory();
      }
    },
    [historyHasMore, historyLoading, loadMoreHistory],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleIntersect, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect]);

  const filtered = historyStats.filter((s) => {
    if (historyShowOpenOnly && !s.stillOpen) return false;
    if (!historySearchQuery) return true;
    const q = historySearchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'visits') return b.activationCount - a.activationCount;
    return b.lastSeen - a.lastSeen;
  });

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
      <h2 className="text-sm font-semibold text-gray-800">{t('history.title')}</h2>

      {/* Timeframe buttons */}
      <div className="flex gap-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setHistoryTimeframe(tf)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              historyTimeframe === tf
                ? 'bg-accent text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t(`history.${tf}` as 'history.day')}
          </button>
        ))}
        {historyTotal > 0 && (
          <span className="ml-auto self-center text-[10px] text-gray-400">
            {filtered.length} / {historyTotal}
          </span>
        )}
      </div>

      {/* Search + Sort + Filter */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={historySearchQuery}
          onChange={(e) => setHistorySearchQuery(e.target.value)}
          placeholder={t('history.search')}
          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => setSortMode(sortMode === 'recent' ? 'visits' : 'recent')}
          className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 whitespace-nowrap"
        >
          {sortMode === 'recent' ? t('history.sortVisits') : t('history.sortRecent')}
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={historyShowOpenOnly}
          onChange={(e) => setHistoryShowOpenOnly(e.target.checked)}
          className="rounded border-gray-300 text-accent focus:ring-accent"
        />
        {t('history.openOnly')}
      </label>

      {/* List */}
      {historyLoading && historyStats.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">{t('tabs.loading')}</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">{t('history.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {sorted.map((item) => (
            <div
              key={item.url}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover text-xs group"
            >
              <img
                src={item.favIconUrl ?? `https://www.google.com/s2/favicons?domain=${item.domain}&sz=16`}
                alt=""
                className="w-4 h-4 shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-gray-800 font-medium">{item.title || item.url}</div>
                <div className="truncate text-gray-400">{item.domain}</div>
                <div className="truncate text-[10px] text-gray-400">
                  {t('history.lastActivity')}: {formatDate(item.lastSeen)}
                </div>
                {item.lastOpenedAt && (
                  <div className="truncate text-[10px] text-gray-400">
                    {t('history.lastOpened')}: {formatDate(item.lastOpenedAt)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.activationCount > 0 && (
                  <span className="text-gray-400 text-[10px]" title={t('history.visits')}>
                    {item.activationCount}x
                  </span>
                )}
                {(() => {
                  const openTab = findOpenTab(windowGroups, item.url);
                  if (openTab) {
                    return (
                      <>
                        <button
                          onClick={() => chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: openTab.id })}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                        >
                          {t('chat.goToTab')}
                        </button>
                        <button
                          onClick={() => chrome.runtime.sendMessage({ type: 'CLOSE_TABS', tabIds: [openTab.id] })}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 text-red-600 hover:bg-red-100"
                        >
                          {t('chat.closeTab')}
                        </button>
                      </>
                    );
                  }
                  return (
                    <button
                      onClick={() => chrome.runtime.sendMessage({ type: 'OPEN_URL', url: item.url })}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-green-50 text-green-600 hover:bg-green-100"
                    >
                      {t('chat.openTab')}
                    </button>
                  );
                })()}
              </div>
            </div>
          ))}

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="h-1" />

          {historyLoading && historyStats.length > 0 && (
            <p className="text-xs text-gray-400 text-center py-2">{t('tabs.loading')}</p>
          )}
        </div>
      )}
    </div>
  );
}
