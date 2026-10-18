import type { WorkspaceData } from '@shared/types/workspace';

export const WORKSPACE_KEY = 'aitab.workspace.v1';
export const PREVIEW_KEY = 'aitab.duplicate-preview.v1';
let queue: Promise<unknown> = Promise.resolve();

export function withWorkspaceLock<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action, action);
  queue = result.catch(() => {});
  return result;
}

export async function readWorkspace(): Promise<WorkspaceData> {
  const stored = await chrome.storage.local.get(WORKSPACE_KEY);
  const data = stored[WORKSPACE_KEY] as WorkspaceData | undefined;
  if (!data) return { version: 1, revision: 0, operations: [], collections: [] };
  if (data.version !== 1 || !Array.isArray(data.operations) || !Array.isArray(data.collections)) {
    throw new Error('Unsupported workspace data. Export a backup before migrating.');
  }
  return data;
}

export async function saveWorkspace(data: WorkspaceData): Promise<void> {
  const active = data.operations.filter((operation) => ['running', 'interrupted', 'undoing'].includes(operation.status));
  const recent = data.operations.filter((operation) => !active.includes(operation)).slice(-50);
  data.operations = [...active, ...recent].sort((a, b) => a.createdAt - b.createdAt);
  if (new TextEncoder().encode(JSON.stringify(data)).length > 7_000_000) {
    throw new Error('Workspace is too large. Export and remove old collections before continuing.');
  }
  data.revision += 1;
  await chrome.storage.local.set({ [WORKSPACE_KEY]: data });
}

export async function browserSessionId(): Promise<string> {
  const stored = await chrome.storage.session.get('aitab.browser-session');
  if (typeof stored['aitab.browser-session'] === 'string') return stored['aitab.browser-session'];
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ 'aitab.browser-session': id });
  return id;
}
