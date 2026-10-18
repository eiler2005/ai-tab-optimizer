import { useEffect, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { TabRecord } from '@shared/types';
import type { TabOperation } from '@shared/types/workspace';
import { tabProtectionReason } from '@shared/utils/rules';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';
import { useWorkspaceReview } from '../review-controller';
import { WorkspaceActionBar } from './WorkspaceActionBar';
import { ReviewOptions } from './ReviewOptions';

export function ContentReviewPanel({ mode, busy, run, onResult }: {
  mode: 'similar' | 'outdated'; busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>; onResult: (operation: TabOperation) => void;
}) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { job, start } = useWorkspaceReview();
  const preview = job?.status === 'completed' && !job.preview?.savedSources ? job.preview : undefined;
  const running = job?.status === 'running';
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Map<number, number | undefined>>(new Map());
  useEffect(() => { setSelected(new Map()); }, [mode]);
  useEffect(() => {
    setKeepers(Object.fromEntries(preview?.similarGroups.map((group) => [group.id, group.keepTabId]) ?? []));
    setSelected(new Map());
  }, [preview?.id]);

  const blocking = (tab: TabRecord, keep?: number) => {
    const reason = tabProtectionReason(tab, preview?.protectedDomains);
    const labels: Record<string, string> = { pinned: 'закреплена', active: 'активна', 'playing audio': 'воспроизводит звук', 'marked important or protected': 'важная или защищённая', 'protected domain': 'защищённый домен' };
    if (reason) return tr('Защищена: ' + (labels[reason] ?? reason), 'Protected: ' + reason);
    if (tab.id === keep) return tr('Оставляем эту версию. Чтобы закрыть её, выберите другую сохраняемую версию.', 'Keeping this version. Choose another version to keep before closing this one.');
    if (keep !== undefined && selected.has(keep)) return tr('Сохраняемая версия отмечена на закрытие. Сначала снимите её выбор.', 'The retained version is selected to close. Clear its selection first.');
    if ([...selected.values()].includes(tab.id)) return tr('Нужна как сохраняемая версия для выбранных страниц. Сначала снимите их выбор.', 'Needed by selected pages. Clear their selections first.');
    return null;
  };
  const page = (tab: TabRecord, keep?: number) => {
    const reason = blocking(tab, keep);
    return <div className="flex gap-2 items-start text-xs" key={tab.id}>
      <input type="checkbox" aria-label={tr('Закрыть кандидата', 'Close candidate') + ' ' + tab.id} title={reason ?? tr('Выбрать для закрытия', 'Select for closing')} checked={selected.has(tab.id)} disabled={busy || Boolean(reason)} onChange={() => setSelected((previous) => {
        const next = new Map(previous); if (next.has(tab.id)) next.delete(tab.id); else next.set(tab.id, keep); return next;
      })} />
      <div className="min-w-0 flex-1"><button onClick={() => void workspaceMessage({ type: 'FOCUS_TAB', tabId: tab.id }).catch((error) => useStore.getState().setActionError(String(error)))} className="text-left text-accent break-words">{tab.title || tab.url}</button>
        <div className="text-[10px] text-gray-500 break-all">{tab.url}</div>
        {reason && <p className="text-[10px] text-amber-800">{reason}</p>}
      </div>
    </div>;
  };
  const selectCandidates = () => {
    if (!preview) return;
    const next = new Map<number, number | undefined>();
    const roots = new Set<number>();
    const add = (tab: TabRecord, keep?: number) => {
      if (!tabProtectionReason(tab, preview.protectedDomains) && tab.id !== keep && !roots.has(tab.id) && (keep === undefined || !next.has(keep))) {
        next.set(tab.id, keep); if (keep !== undefined) roots.add(keep);
      }
    };
    if (mode === 'similar') for (const group of preview.similarGroups.filter((item) => item.relation === 'redundant')) {
      const keep = keepers[group.id] ?? group.keepTabId;
      for (const id of group.tabIds) { const tab = preview.tabs.find((item) => item.id === id); if (tab) add(tab, keep); }
    }
    else for (const item of preview.outdatedTabs) { const tab = preview.tabs.find((tab) => tab.id === item.tabId); if (tab) add(tab, item.replacementTabId); }
    setSelected(next);
  };

  return <section className="space-y-3 text-xs" data-testid="content-review">
    <h3 className="font-semibold">{mode === 'similar' ? tr('Похожий контент', 'Similar content') : tr('Устарело по смыслу', 'Outdated content')}</h3>
    <p className="text-gray-600">{tr('Разные авторы, подходы и примеры могут дополнять друг друга. Такие материалы сохраняем в рекомендациях. Неактуальность определяется содержанием и вашим контекстом.', 'Different authors, approaches and examples can complement each other. Recommendations retain these alternatives. Obsolescence uses content and your focus.')}</p>
    <details><summary className="cursor-pointer">{tr('Контекст и параметры проверки', 'Review focus and options')}</summary><div className="pt-2"><ReviewOptions /></div></details>
    <div className="flex gap-2 flex-wrap">
      <button disabled={busy || running} onClick={() => void start(true).catch((error) => useStore.getState().setActionError(String(error)))} className="px-3 py-2 rounded bg-accent text-white disabled:opacity-50">{tr('AI: проверить содержание и актуальность', 'AI: review content and relevance')}</button>
      <button disabled={busy || running} onClick={() => void start(false).catch((error) => useStore.getState().setActionError(String(error)))} className="px-2 py-1 rounded bg-gray-100 disabled:opacity-50">{tr('Сравнить локально без AI', 'Compare locally without AI')}</button>
    </div>
    {preview && <>
      <div className="rounded bg-gray-50 p-2" role="status">
        <p>{tr('Групп', 'Groups')}: {preview.similarGroups.length} · {tr('Устарело', 'Outdated')}: {preview.outdatedTabs.length} · AI: {preview.aiTabCount}/{preview.tabs.length - (preview.excludedChats ?? 0)}</p>
        <p>{tr('Фрагментов прочитано', 'Excerpts read')}: {preview.extractedCount} · {tr('Чатов сохранено', 'Chats retained')}: {preview.excludedChats ?? 0}</p>
      </div>
      {preview.extractionFailed > 0 && <p className="text-amber-800">{tr('Без доступного текста', 'Without accessible text')}: {preview.extractionFailed}. {tr('Для них доступны только заголовки и URL.', 'Only titles and URLs are available for these pages.')}</p>}
      {preview.tabs.length - (preview.excludedChats ?? 0) > 600 && <p className="text-amber-800">{tr('Первые 600 страниц проверены; выберите другое окно для остальных.', 'First 600 pages reviewed; select another window for the rest.')}</p>}
      {preview.warning && <p role="alert" className="text-amber-800">{tr('Показаны локальные совпадения: ', 'Showing local matches: ')}{preview.warning}</p>}
      {mode === 'similar' && preview.similarGroups.map((group) => <div key={group.id} className="border rounded p-2 space-y-2">
        <p className="font-medium">{group.relation === 'redundant' ? tr('Повтор информации', 'Redundant information') : tr('Альтернативные материалы — рекомендуем оставить', 'Alternative material — recommended to keep')} · {Math.round(group.confidence * 100)}%</p>
        <p>{group.source === 'ai' ? group.reason : tr('Совпадают слова заголовков или фрагментов. Полное совпадение содержания не подтверждено.', 'Title or excerpt words overlap. Full content equivalence is unconfirmed.')}</p>
        {group.uniqueValue && <p className="text-green-800">{group.uniqueValue}</p>}
        {group.tabIds.map((id) => preview.tabs.find((tab) => tab.id === id)).filter((tab): tab is TabRecord => Boolean(tab)).map((tab) => <div key={tab.id} className="space-y-1">
          <label className="flex gap-1 text-[10px]"><input type="radio" name={group.id} aria-label={tr('Оставить похожую вкладку', 'Keep similar tab') + ' ' + tab.id} checked={(keepers[group.id] ?? group.keepTabId) === tab.id} disabled={busy} onChange={() => {
            setKeepers((previous) => ({ ...previous, [group.id]: tab.id })); setSelected(new Map());
          }} />{tr('Оставить эту версию', 'Keep this version')}</label>
          {page(tab, keepers[group.id] ?? group.keepTabId)}
        </div>)}
      </div>)}
      {mode === 'outdated' && preview.outdatedTabs.map((item) => {
        const tab = preview.tabs.find((candidate) => candidate.id === item.tabId)!;
        const replacement = preview.tabs.find((candidate) => candidate.id === item.replacementTabId);
        return <div key={item.tabId} className="border rounded p-2 space-y-2">
          {page(tab, item.replacementTabId)}<p>{item.reason}</p><blockquote className="border-l-2 pl-2 text-gray-500 break-words">{item.evidence}</blockquote>
          {replacement && <p className="text-green-800">{tr('Замена останется открытой', 'Replacement stays open')}: {replacement.title}</p>}
        </div>;
      })}
      {(mode === 'similar' ? preview.similarGroups.length === 0 : preview.outdatedTabs.length === 0) && <p className="text-gray-500">{tr('Кандидатов в этом разделе не найдено.', 'No candidates found in this section.')}</p>}
    </>}
    <WorkspaceActionBar>
      <div className="flex gap-2 flex-wrap text-xs"><button disabled={busy || !preview} onClick={selectCandidates} className="px-2 py-1 bg-gray-100 rounded disabled:opacity-50">{tr('Выбрать кандидатов этого раздела', 'Select candidates in this section')}</button><button disabled={busy || !selected.size} onClick={() => setSelected(new Map())} className="px-2 py-1 border rounded disabled:opacity-50">{tr('Снять выбор', 'Clear selection')}</button></div>
      <button disabled={busy || !selected.size} onClick={() => void run(async () => {
        if (!preview) return;
        const operation = await workspaceMessage<TabOperation>({ type: 'EXECUTE_CONTENT_REVIEW', previewId: preview.id, decisions: [...selected].map(([tabId, keepTabId]) => ({ tabId, keepTabId: mode === 'similar' ? keepTabId : undefined })) });
        setSelected(new Map()); onResult(operation);
      })} className="w-full p-2 bg-red-600 text-white rounded text-xs disabled:opacity-50">{tr('Закрыть выбранные с возможностью отмены', 'Close selected with Undo')} ({selected.size})</button>
    </WorkspaceActionBar>
  </section>;
}
