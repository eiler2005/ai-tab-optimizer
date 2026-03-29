import { useMemo } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';

export function StatsBar() {
  const { windowGroups, totalTabs, duplicateCount, staleCount, searchQuery, setSearchQuery } = useStore();
  const { t } = useI18n();

  const stats = useMemo(() => {
    const allTabs = windowGroups.flatMap((wg) => wg.tabs);
    const importantCount = allTabs.filter((t) => t.userFlag === 'important').length;
    const pinnedCount = allTabs.filter((t) => t.pinned).length;

    const domainCounts = new Map<string, number>();
    for (const tab of allTabs) {
      domainCounts.set(tab.domain, (domainCounts.get(tab.domain) ?? 0) + 1);
    }
    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return { importantCount, pinnedCount, topDomains };
  }, [windowGroups]);

  return (
    <div className="border-b border-gray-200 bg-surface-secondary px-3 py-2 space-y-2">
      <div className="flex gap-3 text-xs text-gray-600 flex-wrap">
        <span className="font-medium text-gray-900">{totalTabs} {t('stats.tabs')}</span>
        <span>{windowGroups.length} {t('stats.windows')}</span>
        {duplicateCount > 0 && (
          <span className="text-warning">{duplicateCount} {t('stats.dupes')}</span>
        )}
        {staleCount > 0 && (
          <span className="text-orange-500">{staleCount} {t('stats.stale')}</span>
        )}
        {stats.pinnedCount > 0 && <span>{stats.pinnedCount} {t('stats.pinned')}</span>}
        {stats.importantCount > 0 && (
          <span className="text-accent">{stats.importantCount} {t('stats.important')}</span>
        )}
      </div>

      {stats.topDomains.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {stats.topDomains.map(([domain, count]) => (
            <span
              key={domain}
              className="text-2xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500"
            >
              {domain} ({count})
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t('search.placeholder')}
        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
      />
    </div>
  );
}
