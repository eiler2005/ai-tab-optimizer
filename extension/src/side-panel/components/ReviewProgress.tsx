import { useEffect, useState } from 'react';
import { useI18n } from '@shared/i18n';
import { useWorkspaceReview } from '../review-controller';

export function ReviewProgress() {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const { job, cancel, error } = useWorkspaceReview();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (error) return <p role="alert" className="text-xs text-red-700">{error}</p>;
  if (!job) return null;
  const elapsed = Math.max(0, Math.floor(((job.status === 'running' ? now : job.updatedAt) - job.startedAt) / 1000));
  const labels = { capture: tr('Сбор вкладок', 'Collecting tabs'), extract: tr('Чтение фрагментов', 'Reading excerpts'), compare: tr('Локальное сравнение', 'Local comparison'), ai: tr('AI сравнивает содержание', 'AI is comparing content'), complete: tr('Проверка завершена', 'Review complete') };
  const phaseElapsed = Math.max(0, (now - job.phaseStartedAt) / 1000);
  const eta = job.phase === 'extract' && job.processed > 0 ? Math.ceil(phaseElapsed / job.processed * (job.total - job.processed)) : null;
  return <aside aria-label={tr('Прогресс проверки', 'Review progress')} className="bg-blue-50 border border-blue-100 rounded p-2 text-xs space-y-1" data-testid="review-progress">
    <div className="flex items-center gap-2 justify-between"><strong>{job.status === 'running' || job.status === 'completed' ? labels[job.phase] : job.status === 'cancelled' ? tr('Проверка отменена', 'Review cancelled') : tr('Проверка прервана', 'Review interrupted')}</strong><span>{elapsed} {tr('с', 's')}</span></div>
    {job.status === 'running' && <>
      {job.phase === 'extract' ? <><progress aria-label={tr('Обработано фрагментов', 'Excerpts processed')} value={job.processed} max={Math.max(1, job.total)} className="w-full" /><p>{job.processed} / {job.total}{eta !== null ? ` · ${tr('до этапа AI примерно', 'estimated before AI')} ${eta} ${tr('с', 's')}` : ''}</p></> : <progress aria-label={labels[job.phase]} className="w-full" />}
      {job.phase === 'ai' && <p>{tr('Вкладок отправлено', 'Tabs sent')}: {job.total}. {tr('Ждём ответ, точный процент неизвестен. Лимит ожидания — 100 с.', 'Waiting for a response; exact percentage is unavailable. Wait limit: 100 s.')}</p>}
      <button onClick={() => void cancel().catch((failure) => console.error(failure))} className="border rounded bg-white px-2 py-1">{tr('Отменить проверку', 'Cancel review')}</button>
    </>}
    {job.error && <p role="alert">{job.error}</p>}
    {job.status === 'completed' && !job.preview && <p>{tr('Предпросмотр истёк. Запустите новую проверку.', 'Preview expired. Start a new review.')}</p>}
  </aside>;
}
