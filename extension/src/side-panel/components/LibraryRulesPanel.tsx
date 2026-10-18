import { useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { WorkspaceData } from '@shared/types/workspace';
import { workspaceMessage } from '../workspace-api';

export function LibraryRulesPanel({ workspace, busy, run }: { workspace: WorkspaceData | null; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [hostname, setHostname] = useState('');
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<'suggest' | 'save'>('suggest');
  const collections = workspace?.collections.filter((collection) => !collection.deletedAt) ?? [];
  const rules = workspace?.urlRules ?? [];
  return <details className="border rounded p-2 space-y-2 text-xs"><summary className="font-semibold">{tr('Предотвращение повторов и правила сохранения', 'Duplicate prevention and save rules')}</summary>
    <p>{tr('На вкладке Tabs появится подсказка для активной страницы: уже открыта, сохранена или подходит коллекции. Правила работают по точному домену, первое совпадение побеждает. Автосохранение добавляет ссылку один раз и не закрывает страницу; чаты и приватные окна исключены.', 'Tabs shows a hint for the active page: already open, saved or matching a collection. Rules use an exact hostname, first match wins. Auto-save adds a link once and never closes it; chats and private windows are excluded.')}</p>
    <input value={hostname} onChange={(event) => setHostname(event.target.value)} aria-label={tr('Домен правила', 'Rule hostname')} placeholder="example.com" className="block w-full border rounded p-2" />
    <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label={tr('Коллекция правила', 'Rule collection')} className="block w-full border rounded p-2"><option value="">{tr('Выберите коллекцию', 'Choose collection')}</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>
    <select value={mode} onChange={(event) => setMode(event.target.value as 'suggest' | 'save')} aria-label={tr('Действие правила', 'Rule action')} className="block w-full border rounded p-2"><option value="suggest">{tr('Предлагать сохранение', 'Suggest saving')}</option><option value="save">{tr('Автоматически сохранять ссылку, не закрывать', 'Automatically save link, keep open')}</option></select>
    <button disabled={busy || !hostname.trim() || !target || rules.length >= 50} className="border rounded p-2 disabled:opacity-50" onClick={() => void run(async () => { await workspaceMessage({ type: 'SAVE_URL_RULES', rules: [...rules, { id: crypto.randomUUID(), hostname: hostname.trim().toLowerCase(), collectionId: target, mode }] }); setHostname(''); })}>{tr('Добавить правило', 'Add rule')}</button>
    {rules.map((rule) => <div key={rule.id} className="flex gap-2 items-center border-t py-2"><span className="flex-1 break-all">{rule.hostname} → {collections.find((collection) => collection.id === rule.collectionId)?.name ?? tr('коллекция недоступна', 'collection unavailable')} · {rule.mode}</span><button disabled={busy} className="border rounded p-1" onClick={() => void run(async () => { await workspaceMessage({ type: 'SAVE_URL_RULES', rules: rules.filter((entry) => entry.id !== rule.id && collections.some((collection) => collection.id === entry.collectionId)) }); })}>{tr('Удалить правило', 'Remove rule')}</button></div>)}
    <p>{tr('Контекстное меню страницы → AITab: save page to Inbox. Сочетание клавиш задаётся в chrome://extensions/shortcuts. Эти действия сохраняют ссылку без закрытия.', 'Page context menu → AITab: save page to Inbox. Set a keyboard shortcut in chrome://extensions/shortcuts. Both save a link without closing the page.')}</p>
  </details>;
}
