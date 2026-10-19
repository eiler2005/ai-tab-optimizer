import { useStore } from '../store';
import { useI18n } from '@shared/i18n';
import { filteredWindows } from '../tab-filter';

export function BulkActions() {
  const state = useStore(); const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  if (!state.selectedTabIds.size) return null;
  const visible = new Set(filteredWindows(state.windowGroups, state).flatMap((window) => window.tabs.map((tab) => tab.id)));
  const hidden = [...state.selectedTabIds].filter((id) => !visible.has(id)).length;
  return <div className="border-t bg-white p-3 text-xs space-y-2 flex-none">
    <p>{tr('Выбрано', 'Selected')}: {state.selectedTabIds.size} · {tr('Вне фильтра', 'Outside filter')}: {hidden}</p>
    <div className="flex gap-2 flex-wrap">
      <button className="border rounded p-2" onClick={() => useStore.setState({ searchQuery: '', tabScope: 'all', tabTopicUrls: null, showSelectedOnly: !state.showSelectedOnly })}>{state.showSelectedOnly ? tr('Показать все', 'Show all') : tr('Показать выбранные', 'Show selected')}</button>
      <button className="border rounded p-2" onClick={state.deselectAll}>{tr('Снять выбор', 'Clear selection')}</button>
      <button className="border rounded p-2" onClick={() => { useStore.setState({ librarySection: 'collections' }); state.setView('library'); }}>{tr('Сохранить…', 'Save…')}</button>
      <button className="border rounded p-2" onClick={() => state.openWorkspace('optimize')}>{tr('Разобрать…', 'Review…')}</button>
      <button className="text-red-700 border rounded p-2" onClick={() => { if (!hidden || confirm(tr(`Закрыть также ${hidden} вкладок вне фильтра?`, `Also close ${hidden} tabs outside the filter?`))) void state.closeTabs([...state.selectedTabIds]); }}>{tr('Закрыть', 'Close')} ({state.selectedTabIds.size})</button>
    </div>
  </div>;
}
