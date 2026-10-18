import { useI18n } from '@shared/i18n';
import { useWorkspaceReview } from '../review-controller';
import { ReviewOptions } from './ReviewOptions';

export function LibraryReview({ selectedUrls }: { selectedUrls: string[] }) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const review = useWorkspaceReview();
  const preview = review.job?.status === 'completed' && review.job.preview?.savedSources ? review.job.preview : undefined;
  return <section className="space-y-2 border rounded p-2 text-xs">
    <h4 className="font-semibold">{tr('Сравнение всей библиотеки', 'Compare the library')}</h4>
    <p>{tr('Проверяет открытые страницы и сохранённые ссылки. Корзина и чаты исключены. Для закрытых страниц используются заголовки и доступные сохранённые фрагменты; ссылки не открываются автоматически.', 'Reviews open and saved pages. Trash and chats are excluded. Closed pages use titles and available cached excerpts; no pages open automatically.')}</p>
    <details><summary>{tr('Параметры проверки', 'Review options')}</summary><ReviewOptions /></details>
    <div className="flex flex-wrap gap-2">
      <button disabled={review.job?.status === 'running'} className="bg-accent text-white rounded p-2 disabled:opacity-50" onClick={() => void review.start(true, { includeSaved: true }).catch((error) => alert(String(error)))}>{tr('AI: сравнить библиотеку', 'AI: compare library')}</button>
      <button disabled={review.job?.status === 'running'} className="border rounded p-2" onClick={() => void review.start(false, { includeSaved: true }).catch((error) => alert(String(error)))}>{tr('Локальное сравнение', 'Compare locally')}</button>
      <button disabled={review.job?.status === 'running' || selectedUrls.length !== 2} className="border rounded p-2 disabled:opacity-50" onClick={() => void review.start(true, { includeSaved: true, deepUrls: selectedUrls }).catch((error) => alert(String(error)))}>{tr('Углубить выбранную пару', 'Deep review selected pair')} ({selectedUrls.length}/2)</button>
    </div>
    {preview && <>
      <p role="status">AI: {preview.aiTabCount}/{preview.tabs.length - (preview.excludedChats ?? 0)} · {tr('Групп', 'Groups')}: {preview.similarGroups.length} · {tr('Неактуально', 'Outdated')}: {preview.outdatedTabs.length}</p>
      {preview.warning && <p role="alert" className="text-amber-800">{preview.warning}</p>}
      {preview.tabs.length > 600 && <p className="text-amber-800">{tr('AI охватил первые 600 страниц. Для остальных выберите пару или область проверки.', 'AI covers the first 600 pages. Choose a pair or scope to review the rest.')}</p>}
      {preview.similarGroups.map((group) => <article key={group.id} className="border rounded p-2 space-y-2">
        <h5 className="font-medium">{group.relation === 'related' ? tr('Дополняют друг друга — оставить', 'Complementary — retain') : tr('Возможный повтор информации', 'Possible information redundancy')}</h5>
        <p>{group.reason}</p>{group.uniqueValue && <p className="text-green-800">{group.uniqueValue}</p>}
        {group.tabIds.map((id) => { const tab = preview.tabs.find((page) => page.id === id); const source = preview.savedSources?.[id]; const evidence = preview.evidence?.[id]; return tab ? <div key={id} className="border-t pt-1 break-words">
          <p>{tab.title} · {source ? source.collectionName : tr('Открытая вкладка', 'Open tab')}</p><p className="text-gray-500 break-all">{tab.url}</p>
          {evidence ? <details><summary>{tr('Доказательства', 'Evidence')} · {new Date(evidence.capturedAt).toLocaleString()} · {evidence.cached ? tr('сохранённый фрагмент', 'cached excerpt') : tr('прочитано сейчас', 'read now')}</summary><blockquote className="whitespace-pre-wrap">{evidence.text}</blockquote></details> : <p className="text-amber-800">{tr('Только заголовок и URL — текст не проверен', 'Title and URL only — page text unverified')}</p>}
        </div> : null; })}
      </article>)}
      {preview.outdatedTabs.map((item) => <article key={item.tabId} className="border rounded p-2 space-y-1"><p className="font-medium">{preview.tabs.find((tab) => tab.id === item.tabId)?.title}</p><p>{item.reason}</p><blockquote>{item.evidence}</blockquote><p className="text-gray-500">{tr('Проверено по предоставленным страницам; поиск актуальной замены в интернете не выполнялся.', 'Grounded in supplied pages; no external search for a current replacement was performed.')}</p></article>)}
      <p className="text-gray-500">{tr('Сравнение библиотеки не удаляет сохранённые материалы. Для закрытия открытых страниц используйте просмотр сохранения коллекции или Оптимизацию.', 'Library review never deletes saved material. Use collection save previews or Optimize to close open pages.')}</p>
    </>}
  </section>;
}
