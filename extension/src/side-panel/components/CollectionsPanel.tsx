import { useState } from 'react';
import { useI18n } from '@shared/i18n';
import type { CollectionMergePreview, CollectionPreview, SavedCollection, TabOperation, WorkspaceData } from '@shared/types/workspace';
import type { ImportPreview } from '../../background/workspace-backup';
import type { RestoreResult } from '../../background/session-actions';
import { useStore } from '../store';
import { workspaceMessage } from '../workspace-api';

interface Props {
  workspace: WorkspaceData | null;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onResult: (operation: TabOperation) => void;
  onFeedback: (message: string) => void;
}

export function CollectionsPanel({ workspace, busy, run, onResult, onFeedback }: Props) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const windows = useStore((state) => state.windowGroups);
  const selectedTabs = useStore((state) => state.selectedTabIds);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('all');
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState('');
  const [merge, setMerge] = useState<CollectionMergePreview | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const collections = workspace?.collections ?? [];

  async function save(closeAfter: boolean) {
    if (!preview) return;
    const result = await workspaceMessage<{ collection: SavedCollection; operation?: TabOperation }>({ type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter });
    setPreview(null); setName('');
    if (result.operation) onResult(result.operation);
    else onFeedback(tr('Коллекция сохранена.', 'Collection saved.'));
  }

  return <section className="space-y-4">
    <div className="space-y-2">
      <h3 className="font-semibold text-xs">{tr('Сохранить вкладки в коллекцию', 'Save tabs as a collection')}</h3>
      <input aria-label={tr('Название коллекции', 'Collection name')} maxLength={120} value={name} placeholder={tr('Название коллекции', 'Collection name')}
        onChange={(event) => { setName(event.target.value); setPreview(null); }} className="w-full border rounded p-2 text-xs" />
      <select aria-label={tr('Вкладки для сохранения', 'Tabs to save')} value={scope} onChange={(event) => { setScope(event.target.value); setPreview(null); }} className="w-full border rounded p-1 text-xs">
        <option value="all">{tr('Все обычные окна', 'All normal windows')}</option>
        <option value="selected" disabled={!selectedTabs.size}>{tr('Выделенные вкладки', 'Selected tabs')} ({selectedTabs.size})</option>
        {windows.map((window, index) => <option key={window.windowId} value={window.windowId}>{tr('Окно', 'Window')} {index + 1} ({window.tabs.length})</option>)}
      </select>
      <button disabled={busy || !name.trim()} onClick={() => void run(async () => {
        const ids = scope === 'all' ? undefined : scope === 'selected' ? [...selectedTabs] : windows.find((window) => window.windowId === Number(scope))?.tabs.map((tab) => tab.id) ?? [];
        setPreview(await workspaceMessage<CollectionPreview>({ type: 'PREVIEW_COLLECTION', name, tabIds: ids }));
      })} className="px-3 py-2 bg-gray-100 rounded text-xs disabled:opacity-50">{tr('Просмотреть сохранение', 'Preview save')}</button>
      {preview && <div className="border rounded p-2 space-y-2 text-xs">
        <p>{preview.name} · {preview.windows.reduce((sum, window) => sum + window.tabs.length, 0)} {tr('вкладок', 'tabs')}</p>
        <details><summary>{tr('Просмотреть URL', 'Review URLs')}</summary><ul className="max-h-40 overflow-y-auto text-[10px]">{preview.windows.flatMap((window) => window.tabs).map((tab) => <li key={tab.id} className="break-all">{tab.url}</li>)}</ul></details>
        <p className="text-gray-500">{tr('При сохранении с закрытием защищённые вкладки останутся открыты. Копия сохраняется до закрытия.', 'Save and close leaves protected tabs open. The saved copy is persisted before any close.')}</p>
        <div className="flex gap-2 flex-wrap">
          <button disabled={busy} onClick={() => void run(() => save(false))} className="px-3 py-2 bg-accent text-white rounded">{tr('Сохранить', 'Save')}</button>
          <button disabled={busy} onClick={() => void run(() => save(true))} className="px-3 py-2 bg-red-600 text-white rounded">{tr('Сохранить и закрыть', 'Save and close')}</button>
        </div>
      </div>}
    </div>
    <div className="space-y-2 border-t pt-3">
      <h3 className="font-semibold text-xs">{tr('Мои коллекции', 'My collections')}</h3>
      {collections.filter((collection) => !collection.deletedAt).map((collection) => <CollectionCard key={collection.id} collection={collection} busy={busy} run={run} onFeedback={onFeedback}
        selected={selected.has(collection.id)} onSelect={(checked) => { setSelected((previous) => { const next = new Set(previous); if (checked) next.add(collection.id); else next.delete(collection.id); return next; }); setMerge(null); }} />)}
      {!collections.some((collection) => !collection.deletedAt) && <p className="text-xs text-gray-400">{tr('Сохранённых коллекций пока нет.', 'No saved collections yet.')}</p>}
      {selected.size > 0 && <div className="border rounded p-2 space-y-2">
        <input aria-label={tr('Название объединённой коллекции', 'Merged collection name')} maxLength={120} value={mergeName} onChange={(event) => { setMergeName(event.target.value); setMerge(null); }} placeholder={tr('Название новой коллекции', 'New collection name')} className="w-full border rounded p-1 text-xs" />
        <button disabled={busy || !mergeName.trim()} onClick={() => void run(async () => setMerge(await workspaceMessage<CollectionMergePreview>({ type: 'PREVIEW_COLLECTION_MERGE', collectionIds: [...selected], name: mergeName })))} className="px-2 py-1 text-xs bg-gray-100 rounded disabled:opacity-50">{tr('Просмотреть объединение / удаление повторов', 'Preview merge / deduplication')}</button>
        {merge && <div className="space-y-2 text-xs">
          <p>{tr('До', 'Before')}: {merge.inputTabs}; {tr('повторов', 'duplicates')}: {merge.duplicatesRemoved}; {tr('после', 'after')}: {merge.inputTabs - merge.duplicatesRemoved}.</p>
          <p className="text-gray-500">{tr('Создастся новая коллекция. Исходные наборы сохранятся, заметки повторяющихся страниц объединятся.', 'Creates a new collection. Sources are retained and duplicate page notes are combined.')}</p>
          <details><summary>{tr('Просмотреть результат', 'Review result')}</summary><ul className="max-h-40 overflow-y-auto text-[10px]">{merge.windows.flatMap((window) => window.tabs).map((tab) => <li key={tab.itemId} className="break-all">{tab.url}{tab.note ? ' · ' + tr('есть заметки', 'has notes') : ''}</li>)}</ul></details>
          <button disabled={busy} onClick={() => void run(async () => {
            await workspaceMessage({ type: 'MERGE_COLLECTIONS', previewId: merge.id }); setMerge(null); setSelected(new Set()); setMergeName(''); onFeedback(tr('Объединённая коллекция создана.', 'Merged collection created.'));
          })} className="px-3 py-2 bg-accent text-white rounded">{tr('Создать коллекцию без повторов', 'Create deduplicated collection')}</button>
        </div>}
      </div>}
    </div>
    {collections.some((collection) => collection.deletedAt) && <details className="border-t pt-3">
      <summary className="text-xs font-semibold">{tr('Корзина', 'Trash')}</summary>
      <div className="mt-2 space-y-2">{collections.filter((collection) => collection.deletedAt).map((collection) => <div key={collection.id} className="border rounded p-2 text-xs space-y-2">
        <p>{collection.name}</p><div className="flex gap-2">
          <button disabled={busy} onClick={() => void run(async () => { await workspaceMessage({ type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { deleted: false } }); })} className="p-1 bg-gray-100 rounded">{tr('Восстановить', 'Restore')}</button>
          <button disabled={busy} onClick={() => {
            if (confirm(tr('Удалить коллекцию навсегда? Для восстановления потребуется JSON-бэкап.', 'Permanently delete this collection? Recovery will require a JSON backup.'))) void run(async () => { await workspaceMessage({ type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { permanent: true } }); });
          }} className="p-1 text-red-700">{tr('Удалить навсегда', 'Delete permanently')}</button>
        </div>
      </div>)}</div>
    </details>}
    <section className="space-y-2 border-t pt-3">
      <h3 className="font-semibold text-xs">{tr('Бэкап и перенос данных', 'Backup and migration')}</h3>
      <p className="text-[10px] text-gray-500">{tr('JSON содержит коллекции, историю операций и локальные буферы. Базу Python SQLite сохраняйте отдельно. Токены и разрешения на папку Obsidian в файл не входят.', 'JSON contains collections, operation history and local buffers. Back up the Python SQLite database separately. Tokens and Obsidian folder permissions are excluded.')}</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const json = await workspaceMessage<string>({ type: 'EXPORT_WORKSPACE_BACKUP' });
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `aitab-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })} className="px-2 py-1 text-xs bg-gray-100 rounded">{tr('Скачать JSON-бэкап', 'Download JSON backup')}</button>
      <label className="block text-xs">{tr('Импортировать бэкап', 'Import backup')}
        <input aria-label={tr('Импортировать бэкап', 'Import backup')} type="file" accept=".json,application/json" disabled={busy} className="block mt-1 w-full text-xs" onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void run(async () => { if (file.size > 8_000_000) throw new Error('Backup exceeds 8 MB'); setImportPreview(await workspaceMessage<ImportPreview>({ type: 'PREVIEW_BACKUP_IMPORT', json: await file.text() })); });
        }} />
      </label>
      {importPreview && <div className="border rounded p-2 space-y-2 text-xs">
        <p>{tr('Коллекций', 'Collections')}: {importPreview.collections.length}; {tr('операций', 'operations')}: {importPreview.operations.length}; {tr('пропущено некорректных записей', 'invalid entries skipped')}: {importPreview.skipped}.</p>
        <ul>{importPreview.collections.map((collection) => <li key={collection.id}>{collection.name}</li>)}</ul>
        <p className="text-gray-500">{tr('Данные добавятся к существующим. Вкладки не откроются автоматически.', 'Data is appended to existing data. No tabs open automatically.')}</p>
        <button disabled={busy} onClick={() => void run(async () => {
          const result = await workspaceMessage<{ imported: number; skipped: number }>({ type: 'IMPORT_WORKSPACE_BACKUP', previewId: importPreview.id });
          setImportPreview(null); onFeedback(`${tr('Импортировано коллекций', 'Imported collections')}: ${result.imported}; ${tr('пропущено', 'skipped')}: ${result.skipped}`);
        })} className="px-3 py-2 bg-accent text-white rounded">{tr('Добавить проверенные данные', 'Append validated data')}</button>
      </div>}
    </section>
  </section>;
}

function CollectionCard({ collection, busy, run, onFeedback, selected, onSelect }: {
  collection: SavedCollection; busy: boolean; run: Props['run']; onFeedback: Props['onFeedback']; selected: boolean; onSelect: (checked: boolean) => void;
}) {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [name, setName] = useState(collection.name);
  return <details className="border rounded p-2 space-y-2 text-xs">
    <summary className="flex gap-2 items-start"><input type="checkbox" checked={selected} disabled={busy} aria-label={tr('Выбрать коллекцию', 'Select collection') + ' ' + collection.name} onChange={(event) => onSelect(event.target.checked)} /><span className="flex-1 break-words">{collection.name} · {collection.windows.reduce((sum, window) => sum + window.tabs.length, 0)}</span></summary>
    <div className="space-y-2 mt-2">
      <div className="flex gap-1"><input aria-label={tr('Переименовать коллекцию', 'Rename collection')} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="border rounded p-1 min-w-0 flex-1" />
        <button disabled={busy || name === collection.name || !name.trim()} onClick={() => void run(async () => { await workspaceMessage({ type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { name } }); })} className="px-2 bg-gray-100 rounded disabled:opacity-50">{tr('Сохранить имя', 'Save name')}</button></div>
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={() => void run(async () => {
          const result = await workspaceMessage<RestoreResult>({ type: 'OPEN_COLLECTION', collectionId: collection.id });
          onFeedback(`${tr('Открыто', 'Opened')}: ${result.restoredTabIds.length}; ${tr('уже открыто', 'already open')}: ${result.skippedUrls.length}; ${tr('ошибок', 'failed')}: ${result.failedUrls.length + result.errors.length}`);
        })} className="px-2 py-1 bg-accent text-white rounded">{tr('Открыть отсутствующие', 'Open missing tabs')}</button>
        <button disabled={busy} onClick={() => void run(async () => { await workspaceMessage({ type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { deleted: true } }); })} className="px-2 py-1 text-red-700">{tr('В корзину', 'Move to trash')}</button>
      </div>
      {collection.windows.map((window, index) => <div key={window.id} className="space-y-1">
        <p className="font-medium">{tr('Окно', 'Window')} {index + 1}</p>
        {window.tabs.map((tab) => <div key={tab.itemId} className="border-t py-1 space-y-1"><p className="break-all">{tab.pinned ? '📌 ' : ''}{tab.groupName ? `[${tab.groupName}] ` : ''}{tab.title || tab.url}</p><p className="break-all text-[10px] text-gray-500">{tab.url}</p>
          <NoteEditor value={tab.note ?? ''} busy={busy} onSave={(note) => run(async () => { await workspaceMessage({ type: 'UPDATE_COLLECTION', collectionId: collection.id, change: { itemId: tab.itemId, note } }); onFeedback(tr('Заметка сохранена.', 'Note saved.')); })} />
        </div>)}
      </div>)}
    </div>
  </details>;
}

function NoteEditor({ value, busy, onSave }: { value: string; busy: boolean; onSave: (note: string) => Promise<void> }) {
  const { locale } = useI18n();
  const [note, setNote] = useState(value);
  return <details><summary className="text-[10px] text-gray-500">{locale === 'ru' ? 'Заметка' : 'Note'}{value ? ' ✓' : ''}</summary>
    <textarea maxLength={20_000} aria-label={locale === 'ru' ? 'Текст заметки' : 'Note text'} value={note} onChange={(event) => setNote(event.target.value)} className="w-full border rounded p-1 mt-1" />
    <button disabled={busy || note === value} onClick={() => void onSave(note)} className="text-[10px] px-2 py-1 bg-gray-100 rounded disabled:opacity-50">{locale === 'ru' ? 'Сохранить заметку' : 'Save note'}</button>
  </details>;
}
