import { useI18n } from '@shared/i18n';
import type { TopicCatalog } from '@shared/types/topics';
import { useTopics } from '../topic-store';

export function TopicHistory({ catalog, busy, run }: { catalog?: TopicCatalog; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const { locale } = useI18n(); const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const labels: Record<string, string> = { create: tr('Создание темы', 'Create topic'), update: tr('Изменение темы', 'Edit topic'), merge: tr('Объединение тем', 'Merge topics'), split: tr('Разделение темы', 'Split topic'), link: tr('Связанные темы', 'Related topics'), different: tr('Разные темы', 'Distinct topics') };
  return <details className="border-t pt-2"><summary>{tr('История изменений тем', 'Topic change history')}</summary>{catalog?.history.slice().reverse().map((entry) => <div className="p-2 border-b space-y-1" key={entry.id}><p>{new Date(entry.createdAt).toLocaleString()} · {labels[entry.label] ?? tr('Изменение темы', 'Topic change')}</p><button disabled={busy || entry.undone} className="text-accent border rounded p-2" onClick={() => void run(() => useTopics.getState().command({ action: 'undo', historyId: entry.id }))}>{entry.undone ? tr('Отменено', 'Undone') : tr('Отменить изменение темы', 'Undo topic change')}</button></div>)}</details>;
}
