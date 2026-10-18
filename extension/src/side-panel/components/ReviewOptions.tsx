import { useI18n } from '@shared/i18n';
import { useEffect, useState } from 'react';
import type { WorkspaceData } from '@shared/types/workspace';
import { workspaceMessage } from '../workspace-api';
import { useStore } from '../store';
import { useWorkspaceReview } from '../review-controller';

export function ReviewOptions() {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const { options, setOptions, job, permissionDenied } = useWorkspaceReview();
  const running = job?.status === 'running';
  const [collections, setCollections] = useState<WorkspaceData['collections']>([]);
  useEffect(() => { void workspaceMessage<WorkspaceData>({ type: 'WORKSPACE_OVERVIEW' }).then((data) => setCollections(data.collections.filter((collection) => !collection.deletedAt && collection.focus))).catch(() => {}); }, []);
  return <div className="space-y-2 text-xs">
    {collections.length > 0 && <label className="block">{tr('Взять задачу из коллекции', 'Use a collection task')}<select disabled={running} defaultValue="" className="block w-full border rounded p-2" onChange={(event) => { const collection = collections.find((entry) => entry.id === event.target.value); if (collection) setOptions({ ...options, focus: collection.focus ?? '' }); }}><option value="">{tr('Выберите коллекцию', 'Choose collection')}</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>}
    <label className="block">{tr('Что сейчас актуально (необязательно)', 'Current focus (optional)')}
      <textarea aria-label={tr('Что сейчас актуально (необязательно)', 'Current focus (optional)')} disabled={running} value={options.focus} maxLength={1000} onChange={(event) => setOptions({ ...options, focus: event.target.value })} placeholder={tr('Какие темы и версии нужны; что уже не актуально', 'Relevant topics and versions; what is no longer useful')} className="block w-full border rounded p-2 mt-1" rows={2} />
    </label>
    <select disabled={running} aria-label={tr('Окна для проверки содержания', 'Content review scope')} value={options.windowId ?? 'all'} onChange={(event) => setOptions({ ...options, windowId: event.target.value === 'all' ? undefined : Number(event.target.value) })} className="w-full border rounded p-1">
      <option value="all">{tr('Все обычные окна', 'All normal windows')}</option>
      {windows.map((window, index) => <option key={window.windowId} value={window.windowId}>{tr('Окно', 'Window')} {index + 1} ({window.tabs.length})</option>)}
    </select>
    <label className="flex gap-2"><input disabled={running} type="checkbox" checked={options.readContent} onChange={(event) => setOptions({ ...options, readContent: event.target.checked })} />{tr('Добавить доступные фрагменты страниц', 'Include accessible page excerpts')}</label>
    <p className="text-[10px] text-gray-500">{tr('AI получает заголовки, URL, контекст и включённые фрагменты до 600 страниц. Чаты исключены. Спящие страницы не пробуждаются.', 'AI receives titles, URLs, focus and enabled excerpts of up to 600 pages. Chats are excluded. Discarded pages stay asleep.')}</p>
    {permissionDenied && <p className="text-amber-800">{tr('Разрешение на чтение не выдано: анализ только по заголовкам и URL.', 'Page permission was denied: titles and URLs only.')}</p>}
  </div>;
}
