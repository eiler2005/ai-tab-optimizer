import { useEffect, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { TabRecord } from '@shared/types';
import type { ContentReviewPreview } from '@shared/types/content-review';
import type { TabOperation } from '@shared/types/workspace';
import { tabProtectionReason } from '@shared/utils/rules';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';

export function ContentReviewPanel({ mode, busy, run, onResult }: {
  mode: 'similar' | 'outdated'; busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>; onResult: (operation: TabOperation) => void;
}) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const [preview, setPreview] = useState<ContentReviewPreview | null>(null);
  const [scope, setScope] = useState('all');
  const [focus, setFocus] = useState('');
  const [readContent, setReadContent] = useState(true);
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Map<number, number | undefined>>(new Map());
  const [permissionNotice, setPermissionNotice] = useState(false);
  useEffect(() => { setSelected(new Map()); }, [mode]);
  useEffect(() => { setPreview(null); setSelected(new Map()); }, [scope, focus, readContent]);
  const allKeepers = new Set([...Object.values(keepers), ...(preview?.outdatedTabs.flatMap((item) => item.replacementTabId === undefined ? [] : [item.replacementTabId]) ?? [])]);

  async function scan(useAi: boolean) {
    let canRead = readContent;
    if (canRead) {
      canRead = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
      setPermissionNotice(!canRead);
    }
    await run(async () => {
      const next = await workspaceMessage<ContentReviewPreview>({ type: 'PREVIEW_CONTENT_REVIEW', options: {
        useAi, readContent: canRead, focus, windowId: scope === 'all' ? undefined : Number(scope),
      } });
      setPreview(next); setSelected(new Map());
      setKeepers(Object.fromEntries(next.similarGroups.map((group) => [group.id, group.keepTabId])));
    });
  }

  const toggle = (id: number, keep?: number) => setSelected((previous) => {
    const next = new Map(previous); if (next.has(id)) next.delete(id); else next.set(id, keep); return next;
  });
  const protection = (tab: TabRecord) => tabProtectionReason(tab, preview?.protectedDomains);
  const canSelect = (tab: TabRecord) => !busy && !protection(tab) && !allKeepers.has(tab.id);
  const page = (tab: TabRecord, keep?: number) => <div className="flex gap-2 items-start text-xs" key={tab.id}>
    <input type="checkbox" aria-label={tr('Закрыть кандидата', 'Close candidate') + ' ' + tab.id} checked={selected.has(tab.id)} disabled={!canSelect(tab)} onChange={() => toggle(tab.id, keep)} />
    <div className="min-w-0 flex-1">
      <button onClick={() => void workspaceMessage({ type: 'FOCUS_TAB', tabId: tab.id }).catch((error) => useStore.getState().setActionError(String(error)))} className="text-left text-accent break-words">{tab.title || tab.url}</button>
      <div className="text-[10px] text-gray-500 break-all">{tab.url}</div>
      {protection(tab) && <span className="block text-[10px] text-amber-800">{tr('Защищена от закрытия', 'Protected from closing')}</span>}
      {allKeepers.has(tab.id) && <span className="block text-[10px] text-green-800">{tr('Оставить открытой', 'Keep open')}</span>}
    </div>
  </div>;

  return <section className="space-y-3 text-xs" data-testid="content-review">
    <h3 className="font-semibold">{mode === 'similar' ? tr('Похожий контент', 'Similar content') : tr('Устарело по смыслу', 'Outdated content')}</h3>
    <p className="text-gray-600">{tr('Одна тема ещё не означает повтор. AI объясняет пересечение и различия. Устаревание оценивается по датам, версиям, заменяющим материалам и вашему контексту; давность посещения не используется.', 'A shared topic alone is not duplication. AI explains overlap and differences. Obsolescence uses dates, versions, replacement material and your focus; time since last visit is not used.')}</p>
    <label className="block space-y-1">{tr('Что сейчас актуально (необязательно)', 'Current focus (optional)')}
      <textarea disabled={busy} value={focus} maxLength={1000} onChange={(event) => setFocus(event.target.value)} placeholder={tr('Например: изучаю React 19; конференция 2025 года уже не нужна', 'Example: learning React 19; the 2025 conference is no longer relevant')} className="w-full border rounded p-2" rows={2} />
    </label>
    <select disabled={busy} aria-label={tr('Окна для проверки содержания', 'Content review scope')} value={scope} onChange={(event) => setScope(event.target.value)} className="w-full border rounded p-1">
      <option value="all">{tr('Все обычные окна', 'All normal windows')}</option>
      {windows.map((window, index) => <option key={window.windowId} value={window.windowId}>{tr('Окно', 'Window')} {index + 1} ({window.tabs.length})</option>)}
    </select>
    <label className="flex gap-2"><input disabled={busy} type="checkbox" checked={readContent} onChange={(event) => setReadContent(event.target.checked)} />{tr('Добавить доступные фрагменты страниц', 'Include accessible page excerpts')}</label>
    <p className="text-[10px] text-gray-500">{tr('AI отправляет выбранному провайдеру заголовки, URL, контекст и включённые фрагменты (до 600 вкладок). Спящие страницы не пробуждаются. Это рекомендации для ручной проверки; вкладки изначально не отмечены.', 'AI sends titles, URLs, focus and enabled excerpts to your provider (up to 600 tabs). Discarded pages stay asleep. Suggestions require review; no tab is selected initially.')}</p>
    <div className="flex gap-2 flex-wrap">
      <button disabled={busy} onClick={() => void scan(true).catch((error) => useStore.getState().setActionError(String(error)))} className="px-3 py-2 rounded bg-accent text-white disabled:opacity-50">{tr('AI: проверить содержание и актуальность', 'AI: review content and relevance')}</button>
      <button disabled={busy} onClick={() => void scan(false).catch((error) => useStore.getState().setActionError(String(error)))} className="px-2 py-1 rounded bg-gray-100 disabled:opacity-50">{tr('Сравнить локально без AI', 'Compare locally without AI')}</button>
    </div>
    {busy && <p role="status">{tr('Проверка выполняется. Сотни вкладок могут занять несколько минут…', 'Review in progress. Hundreds of tabs can take several minutes…')}</p>}
    {permissionNotice && <p className="text-amber-800">{tr('Доступ к страницам не выдан: сравниваются заголовки и URL.', 'Page permission was denied: comparing titles and URLs.')}</p>}
    {preview && <>
      <div className="rounded bg-gray-50 p-2 space-y-1" role="status">
        <p>{tr('Вкладок', 'Tabs')}: {preview.tabs.length} · {tr('Фрагментов', 'Excerpts')}: {preview.extractedCount} · AI: {preview.aiTabCount}/{preview.tabs.length}{preview.provider ? ` (${preview.provider})` : ''}</p>
        <p>{tr('Групп похожего контента', 'Similar groups')}: {preview.similarGroups.length} · {tr('Возможно устарело', 'Possibly outdated')}: {preview.outdatedTabs.length} · {tr('Выбрано на закрытие', 'Selected to close')}: {selected.size}</p>
      </div>
      {preview.extractionFailed > 0 && <p className="text-amber-800">{tr('Без доступного текста', 'Without accessible text')}: {preview.extractionFailed}. {tr('Для них AI видит только заголовок и URL.', 'AI only sees their title and URL.')}</p>}
      {preview.tabs.length > 600 && <p className="text-amber-800">{tr('Лимит AI — первые 600 вкладок. Для остальных выберите отдельное окно.', 'AI limit: first 600 tabs. Select another window to review the rest.')}</p>}
      {preview.warning && <p role="alert" className="text-amber-800">{tr('AI недоступен; показаны локальные совпадения.', 'AI unavailable; showing local matches.')} {preview.warning}</p>}
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={() => {
          const next = new Map<number, number | undefined>();
          if (mode === 'similar') for (const group of preview.similarGroups) for (const id of group.tabIds) {
            const tab = preview.tabs.find((item) => item.id === id);
            if (tab && canSelect(tab) && !next.has(id)) next.set(id, keepers[group.id]);
          }
          else for (const item of preview.outdatedTabs) {
            const tab = preview.tabs.find((candidate) => candidate.id === item.tabId);
            if (tab && canSelect(tab)) next.set(tab.id, undefined);
          }
          setSelected(next);
        }} className="px-2 py-1 rounded bg-gray-100">{tr('Выбрать кандидатов этого раздела', 'Select candidates in this section')}</button>
        <button disabled={busy} onClick={() => setSelected(new Map())} className="px-2 py-1 rounded bg-gray-100">{tr('Снять выбор', 'Clear selection')}</button>
      </div>
      {mode === 'similar' && preview.similarGroups.map((group) => <div key={group.id} className="border rounded p-2 space-y-2">
        <p className="font-medium">{group.source === 'ai' ? tr('AI: возможное пересечение', 'AI: possible overlap') : group.source === 'titles' ? tr('Похожие заголовки — содержание не подтверждено', 'Similar titles — content unconfirmed') : tr('Пересекающиеся фрагменты', 'Overlapping excerpts')} · {Math.round(group.confidence * 100)}%</p>
        <p>{group.source === 'ai' ? group.reason : group.source === 'titles' ? tr('Совпадают характерные слова заголовков. Откройте страницы и сравните.', 'Distinctive title words overlap. Open the pages to compare.') : tr('Совпадает значительная часть слов в доступных фрагментах.', 'Accessible excerpts share a substantial proportion of words.')}</p>
        {group.tabIds.map((id) => preview.tabs.find((tab) => tab.id === id)).filter((tab): tab is TabRecord => Boolean(tab)).map((tab) => <div key={tab.id} className="space-y-1">
          <label className="flex gap-1 text-[10px]"><input type="radio" name={group.id} aria-label={tr('Оставить похожую вкладку', 'Keep similar tab') + ' ' + tab.id} checked={keepers[group.id] === tab.id} disabled={busy} onChange={() => {
            setKeepers((previous) => ({ ...previous, [group.id]: tab.id }));
            setSelected(new Map());
          }} />{tr('Оставить эту версию', 'Keep this version')}</label>
          {page(tab, keepers[group.id])}
        </div>)}
      </div>)}
      {mode === 'outdated' && preview.outdatedTabs.map((item) => {
        const tab = preview.tabs.find((candidate) => candidate.id === item.tabId)!;
        const replacement = preview.tabs.find((candidate) => candidate.id === item.replacementTabId);
        return <div key={item.tabId} className="border rounded p-2 space-y-2">
          {page(tab)}<p>{item.reason}</p><blockquote className="border-l-2 pl-2 text-gray-500 break-words">{item.evidence}</blockquote>
          {replacement && <p className="text-green-800">{tr('Актуальная замена останется открытой', 'Replacement stays open')}: {replacement.title}</p>}
          <p className="text-[10px] text-gray-500">{tr('Уверенность AI', 'AI confidence')}: {Math.round(item.confidence * 100)}%</p>
        </div>;
      })}
      {(mode === 'similar' ? preview.similarGroups.length === 0 : preview.outdatedTabs.length === 0) && <p className="text-gray-500">{mode === 'outdated' && !preview.provider ? tr('Для проверки устаревания по смыслу запустите AI с контекстом.', 'Run AI with your focus to review obsolescence.') : tr('Обоснованных кандидатов в этом разделе не найдено.', 'No supported candidates found in this section.')}</p>}
      {selected.size > 0 && <button disabled={busy} onClick={() => void run(async () => {
        const operation = await workspaceMessage<TabOperation>({ type: 'EXECUTE_CONTENT_REVIEW', previewId: preview.id, decisions: [...selected].map(([tabId, keepTabId]) => ({ tabId, keepTabId })) });
        setPreview(null); setSelected(new Map()); onResult(operation);
      })} className="w-full p-2 bg-red-600 text-white rounded disabled:opacity-50">{tr('Закрыть выбранные с возможностью отмены', 'Close selected with Undo')} ({selected.size})</button>}
    </>}
  </section>;
}
