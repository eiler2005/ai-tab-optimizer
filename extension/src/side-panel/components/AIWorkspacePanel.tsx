import { useMemo, useState } from 'react';
import { useI18n } from '@shared/i18n';
import { buildWorkspaceSuggestions } from '@shared/utils/workspace-suggestions';
import type { CollectionPreview } from '@shared/types/workspace';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';

export function AIWorkspacePanel({ busy, run, onFeedback, onReviewDuplicates }: {
  busy: boolean; run: (action: () => Promise<void>) => Promise<void>; onFeedback: (message: string) => void; onReviewDuplicates: () => void;
}) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { aiResult, aiLoading, aiError, aiAnalyzedAt, windowGroups, analyzeTabs, stopAIAnalysis } = useStore();
  const suggestions = useMemo(() => buildWorkspaceSuggestions(aiResult?.topicClusters ?? [], windowGroups.flatMap((window) => window.tabs)), [aiResult, windowGroups]);
  const [preview, setPreview] = useState<CollectionPreview | null>(null);

  return <section className="space-y-3 text-xs">
    <h3 className="font-semibold">{tr('AI-подсказки для организации', 'AI organization suggestions')}</h3>
    <p className="text-gray-500">{tr('Посмотрите тематические наборы из анализа. Сохранение требует отдельного просмотра и подтверждения; AI не запускает закрытие вкладок. При новом анализе URL и заголовки передаются выбранному AI-провайдеру.', 'Review topic sets from analysis. Saving requires a separate preview and confirmation; AI never triggers tab closing. A new analysis sends URLs and titles to your configured AI provider.')}</p>
    <div className="flex gap-2 flex-wrap">
      <button disabled={busy || aiLoading} onClick={() => analyzeTabs(true)} className="px-3 py-2 bg-accent text-white rounded disabled:opacity-50">{tr('Обновить AI-анализ', 'Refresh AI analysis')}</button>
      {aiLoading && <button onClick={() => void stopAIAnalysis().catch((error) => useStore.getState().setActionError(String(error)))} className="px-2 py-1 bg-gray-100 rounded">{tr('Остановить анализ', 'Stop analysis')}</button>}
      <button onClick={onReviewDuplicates} className="px-2 py-1 bg-gray-100 rounded">{tr('Проверить точные повторы', 'Review exact duplicates')}</button>
    </div>
    {aiError && <p role="alert" className="text-red-700">{aiError}</p>}
    {aiLoading && <p role="status">{tr('Анализ выполняется…', 'Analysis in progress…')}</p>}
    {aiAnalyzedAt && <p className="text-gray-500">{tr('Последний анализ', 'Last analysis')}: {new Date(aiAnalyzedAt).toLocaleString()}</p>}
    {!suggestions.length && !aiLoading && <p className="text-gray-500">{tr('Нет тематических наборов с двумя открытыми вкладками. Обновите анализ или сохраните коллекцию вручную.', 'No topic sets with two live tabs. Refresh analysis or save a collection manually.')}</p>}
    {suggestions.map((suggestion, index) => <section key={suggestion.name + index} className="border rounded p-2 space-y-2">
      <h4 className="font-medium">{suggestion.name} · {suggestion.tabIds.length}</h4>
      <p className="text-gray-600 whitespace-pre-wrap">{suggestion.reason}</p>
      <details><summary>{tr('Страницы в наборе', 'Pages in this set')}</summary><ul className="max-h-40 overflow-auto text-[10px]">{suggestion.urls.map((url) => <li key={url} className="break-all">{url}</li>)}</ul></details>
      <button disabled={busy} onClick={() => void run(async () => setPreview(await workspaceMessage<CollectionPreview>({ type: 'PREVIEW_COLLECTION', name: suggestion.name, tabIds: suggestion.tabIds })))} className="px-2 py-1 bg-gray-100 rounded">{tr('Просмотреть сохранение набора', 'Preview saving this set')}</button>
    </section>)}
    {preview && <div className="border border-blue-200 p-2 rounded space-y-2">
      <p className="font-medium">{preview.name}</p>
      <ul className="max-h-40 overflow-auto text-[10px]">{preview.windows.flatMap((window) => window.tabs).map((tab) => <li key={tab.id} className="break-all">{tab.url}</li>)}</ul>
      <button disabled={busy} onClick={() => void run(async () => {
        await workspaceMessage({ type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
        setPreview(null); onFeedback(tr('Тематическая коллекция сохранена.', 'Topic collection saved.'));
      })} className="px-3 py-2 bg-accent text-white rounded">{tr('Сохранить коллекцию', 'Save collection')}</button>
    </div>}
  </section>;
}
