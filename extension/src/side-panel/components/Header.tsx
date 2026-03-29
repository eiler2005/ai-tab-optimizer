import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import type { View } from '../store';

const NAV_ITEMS: { view: View; key: string; icon: string }[] = [
  { view: 'tabs', key: 'nav.tabs', icon: '📋' },
  { view: 'history', key: 'nav.history', icon: '📊' },
  { view: 'ai-recommendations', key: 'nav.ai', icon: '🤖' },
  { view: 'chat', key: 'nav.chat', icon: '🔍' },
  { view: 'snapshots', key: 'nav.snapshots', icon: '📸' },
  { view: 'settings', key: 'nav.settings', icon: '⚙️' },
];

const VIEW_ALIASES: Partial<Record<View, View>> = {
  'snapshot-detail': 'snapshots',
  'cleanup-session': 'ai-recommendations',
};

export function Header() {
  const { view, setView } = useStore();
  const { t } = useI18n();
  const activeView = VIEW_ALIASES[view] ?? view;

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="flex items-center justify-between px-3 py-2">
        <h1 className="text-sm font-semibold text-gray-800">{t('app.title')}</h1>
      </div>
      <nav className="flex border-t border-gray-100">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            onClick={() => setView(item.view)}
            className={`flex-1 px-1 py-1.5 text-xs text-center transition-colors ${
              activeView === item.view
                ? 'text-accent border-b-2 border-accent font-medium'
                : 'text-gray-500 hover:text-gray-700 hover:bg-surface-hover'
            }`}
          >
            <span className="mr-0.5">{item.icon}</span>
            {t(item.key as 'nav.tabs')}
          </button>
        ))}
      </nav>
    </header>
  );
}
