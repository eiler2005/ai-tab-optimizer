import { useI18n } from '@shared/i18n';
import type { ContentReviewPreview } from '@shared/types/content-review';

export function ReviewCoverage({ preview }: { preview: ContentReviewPreview }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const excerpts = new Set(preview.excerptTabIds ?? []);
  const withText = preview.aiReviewedTabIds ? preview.aiReviewedTabIds.filter((id) => excerpts.has(id)).length : Math.min(excerpts.size, preview.aiTabCount);
  const local = preview.similarGroups.filter((group) => group.source !== 'ai').length;
  return <aside data-testid="review-coverage" className="rounded border p-3 space-y-1 bg-gray-50">
    <h4 className="font-semibold">{tr('Охват и ограничения', 'Coverage and limitations')}</h4>
    <p>AI: {preview.aiTabCount} / {preview.reviewEligibleCount ?? preview.tabs.length} · {tr('С текстом', 'With text')}: {withText} · {tr('Только заголовок и URL', 'Title and URL only')}: {Math.max(0, preview.aiTabCount - withText)}</p>
    {preview.aiBatchCount !== undefined && <p>{tr('Порций AI успешно', 'AI batches completed')}: {preview.aiCompletedBatches ?? 0} / {preview.aiBatchCount} · {tr('Ошибок', 'Failed')}: {preview.aiFailedBatches ?? 0}</p>}
    <p>{tr('Локальных кандидатов без подтверждения AI', 'Local candidates without AI confirmation')}: {local}</p>
    {preview.sleepingWithoutText ? <p>{tr('Спящих страниц без текста', 'Sleeping pages without text')}: {preview.sleepingWithoutText}. {tr('Они не открывались ради анализа.', 'They were not opened for analysis.')}</p> : null}
    <p className="text-gray-600">{tr('AI сравнивает небольшие группы с близкими соседями. Это не проверка всех возможных пар и не чтение полных страниц. Мало результатов не доказывает отсутствие повторов или неактуальности.', 'AI compares small groups with related neighbors. This is not exhaustive all-pairs comparison or full-page reading. Few results do not prove there is no overlap or outdated material.')}</p>
  </aside>;
}
