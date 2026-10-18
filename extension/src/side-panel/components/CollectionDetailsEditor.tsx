import { useI18n } from '@shared/i18n';
import type { CollectionDetails, CollectionPurpose } from '@shared/types/workspace';

export function CollectionDetailsEditor({ value, onChange, disabled }: { value: CollectionDetails; onChange: (value: CollectionDetails) => void; disabled?: boolean }) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  return <div className="space-y-2 text-xs">
    <label className="block">{tr('Назначение', 'Purpose')}<select disabled={disabled} aria-label={tr('Назначение коллекции', 'Collection purpose')} className="block w-full border rounded p-2" value={value.purpose ?? 'reference'} onChange={(event) => onChange({ ...value, purpose: event.target.value as CollectionPurpose })}>
      <option value="now">{tr('Нужно сейчас', 'Working now')}</option><option value="later">{tr('Прочитать позже', 'Read later')}</option><option value="reference">{tr('Справочник', 'Reference')}</option>
    </select></label>
    <label className="block">{tr('Зачем сохранено', 'Why keep this')}<input disabled={disabled} maxLength={1000} className="block w-full border rounded p-2" value={value.reason ?? ''} onChange={(event) => onChange({ ...value, reason: event.target.value })} /></label>
    <label className="block">{tr('Текущая задача / критерий актуальности', 'Current task / relevance criteria')}<textarea disabled={disabled} maxLength={1000} className="block w-full border rounded p-2" value={value.focus ?? ''} onChange={(event) => onChange({ ...value, focus: event.target.value })} /></label>
    <label className="block">{tr('Пересмотреть после даты (не удалять автоматически)', 'Review after date (never deletes automatically)')}<input type="date" disabled={disabled} className="block w-full border rounded p-2" value={value.reviewAt ? new Date(value.reviewAt).toISOString().slice(0, 10) : ''} onChange={(event) => onChange({ ...value, reviewAt: event.target.value ? Date.parse(event.target.value + 'T12:00:00Z') : null })} /></label>
  </div>;
}
