import { create } from 'zustand';
import type { TopicCatalog, TopicCommand } from '@shared/types/topics';
import type { TopicAdviceJob } from '@shared/types/topic-review';
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
  pairJob: TopicAdviceJob | null;
  startPairReview: (ids: string[], readEvidence: boolean) => Promise<void>;
  loadPairReview: () => Promise<void>;
  cancelPairReview: () => Promise<void>;
  refresh: (server?: boolean) => Promise<void>;
  command: (command: TopicCommand) => Promise<void>;
}
let pending: Promise<void> | undefined;
export const useTopics = create<TopicState>((set, get) => ({
  catalog: emptyTopicCatalog(), sessionId: '', loading: false, error: null, activeId: null, query: '', matchedIds: null, filter: 'all', scrollTop: 0,
  pairJob: null,
  startPairReview: async (topicIds, readEvidence) => { set({ pairJob: await workspaceMessage<TopicAdviceJob>({ type: 'START_TOPIC_PAIR_REVIEW', topicIds, readEvidence }) }); },
  loadPairReview: async () => {
    const next = await workspaceMessage<TopicAdviceJob | null>({ type: 'GET_TOPIC_PAIR_REVIEW' });
    const current = get().pairJob;
    if (next && (!current || next.startedAt > current.startedAt || next.id === current.id && (next.updatedAt > current.updatedAt || next.status !== current.status))) set({ pairJob: next });
  },
  cancelPairReview: async () => { if (get().pairJob) set({ pairJob: await workspaceMessage<TopicAdviceJob | null>({ type: 'CANCEL_TOPIC_PAIR_REVIEW', jobId: get().pairJob!.id }) }); },
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
