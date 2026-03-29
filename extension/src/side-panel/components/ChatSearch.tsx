import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n, type TranslationKey } from '@shared/i18n';
import type { AIProviderId, ChatSearchResult, RecommendedAction } from '@shared/types';

const ACTION_KEYS: Record<RecommendedAction, 'ai.keep' | 'ai.group' | 'ai.readLater' | 'ai.archive' | 'ai.close'> = {
  keep: 'ai.keep',
  group: 'ai.group',
  read_later: 'ai.readLater',
  archive: 'ai.archive',
  close: 'ai.close',
};

type TranslateFn = (key: TranslationKey) => string;

function formatProviderLabel(
  provider: AIProviderId | null | undefined,
  model: string | null | undefined,
  t: TranslateFn,
) {
  const providerLabel = provider === 'claude_code'
    ? t('settings.providerClaudeCode')
    : provider === 'codex_cli'
      ? t('settings.providerCodexCli')
      : t('settings.providerNone');
  return model ? `${providerLabel} · ${model}` : providerLabel;
}

function formatRelativeTime(timestamp: number, locale: 'ru' | 'en') {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return locale === 'ru' ? 'только что' : 'just now';

  const units = [
    { step: 60, labelEn: 'm ago', labelRu: 'м назад' },
    { step: 60, labelEn: 'h ago', labelRu: 'ч назад' },
    { step: 24, labelEn: 'd ago', labelRu: 'д назад' },
  ];

  let value = deltaSeconds;
  for (const unit of units) {
    value = Math.floor(value / unit.step);
    if ((unit.labelEn === 'm ago' && value < 60) || (unit.labelEn === 'h ago' && value < 24) || unit.labelEn === 'd ago') {
      return `${value}${locale === 'ru' ? unit.labelRu : unit.labelEn}`;
    }
  }
  return locale === 'ru' ? 'давно' : 'a while ago';
}

function getSourceLabel(
  source: ChatSearchResult['source'],
  t: TranslateFn,
) {
  if (source === 'url_analysis') return t('chat.sourceAnalysis');
  if (source === 'tab_history') return t('chat.sourceHistory');
  return t('chat.sourceCluster');
}

function ResultCard({
  result,
  allTabs,
}: {
  result: ChatSearchResult;
  allTabs: { id: number; url: string; windowId: number }[];
}) {
  const { t, locale } = useI18n();
  const normalizedUrl = result.url.toLowerCase().replace(/\/+$/, '');
  const matchedTab = allTabs.find((tab) => tab.url.toLowerCase().replace(/\/+$/, '') === normalizedUrl);
  const isOpen = !!matchedTab;

  function openOrFocus() {
    if (matchedTab) {
      chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: matchedTab.id });
      return;
    }
    chrome.runtime.sendMessage({ type: 'OPEN_URL', url: result.url });
  }

  return (
    <div className="rounded border border-gray-100 bg-white px-3 py-2">
      <div className="flex items-start gap-2">
        <img
          src={`https://www.google.com/s2/favicons?domain=${result.domain}&sz=16`}
          alt=""
          className="mt-0.5 h-4 w-4 shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="min-w-0 flex-1">
          <button
            onClick={openOrFocus}
            className="block w-full truncate text-left text-xs font-medium text-gray-800 hover:text-accent hover:underline"
            title={result.title}
          >
            {result.title}
          </button>
          <button
            onClick={openOrFocus}
            className="mt-0.5 block w-full truncate text-left text-[10px] text-accent hover:underline"
            title={result.url}
          >
            {result.url}
          </button>

          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              {getSourceLabel(result.source, t)}
            </span>
            {result.action && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                {t(ACTION_KEYS[result.action])}
              </span>
            )}
            {result.provider && (
              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700">
                {formatProviderLabel(result.provider, result.model, t)}
              </span>
            )}
            {result.clusterNames && result.clusterNames.length > 0 && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                {result.clusterNames.slice(0, 2).join(', ')}
              </span>
            )}
          </div>

          {result.reason && (
            <div className="mt-1 text-[11px] text-gray-600">{result.reason}</div>
          )}

          {result.analyzedAt && (
            <div className="mt-1 text-[10px] text-gray-400">
              {t('chat.lastAnalyzed')}: {formatRelativeTime(result.analyzedAt, locale)}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div
            className="h-1.5 w-9 rounded-full bg-gray-100"
            title={`${t('chat.relevance')}: ${Math.round(result.relevanceScore * 100)}%`}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round(result.relevanceScore * 100)}%` }}
            />
          </div>
          <button
            onClick={openOrFocus}
            className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-100"
          >
            {isOpen ? t('chat.goToTab') : t('chat.openTab')}
          </button>
          {isOpen && (
            <button
              onClick={() => chrome.runtime.sendMessage({ type: 'CLOSE_TABS', tabIds: [matchedTab.id] })}
              className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100"
            >
              {t('chat.closeTab')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatSearch() {
  const { chatMessages, chatLoading, sendChatQuery, clearChat, windowGroups } = useStore();
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const allTabs = windowGroups.flatMap((wg) => wg.tabs).map((tab) => ({
    id: tab.id,
    url: tab.url,
    windowId: tab.windowId ?? 0,
  }));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  function submitQuery(queryText: string) {
    const trimmed = queryText.trim();
    if (!trimmed) return;
    setInput('');
    void sendChatQuery(trimmed);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-gray-200 px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">{t('nav.chat')}</h2>
          {chatMessages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-200"
            >
              {t('chat.clear')}
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-gray-500">{t('chat.sqliteHint')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {chatMessages.length === 0 && !chatLoading && (
          <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-4">
            <p className="whitespace-pre-line text-xs text-gray-500">{t('chat.instruction')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                t('chat.sampleReview'),
                t('chat.sampleFocus'),
                t('chat.sampleClose'),
              ].map((sample) => (
                <button
                  key={sample}
                  onClick={() => submitQuery(sample)}
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {chatMessages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[90%] rounded-2xl bg-accent/10 px-3 py-2">
                  <p className="text-xs text-accent">{msg.content}</p>
                </div>
              ) : (
                <div className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2">
                  <p className="text-xs leading-5 text-gray-700">{msg.content}</p>

                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    {typeof msg.totalCandidates === 'number' && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                        {t('chat.candidates')}: {msg.totalCandidates}
                      </span>
                    )}
                    {msg.providerUsed && (
                      <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">
                        {t('chat.usingModel')}: {formatProviderLabel(msg.providerUsed, msg.modelUsed, t)}
                      </span>
                    )}
                    {!msg.llmUsed && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                        {t('chat.sqliteOnly')}
                      </span>
                    )}
                    {msg.llmUsed && (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">
                        {t('chat.llmUsed')}
                      </span>
                    )}
                  </div>

                  {msg.results && msg.results.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.results.map((result) => (
                        <ResultCard key={`${msg.id}:${result.url}`} result={result} allTabs={allTabs} />
                      ))}
                    </div>
                  )}

                  {msg.followUpSuggestions && msg.followUpSuggestions.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">
                        {t('chat.followUps')}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.followUpSuggestions.map((suggestion) => (
                          <button
                            key={`${msg.id}:${suggestion}`}
                            onClick={() => submitQuery(suggestion)}
                            disabled={chatLoading}
                            className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/15 disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {chatLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-gray-200 bg-white px-3 py-2">
                <span className="text-xs text-gray-400">{t('chat.searching')}</span>
              </div>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-200 px-3 py-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitQuery(input); }}
            placeholder={t('chat.placeholder')}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => submitQuery(input)}
            disabled={chatLoading || !input.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
