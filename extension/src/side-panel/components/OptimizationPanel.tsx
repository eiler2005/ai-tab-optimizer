import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { OptimizationCandidate, OptimizationCategory, OptimizationPlan } from '@shared/types/optimization';
import type { TabRecord } from '@shared/types';
import { isStatefulChat } from '@shared/utils/page-safety';
import { tabProtectionReason } from '@shared/utils/rules';
import type { ContentReviewOptions } from '@shared/types/content-review';
import type { TabOperation, WorkspaceData } from '@shared/types/workspace';
import { optimizationMarkdown } from '@shared/utils/optimization';
import { exportWorkspaceMarkdown } from '@shared/utils/obsidian';
import { useWorkspaceReview } from '../review-controller';
import { workspaceMessage } from '../workspace-api';
import { resumeCleanup, type CleanupPosition } from '../cleanup-position';
import { useStore, type WorkspaceSection } from '../store';
import { ReviewOptions } from './ReviewOptions';
import { ReviewCoverage } from './ReviewCoverage';
import { ReviewProgress } from './ReviewProgress';
import { OptimizationOutcome } from './OptimizationOutcome';
import { WorkspaceActionBar } from './WorkspaceActionBar';

const scopeKey = (value: ContentReviewOptions) => JSON.stringify([value.tabIds, value.expectedUrls, value.windowId, value.focus ?? '', value.readContent, value.includeSaved ?? false, value.deepUrls]);
export function OptimizationPanel({ workspace, busy, run, filter = 'optimize' }: { workspace: WorkspaceData | null; busy: boolean; run: (action: () => Promise<void>) => Promise<void>; filter?: WorkspaceSection }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { job, options, start } = useWorkspaceReview();
  const { reviewScope, view } = useStore();
  const [plan, setPlan] = useState<OptimizationPlan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [operation, setOperation] = useState<TabOperation | null>(null);
  const [includeAi, setIncludeAi] = useState(true); const [preparing, setPreparing] = useState(false);
  const [category, setCategory] = useState<'all' | OptimizationCategory>('all'); const [limit, setLimit] = useState(100);
  const [now, setNow] = useState(Date.now()); const [feedback, setFeedback] = useState('');
  const results = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const position = useRef<CleanupPosition | null>(null);
  const lastInteraction = useRef<number | null>(null);
  const resume = useRef<{ planId: string; id: number; url: string; offset: number } | null>(null);
  const [resumedId, setResumedId] = useState<number | null>(null);
  const awaiting = useRef<{ id: string; scope: string } | null>(null); const touched = useRef(false);
  const error = (failure: unknown) => useStore.getState().setActionError(String(failure));
  useEffect(() => { setPlan(null); setSelected(new Set()); setOperation(null); awaiting.current = null; touched.current = false; }, [reviewScope?.id]);
  useEffect(() => { if (view !== 'workspace') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [view]);
  const accept = (next: OptimizationPlan, preserve = false) => {
    setPlan(next); setOperation(null); setLimit(100);
    setSelected((previous) => preserve || touched.current ? new Set([...previous].filter((id) => next.candidates.some((item) => item.tab.id === id && plan?.candidates.some((old) => old.tab.id === id && old.tab.url === item.tab.url)))) : new Set(next.candidates.filter((item) => item.recommended).map((item) => item.tab.id)));
  };
  const requestPlan = (reviewId?: string, keepTabIds?: number[]) => workspaceMessage<OptimizationPlan>({ type: 'PREVIEW_OPTIMIZATION', windowId: options.windowId, reviewId,
    scope: { tabIds: options.tabIds, expectedUrls: options.expectedUrls, scopeLabel: options.scopeLabel, windowId: options.windowId }, keepTabIds });
  useEffect(() => {
    if (job?.status === 'completed' && job.preview && awaiting.current?.id === job.id) {
      const expected = awaiting.current.scope; awaiting.current = null;
      if (expected !== scopeKey(options) || scopeKey(job.options) !== expected || job.preview.savedSources || operation || busy) return;
      void requestPlan(job.preview.id).then((next) => accept(next, touched.current)).catch(error);
    }
  }, [job?.status, job?.id, job?.preview?.id]);
  async function prepare(useAi = includeAi) {
    setPreparing(true); setFeedback(''); awaiting.current = null;
    try {
      const reusable = useAi && job?.status === 'completed' && job.preview && !job.preview.savedSources && Date.now() - job.preview.createdAt <= 300_000 && scopeKey(job.options) === scopeKey(options);
      const nextJob = useAi && !reusable && job?.status !== 'running' ? start(true).catch((failure) => { error(failure); return null; }) : undefined;
      accept(await requestPlan(reusable ? job.preview?.id : undefined));
      if (nextJob) { const next = await nextJob; if (next && scopeKey(next.options) === scopeKey(options)) awaiting.current = { id: next.id, scope: scopeKey(options) }; }
      else if (useAi && job?.status === 'running' && scopeKey(job.options) === scopeKey(options)) awaiting.current = { id: job.id, scope: scopeKey(options) };
    } finally { setPreparing(false); }
  }
  function rememberPosition() {
    const viewport = panel.current?.closest<HTMLElement>('[data-testid="workspace-view"]');
    if (!viewport || !candidates.length) return;
    const bounds = viewport.getBoundingClientRect();
    const visible = [...panel.current!.querySelectorAll<HTMLElement>('[data-cleanup-tab-id]')].filter((row) => { const box = row.getBoundingClientRect(); return box.bottom > bounds.top && box.top < bounds.bottom; });
    const row = visible.find((item) => Number(item.dataset.cleanupTabId) === lastInteraction.current) ?? visible[0];
    const index = candidates.findIndex((item) => item.tab.id === (row ? Number(row.dataset.cleanupTabId) : lastInteraction.current));
    position.current = { order: candidates.map((item) => ({ id: item.tab.id, url: item.tab.url })), index: Math.max(0, index), offset: row ? Math.max(0, row.getBoundingClientRect().top - bounds.top) : 0 };
  }
  async function continueCleanup() {
    setPreparing(true); awaiting.current = null;
    try {
      const reusable = job?.status === 'completed' && job.preview && !job.preview.savedSources && Date.now() - job.preview.createdAt <= 300_000 && scopeKey(job.options) === scopeKey(options);
      const next = await requestPlan(reusable ? job.preview?.id : undefined);
      touched.current = false;
      setSelected(new Set());
      accept(next);
      const nextSimilarIds = new Set((next.review?.similarGroups ?? next.localGroups ?? []).flatMap((group) => group.tabIds));
      const visible = next.candidates.filter((item) => matches(item, nextSimilarIds));
      const previous = position.current ?? { order: plan?.candidates.map((item) => ({ id: item.tab.id, url: item.tab.url })) ?? [], index: Math.max(0, plan?.candidates.findIndex((item) => item.tab.id === currentOperation?.items[currentOperation.items.length - 1]?.tab.id) ?? 0), offset: 0 };
      const target = resumeCleanup(previous, visible.map((item) => ({ id: item.tab.id, url: item.tab.url })));
      if (target) {
        resume.current = { planId: next.id, ...target, offset: previous.offset };
        setLimit(Math.max(100, Math.ceil((visible.findIndex((item) => item.tab.id === target.id) + 1) / 100) * 100));
      }
      setFeedback(tr('Список обновлён по оставшимся открытым вкладкам. Выберите следующую порцию.', 'Updated from the remaining open tabs. Select the next batch.'));
    } finally { setPreparing(false); }
  }
  async function chooseKeeper(ids: number[], keep: number) {
    if (!plan) return;
    touched.current = true;
    const old = [...(plan.duplicateGroups?.map((group) => group.keepTabId) ?? []), ...(plan.review?.similarGroups.map((group) => group.keepTabId) ?? [])].filter((id) => !ids.includes(id));
    accept(await workspaceMessage<OptimizationPlan>({ type: 'PREVIEW_OPTIMIZATION', scope: plan.scope, windowId: plan.windowId, reviewId: plan.review?.id, keepTabIds: [...new Set([...old, keep])] }), true);
  }
  function download() {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([optimizationMarkdown(plan, [...selected], currentOperation ?? undefined)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `aitab-review-${new Date(plan.createdAt).toISOString().slice(0, 10)}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const currentOperation = workspace?.operations.find((item) => item.id === plan?.id) ?? (operation?.id === plan?.id ? operation : null);
  const finished = currentOperation && !['running', 'undoing'].includes(currentOperation.status);
  const processed = currentOperation?.items.filter((item) => !['pending', 'applying', 'restoring'].includes(item.state)).length ?? 0;
  const closed = currentOperation?.items.filter((item) => item.state === 'done').length ?? 0;
  const labels: Record<OptimizationCategory, string> = { exact: tr('Точные копии', 'Exact copies'), tracking: tr('Tracking-варианты', 'Tracking variants'), redundant: tr('Пересечение информации', 'Information overlap'), outdated: tr('Возможно неактуально', 'Possibly outdated'), saved: tr('Уже сохранено', 'Already saved'), defer: tr('Сохранить и закрыть', 'Save and close'), manual: tr('Рекомендация AI — ручная проверка', 'AI suggestion — manual review') };
  const similarIds = new Set((plan?.review?.similarGroups ?? plan?.localGroups ?? []).flatMap((group) => group.tabIds));
  const matches = (item: OptimizationCandidate, ids = similarIds) => category !== 'all' ? item.category === category : filter === 'duplicates' ? ['exact', 'tracking'].includes(item.category) : filter === 'similar' ? item.category === 'redundant' || ids.has(item.tab.id) : filter === 'outdated' ? item.category === 'outdated' : true;
  const candidates = plan?.candidates.filter((item) => matches(item)) ?? [];
  useLayoutEffect(() => {
    const target = resume.current;
    if (!target || target.planId !== plan?.id || currentOperation || view !== 'workspace') return;
    const row = panel.current?.querySelector<HTMLElement>(`[data-cleanup-tab-id="${target.id}"]`);
    const viewport = row?.closest<HTMLElement>('[data-testid="workspace-view"]');
    if (!row || !viewport || row.dataset.cleanupUrl !== target.url) return;
    let parent = row.parentElement;
    while (parent && parent !== viewport) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - target.offset;
    row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
    setResumedId(target.id); resume.current = null;
  }, [plan?.id, currentOperation?.id, limit, view, candidates.length]);
  const expired = Boolean(plan && now - plan.createdAt > 300_000);
  const requiredBy = (id: number) => plan?.candidates.some((item) => selected.has(item.tab.id) && item.keep?.id === id);
  const canChoose = (item: NonNullable<typeof plan>['candidates'][number]) => !requiredBy(item.tab.id) && !(item.keep && selected.has(item.keep.id));
  const hiddenSelected = plan?.candidates.filter((item) => selected.has(item.tab.id) && !matches(item)).length ?? 0;
  const archiveCount = plan?.candidates.filter((item) => selected.has(item.tab.id) && ['saved', 'defer'].includes(item.category)).length ?? 0;
  const review = plan?.review;
  const similarCount = review?.similarGroups.length ?? plan?.localGroups?.length ?? 0;
  const redundantCount = review?.similarGroups.filter((group) => group.source === 'ai' && group.relation === 'redundant').length ?? 0;
  const relatedCount = review?.similarGroups.filter((group) => group.source === 'ai' && group.relation !== 'redundant').length ?? 0;
  const showingGroups = filter === 'similar' || filter === 'optimize';
  const renderedControls = new Set<number>();
  function tabRow(tab: TabRecord, groupId: string) {
    const item = plan?.candidates.find((candidate) => candidate.tab.id === tab.id && candidate.tab.url === tab.url && candidate.tab.title === tab.title);
    const first = !renderedControls.has(tab.id); renderedControls.add(tab.id);
    const unavailable = isStatefulChat(tab.url) ? tr('Чат — проверьте отдельно во Вкладках.', 'Chat — review separately in Tabs.')
      : tabProtectionReason(tab, review?.protectedDomains) ? tr('Защищённая вкладка — этот план её сохраняет.', 'Protected tab — this plan retains it.')
      : !item ? tr('Оставляемая или недоступная для закрытия вкладка этого плана.', 'Retained or unavailable for closure in this plan.')
      : !canChoose(item) ? tr('Нужна как оставляемая версия. Сначала снимите зависимый выбор.', 'Needed as a retained version. Clear dependent selections first.') : '';
    const effect = item?.category === 'defer' ? tr('Сохранить и закрыть', 'Save and close') : item?.category === 'saved' ? tr('Закрыть — уже сохранено', 'Close — already saved') : tr('Закрыть вкладку', 'Close tab');
    return <div key={tab.id} className={`py-2 border-t space-y-1 ${resumedId === tab.id ? 'ring-2 ring-accent' : ''}`} data-cleanup-tab-id={item ? tab.id : undefined} data-cleanup-url={tab.url} data-resumed={resumedId === tab.id ? 'true' : undefined} onFocusCapture={() => { lastInteraction.current = tab.id; }} onPointerDown={() => { lastInteraction.current = tab.id; }}>
      {resumedId === tab.id && <p className="text-accent font-medium">{tr('Продолжение с этой вкладки', 'Continue from this tab')}</p>}
      <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" aria-label={(item ? tr('Включить в оптимизацию', 'Include in optimization') : tr('Закрытие недоступно', 'Closure unavailable')) + ' ' + tab.id + (first ? '' : ' · ' + groupId)} checked={selected.has(tab.id)} disabled={!item || busy || expired || Boolean(currentOperation) || !canChoose(item)} onChange={() => toggleSelection(tab.id)} /><span>{item ? effect : tr('Оставляем открытой', 'Retained open')}</span></label>
      {unavailable && <p className="text-amber-800">{unavailable}</p>}
      <button className="text-accent text-left underline break-words" onClick={() => void workspaceMessage({ type: 'FOCUS_TAB', tabId: tab.id }).catch(error)}>{tab.title || tab.url}</button><p className="text-gray-500 break-all">{tab.url}</p>
      {item && !['defer', 'saved'].includes(item.category) && <p className="font-semibold">{labels[item.category]}</p>}
      {item?.keep && <p className="text-green-800">{tr('Останется', 'Retained')}: {item.keep.title || item.keep.url}</p>}
      {item?.category === 'defer' && <p className="text-green-800">{tr('Перед закрытием ссылка будет сохранена в коллекции «Позже».', 'The link will be saved to a Later collection before closing.')}</p>}
    </div>;
  }
  function toggleSelection(id: number) {
    touched.current = true;
    setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  const forecast = plan && <div className="rounded border bg-blue-50 p-3 space-y-1" data-testid="optimization-forecast"><p>{tr('План для', 'Plan for')}: {plan.scope?.scopeLabel ?? tr('Все обычные окна', 'All normal windows')}</p><strong className="text-lg">{plan.tabsBefore} → {plan.tabsBefore - selected.size}</strong><p>{tr('Предлагается закрыть', 'Proposed to close')}: {selected.size} · {tr('с сохранением', 'with saving')}: {archiveCount}</p><p>{tr('Чатов сохраняем', 'Chats retained')}: {plan.chatCount} · {tr('Защищённых', 'Protected')}: {plan.protectedCount} · {tr('Групп альтернатив', 'Alternative groups')}: {plan.relatedGroups}</p><p>AI: {plan.aiCompared}</p></div>;
  if (plan && currentOperation && (finished || currentOperation.status === 'undoing')) return <section className="space-y-3" data-testid="optimization-panel">
    <OptimizationOutcome plan={plan} operation={currentOperation} workspace={workspace} />
    {feedback && <p role="status" className="text-xs">{feedback}</p>}
    {view === 'workspace' && ['optimize', 'duplicates', 'similar', 'outdated'].includes(filter) && <WorkspaceActionBar>
      <div data-testid="optimization-execution" role="status" aria-live="polite" className="font-semibold">{currentOperation.status === 'undoing' ? tr('Восстанавливаем…', 'Restoring…') : currentOperation.status === 'undone' ? tr('Отмена выполнена', 'Undo completed') : `${tr('Закрыто вкладок', 'Tabs closed')}: ${closed}`}</div>
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy || preparing} className="rounded p-2 bg-accent text-white disabled:opacity-50" onClick={() => void continueCleanup().catch(error)}>{preparing ? tr('Обновляем оставшиеся вкладки…', 'Refreshing remaining tabs…') : tr('Продолжить очистку', 'Continue cleanup')}</button>
        <button disabled={busy || !closed} className="border rounded p-2" onClick={() => void run(async () => setOperation(await workspaceMessage<TabOperation>({ type: 'UNDO_TAB_OPERATION', operationId: currentOperation.id })))}>{tr('Отменить оптимизацию', 'Undo optimization')}</button>
        <button className="border rounded p-2" onClick={() => useStore.getState().setView('tabs')}>{tr('Открытые вкладки', 'Open tabs')}</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="text-accent underline" onClick={download}>{tr('Скачать отчёт', 'Download report')}</button>
        <button disabled={busy} className="text-accent underline" onClick={() => void run(async () => setFeedback(await exportWorkspaceMarkdown('Cleanups', `aitab-review-${new Date(plan.createdAt).toISOString().slice(0, 10)}`, optimizationMarkdown(plan, [...selected], currentOperation))))}>{tr('Отчёт в Obsidian', 'Report to Obsidian')}</button>
        <button className="text-accent underline" onClick={() => useStore.getState().openWorkspace('history')}>{tr('Журнал операций', 'Operation journal')}</button>
      </div>
    </WorkspaceActionBar>}
  </section>;
  return <section ref={panel} className="space-y-3 text-xs" data-testid="optimization-panel">
    <details open={!plan || job?.status === 'running'} data-testid="review-setup" className="rounded border p-2">
    <summary className="font-medium cursor-pointer">{tr('Новая проверка и параметры', 'New review and options')}</summary>
    <div className="space-y-3 pt-2">
    <h3 className="font-semibold text-sm">{tr('Один план: меньше вкладок, полезное сохранено', 'One plan: fewer tabs, useful material retained')}</h3>
    {reviewScope && <button className="text-accent" onClick={() => useStore.getState().setView(reviewScope.returnView)}>{tr('← Вернуться к работе', '← Return to work')}</button>}
    <p>{tr('Область новой проверки', 'New review scope')}: <strong>{options.scopeLabel ?? tr('Все обычные окна', 'All normal windows')}</strong>{options.tabIds ? ` · ${options.tabIds.length}` : ''}</p>
    <details><summary>{tr('Контекст и параметры проверки', 'Review focus and options')}</summary><ReviewOptions /></details>
    <label className="flex gap-2"><input type="checkbox" checked={includeAi} disabled={preparing || job?.status === 'running'} onChange={(event) => setIncludeAi(event.target.checked)} />{tr('Дополнить план проверкой AI', 'Include AI review in the plan')}</label>
    <button disabled={busy || preparing} onClick={() => void prepare().catch(error)} className="w-full p-3 bg-accent text-white rounded disabled:opacity-50">{preparing ? tr('Готовим план…', 'Preparing plan…') : tr('Оптимизировать вкладки — подготовить план', 'Optimize tabs — prepare plan')}</button>
    <div className="flex gap-2 flex-wrap"><button disabled={busy || preparing || job?.status === 'running'} className="border rounded p-2" onClick={() => void prepare(true).catch(error)}>{tr('AI: проверить содержание и актуальность', 'AI: review content and relevance')}</button><button disabled={busy || preparing} className="border rounded p-2" onClick={() => void prepare(false).catch(error)}>{tr('Сравнить локально без AI', 'Compare locally without AI')}</button></div>
    </div></details>
    {job && !job.options.includeSaved && scopeKey(job.options) === scopeKey(options) && <ReviewProgress />}
    {feedback && <p role="status">{feedback}</p>}
    {plan && <>
      {review && <ReviewCoverage preview={review} />}
      {filter === 'outdated' && <div className="rounded border p-3 space-y-2"><strong>{tr('Проверка актуальности по задаче', 'Relevance to your task')}</strong><p>{tr('Неактуальность требует признаков в содержании или явной задачи. Укажите, какие проекты, события и версии уже не нужны; старый справочник может оставаться полезным.', 'Obsolescence needs content evidence or an explicit task. State which projects, events or versions no longer matter; an old reference may still be useful.')}</p><button className="text-accent underline" onClick={() => { const setup = panel.current?.querySelector<HTMLDetailsElement>('[data-testid="review-setup"]'); if (setup) { setup.open = true; setup.querySelectorAll('details').forEach((details) => { details.open = true; }); setup.scrollIntoView({ block: 'start' }); setup.querySelector('textarea')?.focus({ preventScroll: true }); } }}>{tr('Уточнить задачу и параметры', 'Set task and review options')}</button></div>}
      {(filter === 'similar' || filter === 'optimize') && <div className="rounded border p-3 space-y-2 bg-white" data-testid="similarity-summary">
        <h3 className="font-semibold">{tr('Похожие материалы', 'Similar materials')}: {similarCount} {tr('групп', 'groups')}</h3>
        <p>{tr('Пересечение содержания', 'Content overlap')}: {redundantCount} · {tr('Дополняют друг друга', 'Complementary')}: {relatedCount}{` · ${tr('Локальные кандидаты', 'Local candidates')}: ${review?.similarGroups.filter((group) => group.source !== 'ai').length ?? plan.localGroups?.length ?? 0}`}</p>
        <p>{tr('Выбрано к закрытию', 'Selected to close')}: {selected.size}. {tr('Отметьте ненужные вкладки в группах и нажмите «Применить план» внизу. Дополняющие материалы не выбираются автоматически.', 'Check unwanted tabs in the groups, then use Apply plan below. Complementary material is never selected automatically.')}</p>
        {similarCount > 0 ? <button className="text-accent underline" onClick={() => results.current?.scrollIntoView({ block: 'start' })}>{tr('Показать найденные группы', 'Show matching groups')}</button> : <p>{job?.status === 'running' ? tr('Проверка ещё идёт; группы появятся после получения результата.', 'Review is still running; groups will appear when results arrive.') : review ? tr('AI не вернул групп похожего содержания для этой области. Это не доказательство отсутствия повторов.', 'AI returned no similar-content groups for this scope. This does not prove there is no overlap.') : tr('Локальных совпадений не найдено. Для сравнения содержания запустите AI в параметрах проверки.', 'No local matches found. Run AI from review options to compare content.')}</p>}
      </div>}
      {expired && !currentOperation && <p role="alert" className="text-amber-800">{tr('Предпросмотр истёк — подготовьте новый план. Объяснения доступны для просмотра.', 'Preview expired — prepare a new plan. Explanations remain available.')}</p>}
      {plan.warning && <p role="alert" className="text-amber-800">{plan.warning}</p>}
      {filter !== 'similar' && forecast}
      <div ref={results} data-testid="similarity-groups" className="space-y-3">
      {(filter === 'similar' || filter === 'optimize') && plan.localGroups?.map((group) => <details key={group.id} open={filter === 'similar'} className="border rounded p-2"><summary>{tr('Совпадение заголовков — проверить', 'Title overlap — review')}</summary><p>{tr('Это локальное сходство слов, а не доказательство повторения содержания. Источники остаются открытыми.', 'This is local word similarity, not evidence of content redundancy. Sources remain open.')}</p>{group.tabIds.map((id) => { const tab = useStore.getState().windowGroups.flatMap((window) => window.tabs).find((tab) => tab.id === id); return tab ? tabRow(tab, group.id) : null; })}</details>)}
      {(filter === 'similar' || filter === 'optimize') && review?.similarGroups.map((group) => <details key={group.id} open={filter === 'similar'} className="border rounded p-2"><summary>{group.source !== 'ai' ? tr('Локальное сходство — содержание не подтверждено AI', 'Local similarity — content unconfirmed by AI') : group.relation === 'related' ? tr('Дополняющие материалы — ручной выбор', 'Complementary material — manual choice') : tr('Пересечение содержания', 'Content overlap')}</summary><p>{group.reason}</p>{group.uniqueValue && <p>{group.uniqueValue}</p>}{group.tabIds.map((id) => { const tab = review.tabs.find((tab) => tab.id === id); const evidence = review.evidence?.[id]; return tab ? <div key={id}>{tabRow(tab, group.id)}{group.relation === 'redundant' && <button disabled={busy || expired || Boolean(currentOperation)} className="border rounded p-2" onClick={() => void run(() => chooseKeeper(group.tabIds, id))}>{group.keepTabId === id ? tr('Оставляем эту', 'Retaining this') : tr('Оставить эту версию', 'Keep this version')}</button>}{evidence ? <details><summary>{tr('Доказательства', 'Evidence')} · {new Date(evidence.capturedAt).toLocaleString()}</summary><blockquote className="whitespace-pre-wrap break-words">{evidence.text}</blockquote></details> : <p className="text-amber-800">{tr('Только заголовок и URL; текст не проверен.', 'Title and URL only; text unverified.')}</p>}</div> : null; })}<button disabled={busy || expired} className="border rounded p-2" onClick={() => void run(async () => { await workspaceMessage({ type: 'REMEMBER_REVIEW_DECISION', previewId: review.id, kind: 'complementary', tabIds: group.tabIds }); touched.current = true; setSelected((previous) => new Set([...previous].filter((id) => !group.tabIds.includes(id)))); setFeedback(tr('Дополняющие источники запомнены.', 'Complementary sources remembered.')); })}>{tr('Оставить: источники дополняют друг друга', 'Retain: complementary sources')}</button></details>)}
      </div>
      {filter === 'similar' && forecast}
      <label className="block">{tr('Категория предложений', 'Suggestion category')}<select aria-label={tr('Категория предложений', 'Suggestion category')} className="border rounded p-2 ml-2" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); setLimit(100); }}><option value="all">{tr('Текущий раздел', 'Current section')}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label} ({plan.candidates.filter((item) => item.category === value).length})</option>)}</select></label>
      <p>{tr('Галочка выбирает строку. Действие указано в карточке и общей панели. Защищённые страницы и чаты не закрываются этим планом.', 'Checkboxes select rows. Each card and the action bar state the effect. Protected pages and chats are not closed by this plan.')}</p>
      {candidates.filter((item) => !showingGroups || !similarIds.has(item.tab.id)).slice(0, limit).map((item) => {
        const evidence = review?.outdatedTabs.find((entry) => entry.tabId === item.tab.id);
        return <article key={item.tab.id} className="border rounded p-3 space-y-1">
        {tabRow(item.tab, 'candidate')}
        <p>{item.category === 'exact' ? tr('Остаётся копия с тем же URL.', 'A copy with the same URL is retained.') : item.reason}</p>{!canChoose(item) && <p className="text-amber-800">{tr('Сохраняемая копия конфликтует с выбором. Сначала снимите зависимые строки.', 'The retained copy conflicts with the selection. Clear dependent rows first.')}</p>}{evidence && <><blockquote className="border-l-2 pl-2">{evidence.evidence}</blockquote><button className="border rounded p-2" disabled={expired || busy} onClick={() => void run(async () => { await workspaceMessage({ type: 'REMEMBER_REVIEW_DECISION', previewId: review!.id, kind: 'keep', tabIds: [item.tab.id] }); setSelected((previous) => { const next = new Set(previous); next.delete(item.tab.id); return next; }); setFeedback(tr('Решение «ещё нужно» сохранено.', 'Still useful decision remembered.')); })}>{tr('Это всё ещё нужно — запомнить', 'Still useful — remember')}</button></>}</article>;
      })}
      {candidates.filter((item) => !showingGroups || !similarIds.has(item.tab.id)).length > limit && <button className="border rounded p-2" onClick={() => setLimit(limit + 100)}>{tr('Показать ещё', 'Show more')}</button>}
      {!candidates.length && <p>{filter === 'similar' && similarCount ? tr('Похожие материалы показаны выше. Кандидатов на закрытие в этой категории нет.', 'Similar materials are shown above. No closure candidates in this category.') : tr('В этой категории кандидатов нет.', 'No candidates in this category.')}</p>}
      {(filter === 'duplicates' || filter === 'optimize') && plan.duplicateGroups?.map((group) => <details key={group.id} className="border rounded p-2"><summary>{group.kind === 'stateful' ? tr('Чаты с одинаковым адресом — ручная проверка', 'Chats sharing an address — manual review') : tr('Выбрать оставляемую копию', 'Choose retained copy')} ({group.tabs.length})</summary>{group.kind === 'stateful' ? <p>{tr('Одинаковый адрес может содержать разные чаты и черновики. Проверьте их во Вкладках; этот план их сохраняет.', 'The same address may hold different chats and drafts. Review them in Tabs; this plan retains them.')}</p> : group.tabs.map((tab) => <label key={tab.id} className="flex gap-2 p-2"><input type="radio" name={'retain-' + group.id} aria-label={tr('Оставить копию', 'Keep copy') + ' ' + tab.id} disabled={busy || expired || Boolean(currentOperation)} checked={group.keepTabId === tab.id} onChange={() => void run(() => chooseKeeper(group.tabs.map((item) => item.id), tab.id))} /><span className="break-words">{tab.title || tab.url}</span></label>)}</details>)}
    </>}
    {view === 'workspace' && ['optimize', 'duplicates', 'similar', 'outdated'].includes(filter) && <WorkspaceActionBar>
      {expired && !currentOperation && <p role="status" className="text-amber-800">{tr('План истёк. Откройте «Новую проверку и параметры» и подготовьте план заново.', 'Plan expired. Open New review and options and prepare a fresh plan.')}</p>}
      {!currentOperation && <p>{tr('Выбрано к закрытию', 'Selected to close')}: <strong>{selected.size}</strong> · {tr('вне категории', 'outside category')}: {hiddenSelected} · {tr('с сохранением', 'with saving')}: {archiveCount}{plan ? ` · ${tr('после останется', 'forecast remaining')}: ${plan.tabsBefore - selected.size}` : ''}</p>}
      {currentOperation && <div data-testid="optimization-execution" role="status" aria-live="polite" className="space-y-1">
        <strong>{tr('Сохраняем и закрываем…', 'Saving and closing…')}</strong>
        <p>{tr('Обработано', 'Processed')}: {processed} / {currentOperation.items.length}. {tr('Повторно нажимать Apply не нужно.', 'Do not apply again.')}</p>
        <button className="text-accent underline" onClick={() => useStore.getState().openWorkspace('history')}>{tr('Журнал операций', 'Operation journal')}</button>
      </div>}
      <div className="flex gap-2 flex-wrap"><button disabled={!plan || busy || expired || Boolean(currentOperation)} className="border rounded p-2" onClick={() => { touched.current = true; const next = new Set(selected); for (const item of candidates) if (!(filter === 'similar' && category === 'all' && item.category !== 'redundant') && !plan?.candidates.some((other) => next.has(other.tab.id) && other.keep?.id === item.tab.id) && !(item.keep && next.has(item.keep.id))) next.add(item.tab.id); setSelected(next); }}>{tr('Выбрать кандидатов этого раздела', 'Select candidates in this section')}</button><button disabled={!selected.size || busy || Boolean(currentOperation)} className="border rounded p-2" onClick={() => { touched.current = true; setSelected(new Set()); }}>{tr('Снять выбор', 'Clear selection')}</button><button disabled={!plan} className="border rounded p-2" onClick={download}>{tr('Скачать отчёт', 'Download report')}</button><button disabled={!plan || busy} className="border rounded p-2" onClick={() => void run(async () => { if (plan) setFeedback(await exportWorkspaceMarkdown('Cleanups', `aitab-review-${new Date(plan.createdAt).toISOString().slice(0, 10)}`, optimizationMarkdown(plan, [...selected], currentOperation ?? undefined))); })}>{tr('Отчёт в Obsidian', 'Report to Obsidian')}</button></div><button disabled={busy || !selected.size || Boolean(currentOperation) || expired} className="w-full rounded bg-red-600 text-white p-2 disabled:opacity-50" onClick={() => void run(async () => { if (plan) { rememberPosition(); setOperation(await workspaceMessage<TabOperation>({ type: 'EXECUTE_OPTIMIZATION', planId: plan.id, tabIds: [...selected] })); } })}>{currentOperation ? tr('Выполняется…', 'Applying…') : `${tr('Применить план', 'Apply plan')} (${selected.size})`}</button></WorkspaceActionBar>}
  </section>;
}
