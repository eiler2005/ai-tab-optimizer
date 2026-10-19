import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import { filteredWindows } from '../tab-filter';
import { workspaceMessage } from '../workspace-api';

export function StatsBar() {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const state = useStore();
  const current = state.windowGroups.find((window) => window.focused)?.tabs.find((tab) => tab.active);
  return <div className="border-b p-3 space-y-2 flex-none text-xs">
    <div className="flex gap-2 items-center flex-wrap">
      <select aria-label={tr('Область вкладок', 'Tab scope')} value={state.tabScope} onChange={(event) => { const tabScope = event.target.value as 'all' | 'current'; useStore.setState({ tabScope }); void chrome.storage.local.set({ 'aitab.tab-scope': tabScope }); }} className="border rounded p-2"><option value="all">{tr('Все окна', 'All windows')}</option><option value="current">{tr('Текущее окно', 'Current window')}</option></select>
      <span>{state.totalTabs} {tr('вкладок', 'tabs')} · {state.windowGroups.length} {tr('окон', 'windows')}</span>
      <button className="ml-auto border rounded p-2" onClick={() => state.beginReview(filteredWindows(state.windowGroups, state).flatMap((window) => window.tabs), tr('Текущие результаты', 'Current results'))}>{tr('Разобрать…', 'Review…')}</button>
    </div>
    {current && <div data-testid="current-page" data-current-tab-id={current.id} className="rounded bg-gray-50 p-2 space-y-1">
      <p className="truncate">{tr('Текущая', 'Current')}: {current.title || current.url}</p>
      <div className="flex gap-3 flex-wrap"><button className="text-accent" onClick={() => useStore.setState({ searchQuery: '', searchMatchIds: null, searchScope: 'open', tabScope: 'all', tabTopicUrls: null, tabTopicName: '', showSelectedOnly: false, tabRevealId: current.id })}>{tr('Показать текущую', 'Show current')}</button><button className="text-accent" onClick={() => void workspaceMessage({ type: 'SAVE_PAGE_TO_COLLECTION', tabId: current.id }).catch((error) => state.setActionError(String(error)))}>{tr('Сохранить во Входящие', 'Save to Inbox')}</button></div>
    </div>}
    {state.tabTopicUrls && <p>{state.tabTopicName} <button className="text-accent" onClick={() => useStore.setState({ tabTopicUrls: null, tabTopicName: '' })}>{tr('Снять фильтр темы', 'Clear topic filter')}</button></p>}
    <div className="flex gap-3 flex-wrap"><button className="text-accent" onClick={state.selectAll}>{tr('Выбрать результаты', 'Select results')}</button><button className="text-accent" onClick={() => state.openWorkspace('windows')}>{tr('Объединить окна…', 'Merge windows…')}</button></div>
  </div>;
}
