import { useEffect } from 'react';
import { useI18n } from '@shared/i18n';
import { useStore } from '../store';

export function ReportsPanel() {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const state = useStore();
  useEffect(() => { state.loadAnalytics(); }, []);
  return <section className="flex-1 overflow-y-auto p-3 text-xs space-y-3">
    <h2 className="font-semibold text-sm">{tr('Отчёты и активность', 'Reports and activity')}</h2>
    <p>{tr('Результаты выполненных действий доступны в журнале; темы и разбор открываются в своих разделах.', 'Completed operation results are in the journal; topics and reviews have their own workspaces.')}</p>
    <div className="flex gap-2 flex-wrap"><button className="border rounded p-2" onClick={() => state.openWorkspace('history')}>{tr('Журнал и Undo', 'Journal and Undo')}</button><button className="border rounded p-2" onClick={() => state.setView('history')}>{tr('История активности', 'Activity history')}</button><button className="border rounded p-2" onClick={() => state.setView('topics')}>{tr('Темы', 'Topics')}</button></div>
    {state.aiAnalyzedAt && <p>{tr('Последний анализ тем', 'Last topic analysis')}: {new Date(state.aiAnalyzedAt).toLocaleString()}</p>}
    {state.aiMetadata && <details><summary>{tr('Сведения об анализе', 'Analysis details')}</summary><p>{tr('Провайдер', 'Provider')}: {state.aiMetadata.providerStatus?.currentProvider ?? '—'} · {state.aiMetadata.providerStatus?.currentModel ?? '—'}</p></details>}
    {state.insights && <div className="space-y-2"><h3 className="font-semibold">{tr('Распределение по сайтам', 'Distribution by site')}</h3>{state.insights.topDomains.map((domain) => <p key={domain.domain}>{domain.domain}: {domain.count}</p>)}</div>}
    {state.recStats && <details><summary>{tr('История рекомендаций', 'Recommendation history')}</summary><p>{tr('Всего решений', 'Total decisions')}: {state.recStats.totalActions}</p>{Object.entries(state.recStats.byAiAction).map(([action, stats]) => <p key={action}>{action}: {tr('принято', 'accepted')} {stats.accepted} · {tr('пропущено', 'skipped')} {stats.skipped} · {tr('изменено', 'modified')} {stats.modified}</p>)}</details>}
    {state.habitsScore && <details><summary>{tr('Показатели активности', 'Activity metrics')}</summary><p>{tr('Это метрики использования; они не определяют актуальность содержания.', 'These are usage metrics; they do not determine content relevance.')}</p><p>{tr('Показатель', 'Score')}: {state.habitsScore.score} · {new Date(state.habitsScore.computedAt).toLocaleString()}</p>{state.habitsScore.components.map((item) => <p key={item.name}>{item.name}: {item.value}</p>)}</details>}
    {state.heatmap && <details><summary>{tr('Активность по дням и часам', 'Activity by day and hour')}</summary><label className="block py-2">{tr('Сайт', 'Site')}<select aria-label={tr('Сайт на карте активности', 'Activity map site')} className="border rounded p-2 ml-2" defaultValue="" onChange={(event) => state.loadHeatmap(event.target.value || undefined)}><option value="">{tr('Все сайты', 'All sites')}</option>{state.insights?.topDomains.map((domain) => <option key={domain.domain} value={domain.domain}>{domain.domain}</option>)}</select></label><div role="img" aria-label={tr('Число посещений по дням недели и часам; подсказка ячейки показывает значение.', 'Visits by weekday and hour; each cell tooltip shows its value.')} className="space-y-1">{state.heatmap.grid.map((row, day) => <div className="flex gap-px items-center" key={day}><span className="w-8 text-[10px]">{(locale === 'ru' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])[day]}</span>{row.map((value, hour) => <span key={hour} title={`${hour}:00 · ${value}`} className="h-3 min-w-0 flex-1 bg-blue-600 rounded-sm" style={{ opacity: value ? Math.min(1, .25 + Math.log1p(value) / 5) : .08 }} />)}</div>)}</div></details>}
    <button disabled={state.analyticsRefreshing} className="border rounded p-2" onClick={() => void state.refreshAnalytics().catch((error) => state.setActionError(String(error)))}>{tr('Обновить отчёты с AI', 'Refresh reports with AI')}</button>
    {state.analyticsRefreshError && <p role="alert">{state.analyticsRefreshError}</p>}
    {state.analyticsInsight && <div><p>{state.analyticsInsight.browsingPatterns}</p><ul>{state.analyticsInsight.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></div>}
  </section>;
}
