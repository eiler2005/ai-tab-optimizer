import { useEffect, useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { WorkspaceData } from '@shared/types/workspace';
import { isStatefulChat } from '@shared/utils/page-safety';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';

export function LibraryHintBanner() {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [dismissed, setDismissed] = useState('');
  useEffect(() => {
    let disposed = false;
    const load = () => { void workspaceMessage<WorkspaceData>({ type: 'WORKSPACE_OVERVIEW' }).then((data) => { if (!disposed) setWorkspace(data); }).catch(() => {}); };
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => { if (changes['aitab.workspace.v1']) load(); };
    load(); chrome.storage.onChanged.addListener(changed);
    return () => { disposed = true; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  const tab = (windows.find((window) => window.focused) ?? windows[0])?.tabs.find((page) => page.active);
  if (!tab || isStatefulChat(tab.url) || !/^https?:\/\//i.test(tab.url) || tab.url === dismissed) return null;
  const others = windows.flatMap((window) => window.tabs).filter((page) => page.id !== tab.id && page.url === tab.url);
  const collections = workspace?.collections.filter((collection) => !collection.deletedAt) ?? [];
  const saved = collections.filter((collection) => collection.windows.some((window) => window.tabs.some((page) => page.url === tab.url)));
  const rule = workspace?.urlRules?.find((entry) => entry.hostname === new URL(tab.url).hostname && collections.some((collection) => collection.id === entry.collectionId));
  if (!others.length && !saved.length && !rule) return null;
  const target = rule ? collections.find((collection) => collection.id === rule.collectionId) : undefined;
  const action = async () => {
    if (others[0]) await workspaceMessage({ type: 'FOCUS_TAB', tabId: others[0].id });
    else if (target && !saved.some((collection) => collection.id === target.id)) await workspaceMessage({ type: 'SAVE_PAGE_TO_COLLECTION', tabId: tab.id, collectionId: target.id });
  };
  return <aside className="flex-none bg-blue-50 border-b p-2 text-xs space-y-1">
    <p>{others.length ? tr('Эта страница уже открыта', 'This page is already open') + ` (${others.length})` : ''}{saved.length ? ' · ' + tr('Сохранена', 'Saved') + ': ' + saved.map((collection) => collection.name).join(', ') : ''}{target ? ' · ' + tr('Подходит коллекция', 'Suggested collection') + ': ' + target.name : ''}</p>
    <div className="flex gap-2">{(others.length > 0 || (target && !saved.some((collection) => collection.id === target.id))) && <button className="border rounded p-1" onClick={() => void action().catch((failure) => useStore.getState().setActionError(String(failure)))}>{others.length ? tr('Перейти к существующей', 'Focus existing tab') : tr('Сохранить в коллекцию', 'Save to collection')}</button>}<button className="border rounded p-1" onClick={() => setDismissed(tab.url)}>{tr('Скрыть', 'Dismiss')}</button></div>
  </aside>;
}
