import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { PersistentCluster } from '@shared/types';
import type { CollectionPreview, TabOperation, WorkspaceData } from '@shared/types/workspace';
import { buildWorkspaceSuggestions } from '@shared/utils/workspace-suggestions';
import { tabProtectionReason } from '@shared/utils/rules';
import { isStatefulChat } from '@shared/utils/page-safety';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';

export function TopicsPanel({ workspace, busy, run, onResult, onFeedback }: { workspace: WorkspaceData | null; busy: boolean; run: (action: () => Promise<void>) => Promise<void>; onResult: (operation: TabOperation) => void; onFeedback: (text: string) => void }) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const aiResult = useStore((state) => state.aiResult);
  const [domains, setDomains] = useState<string[]>([]);
  useEffect(() => { void chrome.storage.local.get('settings').then((stored) => setDomains((stored.settings as { protectedDomains?: string[] } | undefined)?.protectedDomains ?? [])).catch(() => {}); }, []);
  const [clusters, setClusters] = useState<PersistentCluster[]>([]);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const tabs = windows.flatMap((window) => window.tabs);
  const topics = useMemo(() => {
    const result = (workspace?.collections ?? []).filter((collection) => !collection.deletedAt).map((collection) => ({ id: 'collection:' + collection.id, name: collection.name,
      urls: [...new Set(collection.windows.flatMap((window) => window.tabs.map((tab) => tab.url)))], source: tr('Коллекция', 'Collection'), reason: collection.reason ?? '' }));
    for (const window of windows) for (const tab of window.tabs) if (tab.groupId !== undefined && !result.some((item) => item.id === 'group:' + tab.groupId)) {
      result.push({ id: 'group:' + tab.groupId, name: tab.groupName || tr('Группа браузера', 'Browser group'), urls: window.tabs.filter((item) => item.groupId === tab.groupId).map((item) => item.url), source: tr('Группа браузера', 'Browser group'), reason: '' });
    }
    for (const [index, item] of buildWorkspaceSuggestions(aiResult?.topicClusters ?? [], windows.flatMap((window) => window.tabs)).entries()) result.push({ id: 'ai:' + index, name: item.name, urls: item.urls, source: 'AI', reason: item.reason });
    for (const cluster of clusters) result.push({ id: 'persistent:' + cluster.id, name: cluster.name, urls: cluster.tabUrls, source: tr('Сохранённый кластер', 'Persistent cluster'), reason: cluster.description });
    return result;
  }, [workspace, windows, aiResult, clusters, locale]);
  return <section className="space-y-3 text-xs">
    <h3 className="font-semibold">{tr('Темы и кластеры', 'Topics and clusters')}</h3>
    <p className="text-gray-600">{tr('Сверните тему в группы браузера или сохраните и закройте ненужные сейчас страницы. Отметьте рабочий минимум, который нужно оставить открытым. Сохранение не означает, что содержание устарело.', 'Collapse a topic into browser groups or save and close pages you do not need now. Select the working minimum to keep open. Saving does not mean the content is obsolete.')}</p>
    <button disabled={busy} className="border rounded p-2" onClick={() => void run(async () => setClusters(await workspaceMessage<PersistentCluster[]>({ type: 'GET_PERSISTENT_CLUSTERS' })))}>{tr('Загрузить мои сохранённые кластеры', 'Load my persistent clusters')}</button>
    {!topics.length && <p>{tr('Сохраните коллекцию, создайте группу или выполните AI-анализ для появления тем.', 'Save a collection, create a browser group or run AI analysis to see topics.')}</p>}
    {topics.map((topic) => {
      const urls = new Set(topic.urls);
      const members = tabs.filter((tab) => urls.has(tab.url));
      const eligible = members.filter((tab) => !keep.has(tab.id) && !isStatefulChat(tab.url) && !tabProtectionReason(tab, domains));
      return <details key={topic.id} className="border rounded p-2 space-y-2">
        <summary className="font-medium break-words">{topic.name} · {members.length} {tr('открыто', 'open')} · {topic.source}</summary>
        <p>{topic.reason}</p><p>{tr('Можно сохранить и закрыть', 'Can save and close')}: {eligible.length} · {tr('Останутся открыты', 'Retain open')}: {members.length - eligible.length}</p>
        <div className="space-y-2 max-h-56 overflow-auto">{members.map((tab) => <label key={tab.id} className="flex gap-2 items-start"><input type="checkbox" checked={keep.has(tab.id)} aria-label={tr('Оставить в работе', 'Keep working') + ' ' + tab.id} onChange={() => setKeep((current) => { const next = new Set(current); if (next.has(tab.id)) next.delete(tab.id); else next.add(tab.id); return next; })} /><span className="break-words">{tab.title || tab.url}{isStatefulChat(tab.url) || tabProtectionReason(tab, domains) ? ' · ' + tr('защищена от закрытия', 'protected from closing') : ''}</span></label>)}</div>
        <div className="flex gap-2 flex-wrap">
          <button disabled={busy || !members.some((tab) => !tab.pinned)} className="border rounded p-2 disabled:opacity-50" onClick={() => void run(async () => { await workspaceMessage({ type: 'COLLAPSE_TOPIC', tabIds: members.map((tab) => tab.id), name: topic.name.slice(0, 120), collapsed: true }); onFeedback(tr('Тема свёрнута. Количество вкладок не изменилось.', 'Topic collapsed. The number of tabs is unchanged.')); })}>{tr('Сгруппировать и свернуть', 'Group and collapse')}</button>
          <button disabled={busy || !eligible.length} className="border rounded p-2 disabled:opacity-50" onClick={() => void run(async () => setPreview(await workspaceMessage<CollectionPreview>({ type: 'PREVIEW_COLLECTION', name: topic.name.slice(0, 120), tabIds: eligible.map((tab) => tab.id) })))}>{tr('Просмотреть сохранение и закрытие', 'Preview save and close')}</button>
        </div>
      </details>;
    })}
    {preview && <section className="border border-blue-300 bg-blue-50 rounded p-3 space-y-2">
      <h4 className="font-medium">{preview.name} · {preview.windows.flatMap((window) => window.tabs).length} {tr('вкладок', 'tabs')}</h4>
      <p>{tr('Сначала сохраним новую коллекцию. Затем закроем только показанные страницы, если они не изменились и не защищены. Источники и Undo сохраняются.', 'Save a new collection first, then close only these pages if unchanged and unprotected. Sources and Undo are retained.')}</p>
      <ul className="max-h-40 overflow-auto">{preview.windows.flatMap((window) => window.tabs).map((tab) => <li key={tab.id} className="break-all">{tab.url}</li>)}</ul>
      <button disabled={busy} className="bg-red-600 text-white rounded p-2" onClick={() => void run(async () => {
        const result = await workspaceMessage<{ operation?: TabOperation }>({ type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: true, details: { purpose: 'later', reason: tr('Тематический набор убран из текущей работы', 'Topic set removed from current work') } });
        setPreview(null); if (result.operation) onResult(result.operation);
      })}>{tr('Сохранить и закрыть с Undo', 'Save and close with Undo')}</button>
      <button disabled={busy} className="border rounded p-2 ml-2" onClick={() => setPreview(null)}>{tr('Отмена', 'Cancel')}</button>
    </section>}
  </section>;
}
