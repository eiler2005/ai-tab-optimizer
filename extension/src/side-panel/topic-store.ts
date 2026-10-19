import { create } from 'zustand';
import type { TopicCatalog, TopicCommand } from '@shared/types/topics';
import { emptyTopicCatalog } from '@shared/utils/topics';
import { workspaceMessage } from './workspace-api';

interface TopicState {
  catalog: TopicCatalog;
  sessionId: string;
  loading: boolean;
  error: string | null;
  activeId: string | null;
  query: string;
  matchedIds: string[] | null;
  filter: 'all' | 'working' | 'proposals' | 'unassigned';
  scrollTop: number;
  refresh: (server?: boolean) => Promise<void>;
  command: (command: TopicCommand) => Promise<void>;
}
let pending: Promise<void> | undefined;
export const useTopics = create<TopicState>((set, get) => ({
  catalog: emptyTopicCatalog(), sessionId: '', loading: false, error: null, activeId: null, query: '', matchedIds: null, filter: 'all', scrollTop: 0,
  refresh: async (server = false) => {
    if (!server && pending) return pending;
    const run = async () => {
      set({ loading: true });
      try {
        const next = await workspaceMessage<{ catalog: TopicCatalog; sessionId: string }>({ type: 'GET_TOPIC_CATALOG', refreshServer: server });
        if (next.catalog.revision >= get().catalog.revision) set({ catalog: next.catalog, sessionId: next.sessionId, error: null });
      } catch (error) { set({ error: String(error) }); }
      finally { set({ loading: false }); }
    };
    if (server) return run();
    pending = run(); try { await pending; } finally { pending = undefined; }
  },
  command: async (command) => {
    const catalog = await workspaceMessage<TopicCatalog>({ type: 'TOPIC_COMMAND', command });
    set({ catalog, error: null });
  },
}));
