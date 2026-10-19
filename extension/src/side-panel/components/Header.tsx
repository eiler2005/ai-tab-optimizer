import { useState } from 'react';
import { useStore, type View } from '../store';
import { useI18n } from '@shared/i18n';

export function Header() {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { view, setView, openWorkspace } = useStore();
  const [more, setMore] = useState(false);
  const destinations: [View, string][] = [['tabs', tr('Вкладки', 'Tabs')], ['topics', tr('Темы', 'Topics')], ['library', tr('Библиотека', 'Library')]];
  return <header className="border-b bg-white flex-none z-10 relative">
    <h1 className="text-sm font-semibold px-3 py-2">AITab</h1>
    <nav aria-label={tr('Основные разделы', 'Main navigation')} className="flex">
      {destinations.map(([target, name]) => <button key={target} aria-current={view === target ? 'page' : undefined} onClick={() => { setMore(false); setView(target); }} className={`flex-1 min-w-0 px-1 py-3 text-xs border-b-2 ${view === target ? 'border-accent text-accent font-semibold' : 'border-transparent text-gray-600'}`}>{name}</button>)}
      <button aria-expanded={more} onClick={() => setMore(!more)} className="px-3 py-3 text-xs">{tr('Ещё', 'More')} ▾</button>
    </nav>
    {more && <div className="absolute right-2 left-2 top-full border rounded bg-white shadow-lg p-2 grid gap-1" onKeyDown={(event) => { if (event.key === 'Escape') setMore(false); }}>
      {([
        [tr('Разбор вкладок', 'Review tabs'), () => openWorkspace('optimize')],
        [tr('Журнал и Undo', 'Journal and Undo'), () => openWorkspace('history')],
        [tr('Отчёты', 'Reports'), () => setView('ai-recommendations')],
        [tr('Активность', 'Activity'), () => setView('history')],
        [tr('Восстановление и бэкапы', 'Recovery and backups'), () => openWorkspace('backups')],
        [tr('Снимки', 'Snapshots'), () => setView('snapshots')],
        [tr('Настройки', 'Settings'), () => setView('settings')],
      ] as [string, () => void][]).map(([name, action]) => <button key={name} className="text-left rounded px-3 py-2 text-xs hover:bg-gray-100 focus:bg-gray-100" onClick={() => { action(); setMore(false); }}>{name}</button>)}
    </div>}
  </header>;
}
