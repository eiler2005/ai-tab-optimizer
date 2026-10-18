import { useEffect } from 'react';
import { useStore } from './store';
import { Header } from './components/Header';
import { StatsBar } from './components/StatsBar';
import { TabList } from './components/TabList';
import { BulkActions } from './components/BulkActions';
import { SnapshotsList } from './components/SnapshotsList';
import { SnapshotDetail } from './components/SnapshotDetail';
import { SettingsView } from './components/SettingsView';
import { HistoryPanel } from './components/HistoryPanel';
import { AIRecommendations } from './components/AIRecommendations';
import { CleanupSession } from './components/CleanupSession';
import { ChatSearch } from './components/ChatSearch';
import { WorkspaceView } from './components/WorkspaceView';

export function App() {
  const actionError = useStore((state) => state.actionError);
  const { view, loadTabs, loadSnapshots, loadRecentlyClosed, loadHistory, loadAIResult, loadAITabStatuses, loadAnalytics, loadPersistentClusters, setAIResult, setAIPartialResult, setAIError, setAIProgress, setAIStopped, setAITabStatuses } = useStore();

  useEffect(() => {
    loadTabs();
    loadSnapshots();
    loadRecentlyClosed();
    const historyTimer = window.setTimeout(() => loadHistory(), 1500);
    const aiTimer = window.setTimeout(() => {
      void loadAIResult();
      void loadAITabStatuses();
    }, 2000);
    const analyticsTimer = window.setTimeout(() => {
      loadAnalytics();
      loadPersistentClusters();
    }, 2500);
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
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      window.clearTimeout(historyTimer);
      window.clearTimeout(aiTimer);
      window.clearTimeout(analyticsTimer);
      window.clearInterval(keepaliveTimer);
      window.clearTimeout(tabsTimer);
      window.clearTimeout(historyUpdateTimer);
      keepalivePort.disconnect();
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [loadTabs, loadSnapshots, loadHistory]);

  return (
    <div className="flex flex-col h-screen">
      <Header />
      {view === 'workspace' && <WorkspaceView />}
      {actionError && <div role="alert" className="p-3 text-xs bg-red-50 text-red-700 flex gap-2">
        <span className="flex-1">{actionError}</span>
        <button aria-label="Dismiss" onClick={() => useStore.getState().setActionError(null)}>✕</button>
      </div>}
      {view === 'tabs' && (
        <>
          <StatsBar />
          <TabList />
          <BulkActions />
        </>
      )}
      {view === 'snapshots' && <SnapshotsList />}
      {view === 'snapshot-detail' && <SnapshotDetail />}
      {view === 'settings' && <SettingsView />}
      {view === 'history' && <HistoryPanel />}
      {view === 'ai-recommendations' && <AIRecommendations />}
      {view === 'cleanup-session' && <CleanupSession />}
      {view === 'chat' && <ChatSearch />}
    </div>
  );
}
