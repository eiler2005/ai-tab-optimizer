import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceData } from '@shared/types/workspace';
import { useTopics } from './topic-store';
import { useStore } from './store';
import { indexLibrary } from './library-index';

export function useLibraryPages() {
  const windows = useStore((state) => state.windowGroups);
  const { catalog, sessionId } = useTopics();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  useEffect(() => {
    let disposed = false;
    void chrome.storage.local.get('aitab.workspace.v1').then((stored) => { if (!disposed) setWorkspace(stored['aitab.workspace.v1'] as WorkspaceData ?? null); });
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && changes['aitab.workspace.v1']) setWorkspace(changes['aitab.workspace.v1'].newValue as WorkspaceData ?? null); };
    chrome.storage.onChanged.addListener(changed);
    return () => { disposed = true; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  return useMemo(() => indexLibrary(windows, workspace?.collections ?? [], catalog, sessionId), [windows, workspace, catalog, sessionId]);
}
