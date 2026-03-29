import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import type { RecommendedAction } from '@shared/types';
import { exportCleanupReview } from '@shared/utils/obsidian';

const ACTION_OPTIONS: RecommendedAction[] = ['close', 'group', 'read_later', 'archive', 'keep'];

export function CleanupSession() {
  const {
    cleanupStep,
    cleanupRecommendations,
    cleanupActions,
    applyCleanupAction,
    skipCleanupStep,
    finishCleanup,
    windowGroups,
    totalTabs,
  } = useStore();
  const { t } = useI18n();

  const allTabs = windowGroups.flatMap((wg) => wg.tabs);
  const tabMap = new Map(allTabs.map((tab) => [tab.id, tab]));

  const trackRec = (tabId: number, aiAction: RecommendedAction, userAction: 'accepted' | 'skipped' | 'modified', confidence: number) => {
    const tab = tabMap.get(tabId);
    if (tab) {
      chrome.runtime.sendMessage({
        type: 'TRACK_RECOMMENDATION',
        action: { tabUrl: tab.url, tabTitle: tab.title, aiAction, userAction, confidence },
      });
    }
  };

  const total = cleanupRecommendations.length;
  const isComplete = cleanupStep >= total;
  const current = !isComplete ? cleanupRecommendations[cleanupStep] : null;
  const currentTab = current ? tabMap.get(current.tabId) : null;

  const closedCount = [...cleanupActions.values()].filter((a) => a === 'close').length;
  const groupedCount = [...cleanupActions.values()].filter((a) => a === 'group').length;
  const savedCount = [...cleanupActions.values()].filter((a) => a === 'read_later' || a === 'archive').length;

  async function handleExportReport() {
    const closed = [...cleanupActions.entries()]
      .filter(([, a]) => a === 'close')
      .map(([id]) => {
        const tab = tabMap.get(id);
        return { title: tab?.title ?? '', url: tab?.url ?? '', reason: 'AI recommendation' };
      });
    const saved = [...cleanupActions.entries()]
      .filter(([, a]) => a === 'read_later' || a === 'archive')
      .map(([id]) => {
        const tab = tabMap.get(id);
        return { title: tab?.title ?? '', url: tab?.url ?? '', note: '' };
      });
    const grouped = [...cleanupActions.entries()]
      .filter(([, a]) => a === 'group')
      .map(([id]) => {
        const tab = tabMap.get(id);
        return { groupName: tab?.groupName ?? 'Ungrouped', count: 1 };
      });

    await exportCleanupReview({
      snapshotId: '',
      date: new Date().toISOString(),
      tabsBefore: totalTabs,
      tabsAfter: totalTabs - closedCount,
      closedTabs: closed,
      savedTabs: saved,
      groupedTabs: grouped,
    });
  }

  if (isComplete) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <h2 className="text-sm font-semibold text-gray-800">{t('cleanup.done')}</h2>
        <div className="px-3 py-2 bg-green-50 text-green-700 text-xs rounded">
          <p className="font-medium mb-1">{t('cleanup.summary')}</p>
          <ul className="space-y-0.5">
            <li>{t('ai.close')}: {closedCount}</li>
            <li>{t('ai.group')}: {groupedCount}</li>
            <li>{t('ai.readLater')}: {savedCount}</li>
            <li>Skipped: {total - cleanupActions.size}</li>
          </ul>
        </div>
        <button
          onClick={handleExportReport}
          className="w-full py-2 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          {t('cleanup.exportReport')}
        </button>
        <button
          onClick={finishCleanup}
          className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-700"
        >
          {t('snap.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{t('cleanup.title')}</h2>
        <span className="text-xs text-gray-400">
          {t('cleanup.step')} {cleanupStep + 1}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-gray-100 rounded">
        <div
          className="h-1 bg-accent rounded transition-all"
          style={{ width: `${(cleanupStep / total) * 100}%` }}
        />
      </div>

      {current && currentTab && (
        <div className="px-3 py-3 bg-surface-hover rounded">
          <div className="flex items-center gap-2 mb-2">
            <img
              src={currentTab.favIconUrl ?? `https://www.google.com/s2/favicons?domain=${currentTab.domain}&sz=16`}
              alt=""
              className="w-4 h-4 shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-800 truncate">{currentTab.title}</div>
              <div className="text-[10px] text-gray-400 truncate">{currentTab.domain}</div>
            </div>
          </div>

          <div className="text-xs text-gray-600 mb-1">
            <span className="font-medium">{t('ai.reason')}:</span> {current.reason}
          </div>
          <div className="text-[10px] text-gray-400 mb-3">
            {t('ai.confidence')}: {Math.round(current.confidence * 100)}%
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => { trackRec(current.tabId, current.action, 'accepted', current.confidence); applyCleanupAction(current.tabId, current.action); }}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90"
            >
              {t('cleanup.accept')} ({current.action})
            </button>
            <button
              onClick={() => { trackRec(current.tabId, current.action, 'skipped', current.confidence); skipCleanupStep(); }}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
            >
              {t('cleanup.skip')}
            </button>
            {/* Alternative actions */}
            {ACTION_OPTIONS.filter((a) => a !== current.action).map((action) => (
              <button
                key={action}
                onClick={() => { trackRec(current.tabId, current.action, 'modified', current.confidence); applyCleanupAction(current.tabId, action); }}
                className="px-2 py-1 text-[10px] bg-gray-50 text-gray-500 rounded hover:bg-gray-100"
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
