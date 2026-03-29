import { useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import { exportLinkNote, isAlreadyExported, markExported } from '@shared/utils/obsidian';
import type { TabRecord } from '@shared/types';

interface TabItemProps {
  tab: TabRecord;
}

export function TabItem({ tab }: TabItemProps) {
  const { selectedTabIds, toggleTabSelection, closeTabs, pinTab, setUserFlag } = useStore();
  const { t } = useI18n();
  const [showActions, setShowActions] = useState(false);
  const isSelected = selectedTabIds.has(tab.id);

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await closeTabs([tab.id]);
  };

  const handleClick = () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  };

  const flags = tab.ruleFlags;

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 border-b border-gray-50 hover:bg-surface-hover cursor-pointer ${
        isSelected ? 'bg-accent-light' : ''
      } ${tab.active ? 'border-l-2 border-l-accent' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => toggleTabSelection(tab.id)}
        onClick={(e) => e.stopPropagation()}
        className="w-3 h-3 rounded border-gray-300 text-accent focus:ring-accent/30 flex-shrink-0"
      />

      {/* Favicon */}
      <div className="w-4 h-4 flex-shrink-0" onClick={handleClick}>
        {tab.favIconUrl ? (
          <img src={tab.favIconUrl} alt="" className="w-4 h-4 rounded-sm" onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }} />
        ) : (
          <div className="w-4 h-4 bg-gray-200 rounded-sm" />
        )}
      </div>

      {/* Title + Domain + Badges */}
      <div className="flex-1 min-w-0" onClick={handleClick}>
        <div className="flex items-center gap-1 flex-wrap">
          {tab.pinned && <span className="text-2xs text-gray-400">📌</span>}
          {tab.userFlag === 'important' && <span className="text-2xs">⭐</span>}
          {tab.userFlag === 'read_later' && <span className="text-2xs">📖</span>}
          {tab.groupName && (
            <span className="text-2xs px-1 py-0 bg-blue-100 text-blue-600 rounded">
              {tab.groupName}
            </span>
          )}
          <span className="text-xs truncate">{tab.title || t('tabs.untitled')}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-2xs text-gray-400 truncate">{tab.domain}</span>
          {/* Rule-based badges */}
          {flags?.isExactDuplicate && (
            <span className="text-2xs px-1 py-0 bg-warning-light text-warning rounded font-medium">
              {t('badge.duplicate')}
            </span>
          )}
          {flags?.isNearDuplicate && (
            <span className="text-2xs px-1 py-0 bg-orange-50 text-orange-500 rounded font-medium">
              {t('badge.nearDupe')}
            </span>
          )}
          {flags?.isStale && (
            <span className="text-2xs px-1 py-0 bg-gray-100 text-gray-500 rounded font-medium">
              {t('badge.stale')}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions (visible on hover) */}
      {showActions && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); pinTab(tab.id, !tab.pinned); }}
            title={tab.pinned ? t('action.unpin') : t('action.pin')}
            className="p-0.5 text-2xs text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
          >
            📌
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setUserFlag(tab.id, tab.userFlag === 'important' ? null : 'important');
            }}
            title={tab.userFlag === 'important' ? t('action.removeImportant') : t('action.markImportant')}
            className="p-0.5 text-2xs text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
          >
            ⭐
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setUserFlag(tab.id, tab.userFlag === 'read_later' ? null : 'read_later');
            }}
            title={tab.userFlag === 'read_later' ? t('action.removeReadLater') : t('action.readLater')}
            className="p-0.5 text-2xs text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
          >
            📖
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const alreadyExported = await isAlreadyExported(tab.url);
                if (alreadyExported && !confirm(t('obsidian.alreadyExported'))) return;
                await exportLinkNote(tab);
                await markExported(tab.url);
              } catch (err) {
                console.error('Obsidian export failed:', err);
              }
            }}
            title={t('action.exportObsidian')}
            className="p-0.5 text-2xs text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
          >
            💾
          </button>
          <button
            onClick={handleClose}
            title={t('action.close')}
            className="p-0.5 text-2xs text-gray-400 hover:text-danger rounded hover:bg-danger-light"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
