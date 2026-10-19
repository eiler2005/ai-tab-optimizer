import { useI18n } from '@shared/i18n';
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useWorkspaceReview } from '../review-controller';

export function TaskCenter() {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { job, cancel } = useWorkspaceReview();
  const { aiLoading, aiProgress, aiError, aiScope, chatLoading, stopAIAnalysis, setView } = useStore();
  const contentRunning = job?.status === 'running';
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!contentRunning && !aiLoading) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [contentRunning, aiLoading]);
  const phases: Record<string, string> = { capture: tr('Сбор вкладок', 'Collecting tabs'), extract: tr('Чтение фрагментов', 'Reading excerpts'), compare: tr('Локальное сравнение', 'Local comparison'), ai: tr('Ожидание AI', 'Waiting for AI'), complete: tr('Завершено', 'Completed') };
  if (!contentRunning && !aiLoading && !chatLoading && !aiError) return null;
  return <aside aria-label={tr('Текущие задачи', 'Current tasks')} className="border-b bg-blue-50 px-3 py-2 text-xs flex-none space-y-1">
    {contentRunning && <details><summary>{tr('Проверка материалов', 'Material review')}: {job.options.scopeLabel ?? tr('выбранная область', 'selected scope')} · {job.processed}/{job.total} · {Math.max(0, Math.floor((now - job.startedAt) / 1000))} {tr('с', 's')}</summary><p>{tr('Этап', 'Stage')}: {phases[job.phase]}</p><button className="border rounded p-2" onClick={() => void cancel().catch((error) => useStore.getState().setActionError(String(error)))}>{tr('Остановить задачу проверки', 'Stop material review')}</button></details>}
    {aiLoading && <div className="flex gap-2 items-center flex-wrap"><span>{tr('Предлагаем темы', 'Suggesting topics')} · {aiScope?.scopeLabel ?? tr('область сохранённого анализа', 'saved analysis scope')} · {aiProgress ? `${aiProgress.tabsProcessed}/${aiProgress.tabsTotal} · ${Math.max(0, Math.floor((now - aiProgress.startedAt) / 1000))} ${tr('с', 's')}` : tr('подготовка', 'preparing')}</span><button className="border rounded px-2 py-1 bg-white" onClick={() => void stopAIAnalysis().catch((error) => useStore.getState().setActionError(String(error)))}>{tr('Остановить анализ тем', 'Stop topic analysis')}</button></div>}
    {chatLoading && <p>{tr('Ищем по истории и результатам анализа…', 'Searching history and analysis results…')}</p>}
    {aiError && <details><summary>{tr('AI недоступен — локальные действия работают', 'AI unavailable — local actions remain available')}</summary><p className="break-words">{aiError}</p><button className="border rounded p-2" onClick={() => setView('settings')}>{tr('Настроить AI', 'Configure AI')}</button></details>}
  </aside>;
}
