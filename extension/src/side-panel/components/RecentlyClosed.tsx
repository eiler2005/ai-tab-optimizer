import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';

export function RecentlyClosed() {
  const { recentlyClosed, loadRecentlyClosed, restoreClosedTab } = useStore();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadRecentlyClosed();
  }, [loadRecentlyClosed]);

  if (recentlyClosed.length === 0) return null;

  return (
    <div className="border-t border-gray-200 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 bg-surface-secondary hover:bg-surface-hover"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span>{t('closed.title')} ({recentlyClosed.length})</span>
      </button>

      {expanded && (
        <div>
          {recentlyClosed.map((item) => (
            <div
              key={item.sessionId}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-50 hover:bg-surface-hover"
            >
              <div className="w-4 h-4 bg-gray-200 rounded-sm flex-shrink-0 opacity-50" />
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate text-gray-500">{item.title || item.url}</div>
              </div>
              <button
                onClick={() => restoreClosedTab(item.sessionId)}
                className="text-2xs px-1.5 py-0.5 text-accent hover:bg-accent-light rounded"
              >
                {t('closed.restore')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
