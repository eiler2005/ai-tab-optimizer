import { useStore } from '../store';
import { useI18n } from '@shared/i18n';

export function BulkActions() {
  const { selectedTabIds, closeTabs, selectAll, deselectAll } = useStore();
  const { t } = useI18n();

  if (selectedTabIds.size === 0) return null;

  return (
    <div className="border-t border-gray-200 bg-white px-3 py-2 flex items-center gap-2 sticky bottom-0">
      <span className="text-xs text-gray-500">{selectedTabIds.size} {t('bulk.selected')}</span>
      <div className="flex-1" />
      <button
        onClick={selectAll}
        className="text-2xs px-2 py-1 text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100"
      >
        {t('bulk.selectAll')}
      </button>
      <button
        onClick={deselectAll}
        className="text-2xs px-2 py-1 text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100"
      >
        {t('bulk.deselect')}
      </button>
      <button
        onClick={() => closeTabs([...selectedTabIds])}
        className="text-2xs px-2 py-1 text-white bg-danger hover:bg-danger/90 rounded"
      >
        {t('bulk.close')} ({selectedTabIds.size})
      </button>
    </div>
  );
}
