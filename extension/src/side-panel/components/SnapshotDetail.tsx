import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import { exportSessionSnapshot } from '@shared/utils/obsidian';
import type { TabRecord } from '@shared/types';

function findOpenTab(windowGroups: { tabs: TabRecord[] }[], url: string): TabRecord | undefined {
  for (const wg of windowGroups) {
    const found = wg.tabs.find((t) => t.url === url);
    if (found) return found;
  }
  return undefined;
}

export function SnapshotDetail() {
  const { snapshots, activeSnapshotId, setActiveSnapshotId, restoreSnapshot, aiResult, windowGroups } = useStore();
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);

  const snapshot = useMemo(
    () => snapshots.find((s) => s.id === activeSnapshotId),
    [snapshots, activeSnapshotId]
  );

  if (!snapshot) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        {t('snap.notFound')}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 border-b border-gray-200 space-y-2">
        <button
          onClick={() => setActiveSnapshotId(null)}
          className="text-xs text-accent hover:underline"
        >
          {t('snap.back')}
        </button>
        <h2 className="text-sm font-semibold">{snapshot.name}</h2>
        <div className="text-2xs text-gray-400">
          {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.stats.totalTabs} {t('stats.tabs')}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => restoreSnapshot(snapshot.id)}
            className="px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded"
          >
            {t('snap.restoreAll')}
          </button>
          <button
            onClick={async () => {
              setExporting(true);
              await exportSessionSnapshot(snapshot, aiResult ?? undefined);
              setExporting(false);
            }}
            disabled={exporting}
            className="px-3 py-1 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded disabled:opacity-50"
          >
            {exporting ? '...' : t('obsidian.exportSnapshot')}
          </button>
        </div>
      </div>

      {snapshot.windows.map((win, i) => (
        <div key={i}>
          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-surface-secondary">
            {t('tabs.window')} {i + 1} {win.focused ? t('snap.wasActive') : ''} — {win.tabs.length} {t('tabs.tabsCount')}
          </div>
          {win.tabs.map((tab, j) => (
            <div key={j} className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-50 hover:bg-surface-hover">
              <div className="w-4 h-4 flex-shrink-0">
                {tab.favIconUrl ? (
                  <img src={tab.favIconUrl} alt="" className="w-4 h-4 rounded-sm" onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }} />
                ) : (
                  <div className="w-4 h-4 bg-gray-200 rounded-sm" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate">{tab.title || t('tabs.untitled')}</div>
                <div className="text-2xs text-gray-400 truncate">{tab.domain}</div>
              </div>
              {(() => {
                const openTab = findOpenTab(windowGroups, tab.url);
                if (openTab) {
                  return (
                    <div className="flex items-center gap-1 shrink-0">
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
                    </div>
                  );
                }
                return (
                  <button
                    onClick={() => restoreSnapshot(snapshot.id, [tab.url])}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-green-50 text-green-600 hover:bg-green-100"
                  >
                    {t('chat.openTab')}
                  </button>
                );
              })()}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
