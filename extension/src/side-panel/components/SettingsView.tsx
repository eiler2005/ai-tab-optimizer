import { useEffect, useState } from 'react';
import type {
  GetServerDbStatusResponse,
  GetServerRuntimeLogsResponse,
  GetLLMCallLogsResponse,
  GetUrlCacheListResponse,
  GetAnalysisSessionsResponse,
  ServerDbStatus,
  ServerRuntimeLogEntry,
  LLMCallLogEntry,
  UrlCacheEntry,
  AnalysisSessionEntry,
  UserSettings,
} from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types/messages';
import { useI18n, type Locale } from '@shared/i18n';

export function SettingsView() {
  const { t, locale, setLocale } = useI18n();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [serverStatus, setServerStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [dbStatus, setDbStatus] = useState<ServerDbStatus | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<ServerRuntimeLogEntry[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbAction, setDbAction] = useState<'sync' | 'clear' | null>(null);
  const [dbFeedback, setDbFeedback] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [llmLogs, setLlmLogs] = useState<LLMCallLogEntry[]>([]);
  const [llmLogsExpanded, setLlmLogsExpanded] = useState<Set<number>>(new Set());
  const [llmLogsLimit, setLlmLogsLimit] = useState(20);
  const [urlCacheEntries, setUrlCacheEntries] = useState<UrlCacheEntry[]>([]);
  const [urlCacheTotal, setUrlCacheTotal] = useState(0);
  const [urlCacheDomain, setUrlCacheDomain] = useState('');
  const [urlCacheSelected, setUrlCacheSelected] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<AnalysisSessionEntry[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then((res: { success: boolean; data: UserSettings }) => {
      if (res.success && res.data) {
        setSettings(res.data);
        if (res.data.aiProvider === 'local_server') {
          void refreshServerDiagnostics();
        }
      }
    });
  }, []);

  const save = async (partial: Partial<UserSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: partial });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addProtectedDomain = () => {
    const domain = newDomain.trim().toLowerCase();
    if (domain && !settings.protectedDomains.includes(domain)) {
      save({ protectedDomains: [...settings.protectedDomains, domain] });
      setNewDomain('');
    }
  };

  const removeProtectedDomain = (domain: string) => {
    save({ protectedDomains: settings.protectedDomains.filter((d) => d !== domain) });
  };

  const buildHealthCandidates = (serverUrl: string) => {
    try {
      const url = new URL(serverUrl.trim());
      const candidates = [url.hostname];

      if (url.hostname === 'localhost') {
        candidates.push('127.0.0.1');
      } else if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
        candidates.push('localhost');
      }

      return [...new Set(candidates)].map((hostname) => {
        const candidate = new URL(url.toString());
        candidate.hostname = hostname;
        candidate.pathname = '/health';
        candidate.search = '';
        candidate.hash = '';
        return candidate.toString();
      });
    } catch {
      return [];
    }
  };

  const testConnection = async () => {
    setServerStatus('idle');
    const candidates = buildHealthCandidates(settings.localServerUrl);
    if (candidates.length === 0) {
      setServerStatus('error');
      return;
    }

    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          setServerStatus('ok');
          return;
        }
      } catch {
        // Try the next candidate.
      }
    }

    setServerStatus('error');
  };

  const refreshServerDiagnostics = async () => {
    setDbLoading(true);
    setDbError(null);

    try {
      const [statusRes, logsRes, llmRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_SERVER_DB_STATUS' }) as Promise<GetServerDbStatusResponse | { success: false; error: string }>,
        chrome.runtime.sendMessage({ type: 'GET_SERVER_RUNTIME_LOGS', limit: 12 }) as Promise<GetServerRuntimeLogsResponse | { success: false; error: string }>,
        chrome.runtime.sendMessage({ type: 'GET_LLM_CALL_LOGS', limit: llmLogsLimit }) as Promise<GetLLMCallLogsResponse | { success: false; error: string }>,
      ]);

      if ('success' in statusRes && statusRes.success && statusRes.data) {
        setDbStatus(statusRes.data.status);
      } else {
        throw new Error('error' in statusRes ? statusRes.error : 'Failed to load DB status.');
      }
      if ('success' in logsRes && logsRes.success && logsRes.data) {
        setRuntimeLogs(logsRes.data.logs);
      } else {
        throw new Error('error' in logsRes ? logsRes.error : 'Failed to load runtime logs.');
      }
      if ('success' in llmRes && llmRes.success && llmRes.data) {
        setLlmLogs(llmRes.data.logs);
      }

      const [cacheRes, sessionsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_URL_CACHE_LIST', limit: 30, domain: urlCacheDomain || undefined }) as Promise<GetUrlCacheListResponse | { success: false; error: string }>,
        chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_SESSIONS', limit: 20 }) as Promise<GetAnalysisSessionsResponse | { success: false; error: string }>,
      ]);
      if ('success' in cacheRes && cacheRes.success && cacheRes.data) {
        setUrlCacheEntries(cacheRes.data.entries);
        setUrlCacheTotal(cacheRes.data.total);
      }
      if ('success' in sessionsRes && sessionsRes.success && sessionsRes.data) {
        setSessions(sessionsRes.data.sessions);
      }
    } catch (error) {
      setDbError(error instanceof Error ? error.message : String(error));
    } finally {
      setDbLoading(false);
    }
  };

  const syncServerPersistence = async () => {
    setDbAction('sync');
    setDbFeedback(null);
    setDbError(null);
    try {
      await chrome.runtime.sendMessage({ type: 'SYNC_SERVER_PERSISTENCE' });
      await refreshServerDiagnostics();
      setDbFeedback(t('settings.dbSyncDone'));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : String(error));
    } finally {
      setDbAction(null);
    }
  };

  const clearServerDatabase = async () => {
    if (!window.confirm(t('settings.dbConfirmClear'))) {
      return;
    }

    setDbAction('clear');
    setDbFeedback(null);
    setDbError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CLEAR_SERVER_DB' }) as GetServerDbStatusResponse | { success: false; error: string };
      if ('success' in response && response.success && response.data) {
        setDbStatus(response.data.status);
      } else {
        throw new Error('error' in response ? response.error : 'Failed to clear DB.');
      }
      await refreshServerDiagnostics();
      setDbFeedback(t('settings.dbClearDone'));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : String(error));
    } finally {
      setDbAction(null);
    }
  };

  const formatDateTime = (timestamp: number | null | undefined) => {
    if (!timestamp) {
      return t('settings.dbNever');
    }
    return new Date(timestamp).toLocaleString();
  };

  const toggleLlmLogExpanded = (id: number) => {
    setLlmLogsExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadMoreLlmLogs = async () => {
    const newLimit = llmLogsLimit + 20;
    setLlmLogsLimit(newLimit);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_LLM_CALL_LOGS', limit: newLimit }) as GetLLMCallLogsResponse | { success: false; error: string };
      if ('success' in res && res.success && res.data) {
        setLlmLogs(res.data.logs);
      }
    } catch { /* ignore */ }
  };

  const deleteSelectedUrlCache = async () => {
    if (urlCacheSelected.size === 0) return;
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_URL_CACHE', urls: [...urlCacheSelected] });
      setUrlCacheSelected(new Set());
      await refreshServerDiagnostics();
    } catch { /* ignore */ }
  };

  const deleteUrlCacheByDomain = async () => {
    const domain = urlCacheDomain.trim();
    if (!domain) return;
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_URL_CACHE', domainPattern: domain });
      await refreshServerDiagnostics();
    } catch { /* ignore */ }
  };

  const refreshUrlCache = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_URL_CACHE_LIST', limit: 30, domain: urlCacheDomain || undefined }) as GetUrlCacheListResponse | { success: false; error: string };
      if ('success' in res && res.success && res.data) {
        setUrlCacheEntries(res.data.entries);
        setUrlCacheTotal(res.data.total);
      }
    } catch { /* ignore */ }
  };

  const deleteSession = async (sessionId: number) => {
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_ANALYSIS_SESSION', sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch { /* ignore */ }
  };

  const toggleUrlCacheSelect = (url: string) => {
    setUrlCacheSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      <h2 className="text-sm font-semibold">{t('settings.title')}</h2>

      {saved && (
        <div className="text-xs text-success bg-success-light px-2 py-1 rounded">
          {t('settings.saved')}
        </div>
      )}

      {/* Language */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.language')}</label>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        >
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </div>

      {/* Stale threshold */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.staleThreshold')}</label>
        <input
          type="number"
          min={1}
          max={90}
          value={settings.staleDaysThreshold}
          onChange={(e) => save({ staleDaysThreshold: Number(e.target.value) })}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        />
      </div>

      {/* Max snapshots */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.maxSnapshots')}</label>
        <input
          type="number"
          min={5}
          max={100}
          value={settings.maxStoredSnapshots}
          onChange={(e) => save({ maxStoredSnapshots: Number(e.target.value) })}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        />
      </div>

      {/* Auto-snapshots */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.autoSnapshot')}</label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.autoSnapshotEnabled}
            onChange={(e) => save({ autoSnapshotEnabled: e.target.checked })}
            className="rounded border-gray-300"
          />
          <span className="text-xs text-gray-600">{t('settings.autoSnapshot')}</span>
        </div>
        {settings.autoSnapshotEnabled && (
          <div className="mt-1">
            <label className="text-xs text-gray-500">{t('settings.autoSnapshotInterval')}</label>
            <input
              type="number"
              min={1}
              max={24}
              value={settings.autoSnapshotIntervalHours}
              onChange={(e) => save({ autoSnapshotIntervalHours: Number(e.target.value) })}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            />
          </div>
        )}
      </div>

      {/* History retention */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.historyRetention')}</label>
        <input
          type="number"
          min={7}
          max={90}
          value={settings.historyRetentionDays}
          onChange={(e) => save({ historyRetentionDays: Number(e.target.value) })}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        />
      </div>

      {/* Protected domains */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.protectedDomains')}</label>
        <p className="text-2xs text-gray-400">{t('settings.protectedDomainsHint')}</p>
        <div className="flex gap-1">
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProtectedDomain()}
            placeholder="e.g. github.com"
            className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
          />
          <button
            onClick={addProtectedDomain}
            className="px-2 py-1 text-xs text-white bg-accent rounded hover:bg-accent-hover"
          >
            {t('settings.addDomain')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {settings.protectedDomains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 bg-gray-100 rounded">
              {d}
              <button onClick={() => removeProtectedDomain(d)} className="text-gray-400 hover:text-danger">✕</button>
            </span>
          ))}
        </div>
      </div>

      {/* Obsidian vault path */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.vaultPath')}</label>
        <p className="text-2xs text-gray-400">{t('settings.vaultPathHint')}</p>
        <input
          type="text"
          value={settings.obsidianVaultPath}
          onChange={(e) => save({ obsidianVaultPath: e.target.value })}
          placeholder="/Users/you/Documents/MyVault"
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        />
      </div>

      {/* AI provider */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t('settings.aiProvider')}</label>
        <select
          value={settings.aiProvider}
          onChange={(e) => save({ aiProvider: e.target.value as UserSettings['aiProvider'] })}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
        >
          <option value="none">{t('settings.aiNone')}</option>
          <option value="local_server">{t('settings.localServer')}</option>
        </select>
      </div>

      {/* Local Server settings */}
      {settings.aiProvider === 'local_server' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">{t('settings.localServerUrl')}</label>
            <p className="text-2xs text-gray-400">{t('settings.serverHint')}</p>
            <input
              type="text"
              value={settings.localServerUrl}
              onChange={(e) => save({ localServerUrl: e.target.value })}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            />
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={testConnection}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
              >
                {t('settings.testConnection')}
              </button>
              {serverStatus === 'ok' && (
                <span className="text-xs text-green-600">{t('settings.connected')}</span>
              )}
              {serverStatus === 'error' && (
                <span className="text-xs text-red-500">{t('settings.disconnected')}</span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">{t('settings.serverAiProvider')}</label>
            <p className="text-2xs text-gray-400">{t('settings.serverAiProviderHint')}</p>
            <select
              value={settings.serverAiProvider}
              onChange={(e) => save({ serverAiProvider: e.target.value as UserSettings['serverAiProvider'] })}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            >
              <option value="claude_code">{t('settings.providerClaudeCode')}</option>
              <option value="codex_cli">{t('settings.providerCodexCli')}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">{t('settings.fallbackAiProvider')}</label>
            <select
              value={settings.fallbackAiProvider}
              onChange={(e) => save({ fallbackAiProvider: e.target.value as UserSettings['fallbackAiProvider'] })}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            >
              <option value="none">{t('settings.providerNone')}</option>
              <option value="claude_code">{t('settings.providerClaudeCode')}</option>
              <option value="codex_cli">{t('settings.providerCodexCli')}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">{t('settings.codexModel')}</label>
            <input
              type="text"
              value={settings.codexModel}
              onChange={(e) => save({ codexModel: e.target.value })}
              placeholder="gpt-5.4"
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">{t('settings.claudeCliPath')}</label>
            <input
              type="text"
              value={settings.claudeCliPath}
              onChange={(e) => save({ claudeCliPath: e.target.value })}
              placeholder="/usr/local/bin/claude"
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">{t('settings.codexCliPath')}</label>
            <input
              type="text"
              value={settings.codexCliPath}
              onChange={(e) => save({ codexCliPath: e.target.value })}
              placeholder="/usr/local/bin/codex"
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-gray-700">{t('settings.dbTools')}</p>
                <p className="text-2xs text-gray-400">{t('settings.dbToolsHint')}</p>
              </div>
              <button
                onClick={() => void refreshServerDiagnostics()}
                disabled={dbLoading}
                className="px-2 py-1 text-xs bg-white text-gray-600 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
              >
                {t('settings.dbRefresh')}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void syncServerPersistence()}
                disabled={dbAction !== null}
                className="px-2 py-1 text-xs text-white bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
              >
                {dbAction === 'sync' ? t('settings.dbSyncing') : t('settings.dbSync')}
              </button>
              <button
                onClick={() => void clearServerDatabase()}
                disabled={dbAction !== null}
                className="px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-50"
              >
                {dbAction === 'clear' ? t('settings.dbClearing') : t('settings.dbClear')}
              </button>
            </div>

            {dbFeedback && (
              <div className="text-xs text-green-600">{dbFeedback}</div>
            )}
            {dbError && (
              <div className="text-xs text-red-500">{dbError}</div>
            )}

            {dbStatus && (
              <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                <div className="rounded bg-white px-2 py-1">{t('settings.dbCacheEntries')}: {dbStatus.urlCacheEntries}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbSessions')}: {dbStatus.analysisSessions}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbAnalysisRuns')}: {dbStatus.analysisRuns}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbHistoryEvents')}: {dbStatus.historyEvents}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbSnapshots')}: {dbStatus.snapshots}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbLogs')}: {dbStatus.runtimeLogs}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.llmCallLogsCount')}: {dbStatus.llmCallLogs}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbSize')}: {formatBytes(dbStatus.dbSizeBytes)}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbLastAnalysis')}: {formatDateTime(dbStatus.lastAnalysisAt)}</div>
                <div className="rounded bg-white px-2 py-1">{t('settings.dbLastLog')}: {formatDateTime(dbStatus.lastLogAt)}</div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">{t('settings.modelLogs')}</p>
              {runtimeLogs.length === 0 ? (
                <p className="text-xs text-gray-400">{t('settings.modelLogsEmpty')}</p>
              ) : (
                <div className="space-y-1">
                  {runtimeLogs.map((entry) => (
                    <div key={entry.id} className="rounded bg-white px-2 py-1 text-[11px] text-gray-600">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium uppercase text-[10px] text-gray-400">
                          {entry.level}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {formatDateTime(entry.timestamp)}
                        </span>
                      </div>
                      <div>{entry.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">{t('settings.llmCallLogs')}</p>
              <p className="text-2xs text-gray-400">{t('settings.llmCallLogsHint')}</p>
              {llmLogs.length === 0 ? (
                <p className="text-xs text-gray-400">{t('settings.llmCallLogsEmpty')}</p>
              ) : (
                <div className="space-y-1">
                  {llmLogs.map((entry) => {
                    const isExpanded = llmLogsExpanded.has(entry.id);
                    const isError = entry.phase === 'error';
                    return (
                      <div
                        key={entry.id}
                        className={`rounded px-2 py-1.5 text-[11px] cursor-pointer ${isError ? 'bg-red-50 border border-red-100' : 'bg-white'}`}
                        onClick={() => toggleLlmLogExpanded(entry.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-medium text-[10px] uppercase ${isError ? 'text-red-500' : 'text-blue-500'}`}>
                              {entry.phase}
                            </span>
                            <span className="text-[10px] text-gray-500 font-medium">{entry.provider}</span>
                            {entry.model && <span className="text-[10px] text-gray-400">({entry.model})</span>}
                          </div>
                          <span className="text-[10px] text-gray-400">{formatDateTime(entry.timestamp)}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-gray-500">
                          <span>{t('settings.llmBatch')}: {entry.batchIndex + 1}</span>
                          <span>{t('settings.llmTabs')}: {entry.tabCount}</span>
                          {entry.durationMs != null && <span>{t('settings.llmDuration')}: {(entry.durationMs / 1000).toFixed(1)}s</span>}
                          {(entry.inputTokens > 0 || entry.outputTokens > 0) && (
                            <span>{t('settings.llmTokens')}: {entry.inputTokens}→{entry.outputTokens}</span>
                          )}
                          {entry.costUsd != null && <span>{t('settings.llmCost')}: ${entry.costUsd.toFixed(4)}</span>}
                        </div>
                        {isExpanded && (
                          <div className="mt-1.5 space-y-1 border-t border-gray-100 pt-1.5">
                            {entry.requestSummary && (
                              <div>
                                <span className="text-[10px] font-medium text-gray-400">{t('settings.llmPrompt')}:</span>
                                <pre className="mt-0.5 text-[10px] text-gray-600 whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-gray-50 rounded p-1">
                                  {entry.requestSummary}
                                </pre>
                              </div>
                            )}
                            {entry.responseSummary && (
                              <div>
                                <span className="text-[10px] font-medium text-gray-400">{t('settings.llmResponse')}:</span>
                                <pre className="mt-0.5 text-[10px] text-gray-600 whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-gray-50 rounded p-1">
                                  {entry.responseSummary}
                                </pre>
                              </div>
                            )}
                            {entry.errorMessage && (
                              <div>
                                <span className="text-[10px] font-medium text-red-400">{t('settings.llmError')}:</span>
                                <pre className="mt-0.5 text-[10px] text-red-600 whitespace-pre-wrap break-all max-h-24 overflow-y-auto bg-red-50 rounded p-1">
                                  {entry.errorMessage}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {llmLogs.length >= llmLogsLimit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void loadMoreLlmLogs(); }}
                      className="w-full text-center text-[11px] text-accent hover:underline py-1"
                    >
                      {t('settings.llmShowMore')}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">{t('settings.urlCache')}</p>
              <p className="text-2xs text-gray-400">{t('settings.urlCacheHint')}</p>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={urlCacheDomain}
                  onChange={(e) => setUrlCacheDomain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void refreshUrlCache(); }}
                  placeholder={t('settings.urlCacheFilterDomain')}
                  className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => void refreshUrlCache()}
                  className="px-2 py-1 text-xs bg-white text-gray-600 rounded border border-gray-200 hover:bg-gray-100"
                >
                  {t('settings.dbRefresh')}
                </button>
              </div>
              {urlCacheEntries.length === 0 ? (
                <p className="text-xs text-gray-400">{t('settings.urlCacheEmpty')}</p>
              ) : (
                <>
                  <p className="text-[10px] text-gray-400">{t('settings.urlCacheTotal')}: {urlCacheTotal}</p>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {urlCacheEntries.map((entry) => (
                      <label key={entry.url} className="flex items-start gap-1.5 rounded bg-white px-2 py-1 text-[11px] text-gray-600 cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={urlCacheSelected.has(entry.url)}
                          onChange={() => toggleUrlCacheSelect(entry.url)}
                          className="mt-0.5 rounded border-gray-300"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{entry.url.replace(/^[^:]+::/, '')}</div>
                          <div className="flex gap-2 text-[10px] text-gray-400">
                            <span>{entry.action}</span>
                            <span>{Math.round(entry.confidence * 100)}%</span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {urlCacheSelected.size > 0 && (
                      <button
                        onClick={() => void deleteSelectedUrlCache()}
                        className="px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600"
                      >
                        {t('settings.urlCacheDeleteSelected')} ({urlCacheSelected.size})
                      </button>
                    )}
                    {urlCacheDomain.trim() && (
                      <button
                        onClick={() => void deleteUrlCacheByDomain()}
                        className="px-2 py-1 text-xs text-white bg-orange-500 rounded hover:bg-orange-600"
                      >
                        {t('settings.urlCacheDeleteByDomain')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">{t('settings.analysisSessions')}</p>
              <p className="text-2xs text-gray-400">{t('settings.analysisSessionsHint')}</p>
              {sessions.length === 0 ? (
                <p className="text-xs text-gray-400">{t('settings.analysisSessionsEmpty')}</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {sessions.map((session) => (
                    <div key={session.id} className="rounded bg-white px-2 py-1.5 text-[11px] text-gray-600">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{formatDateTime(session.timestamp * 1000)}</span>
                        <button
                          onClick={() => void deleteSession(session.id)}
                          className="text-[10px] text-red-400 hover:text-red-600"
                        >
                          {t('settings.sessionDelete')}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
                        <span>{session.tabCount} {t('settings.sessionTabs')}</span>
                        <span>{session.tabsFromCache} {t('settings.sessionCached')}</span>
                        <span>{session.tabsAnalyzed} {t('settings.sessionNew')}</span>
                        {session.durationMs > 0 && <span>{(session.durationMs / 1000).toFixed(1)}s</span>}
                        {session.totalCostUsd != null && <span>${session.totalCostUsd.toFixed(4)}</span>}
                        {(session.inputTokens > 0 || session.outputTokens > 0) && (
                          <span>{session.inputTokens}→{session.outputTokens} tok</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="text-2xs text-gray-300 pt-4">
        AI Tab Optimizer v0.2.0
      </div>
    </div>
  );
}
