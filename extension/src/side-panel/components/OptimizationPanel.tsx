import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { OptimizationPlan } from '@shared/types/optimization';
import type { TabOperation } from '@shared/types/workspace';
import { optimizationMarkdown } from '@shared/utils/optimization';
import { useWorkspaceReview } from '../review-controller';
import { workspaceMessage } from '../workspace-api';
import { useStore } from '../store';
import { ReviewOptions } from './ReviewOptions';
import { WorkspaceActionBar } from './WorkspaceActionBar';

export function OptimizationPanel({ busy, run }: { busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { job, options, start } = useWorkspaceReview();
  const [plan, setPlan] = useState<OptimizationPlan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [operation, setOperation] = useState<TabOperation | null>(null);
  const [includeAi, setIncludeAi] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const awaiting = useRef<string | null>(null);
  const error = (failure: unknown) => useStore.getState().setActionError(String(failure));
  const acceptPlan = (next: OptimizationPlan) => { setPlan(next); setSelected(new Set(next.candidates.filter((item) => item.recommended).map((item) => item.tab.id))); setOperation(null); };

  useEffect(() => {
    if (job?.status === 'completed' && job.preview && awaiting.current === job.id) {
      awaiting.current = null;
      if (busy || operation) return;
      void workspaceMessage<OptimizationPlan>({ type: 'PREVIEW_OPTIMIZATION', windowId: job.options.windowId, reviewId: job.preview.id }).then(acceptPlan).catch(error);
    }
  }, [job?.status, job?.id, job?.preview?.id]);

  async function prepare() {
    setPreparing(true);
    try {
      const reusable = job?.status === 'completed' && job.preview && Date.now() - job.preview.createdAt <= 300_000
        && job.options.windowId === options.windowId && job.options.focus === options.focus && job.options.readContent === options.readContent;
      // Request excerpt permission directly from this click, before asynchronous work.
      const nextJob = includeAi && !reusable && job?.status !== 'running' ? start(true).catch((failure) => { error(failure); return null; }) : undefined;
      acceptPlan(await workspaceMessage<OptimizationPlan>({ type: 'PREVIEW_OPTIMIZATION', windowId: options.windowId, reviewId: includeAi && reusable ? job.preview?.id : undefined }));
      if (nextJob) awaiting.current = (await nextJob)?.id ?? null;
      else if (includeAi && job?.status === 'running') awaiting.current = job.id;
    } finally { setPreparing(false); }
  }
  function download() {
    if (!plan) return;
    const blob = new Blob([optimizationMarkdown(plan, [...selected], operation ?? undefined)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `aitab-optimization-${new Date(plan.createdAt).toISOString().slice(0, 10)}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const labels = { exact: tr('Одинаковый URL', 'Exact URL copy'), tracking: tr('Tracking-вариант — проверить', 'Tracking variant — review'), redundant: tr('Повтор информации', 'Redundant content'), outdated: tr('Устарело по смыслу — проверить', 'Outdated — review'), saved: tr('Уже сохранено в коллекции — можно закрыть', 'Already saved in a collection — can close') };
  const requiredBy = (id: number) => plan?.candidates.some((item) => selected.has(item.tab.id) && item.keep?.id === id);
  return <section className="space-y-3 text-xs" data-testid="optimization-panel">
    <h3 className="font-semibold text-sm">{tr('Меньше вкладок, полезные материалы остаются', 'Fewer tabs, useful material retained')}</h3>
    <p className="text-gray-600">{tr('Подготовим план по точным копиям и имеющемуся AI-анализу. Чаты, защищённые страницы и разные подходы сохраняем. Сначала увидите расчёт и список; закрытие запускается отдельно.', 'Prepare a plan using exact copies and available AI analysis. Retain chats, protected pages and distinct approaches. Review the forecast and pages before applying.')}</p>
    <details><summary className="cursor-pointer">{tr('Контекст и параметры', 'Focus and options')}</summary><div className="pt-2"><ReviewOptions /></div></details>
    <label className="flex gap-2"><input type="checkbox" checked={includeAi} disabled={preparing || job?.status === 'running'} onChange={(event) => setIncludeAi(event.target.checked)} />{tr('Дополнить план проверкой AI', 'Include AI review in the plan')}</label>
    <button disabled={busy || preparing} onClick={() => void prepare().catch(error)} className="w-full p-3 bg-accent text-white rounded font-medium disabled:opacity-50">{preparing ? tr('Готовим план…', 'Preparing plan…') : tr('Оптимизировать вкладки — подготовить план', 'Optimize tabs — prepare plan')}</button>
    {awaiting.current && job?.status === 'running' && <p>{tr('Локальный план уже доступен. После AI он обновится; до подтверждения ничего не закрывается.', 'The local plan is available. AI will refine it; nothing closes before you apply.')}</p>}
    {plan && <>
      <div className="rounded border border-blue-200 bg-blue-50 p-3 space-y-1" data-testid="optimization-forecast">
        <strong className="text-lg">{plan.tabsBefore} → {plan.tabsBefore - selected.size}</strong>
        <p>{tr('Предлагается закрыть', 'Proposed to close')}: <strong>{selected.size}</strong> ({plan.tabsBefore ? Math.round(selected.size / plan.tabsBefore * 100) : 0}%)</p>
        <p>{tr('Чатов сохраняем', 'Chats retained')}: {plan.chatCount} · {tr('Защищённых', 'Protected')}: {plan.protectedCount} · {tr('Групп альтернатив', 'Alternative groups')}: {plan.relatedGroups}</p>
        <p>AI: {plan.aiCompared} · {tr('Дополнительно для ручного выбора', 'Additional manual choices')}: {plan.candidates.filter((item) => !item.recommended).length}</p>
      </div>
      {plan.warning && <p role="alert" className="text-amber-800">{plan.warning}</p>}
      {operation?.optimizationReport && <div className="rounded bg-green-50 p-3 space-y-2" role="status">
        <strong>{tr('Фактически', 'Actual')}: {operation.optimizationReport.tabsBefore} → {operation.optimizationReport.tabsAfter}</strong>
        <p>{tr('Закрыто', 'Closed')}: {operation.optimizationReport.closed} · {tr('Пропущено', 'Skipped')}: {operation.optimizationReport.skipped} · {tr('Ошибок', 'Failed')}: {operation.optimizationReport.failed}</p>
        <p>{tr('В коллекциях', 'Archived')}: {operation.optimizationReport.archived ?? 0} · {tr('Повторов', 'Duplicates')}: {operation.optimizationReport.duplicatesClosed ?? 0} · {tr('Неактуальных', 'Outdated')}: {operation.optimizationReport.outdatedClosed ?? 0}</p>
        <button disabled={busy || !operation.items.some((item) => item.state === 'done')} onClick={() => void run(async () => setOperation(await workspaceMessage<TabOperation>({ type: 'UNDO_TAB_OPERATION', operationId: operation.id })))} className="border rounded px-2 py-1 bg-white">{tr('Отменить оптимизацию', 'Undo optimization')}</button>
      </div>}
      {!plan.candidates.length && <p>{tr('Обоснованных кандидатов на сокращение нет. Полезные альтернативы и чаты оставлены.', 'No supported reduction candidates. Useful alternatives and chats are retained.')}</p>}
      {plan.candidates.map((item) => {
        const needed = requiredBy(item.tab.id);
        const retainedSelected = item.keep && selected.has(item.keep.id);
        return <div key={item.tab.id} className="border rounded p-2 space-y-1">
          <label className="flex gap-2 items-start"><input type="checkbox" aria-label={tr('Включить в оптимизацию', 'Include in optimization') + ' ' + item.tab.id} disabled={busy || Boolean(operation) || Boolean(needed) || Boolean(retainedSelected)} checked={selected.has(item.tab.id)} onChange={() => setSelected((previous) => { const next = new Set(previous); if (next.has(item.tab.id)) next.delete(item.tab.id); else next.add(item.tab.id); return next; })} /><span className="min-w-0 break-words font-medium">{item.tab.title || item.tab.url}</span></label>
          <p className="text-[10px] text-gray-500 break-all">{item.tab.url}</p><p className="font-medium">{labels[item.category]}</p>
          <p>{item.category === 'exact' ? tr('Сохраняем одну копию с тем же URL.', 'Retain one copy with the same URL.') : item.reason}</p>
          {item.keep && <p className="text-green-800 break-words">{tr('Останется', 'Retained')}: {item.keep.title || item.keep.url}</p>}
          {needed && <p className="text-amber-800">{tr('Нужна для выбранных страниц: сначала снимите их выбор.', 'Needed by selected pages: clear their selections first.')}</p>}
          {retainedSelected && <p className="text-amber-800">{tr('Сохраняемая версия отмечена на закрытие: сначала снимите её выбор.', 'The retained version is selected to close: clear its selection first.')}</p>}
        </div>;
      })}
    </>}
    <WorkspaceActionBar>
      <p className="text-xs">{tr('Выбрано к закрытию', 'Selected to close')}: <strong>{selected.size}</strong>{plan ? ` · ${tr('после останется', 'forecast remaining')}: ${plan.tabsBefore - selected.size}` : ''}</p>
      <div className="flex gap-2"><button disabled={!plan || busy} onClick={download} className="border rounded p-2 text-xs disabled:opacity-50">{tr('Скачать отчёт', 'Download report')}</button><button disabled={busy || !selected.size || Boolean(operation)} onClick={() => void run(async () => {
        if (plan) setOperation(await workspaceMessage<TabOperation>({ type: 'EXECUTE_OPTIMIZATION', planId: plan.id, tabIds: [...selected] }));
      })} className="flex-1 rounded bg-red-600 text-white p-2 text-xs disabled:opacity-50">{tr('Применить план', 'Apply plan')} ({selected.size})</button></div>
    </WorkspaceActionBar>
  </section>;
}
