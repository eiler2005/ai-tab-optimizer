import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { GlobalSearch } from './components/GlobalSearch';
import { Header } from './components/Header';
import { StatsBar } from './components/StatsBar';
import { TabList } from './components/TabList';
import { BulkActions } from './components/BulkActions';
import { SnapshotsList } from './components/SnapshotsList';
import { SnapshotDetail } from './components/SnapshotDetail';
import { SettingsView } from './components/SettingsView';
import { HistoryPanel } from './components/HistoryPanel';
import { ReportsPanel } from './components/ReportsPanel';
import { TaskCenter } from './components/TaskCenter';
import { ReviewContext, useReviewController } from './review-controller';
import { ChatSearch } from './components/ChatSearch';
import { WorkspaceView } from './components/WorkspaceView';
import { LibraryHintBanner } from './components/LibraryHintBanner';

export function App() {
  const review = useReviewController();
  const reviewScope = useStore((state) => state.reviewScope);
  const lastScope = useRef<string | null>(null);
  useEffect(() => { if (lastScope.current === (reviewScope?.id ?? null)) return; lastScope.current = reviewScope?.id ?? null; review.setOptions({ ...review.options, windowId: reviewScope?.windowId, tabIds: reviewScope?.tabIds, expectedUrls: reviewScope?.expectedUrls, scopeLabel: reviewScope?.scopeLabel, focus: reviewScope?.focus ?? review.options.focus }); }, [reviewScope?.id]);
  const actionError = useStore((state) => state.actionError);
  const { view, loadTabs, loadSnapshots, loadRecentlyClosed, loadHistory, loadAIResult, loadAITabStatuses, setAIResult, setAIPartialResult, setAIError, setAIProgress, setAIStopped, setAITabStatuses } = useStore();

  useEffect(() => {
    loadTabs();
    loadSnapshots();
    loadRecentlyClosed();
    void chrome.storage.local.get('aitab.tab-scope').then((stored) => { if (stored['aitab.tab-scope'] === 'all' || stored['aitab.tab-scope'] === 'current') useStore.setState({ tabScope: stored['aitab.tab-scope'] }); });
    const aiTimer = window.setTimeout(() => {
      void loadAIResult();
      void loadAITabStatuses();
    }, 2000);
    const keepalivePort = chrome.runtime.connect({ name: 'sidepanel-keepalive' });
    const keepaliveTimer = window.setInterval(() => {
      try {
        keepalivePort.postMessage({ type: 'PING', timestamp: Date.now() });
      } catch {
        // Port may close during extension reloads.
      }
    }, 20_000);

    let tabsTimer: number | undefined;
    let historyUpdateTimer: number | undefined;
    const listener = (message: Record<string, unknown>) => {
      if (message.type === 'TABS_UPDATED') {
        window.clearTimeout(tabsTimer);
        tabsTimer = window.setTimeout(() => void loadTabs(), 150);
      } else if (message.type === 'SNAPSHOT_CREATED') {
        loadSnapshots();
      } else if (message.type === 'AI_ANALYSIS_COMPLETE' && message.result) {
        setAIResult(
          message.result as Parameters<typeof setAIResult>[0],
          message.metadata as Parameters<typeof setAIResult>[1],
          message.fromCache as boolean | undefined,
        );
        if (message.tabStatuses) {
          setAITabStatuses(
            message.tabStatuses as Parameters<typeof setAITabStatuses>[0],
            message.statusSummary as Parameters<typeof setAITabStatuses>[1],
          );
        }
      } else if (message.type === 'AI_ANALYSIS_PARTIAL' && message.result && message.progress) {
        setAIPartialResult(
          message.result as Parameters<typeof setAIPartialResult>[0],
          message.progress as Parameters<typeof setAIPartialResult>[1],
          message.metadata as Parameters<typeof setAIPartialResult>[2],
        );
        if (message.tabStatuses) {
          setAITabStatuses(
            message.tabStatuses as Parameters<typeof setAITabStatuses>[0],
            message.statusSummary as Parameters<typeof setAITabStatuses>[1],
          );
        }
      } else if (message.type === 'AI_ANALYSIS_ERROR' && message.error) {
        setAIError(message.error as string);
      } else if (message.type === 'AI_ANALYSIS_CANCELED') {
        setAIStopped(
          message.result as Parameters<typeof setAIStopped>[0],
          message.metadata as Parameters<typeof setAIStopped>[1],
          message.progress as Parameters<typeof setAIStopped>[2],
          message.resumable as boolean | undefined,
          message.runId as string | undefined,
        );
        if (message.tabStatuses) {
          setAITabStatuses(
            message.tabStatuses as Parameters<typeof setAITabStatuses>[0],
            message.statusSummary as Parameters<typeof setAITabStatuses>[1],
          );
        }
      } else if (message.type === 'AI_ANALYSIS_PROGRESS' && message.progress) {
        setAIProgress(message.progress as Parameters<typeof setAIProgress>[0]);
      } else if (message.type === 'HISTORY_UPDATED') {
        window.clearTimeout(historyUpdateTimer);
        historyUpdateTimer = window.setTimeout(() => void useStore.getState().loadHistory(), 200);
      } else if (message.type === 'TAB_OPERATION_COMPLETE' && Array.isArray(message.errors) && message.errors.length) {
        useStore.getState().setActionError(message.errors.join('; '));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      window.clearTimeout(aiTimer);
      window.clearInterval(keepaliveTimer);
      window.clearTimeout(tabsTimer);
      window.clearTimeout(historyUpdateTimer);
      keepalivePort.disconnect();
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [loadTabs, loadSnapshots, loadHistory]);

  return (
    <ReviewContext.Provider value={review}><div className="flex flex-col h-screen min-w-0">
      <Header />
      <TaskCenter />
      <GlobalSearch />
      <div className={(['workspace', 'topics', 'library'].includes(view) || view === 'tabs' && useStore.getState().searchScope !== 'open') ? 'flex flex-1 min-h-0 flex-col' : 'hidden'}><WorkspaceView /></div>
      {actionError && <div role="alert" className="p-3 text-xs bg-red-50 text-red-700 flex gap-2">
        <span className="flex-1">{actionError}</span>
        <button aria-label="Dismiss" onClick={() => useStore.getState().setActionError(null)}>✕</button>
      </div>}
      {view === 'tabs' && useStore.getState().searchScope === 'open' && (
        <>
          <StatsBar />
          <LibraryHintBanner />
          <TabList />
          <BulkActions />
        </>
      )}
      {view === 'snapshots' && <SnapshotsList />}
      {view === 'snapshot-detail' && <SnapshotDetail />}
      {view === 'settings' && <SettingsView />}
      {view === 'history' && <HistoryPanel />}
      {view === 'ai-recommendations' && <ReportsPanel />}
      {view === 'chat' && <ChatSearch />}
    </div></ReviewContext.Provider>
  );
}
