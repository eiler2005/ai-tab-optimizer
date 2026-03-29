import { useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '@shared/i18n';

export function SnapshotsList() {
  const { snapshots, createSnapshot, deleteSnapshot, setActiveSnapshotId } = useStore();
  const { t } = useI18n();
  const [snapshotName, setSnapshotName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    await createSnapshot(snapshotName.trim() || undefined);
    setSnapshotName('');
    setSaving(false);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 border-b border-gray-200 space-y-2">
        <input
          type="text"
          value={snapshotName}
          onChange={(e) => setSnapshotName(e.target.value)}
          placeholder={t('snap.namePlaceholder')}
          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded disabled:opacity-50"
        >
          {saving ? t('snap.saving') : t('snap.save')}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="p-6 text-center text-gray-400 text-xs">
          {t('snap.empty')}
        </div>
      ) : (
        <div>
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center gap-2 px-3 py-2 border-b border-gray-50 hover:bg-surface-hover cursor-pointer"
              onClick={() => setActiveSnapshotId(snap.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{snap.name}</div>
                <div className="text-2xs text-gray-400">
                  {new Date(snap.createdAt).toLocaleString()} · {snap.stats.totalTabs} {t('stats.tabs')} · {snap.stats.totalWindows} {t('stats.windows')}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(t('snap.delete'))) deleteSnapshot(snap.id);
                }}
                className="p-1 text-2xs text-gray-300 hover:text-danger rounded hover:bg-danger-light"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
