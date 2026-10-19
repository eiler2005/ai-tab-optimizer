import { useEffect, useRef, useState } from 'react';
import { useStore, type View } from '../store';
import { useI18n } from '@shared/i18n';

export function Header() {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { view, setView, openWorkspace } = useStore();
  const [more, setMore] = useState(false);
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!more) return;
    const outside = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) setMore(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMore(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [more]);
  const destinations: [View, string][] = [['tabs', tr('Вкладки', 'Tabs')], ['topics', tr('Темы', 'Topics')], ['library', tr('Библиотека', 'Library')]];
  return <header ref={header} className="border-b bg-white flex-none z-10 relative">
    <h1 className="text-sm font-semibold px-3 py-2">AITab</h1>
    <nav aria-label={tr('Основные разделы', 'Main navigation')} className="flex flex-wrap">
      {destinations.map(([target, name]) => <button key={target} aria-current={view === target ? 'page' : undefined} onClick={() => { setMore(false); setView(target); }} className={`flex-1 min-w-[5rem] break-words px-1 py-2 text-xs border-b-2 ${view === target ? 'border-accent text-accent font-semibold' : 'border-transparent text-gray-600'}`}>{name}</button>)}
      <button ref={trigger} aria-expanded={more} onClick={() => setMore(!more)} className="flex-1 min-w-[5rem] px-1 py-2 text-xs">{tr('Ещё', 'More')} ▾</button>
    </nav>
    {more && <div className="absolute right-2 left-2 top-full border rounded bg-white shadow-lg p-2 grid gap-1">
      {([
        [tr('Разбор вкладок', 'Review tabs'), () => useStore.setState({ view: 'workspace', workspaceSection: 'optimize' })],
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
