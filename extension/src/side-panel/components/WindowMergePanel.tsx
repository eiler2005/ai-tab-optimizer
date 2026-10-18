import { useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { TabOperation, WindowMergePreview } from '@shared/types/workspace';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';

interface Props {
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onResult: (operation: TabOperation) => void;
}

export function WindowMergePanel({ busy, run, onResult }: Props) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const [target, setTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<WindowMergePreview | null>(null);
  const targetId = target ?? windows[0]?.windowId;

  return <section className="border-t pt-3 space-y-2">
    <h3 className="font-semibold text-xs">{tr('Объединить окна', 'Merge windows')}</h3>
    <p className="text-[10px] text-gray-500">{tr('Выберите целевое окно и вкладки для переноса. Закрепление и группы сохраняются; перенос можно отменить в истории.', 'Choose the target window and tabs to move. Pinning and groups are preserved; undo is available in history.')}</p>
    {windows.length < 2 ? <p className="text-xs text-gray-400">{tr('Для объединения нужно хотя бы два обычных окна.', 'Open at least two normal windows to merge.')}</p> : <>
      <label className="block text-xs">{tr('Целевое окно', 'Target window')}
        <select aria-label={tr('Целевое окно', 'Target window')} value={targetId} disabled={busy} onChange={(event) => {
          setTarget(Number(event.target.value)); setSelected(new Set()); setPreview(null);
        }} className="w-full border rounded p-1 mt-1">
          {windows.map((window, index) => <option value={window.windowId} key={window.windowId}>{tr('Окно', 'Window')} {index + 1} ({window.tabs.length})</option>)}
        </select>
      </label>
      {windows.filter((window) => window.windowId !== targetId).map((window) => <details key={window.windowId} className="border rounded p-2 text-xs">
        <summary className="flex gap-2 items-center">
          <input type="checkbox" aria-label={tr('Перенести окно', 'Move window') + ' ' + window.windowId} disabled={busy}
            checked={window.tabs.every((tab) => selected.has(tab.id))} onChange={(event) => {
              const checked = event.target.checked;
              setSelected((previous) => { const next = new Set(previous); for (const tab of window.tabs) { if (checked) next.add(tab.id); else next.delete(tab.id); } return next; }); setPreview(null);
            }} />
          {tr('Из окна', 'From window')} {windows.findIndex((item) => item.windowId === window.windowId) + 1} · {window.tabs.length}
        </summary>
        <div className="mt-2 space-y-1">{window.tabs.map((tab) => <label key={tab.id} className="flex gap-2 items-start">
          <input type="checkbox" disabled={busy} checked={selected.has(tab.id)} onChange={(event) => {
            const checked = event.target.checked;
            setSelected((previous) => { const next = new Set(previous); if (checked) next.add(tab.id); else next.delete(tab.id); return next; }); setPreview(null);
          }} /><span className="truncate">{tab.pinned ? '📌 ' : ''}{tab.groupName ? `[${tab.groupName}] ` : ''}{tab.title || tab.url}</span>
        </label>)}</div>
      </details>)}
      <button disabled={busy || !selected.size || targetId === undefined} onClick={() => void run(async () => {
        setPreview(await workspaceMessage<WindowMergePreview>({ type: 'PREVIEW_WINDOW_MERGE', targetWindowId: targetId!, tabIds: [...selected] }));
      })} className="px-3 py-2 bg-gray-100 rounded text-xs disabled:opacity-50">{tr('Просмотреть перенос', 'Preview move')} ({selected.size})</button>
      {preview && <div className="border border-blue-200 rounded p-2 space-y-2 text-xs">
        <p>{tr('Будет перенесено вкладок', 'Tabs to move')}: {preview.tabs.length} → {tr('окно', 'window')} {windows.findIndex((window) => window.windowId === preview.targetWindowId) + 1}.</p>
        <ul className="max-h-36 overflow-y-auto text-[10px] space-y-1">{preview.tabs.map((tab) => <li className="break-all" key={tab.id}>{tab.pinned ? '📌 ' : ''}{tab.groupName ? `[${tab.groupName}] ` : ''}{tab.url}</li>)}</ul>
        <button disabled={busy} onClick={() => void run(async () => {
          onResult(await workspaceMessage<TabOperation>({ type: 'EXECUTE_WINDOW_MERGE', previewId: preview.id }));
          setPreview(null); setSelected(new Set());
        })} className="px-3 py-2 bg-accent text-white rounded disabled:opacity-50">{tr('Перенести выбранные вкладки', 'Move selected tabs')}</button>
      </div>}
    </>}
  </section>;
}
