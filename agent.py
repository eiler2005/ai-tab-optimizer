"""
AI Tab Optimizer — Local AI Server
FastAPI server with SQLite database for persistent per-URL tab analysis caching.
Uses local AI CLIs for analysis and stores state in SQLite.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import time
from uuid import uuid4
from collections import Counter, defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from urllib.parse import parse_qs, unquote, urlparse

import aiosqlite
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage
from server_core.constants import (
    BATCH_SIZE,
    CLAUDE_TIMEOUT_SECONDS,
    CODEX_TIMEOUT_SECONDS,
    LLM_LOG_RETENTION_DAYS,
    MAX_RUNTIME_LOG_ENTRIES,
    SUPPORTED_SERVER_AI_PROVIDERS,
    URL_ANALYSIS_TTL_DAYS,
    VALID_ACTIONS,
)
from server_core.provider_policy import (
    classify_fallback_issue,
    should_disable_provider_for_run,
    summarize_provider_error,
)
from server_core.runtime_state import AnalysisRuntimeState

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ai-tab-optimizer")

# Clear Claude Code nesting env vars so claude CLI can be spawned from this server
for _env_key in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"):
    os.environ.pop(_env_key, None)

DB_PATH = Path(__file__).parent / "tab_analysis.db"
APP_ROOT = Path(__file__).parent
RETENTION_SWEEP_INTERVAL_SECONDS = 3600

analysis_runtime = AnalysisRuntimeState()
THEME_QUERY_KEYS = {"q", "query", "search", "text", "title", "topic", "s"}
THEME_STOPWORDS = {
    "about", "account", "accounts", "agent", "agents", "all", "and", "app", "article",
    "assistant", "auth", "blog", "browser", "chat", "chrome", "code", "codex", "com",
    "course", "courses", "dashboard", "default", "demo", "docs", "document", "download",
    "edu", "en", "error", "extensions", "for", "free", "from", "github", "google", "help",
    "home", "how", "http", "https", "index", "info", "latest", "learn", "lesson", "lessons",
    "list", "localhost", "login", "mail", "main", "manage", "menu", "net", "new", "news",
    "notes", "open", "optimizer", "org", "page", "pages", "platform", "post", "pricing",
    "product", "products", "profile", "project", "projects", "read", "ref", "results",
    "review", "ru", "search", "service", "settings", "sign", "site", "start", "support",
    "tab", "tabs", "team", "teams", "the", "this", "today", "tool", "tools", "topic",
    "update", "user", "users", "video", "watch", "web", "what", "why", "with", "work",
    "www", "xcom", "youtube", "your", "данные", "для", "или", "как", "курс", "курсы",
    "модель", "модели", "новое", "новый", "обзор", "онлайн", "подборка", "посмотреть",
    "после", "проект", "работа", "страница", "статья", "темы", "урок", "уроки",
    "что", "это", "этот", "эти",
}

SYSTEM_PROMPT = """You are a browser tab analyst. You receive a list of open browser tabs and must analyze them.

Return a JSON object matching this exact schema:

{
  "tabRecommendations": [
    {
      "tabId": 1,
      "action": "keep" | "group" | "read_later" | "archive" | "close",
      "confidence": 0.0 to 1.0,
      "reason": "why this action",
      "suggestedGroupName": "optional group name"
    }
  ]
}

Rules:
- Every tab must have exactly one recommendation
- Actions: "keep" (actively useful), "group" (related tabs to organize), "read_later" (interesting but not urgent), "archive" (save reference then close), "close" (not needed)
- Detect duplicate/near-duplicate URLs and group them
- Identify stale tabs (generic new tab pages, error pages)
- Be conservative: when unsure, recommend "keep" with lower confidence
- Return ONLY valid JSON, no markdown fences, no extra text"""

CODEX_SCHEMA = {
    "type": "object",
    "properties": {
        "tabRecommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tabId": {"type": "integer"},
                    "action": {"type": "string"},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                    "suggestedGroupName": {
                        "type": ["string", "null"]
                    },
                },
                "required": [
                    "tabId",
                    "action",
                    "confidence",
                    "reason",
                    "suggestedGroupName",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["tabRecommendations"],
    "additionalProperties": False,
}


# ─── Pydantic Models ──────────────────────────────────────

class TabInput(BaseModel):
    id: int
    title: str
    url: str
    domain: str
    pinned: bool
    active: bool
    groupId: int | None = None
    groupName: str | None = None
    pageExcerpt: str | None = None
    metaDescription: str | None = None


class AnalyzeRequest(BaseModel):
    tabs: list[TabInput]
    forceRefresh: bool = False
    providerOrder: list[Literal["claude_code", "codex_cli"]] | None = None


class ProviderAttempt(BaseModel):
    provider: Literal["claude_code", "codex_cli"]
    model: str | None = None
    status: Literal["succeeded", "failed"]
    error: str | None = None


class AnalysisMetadata(BaseModel):
    durationMs: int
    durationApiMs: int
    totalCostUsd: float | None
    inputTokens: int
    outputTokens: int
    tabCount: int
    providerUsed: Literal["claude_code", "codex_cli"] | None = None
    modelUsed: str | None = None
    providerAttempts: list[ProviderAttempt] = Field(default_factory=list)
    providerStatus: dict[str, Any] | None = None


class CacheStats(BaseModel):
    totalTabs: int
    tabsFromCache: int
    tabsAnalyzed: int
    tabsSaved: int
    cacheHitRate: float


class AnalyzeResponse(BaseModel):
    result: dict[str, Any]
    metadata: AnalysisMetadata
    cacheStats: CacheStats


class TabAnalysisStatus(BaseModel):
    tabId: int
    url: str
    title: str
    domain: str
    status: Literal["pending", "cached", "analyzed", "failed"]
    source: Literal["pending", "database", "provider", "heuristic"]
    action: Literal["keep", "group", "read_later", "archive", "close"] | None = None
    confidence: float | None = None
    reason: str | None = None
    suggestedGroupName: str | None = None
    analyzedAt: int | None = None
    provider: Literal["claude_code", "codex_cli"] | None = None
    model: str | None = None


class TabAnalysisStatusSummary(BaseModel):
    total: int
    cached: int = 0
    analyzed: int = 0
    pending: int = 0
    failed: int = 0


class AnalysisRunSnapshot(BaseModel):
    id: str
    fingerprint: str
    status: Literal["running", "stopped", "completed", "failed"]
    phase: Literal[
        "preparing",
        "sending",
        "analyzing",
        "persisting",
        "processing",
        "stopping",
        "stopped",
        "completed",
        "failed",
    ]
    startedAt: int
    updatedAt: int
    analyzedAt: int | None = None
    forceRefresh: bool = False
    totalTabs: int
    tabsCached: int = 0
    tabsAnalyzed: int = 0
    tabsProcessed: int = 0
    tabsRemaining: int = 0
    tabsSaved: int = 0
    batchesTotal: int = 0
    batchesCompleted: int = 0
    currentBatch: int = 0
    providerOrderOverride: list[Literal["claude_code", "codex_cli"]] = Field(default_factory=list)
    fallbackNotice: str | None = None
    result: dict[str, Any]
    metadata: AnalysisMetadata
    allTabs: list[TabInput]
    pendingTabs: list[TabInput]
    tabStatuses: list[TabAnalysisStatus] = Field(default_factory=list)
    error: str | None = None


class CreateAnalysisRunRequest(BaseModel):
    snapshot: AnalysisRunSnapshot


class UpdateAnalysisRunRequest(BaseModel):
    snapshot: AnalysisRunSnapshot


class TabAnalysisStatusRequest(BaseModel):
    tabs: list[TabInput]
    forceRefresh: bool = False


class TabRecommendationInput(BaseModel):
    tabId: int
    action: Literal["keep", "group", "read_later", "archive", "close"]
    confidence: float
    reason: str
    suggestedGroupName: str | None = None


class ImportUrlAnalysisRequest(BaseModel):
    tabs: list[TabInput]
    recommendations: list[TabRecommendationInput]
    analysisSource: Literal["provider", "heuristic"] = "heuristic"
    provider: Literal["claude_code", "codex_cli"] | None = None
    model: str | None = None
    analyzedAt: int | None = None


class RuntimeLogEntry(BaseModel):
    id: int
    timestamp: int
    level: Literal["info", "warning", "error"]
    category: Literal["analysis", "provider", "database"]
    message: str


class LLMCallLogEntry(BaseModel):
    id: int
    timestamp: int
    sessionTimestamp: int | None = None
    batchIndex: int
    provider: str
    model: str | None = None
    phase: str
    durationMs: int | None = None
    inputTokens: int = 0
    outputTokens: int = 0
    costUsd: float | None = None
    promptChars: int = 0
    responseChars: int = 0
    tabCount: int = 0
    errorMessage: str | None = None
    requestSummary: str | None = None
    responseSummary: str | None = None


class DatabaseStatus(BaseModel):
    urlCacheEntries: int
    analysisSessions: int
    analysisRuns: int
    historyEvents: int
    snapshots: int
    runtimeLogs: int
    llmCallLogs: int
    dbSizeBytes: int
    lastAnalysisAt: int | None = None
    lastLogAt: int | None = None


class AppSettings(BaseModel):
    obsidianVaultPath: str = ""
    protectedDomains: list[str] = Field(default_factory=list)
    staleDaysThreshold: int = 7
    maxStoredSnapshots: int = 30
    aiProvider: Literal["anthropic", "openai", "ollama", "local_server", "none"] = "local_server"
    serverAiProvider: Literal["none", "claude_code", "codex_cli"] = "claude_code"
    fallbackAiProvider: Literal["none", "claude_code", "codex_cli"] = "codex_cli"
    apiKey: str = ""
    ollamaEndpoint: str = "http://localhost:11434"
    localServerUrl: str = "http://localhost:8765"
    claudeCliPath: str = ""
    codexCliPath: str = ""
    codexModel: str = "gpt-5.4"
    autoSnapshotEnabled: bool = False
    autoSnapshotIntervalHours: int = 4
    historyRetentionDays: int = 30


class SaveSettingsRequest(BaseModel):
    settings: dict[str, Any]


class HistoryEventRecord(BaseModel):
    tabId: int
    url: str
    title: str
    domain: str
    event: str
    timestamp: int


class HistoryImportRequest(BaseModel):
    entries: list[HistoryEventRecord]


class HistoryPruneRequest(BaseModel):
    retentionDays: int


class ClearDatabaseRequest(BaseModel):
    preserveSettings: bool = True


class SnapshotTabRecord(BaseModel):
    url: str
    title: str
    domain: str
    pinned: bool
    favIconUrl: str | None = None
    groupName: str | None = None


class SnapshotWindowRecord(BaseModel):
    windowId: int
    focused: bool
    tabs: list[SnapshotTabRecord]


class SnapshotStatsRecord(BaseModel):
    totalTabs: int
    totalWindows: int
    topDomains: list[str]


class SnapshotRecord(BaseModel):
    id: str
    name: str
    createdAt: int
    trigger: str
    windows: list[SnapshotWindowRecord]
    stats: SnapshotStatsRecord


class SaveSnapshotRequest(BaseModel):
    snapshot: SnapshotRecord
    maxStoredSnapshots: int | None = None


class ImportSnapshotsRequest(BaseModel):
    snapshots: list[SnapshotRecord]
    maxStoredSnapshots: int | None = None


# ─── SQLite Setup ─────────────────────────────────────────

async def init_db(db: aiosqlite.Connection) -> None:
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS url_analysis (
            url TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            confidence REAL NOT NULL,
            reason TEXT NOT NULL,
            suggested_group_name TEXT,
            analyzed_at REAL NOT NULL,
            analysis_source TEXT NOT NULL DEFAULT 'provider',
            provider TEXT,
            model TEXT
        );

        CREATE TABLE IF NOT EXISTS analysis_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            tab_count INTEGER NOT NULL,
            tabs_from_cache INTEGER DEFAULT 0,
            tabs_analyzed INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            duration_api_ms INTEGER DEFAULT 0,
            wall_time_ms INTEGER DEFAULT 0,
            total_cost_usd REAL,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS analysis_runs (
            id TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            analyzed_at REAL,
            state_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_analysis_runs_updated_at
            ON analysis_runs(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_analysis_runs_fingerprint
            ON analysis_runs(fingerprint, updated_at DESC);

        CREATE TABLE IF NOT EXISTS tab_history_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tab_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            domain TEXT NOT NULL,
            event TEXT NOT NULL,
            timestamp REAL NOT NULL,
            UNIQUE(tab_id, url, event, timestamp)
        );

        CREATE INDEX IF NOT EXISTS idx_tab_history_events_timestamp
            ON tab_history_events(timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_tab_history_events_url
            ON tab_history_events(url);

        CREATE TABLE IF NOT EXISTS snapshots (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at REAL NOT NULL,
            trigger TEXT NOT NULL,
            total_tabs INTEGER NOT NULL,
            total_windows INTEGER NOT NULL,
            top_domains_json TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
            ON snapshots(created_at DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            settings_json TEXT NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS runtime_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            level TEXT NOT NULL,
            category TEXT NOT NULL,
            message TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_runtime_logs_timestamp
            ON runtime_logs(timestamp DESC);

        CREATE TABLE IF NOT EXISTS llm_call_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            session_timestamp REAL,
            batch_index INTEGER NOT NULL DEFAULT 0,
            provider TEXT NOT NULL,
            model TEXT,
            phase TEXT NOT NULL,
            duration_ms INTEGER,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost_usd REAL,
            prompt_chars INTEGER DEFAULT 0,
            response_chars INTEGER DEFAULT 0,
            tab_count INTEGER DEFAULT 0,
            error_message TEXT,
            request_summary TEXT,
            response_summary TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_llm_call_logs_timestamp
            ON llm_call_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_llm_call_logs_session
            ON llm_call_logs(session_timestamp);

        CREATE TABLE IF NOT EXISTS recommendation_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            tab_url TEXT NOT NULL,
            tab_title TEXT,
            ai_action TEXT NOT NULL,
            user_action TEXT NOT NULL,
            confidence REAL NOT NULL,
            session_timestamp REAL
        );

        CREATE INDEX IF NOT EXISTS idx_recommendation_actions_timestamp
            ON recommendation_actions(timestamp DESC);

        CREATE TABLE IF NOT EXISTS topic_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            tab_urls_json TEXT NOT NULL DEFAULT '[]',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_topic_clusters_updated
            ON topic_clusters(updated_at DESC);
    """)
    # Schema migration: add action_breakdown_json column to analysis_sessions
    try:
        await db.execute("ALTER TABLE analysis_sessions ADD COLUMN action_breakdown_json TEXT")
        await db.commit()
    except Exception:
        pass  # Column already exists

    for statement in (
        "ALTER TABLE url_analysis ADD COLUMN analysis_source TEXT NOT NULL DEFAULT 'provider'",
        "ALTER TABLE url_analysis ADD COLUMN provider TEXT",
        "ALTER TABLE url_analysis ADD COLUMN model TEXT",
    ):
        try:
            await db.execute(statement)
            await db.commit()
        except Exception:
            pass

    await apply_retention_policies(db)


async def apply_retention_policies(db: aiosqlite.Connection) -> None:
    url_cutoff = time.time() - URL_ANALYSIS_TTL_DAYS * 86400
    log_cutoff = time.time() - LLM_LOG_RETENTION_DAYS * 86400
    deleted_rows = 0

    cursor = await db.execute("DELETE FROM url_analysis WHERE analyzed_at < ?", (url_cutoff,))
    deleted_rows += max(cursor.rowcount, 0)
    cursor = await db.execute("DELETE FROM llm_call_logs WHERE timestamp < ?", (log_cutoff * 1000,))
    deleted_rows += max(cursor.rowcount, 0)
    await db.commit()

    if deleted_rows > 0:
        try:
            await db.execute("VACUUM")
        except Exception:
            logger.exception("SQLite VACUUM failed after retention cleanup")


async def retention_worker(db: aiosqlite.Connection) -> None:
    while True:
        await asyncio.sleep(RETENTION_SWEEP_INTERVAL_SECONDS)
        try:
            await apply_retention_policies(db)
        except Exception:
            logger.exception("Periodic retention cleanup failed")


@asynccontextmanager
async def lifespan(application: FastAPI):
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await init_db(db)
    application.state.db = db
    retention_task = asyncio.create_task(retention_worker(db))
    logger.info(f"SQLite database opened: {DB_PATH}")
    yield
    retention_task.cancel()
    try:
        await retention_task
    except asyncio.CancelledError:
        pass
    await db.close()
    logger.info("SQLite database closed")


app = FastAPI(title="AI Tab Optimizer Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db(request: Request) -> aiosqlite.Connection:
    return request.app.state.db


# ─── DB Helpers ───────────────────────────────────────────

async def get_cached_urls(
    db: aiosqlite.Connection,
    urls: list[str],
    cache_namespace: str,
) -> dict[str, dict[str, Any]]:
    if not urls:
        return {}
    cutoff = time.time() - URL_ANALYSIS_TTL_DAYS * 86400
    cache_key_map = {
        f"{cache_namespace}::{url}": url
        for url in urls
    }
    placeholders = ",".join("?" for _ in cache_key_map)
    cursor = await db.execute(
        f"SELECT url, action, confidence, reason, suggested_group_name, analyzed_at, "
        f"analysis_source, provider, model "
        f"FROM url_analysis WHERE url IN ({placeholders}) AND analyzed_at >= ?",
        [*cache_key_map.keys(), cutoff],
    )
    rows = await cursor.fetchall()
    return {
        cache_key_map[row["url"]]: {
            "action": row["action"],
            "confidence": row["confidence"],
            "reason": row["reason"],
            "suggestedGroupName": row["suggested_group_name"],
            "analyzedAt": row["analyzed_at"],
            "analysisSource": row["analysis_source"] or "provider",
            "provider": row["provider"],
            "model": row["model"],
        }
        for row in rows
    }


async def save_url_analyses(
    db: aiosqlite.Connection,
    entries: list[dict[str, Any]],
) -> None:
    if not entries:
        return
    await db.executemany(
        "INSERT OR REPLACE INTO url_analysis "
        "(url, action, confidence, reason, suggested_group_name, analyzed_at, analysis_source, provider, model) "
        "VALUES (:url, :action, :confidence, :reason, :suggestedGroupName, :analyzedAt, :analysisSource, :provider, :model)",
        entries,
    )
    await db.commit()


def build_tab_status_summary(statuses: list[TabAnalysisStatus]) -> TabAnalysisStatusSummary:
    summary = TabAnalysisStatusSummary(total=len(statuses))
    for status in statuses:
        if status.status == "cached":
            summary.cached += 1
        elif status.status == "analyzed":
            summary.analyzed += 1
        elif status.status == "failed":
            summary.failed += 1
        else:
            summary.pending += 1
    return summary


def dedupe_strings(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def normalize_theme_token(token: str) -> str | None:
    normalized = token.strip(" _-+.#").lower()
    if len(normalized) < 3:
        return None
    if normalized.isdigit():
        return None
    if normalized in THEME_STOPWORDS:
        return None
    return normalized


def tokenize_theme_text(text: str) -> list[str]:
    if not text:
        return []
    cleaned = re.sub(r"[^0-9A-Za-zА-Яа-яЁё]+", " ", text.lower())
    tokens = []
    for part in cleaned.split():
        normalized = normalize_theme_token(part)
        if normalized:
            tokens.append(normalized)
    return dedupe_strings(tokens)


def extract_theme_tokens(tab: TabInput) -> list[str]:
    parts = [tab.title, tab.groupName or ""]

    try:
        parsed = urlparse(tab.url)
        parts.append(unquote(parsed.path).replace("/", " "))
        query = parse_qs(parsed.query)
        for key in THEME_QUERY_KEYS:
            for value in query.get(key, [])[:1]:
                parts.append(unquote(value))
    except Exception:
        pass

    tokens: list[str] = []
    for part in parts:
        tokens.extend(tokenize_theme_text(part))
    return dedupe_strings(tokens)


def format_theme_name(tokens: list[str]) -> str:
    if not tokens:
        return "Mixed Topic"
    return " ".join(token.capitalize() for token in tokens[:2])


def build_topic_clusters_from_tabs(tabs: list[TabInput]) -> list[dict[str, Any]]:
    if len(tabs) < 2:
        return []

    token_map = {tab.id: extract_theme_tokens(tab) for tab in tabs}
    doc_freq: Counter[str] = Counter()
    for tokens in token_map.values():
        doc_freq.update(set(tokens))

    max_common_frequency = max(6, int(len(tabs) * 0.45))
    shared_tokens = {
        tab.id: [
            token
            for token in token_map[tab.id]
            if 2 <= doc_freq[token] <= max_common_frequency
        ][:8]
        for tab in tabs
    }

    draft_clusters: list[dict[str, Any]] = []
    for tab in sorted(tabs, key=lambda current: len(shared_tokens.get(current.id, [])), reverse=True):
        tokens = shared_tokens.get(tab.id, [])
        if not tokens:
            continue

        token_set = set(tokens)
        best_index: int | None = None
        best_score = 0

        for index, cluster in enumerate(draft_clusters):
            keywords = [token for token, _ in cluster["token_counts"].most_common(6)]
            overlap = token_set & set(keywords)
            if not overlap:
                continue

            top_overlap_frequency = max(doc_freq[token] for token in overlap)
            score = len(overlap)
            if score > best_score and (score >= 2 or top_overlap_frequency <= max(4, len(tabs) // 6 or 1)):
                best_index = index
                best_score = score

        if best_index is None:
            draft_clusters.append({
                "tabs": [tab],
                "token_counts": Counter(tokens),
            })
            continue

        cluster_tabs = draft_clusters[best_index]["tabs"]
        if all(existing.id != tab.id for existing in cluster_tabs):
            cluster_tabs.append(tab)
        draft_clusters[best_index]["token_counts"].update(tokens)

    final_clusters: list[dict[str, Any]] = []
    seen_signatures: set[tuple[str, tuple[int, ...]]] = set()
    for cluster in draft_clusters:
        cluster_tabs: list[TabInput] = cluster["tabs"]
        if len(cluster_tabs) < 2:
            continue

        keywords = [token for token, _ in cluster["token_counts"].most_common(4)]
        if not keywords:
            continue

        tab_ids = [tab.id for tab in cluster_tabs]
        name = format_theme_name(keywords)
        signature = (name.lower(), tuple(sorted(tab_ids)))
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)

        final_clusters.append({
            "name": name,
            "tabIds": tab_ids,
            "tabUrls": [tab.url for tab in cluster_tabs],
            "description": f"{len(tab_ids)} tabs around {', '.join(keywords[:3])}",
            "tags": keywords,
        })

    final_clusters.sort(key=lambda cluster: (-len(cluster["tabIds"]), cluster["name"].lower()))
    return final_clusters[:15]


def build_main_themes(tabs: list[TabInput], topic_clusters: list[dict[str, Any]]) -> list[str]:
    if topic_clusters:
        return [cluster["name"] for cluster in topic_clusters[:5]]

    doc_freq: Counter[str] = Counter()
    for tab in tabs:
        doc_freq.update(set(extract_theme_tokens(tab)))

    themes: list[str] = []
    for token, count in doc_freq.most_common():
        if count < 2:
            continue
        themes.append(format_theme_name([token]))
        if len(themes) >= 5:
            break
    return themes


async def get_tab_analysis_statuses(
    db: aiosqlite.Connection,
    tabs: list[TabInput],
    settings: AppSettings,
    force_refresh: bool = False,
) -> list[TabAnalysisStatus]:
    if not tabs:
        return []

    if force_refresh:
        return [
            TabAnalysisStatus(
                tabId=tab.id,
                url=tab.url,
                title=tab.title,
                domain=tab.domain,
                status="pending",
                source="pending",
            )
            for tab in tabs
        ]

    cached = await get_cached_urls(
        db,
        [tab.url for tab in tabs],
        build_cache_namespace(settings),
    )
    statuses: list[TabAnalysisStatus] = []
    for tab in tabs:
        entry = cached.get(tab.url)
        if entry is None:
            statuses.append(
                TabAnalysisStatus(
                    tabId=tab.id,
                    url=tab.url,
                    title=tab.title,
                    domain=tab.domain,
                    status="pending",
                    source="pending",
                )
            )
            continue

        analyzed_at = entry.get("analyzedAt")
        statuses.append(
            TabAnalysisStatus(
                tabId=tab.id,
                url=tab.url,
                title=tab.title,
                domain=tab.domain,
                status="cached",
                source="database",
                action=entry.get("action"),
                confidence=float(entry["confidence"]) if entry.get("confidence") is not None else None,
                reason=entry.get("reason"),
                suggestedGroupName=entry.get("suggestedGroupName"),
                analyzedAt=int(float(analyzed_at) * 1000) if analyzed_at is not None else None,
                provider=entry.get("provider"),
                model=entry.get("model"),
            )
        )
    return statuses


async def save_session(db: aiosqlite.Connection, session: dict[str, Any]) -> None:
    await db.execute(
        "INSERT INTO analysis_sessions "
        "(timestamp, tab_count, tabs_from_cache, tabs_analyzed, duration_ms, duration_api_ms, "
        "wall_time_ms, total_cost_usd, input_tokens, output_tokens, action_breakdown_json) "
        "VALUES (:timestamp, :tab_count, :tabs_from_cache, :tabs_analyzed, :duration_ms, "
        ":duration_api_ms, :wall_time_ms, :total_cost_usd, :input_tokens, :output_tokens, "
        ":action_breakdown_json)",
        session,
    )
    await db.commit()


async def save_analysis_run(
    db: aiosqlite.Connection,
    snapshot: AnalysisRunSnapshot,
) -> None:
    await db.execute(
        "INSERT INTO analysis_runs "
        "(id, fingerprint, status, started_at, updated_at, analyzed_at, state_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET "
        "fingerprint = excluded.fingerprint, "
        "status = excluded.status, "
        "started_at = excluded.started_at, "
        "updated_at = excluded.updated_at, "
        "analyzed_at = excluded.analyzed_at, "
        "state_json = excluded.state_json",
        (
            snapshot.id,
            snapshot.fingerprint,
            snapshot.status,
            snapshot.startedAt / 1000,
            snapshot.updatedAt / 1000,
            (snapshot.analyzedAt / 1000) if snapshot.analyzedAt is not None else None,
            snapshot.model_dump_json(),
        ),
    )
    await db.commit()


async def get_analysis_run(
    db: aiosqlite.Connection,
    run_id: str,
) -> AnalysisRunSnapshot | None:
    cursor = await db.execute(
        "SELECT state_json FROM analysis_runs WHERE id = ?",
        (run_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return AnalysisRunSnapshot.model_validate_json(row["state_json"])


async def get_latest_analysis_run(
    db: aiosqlite.Connection,
    fingerprint: str | None = None,
) -> AnalysisRunSnapshot | None:
    if fingerprint:
        cursor = await db.execute(
            "SELECT state_json FROM analysis_runs WHERE fingerprint = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
            (fingerprint,),
        )
    else:
        cursor = await db.execute(
            "SELECT state_json FROM analysis_runs ORDER BY updated_at DESC, id DESC LIMIT 1"
        )
    row = await cursor.fetchone()
    if row is None:
        return None
    return AnalysisRunSnapshot.model_validate_json(row["state_json"])


async def trim_runtime_logs(db: aiosqlite.Connection) -> None:
    await db.execute(
        "DELETE FROM runtime_logs "
        "WHERE id NOT IN (SELECT id FROM runtime_logs ORDER BY timestamp DESC, id DESC LIMIT ?)",
        (MAX_RUNTIME_LOG_ENTRIES,),
    )
    await db.commit()


async def add_runtime_log(
    db: aiosqlite.Connection,
    level: Literal["info", "warning", "error"],
    category: Literal["analysis", "provider", "database"],
    message: str,
) -> None:
    compact_message = " ".join(message.strip().split())[:240]
    await db.execute(
        "INSERT INTO runtime_logs (timestamp, level, category, message) VALUES (?, ?, ?, ?)",
        (int(time.time() * 1000), level, category, compact_message),
    )
    await db.commit()
    await trim_runtime_logs(db)


async def list_runtime_logs(
    db: aiosqlite.Connection,
    limit: int = 20,
) -> list[RuntimeLogEntry]:
    bounded_limit = max(1, min(limit, 100))
    cursor = await db.execute(
        "SELECT id, timestamp, level, category, message "
        "FROM runtime_logs ORDER BY timestamp DESC, id DESC LIMIT ?",
        (bounded_limit,),
    )
    rows = await cursor.fetchall()
    return [
        RuntimeLogEntry(
            id=row["id"],
            timestamp=int(row["timestamp"]),
            level=row["level"],
            category=row["category"],
            message=row["message"],
        )
        for row in rows
    ]


MAX_LLM_LOG_SUMMARY_CHARS = 2000
MAX_LLM_LOG_ERROR_CHARS = 4000


async def add_llm_call_log(
    db: aiosqlite.Connection,
    *,
    session_timestamp: float | None = None,
    batch_index: int = 0,
    provider: str,
    model: str | None = None,
    phase: str,
    duration_ms: int | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: float | None = None,
    prompt_chars: int = 0,
    response_chars: int = 0,
    tab_count: int = 0,
    error_message: str | None = None,
    request_summary: str | None = None,
    response_summary: str | None = None,
) -> None:
    ts = time.time() * 1000
    err = error_message[:MAX_LLM_LOG_ERROR_CHARS] if error_message else None
    req = request_summary[:MAX_LLM_LOG_SUMMARY_CHARS] if request_summary else None
    resp = response_summary[:MAX_LLM_LOG_SUMMARY_CHARS] if response_summary else None
    await db.execute(
        "INSERT INTO llm_call_logs "
        "(timestamp, session_timestamp, batch_index, provider, model, phase, "
        "duration_ms, input_tokens, output_tokens, cost_usd, "
        "prompt_chars, response_chars, tab_count, "
        "error_message, request_summary, response_summary) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ts, session_timestamp, batch_index, provider, model, phase,
         duration_ms, input_tokens, output_tokens, cost_usd,
         prompt_chars, response_chars, tab_count,
         err, req, resp),
    )
    await db.commit()


async def list_llm_call_logs(
    db: aiosqlite.Connection,
    limit: int = 50,
    session_timestamp: float | None = None,
    provider: str | None = None,
) -> list[LLMCallLogEntry]:
    bounded_limit = max(1, min(limit, 200))
    conditions: list[str] = []
    params: list[object] = []
    if session_timestamp is not None:
        conditions.append("session_timestamp = ?")
        params.append(session_timestamp)
    if provider is not None:
        conditions.append("provider = ?")
        params.append(provider)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    cursor = await db.execute(
        f"SELECT * FROM llm_call_logs{where} ORDER BY timestamp DESC, id DESC LIMIT ?",
        (*params, bounded_limit),
    )
    rows = await cursor.fetchall()
    return [
        LLMCallLogEntry(
            id=row["id"],
            timestamp=int(row["timestamp"]),
            sessionTimestamp=int(row["session_timestamp"]) if row["session_timestamp"] else None,
            batchIndex=row["batch_index"],
            provider=row["provider"],
            model=row["model"],
            phase=row["phase"],
            durationMs=row["duration_ms"],
            inputTokens=row["input_tokens"] or 0,
            outputTokens=row["output_tokens"] or 0,
            costUsd=row["cost_usd"],
            promptChars=row["prompt_chars"] or 0,
            responseChars=row["response_chars"] or 0,
            tabCount=row["tab_count"] or 0,
            errorMessage=row["error_message"],
            requestSummary=row["request_summary"],
            responseSummary=row["response_summary"],
        )
        for row in rows
    ]


async def get_database_status(db: aiosqlite.Connection) -> DatabaseStatus:
    cursor = await db.execute(
        "SELECT "
        "(SELECT COUNT(*) FROM url_analysis) AS url_cache_entries, "
        "(SELECT COUNT(*) FROM analysis_sessions) AS analysis_sessions, "
        "(SELECT COUNT(*) FROM analysis_runs) AS analysis_runs, "
        "(SELECT COUNT(*) FROM tab_history_events) AS history_events, "
        "(SELECT COUNT(*) FROM snapshots) AS snapshots, "
        "(SELECT COUNT(*) FROM runtime_logs) AS runtime_logs, "
        "(SELECT COUNT(*) FROM llm_call_logs) AS llm_call_logs, "
        "(SELECT MAX(timestamp) FROM analysis_sessions) AS last_analysis_at, "
        "(SELECT MAX(timestamp) FROM runtime_logs) AS last_log_at"
    )
    row = await cursor.fetchone()
    db_size_bytes = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    last_analysis_at = int(row["last_analysis_at"] * 1000) if row["last_analysis_at"] is not None else None
    last_log_at = int(row["last_log_at"]) if row["last_log_at"] is not None else None
    return DatabaseStatus(
        urlCacheEntries=row["url_cache_entries"],
        analysisSessions=row["analysis_sessions"],
        analysisRuns=row["analysis_runs"],
        historyEvents=row["history_events"],
        snapshots=row["snapshots"],
        runtimeLogs=row["runtime_logs"],
        llmCallLogs=row["llm_call_logs"],
        dbSizeBytes=db_size_bytes,
        lastAnalysisAt=last_analysis_at,
        lastLogAt=last_log_at,
    )


async def clear_database(
    db: aiosqlite.Connection,
    preserve_settings: bool = True,
) -> dict[str, int]:
    tables = [
        ("url_analysis", "urlCacheEntries"),
        ("analysis_sessions", "analysisSessions"),
        ("analysis_runs", "analysisRuns"),
        ("tab_history_events", "historyEvents"),
        ("snapshots", "snapshots"),
        ("runtime_logs", "runtimeLogs"),
        ("llm_call_logs", "llmCallLogs"),
        ("recommendation_actions", "recommendationActions"),
        ("topic_clusters", "topicClusters"),
    ]
    if not preserve_settings:
        tables.append(("app_settings", "settingsRows"))

    cleared_counts: dict[str, int] = {}
    for table_name, output_key in tables:
        cursor = await db.execute(f"SELECT COUNT(*) AS count FROM {table_name}")
        row = await cursor.fetchone()
        cleared_counts[output_key] = row["count"]
        await db.execute(f"DELETE FROM {table_name}")

    await db.commit()
    return cleared_counts


async def save_history_entries(
    db: aiosqlite.Connection,
    entries: list[HistoryEventRecord],
) -> int:
    if not entries:
        return 0

    before = db.total_changes
    await db.executemany(
        "INSERT OR IGNORE INTO tab_history_events "
        "(tab_id, url, title, domain, event, timestamp) "
        "VALUES (:tabId, :url, :title, :domain, :event, :timestamp)",
        [entry.model_dump() for entry in entries],
    )
    await db.commit()
    return db.total_changes - before


def get_history_cutoff(timeframe: str) -> float:
    now = time.time()
    if timeframe == "day":
        return now - 86400
    if timeframe == "week":
        return now - 7 * 86400
    if timeframe == "month":
        return now - 30 * 86400
    raise HTTPException(status_code=400, detail=f"Unsupported timeframe: {timeframe}")


async def get_history_stats(
    db: aiosqlite.Connection,
    timeframe: str,
    limit: int = 0,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    cutoff_seconds = get_history_cutoff(timeframe)
    cutoff_ms = int(cutoff_seconds * 1000)
    cursor = await db.execute(
        "SELECT tab_id, url, title, domain, event, timestamp "
        "FROM tab_history_events "
        "WHERE timestamp >= ? "
        "ORDER BY timestamp ASC",
        (cutoff_ms,),
    )
    rows = await cursor.fetchall()

    stats_by_url: dict[str, dict[str, Any]] = {}
    last_opened_by_url: dict[str, int] = {}

    for row in rows:
        url = row["url"]
        timestamp = int(row["timestamp"])
        if row["event"] == "opened":
            previous = last_opened_by_url.get(url, 0)
            if timestamp > previous:
                last_opened_by_url[url] = timestamp

        existing = stats_by_url.get(url)
        if existing is None:
            stats_by_url[url] = {
                "url": url,
                "title": row["title"],
                "domain": row["domain"],
                "activationCount": 1 if row["event"] == "activated" else 0,
                "firstSeen": timestamp,
                "lastSeen": timestamp,
                "lastOpenedAt": None,
            }
            continue

        if row["event"] == "activated":
            existing["activationCount"] += 1
        if timestamp < existing["firstSeen"]:
            existing["firstSeen"] = timestamp
        if timestamp >= existing["lastSeen"]:
            existing["lastSeen"] = timestamp
            existing["title"] = row["title"]
            existing["domain"] = row["domain"]

    for url, stats in stats_by_url.items():
        stats["lastOpenedAt"] = last_opened_by_url.get(url)

    all_sorted = sorted(
        stats_by_url.values(),
        key=lambda item: item["lastSeen"],
        reverse=True,
    )
    total = len(all_sorted)
    if limit > 0:
        return all_sorted[offset:offset + limit], total
    return all_sorted, total


async def prune_history_entries(
    db: aiosqlite.Connection,
    retention_days: int,
) -> int:
    cutoff_ms = int((time.time() - retention_days * 86400) * 1000)
    before = db.total_changes
    await db.execute(
        "DELETE FROM tab_history_events WHERE timestamp < ?",
        (cutoff_ms,),
    )
    await db.commit()
    return db.total_changes - before


async def save_snapshots(
    db: aiosqlite.Connection,
    snapshots: list[SnapshotRecord],
    max_stored_snapshots: int | None = None,
) -> int:
    if not snapshots:
        return 0

    before = db.total_changes
    await db.executemany(
        "INSERT OR REPLACE INTO snapshots "
        "(id, name, created_at, trigger, total_tabs, total_windows, top_domains_json, payload_json) "
        "VALUES (:id, :name, :created_at, :trigger, :total_tabs, :total_windows, :top_domains_json, :payload_json)",
        [
            {
                "id": snapshot.id,
                "name": snapshot.name,
                "created_at": snapshot.createdAt,
                "trigger": snapshot.trigger,
                "total_tabs": snapshot.stats.totalTabs,
                "total_windows": snapshot.stats.totalWindows,
                "top_domains_json": json.dumps(snapshot.stats.topDomains),
                "payload_json": snapshot.model_dump_json(),
            }
            for snapshot in snapshots
        ],
    )

    if max_stored_snapshots is not None and max_stored_snapshots > 0:
        cursor = await db.execute(
            "SELECT id FROM snapshots ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?",
            (max_stored_snapshots,),
        )
        stale_rows = await cursor.fetchall()
        if stale_rows:
            await db.executemany(
                "DELETE FROM snapshots WHERE id = ?",
                [(row["id"],) for row in stale_rows],
            )

    await db.commit()
    return db.total_changes - before


async def list_snapshots(db: aiosqlite.Connection) -> list[SnapshotRecord]:
    cursor = await db.execute(
        "SELECT payload_json FROM snapshots ORDER BY created_at DESC, id DESC"
    )
    rows = await cursor.fetchall()
    return [SnapshotRecord.model_validate_json(row["payload_json"]) for row in rows]


async def get_snapshot(db: aiosqlite.Connection, snapshot_id: str) -> SnapshotRecord | None:
    cursor = await db.execute(
        "SELECT payload_json FROM snapshots WHERE id = ?",
        (snapshot_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return SnapshotRecord.model_validate_json(row["payload_json"])


async def delete_snapshot(db: aiosqlite.Connection, snapshot_id: str) -> bool:
    before = db.total_changes
    await db.execute("DELETE FROM snapshots WHERE id = ?", (snapshot_id,))
    await db.commit()
    return db.total_changes > before


def normalize_app_settings(raw_settings: dict[str, Any] | None) -> AppSettings:
    raw = dict(raw_settings or {})

    legacy_provider = raw.get("aiProvider")
    if legacy_provider == "anthropic":
        raw["aiProvider"] = "local_server"
        raw.setdefault("serverAiProvider", "claude_code")
    elif legacy_provider == "openai":
        raw["aiProvider"] = "local_server"
        raw.setdefault("serverAiProvider", "codex_cli")
    elif legacy_provider == "ollama":
        raw["aiProvider"] = "local_server"
        raw.setdefault("serverAiProvider", "codex_cli")

    if raw.get("serverAiProvider") not in SUPPORTED_SERVER_AI_PROVIDERS:
        raw["serverAiProvider"] = "claude_code"
    if raw.get("fallbackAiProvider") not in SUPPORTED_SERVER_AI_PROVIDERS:
        raw["fallbackAiProvider"] = "codex_cli"
    if not str(raw.get("claudeCliPath") or "").strip():
        detected_claude_path = shutil.which("claude")
        if detected_claude_path:
            raw["claudeCliPath"] = detected_claude_path
    if not str(raw.get("codexCliPath") or "").strip():
        detected_codex_path = shutil.which("codex")
        if detected_codex_path:
            raw["codexCliPath"] = detected_codex_path

    settings = AppSettings.model_validate(raw)
    if settings.serverAiProvider == settings.fallbackAiProvider:
        settings.fallbackAiProvider = "none"
    return settings


async def get_app_settings(db: aiosqlite.Connection) -> AppSettings:
    cursor = await db.execute(
        "SELECT settings_json FROM app_settings WHERE id = 1"
    )
    row = await cursor.fetchone()
    if row is None:
        settings = AppSettings()
        await db.execute(
            "INSERT INTO app_settings (id, settings_json, updated_at) VALUES (1, ?, ?)",
            (settings.model_dump_json(), time.time()),
        )
        await db.commit()
        return settings

    settings = normalize_app_settings(json.loads(row["settings_json"]))
    normalized_json = settings.model_dump_json()
    if normalized_json != row["settings_json"]:
        await db.execute(
            "UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1",
            (normalized_json, time.time()),
        )
        await db.commit()
    return settings


async def save_app_settings(
    db: aiosqlite.Connection,
    payload: dict[str, Any],
) -> AppSettings:
    current = await get_app_settings(db)
    merged = normalize_app_settings({**current.model_dump(), **payload})
    await db.execute(
        "INSERT INTO app_settings (id, settings_json, updated_at) VALUES (1, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
        (merged.model_dump_json(), time.time()),
    )
    await db.commit()
    return merged


# ─── AI Helpers ───────────────────────────────────────────

def build_tab_prompt(tabs: list[TabInput]) -> str:
    lines = []
    for tab in tabs:
        flags = []
        if tab.pinned:
            flags.append("pinned")
        if tab.active:
            flags.append("active")
        if tab.groupName:
            flags.append(f"group:{tab.groupName}")
        flag_str = f" [{', '.join(flags)}]" if flags else ""
        lines.append(f"[{tab.id}] {tab.title} | {tab.domain} | {tab.url}{flag_str}")
    return f"Analyze these {len(tabs)} browser tabs:\n\n" + "\n".join(lines)


def build_cache_namespace(settings: AppSettings) -> str:
    return "|".join([
        settings.aiProvider,
        settings.serverAiProvider,
        settings.fallbackAiProvider,
        settings.codexModel.strip() or "default",
    ])


def parse_ai_response(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        snippet = cleaned[:200] if cleaned else "<empty response>"
        raise ValueError(
            f"Failed to parse AI response as JSON: {exc.msg}. Raw response: {snippet}"
        ) from exc


def build_heuristic_recommendations(
    tabs: list[TabInput], reason_prefix: str
) -> list[dict[str, Any]]:
    url_groups: dict[str, list[TabInput]] = defaultdict(list)
    domain_groups: dict[str, list[TabInput]] = defaultdict(list)

    for tab in tabs:
        url_groups[tab.url].append(tab)
        domain_groups[tab.domain].append(tab)

    recommendations: list[dict[str, Any]] = []
    for tab in tabs:
        duplicate_tabs = url_groups[tab.url]
        domain_tabs = domain_groups[tab.domain]

        if len(duplicate_tabs) > 1 and duplicate_tabs[0].id != tab.id:
            recommendations.append({
                "tabId": tab.id,
                "action": "close",
                "confidence": 0.82,
                "reason": f"{reason_prefix} Duplicate URL is already open in another tab.",
            })
            continue

        if tab.pinned or tab.active:
            recommendations.append({
                "tabId": tab.id,
                "action": "keep",
                "confidence": 0.9,
                "reason": f"{reason_prefix} Pinned or currently active tabs are kept.",
            })
            continue

        lower_url = tab.url.lower()
        if lower_url == "about:blank" or lower_url.startswith("chrome://newtab/") or lower_url.startswith("chrome-error://"):
            recommendations.append({
                "tabId": tab.id,
                "action": "close",
                "confidence": 0.75,
                "reason": f"{reason_prefix} Temporary browser tabs are safe close candidates.",
            })
            continue

        if len(domain_tabs) >= 2:
            recommendations.append({
                "tabId": tab.id,
                "action": "group",
                "confidence": 0.68,
                "reason": f"{reason_prefix} Multiple tabs from the same domain likely belong together.",
                "suggestedGroupName": tab.domain,
            })
            continue

        recommendations.append({
            "tabId": tab.id,
            "action": "keep",
            "confidence": 0.55,
            "reason": f"{reason_prefix} No strong close signal was found for this tab.",
        })

    return recommendations


def normalize_recommendations(
    tabs: list[TabInput],
    recommendations: list[dict[str, Any]],
    fallback_reason: str,
) -> list[dict[str, Any]]:
    tabs_by_id = {tab.id: tab for tab in tabs}
    normalized: dict[int, dict[str, Any]] = {}

    for rec in recommendations:
        tab_id = rec.get("tabId")
        if not isinstance(tab_id, int) or tab_id not in tabs_by_id or tab_id in normalized:
            continue

        action = rec.get("action")
        if action not in VALID_ACTIONS:
            action = "keep"

        confidence = rec.get("confidence")
        if not isinstance(confidence, (int, float)):
            confidence = 0.5

        reason = rec.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            reason = "AI response did not include a reason."

        suggested_group_name = rec.get("suggestedGroupName")
        normalized[tab_id] = {
            "tabId": tab_id,
            "action": action,
            "confidence": max(0.0, min(float(confidence), 1.0)),
            "reason": reason.strip(),
            "suggestedGroupName": (
                suggested_group_name if isinstance(suggested_group_name, str) else None
            ),
        }

    missing_tabs = [tab for tab in tabs if tab.id not in normalized]
    if missing_tabs:
        for fallback_rec in build_heuristic_recommendations(missing_tabs, fallback_reason):
            normalized[fallback_rec["tabId"]] = fallback_rec

    return [normalized[tab.id] for tab in tabs if tab.id in normalized]


def build_codex_prompt(tabs: list[TabInput]) -> str:
    return (
        f"{SYSTEM_PROMPT}\n\n"
        "Analyze the following browser tabs and return JSON that matches the required schema.\n\n"
        f"{build_tab_prompt(tabs)}"
    )


def resolve_cli_path(configured_path: str, binary_name: str) -> str:
    configured = configured_path.strip()
    if configured:
        if Path(configured).exists():
            return configured
        logger.warning(
            "Configured %s path does not exist: %s. Falling back to PATH lookup.",
            binary_name,
            configured,
        )

    candidate = shutil.which(binary_name)
    if not candidate:
        raise RuntimeError(f"{binary_name} CLI not found")
    return candidate


def parse_codex_total_tokens(stderr_text: str) -> int:
    match = re.search(r"tokens used\s+([\d,]+)", stderr_text, re.IGNORECASE)
    if not match:
        return 0
    return int(match.group(1).replace(",", ""))


def get_provider_model(provider: str, settings: AppSettings) -> str | None:
    if provider == "codex_cli":
        model = settings.codexModel.strip()
        return model or None
    return None


async def analyze_batch_via_claude(
    tabs: list[TabInput],
    settings: AppSettings,
) -> tuple[list[dict[str, Any]], AnalysisMetadata]:
    prompt = build_tab_prompt(tabs)
    metadata = AnalysisMetadata(
        durationMs=0, durationApiMs=0, totalCostUsd=None,
        inputTokens=0, outputTokens=0, tabCount=len(tabs),
        providerUsed="claude_code",
        modelUsed=get_provider_model("claude_code", settings),
    )
    result_text: str | None = None
    stream_error: Exception | None = None
    stderr_lines: list[str] = []

    def capture_stderr(line: str) -> None:
        logger.warning("Claude CLI stderr: %s", line)
        stderr_lines.append(line)

    async def consume_query() -> None:
        nonlocal result_text, metadata
        async for message in query(
            prompt=prompt,
            options=ClaudeAgentOptions(
                system_prompt=SYSTEM_PROMPT,
                max_turns=1,
                allowed_tools=[],
                output_format={"type": "json"},
                cli_path=resolve_cli_path(settings.claudeCliPath, "claude"),
                stderr=capture_stderr,
            ),
        ):
            if isinstance(message, ResultMessage):
                result_text = message.result
                metadata.durationMs = message.duration_ms
                metadata.durationApiMs = message.duration_api_ms
                metadata.totalCostUsd = message.total_cost_usd
                if message.usage:
                    metadata.inputTokens = message.usage.get("input_tokens", 0)
                    metadata.outputTokens = message.usage.get("output_tokens", 0)

    task = asyncio.ensure_future(consume_query())
    await analysis_runtime.set_running_task(task)
    timed_out = False
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=CLAUDE_TIMEOUT_SECONDS)
    except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
        timed_out = isinstance(exc, asyncio.TimeoutError)
        if timed_out:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            stream_error = RuntimeError(
                f"Claude Code CLI timed out after {CLAUDE_TIMEOUT_SECONDS}s"
            )
        elif await analysis_runtime.is_cancelled():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            stream_error = RuntimeError("Claude Code CLI cancelled by user")
        else:
            stream_error = RuntimeError(
                f"Claude Code CLI timed out after {CLAUDE_TIMEOUT_SECONDS}s"
            )
    except Exception as exc:
        stream_error = exc
    finally:
        await analysis_runtime.clear_running_task(task)

    if not result_text:
        if stream_error is not None:
            err_msg = str(stream_error)
            if stderr_lines and "check stderr" in err_msg.lower():
                stderr_tail = "\n".join(stderr_lines[-10:])
                raise RuntimeError(f"{err_msg}\nCLI stderr:\n{stderr_tail}") from stream_error
            if stderr_lines:
                stderr_tail = "\n".join(stderr_lines[-10:])
                raise RuntimeError(f"{err_msg} | stderr: {stderr_tail}") from stream_error
            raise stream_error
        raise HTTPException(status_code=502, detail="No result from AI")

    parsed = parse_ai_response(result_text)
    recommendations = parsed.get("tabRecommendations", [])
    if not isinstance(recommendations, list):
        raise ValueError("AI response did not include a tabRecommendations array.")
    recommendations = normalize_recommendations(
        tabs,
        recommendations,
        "AI response was incomplete, so heuristic recommendations were used for some tabs.",
    )
    return recommendations, metadata


async def analyze_batch_via_codex(
    tabs: list[TabInput],
    settings: AppSettings,
) -> tuple[list[dict[str, Any]], AnalysisMetadata]:
    codex_path = resolve_cli_path(settings.codexCliPath, "codex")
    prompt = build_codex_prompt(tabs)
    started_at = time.time()

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as schema_file:
        json.dump(CODEX_SCHEMA, schema_file)
        schema_path = schema_file.name

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as output_file:
        output_path = output_file.name

    command = [
        codex_path,
        "exec",
        "--skip-git-repo-check",
        "--output-schema",
        schema_path,
        "-o",
        output_path,
        "--color",
        "never",
    ]
    if settings.codexModel.strip():
        command.extend(["-m", settings.codexModel.strip()])
    command.append(prompt)

    process: asyncio.subprocess.Process | None = None
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(APP_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await analysis_runtime.set_codex_process(process)
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=CODEX_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise RuntimeError(
                f"Codex CLI timed out after {CODEX_TIMEOUT_SECONDS}s"
            ) from exc
        stdout_text = stdout_bytes.decode("utf-8", errors="replace")
        stderr_text = stderr_bytes.decode("utf-8", errors="replace")
        result_text = Path(output_path).read_text(encoding="utf-8").strip()

        if process.returncode != 0 and not result_text:
            raise RuntimeError(
                f"Codex CLI exited with code {process.returncode}. {stderr_text or stdout_text}".strip()
            )

        if not result_text:
            raise RuntimeError("Codex CLI returned an empty response.")

        parsed = parse_ai_response(result_text)
        recommendations = parsed.get("tabRecommendations", [])
        if not isinstance(recommendations, list):
            raise ValueError("Codex CLI response did not include a tabRecommendations array.")

        duration_ms = int((time.time() - started_at) * 1000)
        metadata = AnalysisMetadata(
            durationMs=duration_ms,
            durationApiMs=duration_ms,
            totalCostUsd=None,
            inputTokens=0,
            outputTokens=parse_codex_total_tokens(stderr_text),
            tabCount=len(tabs),
            providerUsed="codex_cli",
            modelUsed=get_provider_model("codex_cli", settings),
        )
        recommendations = normalize_recommendations(
            tabs,
            recommendations,
            "Codex response was incomplete, so heuristic recommendations were used for some tabs.",
        )
        return recommendations, metadata
    finally:
        await analysis_runtime.clear_codex_process(process)
        Path(schema_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)


def resolve_provider_chain(
    settings: AppSettings,
    override: list[str] | None = None,
) -> list[str]:
    if settings.aiProvider == "none":
        return []

    if override:
        providers: list[str] = []
        for provider in override:
            if provider in {"claude_code", "codex_cli"} and provider not in providers:
                providers.append(provider)
        if providers:
            return providers

    providers: list[str] = []
    if settings.serverAiProvider != "none":
        providers.append(settings.serverAiProvider)
    if settings.fallbackAiProvider != "none" and settings.fallbackAiProvider not in providers:
        providers.append(settings.fallbackAiProvider)
    return providers


async def analyze_batch_via_provider(
    provider: str,
    tabs: list[TabInput],
    settings: AppSettings,
    *,
    db: aiosqlite.Connection | None = None,
    session_timestamp: float | None = None,
    batch_index: int = 0,
) -> tuple[list[dict[str, Any]], AnalysisMetadata]:
    model = get_provider_model(provider, settings)
    prompt_text = build_tab_prompt(tabs) if provider == "claude_code" else build_codex_prompt(tabs)
    started_at = time.time()

    if db:
        await add_llm_call_log(
            db,
            session_timestamp=session_timestamp,
            batch_index=batch_index,
            provider=provider,
            model=model,
            phase="request",
            tab_count=len(tabs),
            prompt_chars=len(prompt_text),
            request_summary=prompt_text[:MAX_LLM_LOG_SUMMARY_CHARS],
        )

    try:
        if provider == "claude_code":
            recs, metadata = await analyze_batch_via_claude(tabs, settings)
        elif provider == "codex_cli":
            recs, metadata = await analyze_batch_via_codex(tabs, settings)
        else:
            raise RuntimeError(f"Unsupported provider: {provider}")

        elapsed_ms = int((time.time() - started_at) * 1000)
        if db:
            await add_llm_call_log(
                db,
                session_timestamp=session_timestamp,
                batch_index=batch_index,
                provider=provider,
                model=metadata.modelUsed or model,
                phase="response",
                duration_ms=elapsed_ms,
                input_tokens=metadata.inputTokens,
                output_tokens=metadata.outputTokens,
                cost_usd=metadata.totalCostUsd,
                tab_count=len(tabs),
                response_chars=sum(len(json.dumps(r)) for r in recs),
                response_summary=json.dumps(recs[:3], ensure_ascii=False)[:MAX_LLM_LOG_SUMMARY_CHARS],
            )
        return recs, metadata
    except Exception as exc:
        elapsed_ms = int((time.time() - started_at) * 1000)
        if db:
            await add_llm_call_log(
                db,
                session_timestamp=session_timestamp,
                batch_index=batch_index,
                provider=provider,
                model=model,
                phase="error",
                duration_ms=elapsed_ms,
                tab_count=len(tabs),
                error_message=str(exc),
            )
        raise


def build_full_result(
    all_recommendations: list[dict[str, Any]],
    all_tabs: list[TabInput],
    fallback_notice: str | None = None,
    total_tabs_override: int | None = None,
) -> dict[str, Any]:
    topic_clusters = build_topic_clusters_from_tabs(all_tabs)

    action_counts: dict[str, int] = {}
    for r in all_recommendations:
        act = r.get("action", "keep")
        action_counts[act] = action_counts.get(act, 0) + 1

    closable = action_counts.get("close", 0)
    themes = build_main_themes(all_tabs, topic_clusters)

    parts = []
    if closable > 0:
        parts.append(f"{closable} close")
    if action_counts.get("archive"):
        parts.append(f"{action_counts['archive']} archive")
    if action_counts.get("read_later"):
        parts.append(f"{action_counts['read_later']} read later")
    if action_counts.get("group"):
        parts.append(f"{action_counts['group']} group")
    if action_counts.get("keep"):
        parts.append(f"{action_counts['keep']} keep")

    breakdown = f": {', '.join(parts)}" if parts else ""
    expected_total = total_tabs_override or len(all_tabs)
    if len(all_tabs) == expected_total:
        summary = f"Analyzed {len(all_tabs)} tabs{breakdown}."
    else:
        summary = f"Processed {len(all_tabs)} of {expected_total} tabs{breakdown}."
    if fallback_notice:
        summary = f"{fallback_notice} {summary}"

    return {
        "summary": summary,
        "topicClusters": topic_clusters,
        "tabRecommendations": all_recommendations,
        "duplicateGroups": [],
        "staleTabIds": [],
        "sessionStats": {
            "estimatedClosable": closable,
            "mainThemes": themes,
            "urgentItems": 0,
            "actionBreakdown": action_counts,
        },
    }


# ─── Endpoints ────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/db-status")
async def db_status(req: Request):
    db = get_db(req)
    status = await get_database_status(db)
    return {"status": status.model_dump()}


@app.get("/runtime-logs")
async def runtime_logs(req: Request, limit: int = 20):
    db = get_db(req)
    logs = await list_runtime_logs(db, limit)
    return {"logs": [entry.model_dump() for entry in logs]}


@app.post("/db/clear")
async def clear_db(payload: ClearDatabaseRequest, req: Request):
    db = get_db(req)
    cleared = await clear_database(db, payload.preserveSettings)
    await add_runtime_log(
        db,
        "warning",
        "database",
        "Server database was cleared from the extension UI.",
    )
    status = await get_database_status(db)
    return {"cleared": cleared, "status": status.model_dump()}


@app.get("/settings")
async def settings(req: Request):
    db = get_db(req)
    app_settings = await get_app_settings(db)
    return {"settings": app_settings.model_dump()}


@app.post("/settings")
async def update_settings(payload: SaveSettingsRequest, req: Request):
    db = get_db(req)
    app_settings = await save_app_settings(db, payload.settings)
    return {"settings": app_settings.model_dump()}


@app.post("/analysis-runs")
async def create_analysis_run(payload: CreateAnalysisRunRequest, req: Request):
    db = get_db(req)
    await save_analysis_run(db, payload.snapshot)
    return {"run": payload.snapshot.model_dump()}


@app.put("/analysis-runs/{run_id}")
async def update_analysis_run(run_id: str, payload: UpdateAnalysisRunRequest, req: Request):
    if payload.snapshot.id != run_id:
        raise HTTPException(status_code=400, detail="Run ID mismatch")
    db = get_db(req)
    await save_analysis_run(db, payload.snapshot)
    return {"run": payload.snapshot.model_dump()}


@app.post("/tab-analysis-status")
async def tab_analysis_status(payload: TabAnalysisStatusRequest, req: Request):
    db = get_db(req)
    settings = await get_app_settings(db)
    statuses = await get_tab_analysis_statuses(
        db,
        payload.tabs,
        settings,
        payload.forceRefresh,
    )
    return {
        "statuses": [status.model_dump() for status in statuses],
        "summary": build_tab_status_summary(statuses).model_dump(),
    }


@app.post("/url-analysis/import")
async def import_url_analysis(payload: ImportUrlAnalysisRequest, req: Request):
    if not payload.tabs or not payload.recommendations:
        return {"saved": 0}

    db = get_db(req)
    settings = await get_app_settings(db)
    cache_namespace = build_cache_namespace(settings)
    tabs_by_id = {tab.id: tab for tab in payload.tabs}
    analyzed_at = (payload.analyzedAt / 1000) if payload.analyzedAt is not None else time.time()

    entries: list[dict[str, Any]] = []
    for recommendation in payload.recommendations:
        tab = tabs_by_id.get(recommendation.tabId)
        if tab is None:
            continue
        entries.append({
            "url": f"{cache_namespace}::{tab.url}",
            "action": recommendation.action,
            "confidence": recommendation.confidence,
            "reason": recommendation.reason,
            "suggestedGroupName": recommendation.suggestedGroupName,
            "analyzedAt": analyzed_at,
            "analysisSource": payload.analysisSource,
            "provider": payload.provider,
            "model": payload.model,
        })

    await save_url_analyses(db, entries)
    await add_runtime_log(
        db,
        "info",
        "database",
        f"Imported {len(entries)} URL analysis record(s) from the extension worker.",
    )
    return {"saved": len(entries)}


@app.get("/analysis-runs/latest")
async def latest_analysis_run(req: Request, fingerprint: str | None = None):
    db = get_db(req)
    snapshot = await get_latest_analysis_run(db, fingerprint)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No analysis runs found")
    return {"run": snapshot.model_dump()}


@app.get("/analysis-runs/{run_id}")
async def get_analysis_run_endpoint(run_id: str, req: Request):
    db = get_db(req)
    snapshot = await get_analysis_run(db, run_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Analysis run not found")
    return {"run": snapshot.model_dump()}


@app.post("/analyze/cancel")
async def cancel_analysis():
    cancelled = await analysis_runtime.cancel()
    logger.info("Analysis cancel requested: cancelled=%s", cancelled)
    return {"cancelled": cancelled}


@app.post("/analyze")
async def analyze(request: AnalyzeRequest, req: Request) -> AnalyzeResponse:
    if not request.tabs:
        raise HTTPException(status_code=400, detail="No tabs provided")

    await analysis_runtime.start_run()

    try:
        db = get_db(req)
        tab_count = len(request.tabs)
        start_time = time.time()
        settings = await get_app_settings(db)
        provider_chain = resolve_provider_chain(settings, request.providerOrder)
        cache_namespace = build_cache_namespace(settings)

        logger.info(f"Starting analysis: {tab_count} tabs, forceRefresh={request.forceRefresh}")

        # Step 1: Check cache
        all_urls = [tab.url for tab in request.tabs]

        if request.forceRefresh:
            cached = {}
        else:
            cached = await get_cached_urls(db, all_urls, cache_namespace)

        cached_tabs = [tab for tab in request.tabs if tab.url in cached]
        new_tabs = [tab for tab in request.tabs if tab.url not in cached]

        logger.info(f"Cache: {len(cached_tabs)} hits, {len(new_tabs)} misses")
        await add_runtime_log(
            db,
            "info",
            "analysis",
            f"Analysis started: {tab_count} tabs, {len(cached_tabs)} cache hits, {len(new_tabs)} new.",
        )

        # Step 2: Build recommendations from cache
        all_recommendations: list[dict[str, Any]] = []
        for tab in cached_tabs:
            entry = cached[tab.url]
            all_recommendations.append({
                "tabId": tab.id,
                "action": entry["action"],
                "confidence": entry["confidence"],
                "reason": entry["reason"],
                "suggestedGroupName": entry.get("suggestedGroupName"),
            })

        # Step 3: Analyze new tabs in batches
        total_metadata = AnalysisMetadata(
            durationMs=0, durationApiMs=0, totalCostUsd=None,
            inputTokens=0, outputTokens=0, tabCount=tab_count,
        )
        fallback_notices: list[str] = []
        tabs_saved = 0
        disabled_providers: set[str] = set()

        if new_tabs:
            batches = [new_tabs[i:i + BATCH_SIZE] for i in range(0, len(new_tabs), BATCH_SIZE)]
            logger.info(f"Processing {len(batches)} batch(es) of new tabs")

            for batch_idx, batch in enumerate(batches):
                if await analysis_runtime.is_cancelled():
                    logger.info("Analysis cancelled before batch %s/%s", batch_idx + 1, len(batches))
                    await add_runtime_log(db, "info", "analysis", "Analysis cancelled by user.")
                    break

                provider_error: Exception | None = None
                provider_used: str | None = None
                recs: list[dict[str, Any]] | None = None
                batch_meta: AnalysisMetadata | None = None
                batch_attempts: list[ProviderAttempt] = []
                active_chain = [provider for provider in provider_chain if provider not in disabled_providers]

                for provider in active_chain:
                    await add_runtime_log(
                        db,
                        "info",
                        "provider",
                        f"Batch {batch_idx + 1}/{len(batches)}: trying {provider}.",
                    )
                    try:
                        recs, batch_meta = await analyze_batch_via_provider(
                            provider, batch, settings,
                            db=db, session_timestamp=start_time, batch_index=batch_idx,
                        )
                        provider_used = provider
                        batch_attempts.append(ProviderAttempt(
                            provider=provider,
                            model=get_provider_model(provider, settings),
                            status="succeeded",
                        ))
                        await add_runtime_log(
                            db,
                            "info",
                            "provider",
                            f"Batch {batch_idx + 1}/{len(batches)}: {provider} succeeded"
                            + (f" ({batch_meta.modelUsed})" if batch_meta.modelUsed else "")
                            + ".",
                        )
                        break
                    except Exception as error:
                        provider_error = error
                        batch_attempts.append(ProviderAttempt(
                            provider=provider,
                            model=get_provider_model(provider, settings),
                            status="failed",
                            error=summarize_provider_error(error),
                        ))
                        if should_disable_provider_for_run(error):
                            disabled_providers.add(provider)
                        logger.warning(
                            "Provider %s failed for batch %s/%s: %s",
                            provider,
                            batch_idx + 1,
                            len(batches),
                            error,
                        )
                        await add_runtime_log(
                            db,
                            "warning",
                            "provider",
                            f"Batch {batch_idx + 1}/{len(batches)}: {provider} failed — {summarize_provider_error(error)}",
                        )

                if recs is not None and batch_meta is not None:
                    batch_meta.providerAttempts = batch_attempts
                    now = time.time()
                    analysis_source = "provider" if batch_meta.providerUsed else "heuristic"
                    db_entries = []
                    for rec in recs:
                        tab = next((t for t in batch if t.id == rec.get("tabId")), None)
                        if tab:
                            db_entries.append({
                                "url": f"{cache_namespace}::{tab.url}",
                                "action": rec["action"],
                                "confidence": rec["confidence"],
                                "reason": rec["reason"],
                                "suggestedGroupName": rec.get("suggestedGroupName"),
                                "analyzedAt": now,
                                "analysisSource": analysis_source,
                                "provider": batch_meta.providerUsed,
                                "model": batch_meta.modelUsed,
                            })
                        all_recommendations.append(rec)

                    await save_url_analyses(db, db_entries)
                    tabs_saved += len(db_entries)

                    total_metadata.durationMs += batch_meta.durationMs
                    total_metadata.durationApiMs += batch_meta.durationApiMs
                    total_metadata.inputTokens += batch_meta.inputTokens
                    total_metadata.outputTokens += batch_meta.outputTokens
                    total_metadata.providerUsed = batch_meta.providerUsed
                    total_metadata.modelUsed = batch_meta.modelUsed
                    total_metadata.providerAttempts.extend(batch_meta.providerAttempts)
                    if batch_meta.totalCostUsd is not None:
                        total_metadata.totalCostUsd = (total_metadata.totalCostUsd or 0) + batch_meta.totalCostUsd

                    logger.info(
                        "Batch %s/%s analyzed via %s: %s tabs, %s+%s tokens",
                        batch_idx + 1,
                        len(batches),
                        provider_used,
                        len(batch),
                        batch_meta.inputTokens,
                        batch_meta.outputTokens,
                    )
                else:
                    if provider_error is None and not provider_chain:
                        provider_error = RuntimeError("AI provider is disabled.")
                    total_metadata.providerAttempts.extend(batch_attempts)
                    error_msg = summarize_provider_error(provider_error) if provider_error else "No provider configured"
                    fallback_notice = classify_fallback_issue(provider_error or RuntimeError("No provider configured"))
                    fallback_notices.append(fallback_notice)
                    failed_urls = [tab.url for tab in batch]
                    logger.error(
                        "Batch %s/%s FAILED (not saved to DB): %s. Failed URLs: %s",
                        batch_idx + 1,
                        len(batches),
                        error_msg,
                        ", ".join(url[:80] for url in failed_urls[:5]) + (f" (+{len(failed_urls)-5} more)" if len(failed_urls) > 5 else ""),
                    )
                    await add_runtime_log(
                        db,
                        "error",
                        "provider",
                        f"Batch {batch_idx + 1}/{len(batches)}: all providers failed — {error_msg}. "
                        f"{len(batch)} URLs skipped (not saved): "
                        + ", ".join(url[:60] for url in failed_urls[:5])
                        + (f" (+{len(failed_urls)-5} more)" if len(failed_urls) > 5 else ""),
                    )
                    for tab in batch:
                        all_recommendations.append({
                            "tabId": tab.id,
                            "action": "keep",
                            "confidence": 0.0,
                            "reason": f"Error: {error_msg}. This tab was not analyzed.",
                        })

        # Step 4: Build full result
        fallback_summary = fallback_notices[0] if fallback_notices else None
        result = build_full_result(all_recommendations, request.tabs, fallback_summary)

        wall_time_ms = int((time.time() - start_time) * 1000)

        cache_stats = CacheStats(
            totalTabs=tab_count,
            tabsFromCache=len(cached_tabs),
            tabsAnalyzed=len(new_tabs),
            tabsSaved=tabs_saved,
            cacheHitRate=round(len(cached_tabs) / max(tab_count, 1), 3),
        )

        # Step 5: Save session
        action_breakdown = result.get("sessionStats", {}).get("actionBreakdown", {})
        await save_session(db, {
            "timestamp": time.time(),
            "tab_count": tab_count,
            "tabs_from_cache": len(cached_tabs),
            "tabs_analyzed": len(new_tabs),
            "duration_ms": total_metadata.durationMs,
            "duration_api_ms": total_metadata.durationApiMs,
            "wall_time_ms": wall_time_ms,
            "total_cost_usd": total_metadata.totalCostUsd,
            "input_tokens": total_metadata.inputTokens,
            "output_tokens": total_metadata.outputTokens,
            "action_breakdown_json": json.dumps(action_breakdown) if action_breakdown else None,
        })

        logger.info(
            f"Analysis complete: {tab_count} tabs ({len(cached_tabs)} cached, {len(new_tabs)} new), "
            f"{wall_time_ms}ms wall, {total_metadata.inputTokens}+{total_metadata.outputTokens} tokens, "
            f"${total_metadata.totalCostUsd or 0:.4f}"
        )
        await add_runtime_log(
            db,
            "info",
            "analysis",
            f"Analysis complete: {tab_count} tabs, provider={total_metadata.providerUsed or 'cache/heuristics'}, saved={tabs_saved}.",
        )

        return AnalyzeResponse(result=result, metadata=total_metadata, cacheStats=cache_stats)
    finally:
        await analysis_runtime.finish_run()


@app.get("/stats")
async def stats(req: Request):
    db = get_db(req)
    cursor = await db.execute(
        "SELECT COUNT(*) as cnt, "
        "COALESCE(SUM(total_cost_usd), 0) as cost, "
        "COALESCE(SUM(input_tokens), 0) as inp, "
        "COALESCE(SUM(output_tokens), 0) as outp, "
        "COALESCE(AVG(duration_ms), 0) as avg_dur "
        "FROM analysis_sessions"
    )
    row = await cursor.fetchone()
    return {
        "totalAnalyses": row["cnt"],
        "totalCostUsd": round(row["cost"], 6),
        "totalInputTokens": row["inp"],
        "totalOutputTokens": row["outp"],
        "avgDurationMs": int(row["avg_dur"]),
    }


@app.get("/history")
async def history(req: Request):
    db = get_db(req)
    cursor = await db.execute(
        "SELECT * FROM analysis_sessions ORDER BY timestamp DESC LIMIT 50"
    )
    rows = await cursor.fetchall()
    return {
        "analyses": [
            {
                "timestamp": row["timestamp"],
                "tabCount": row["tab_count"],
                "tabsFromCache": row["tabs_from_cache"],
                "tabsAnalyzed": row["tabs_analyzed"],
                "durationMs": row["duration_ms"],
                "wallTimeMs": row["wall_time_ms"],
                "totalCostUsd": row["total_cost_usd"],
                "inputTokens": row["input_tokens"],
                "outputTokens": row["output_tokens"],
            }
            for row in rows
        ]
    }


@app.post("/tab-history/events")
async def add_tab_history_event(payload: HistoryEventRecord, req: Request):
    db = get_db(req)
    inserted = await save_history_entries(db, [payload])
    return {"inserted": inserted}


@app.post("/tab-history/import")
async def import_tab_history(payload: HistoryImportRequest, req: Request):
    db = get_db(req)
    inserted = await save_history_entries(db, payload.entries)
    return {"inserted": inserted}


@app.get("/tab-history")
async def tab_history(timeframe: str, req: Request, limit: int = 0, offset: int = 0):
    db = get_db(req)
    stats, total = await get_history_stats(db, timeframe, limit=limit, offset=offset)
    return {"stats": stats, "total": total}


@app.post("/tab-history/prune")
async def prune_tab_history(payload: HistoryPruneRequest, req: Request):
    db = get_db(req)
    deleted = await prune_history_entries(db, payload.retentionDays)
    return {"deleted": deleted}


@app.get("/snapshots")
async def snapshots(req: Request):
    db = get_db(req)
    records = await list_snapshots(db)
    return {"snapshots": [record.model_dump() for record in records]}


@app.get("/snapshots/{snapshot_id}")
async def snapshot_detail(snapshot_id: str, req: Request):
    db = get_db(req)
    snapshot = await get_snapshot(db, snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {"snapshot": snapshot.model_dump()}


@app.post("/snapshots")
async def create_snapshot(payload: SaveSnapshotRequest, req: Request):
    db = get_db(req)
    await save_snapshots(db, [payload.snapshot], payload.maxStoredSnapshots)
    return {"snapshot": payload.snapshot.model_dump()}


@app.post("/snapshots/import")
async def import_snapshots(payload: ImportSnapshotsRequest, req: Request):
    db = get_db(req)
    inserted = await save_snapshots(db, payload.snapshots, payload.maxStoredSnapshots)
    return {"inserted": inserted}


@app.delete("/snapshots/{snapshot_id}")
async def remove_snapshot(snapshot_id: str, req: Request):
    db = get_db(req)
    deleted = await delete_snapshot(db, snapshot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {"deleted": True}


@app.get("/cache-stats")
async def cache_stats(req: Request):
    db = get_db(req)
    cursor = await db.execute(
        "SELECT COUNT(*) as cnt, MIN(analyzed_at) as oldest, MAX(analyzed_at) as newest "
        "FROM url_analysis"
    )
    row = await cursor.fetchone()
    return {
        "totalUrls": row["cnt"],
        "oldestEntry": row["oldest"],
        "newestEntry": row["newest"],
    }


@app.get("/cache/urls")
async def get_cache_urls(
    req: Request,
    limit: int = 50,
    offset: int = 0,
    domain: str | None = None,
    action: str | None = None,
):
    db = get_db(req)
    bounded_limit = max(1, min(limit, 200))
    conditions: list[str] = []
    params: list[object] = []
    if domain:
        conditions.append("url LIKE ?")
        params.append(f"%{domain}%")
    if action:
        conditions.append("action = ?")
        params.append(action)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    cursor = await db.execute(
        f"SELECT url, action, confidence, reason, suggested_group_name, analyzed_at, analysis_source, provider, model "
        f"FROM url_analysis{where} ORDER BY analyzed_at DESC LIMIT ? OFFSET ?",
        (*params, bounded_limit, offset),
    )
    rows = await cursor.fetchall()
    count_cursor = await db.execute(f"SELECT COUNT(*) as cnt FROM url_analysis{where}", params)
    count_row = await count_cursor.fetchone()
    return {
        "entries": [
            {
                "url": row["url"],
                "action": row["action"],
                "confidence": row["confidence"],
                "reason": row["reason"],
                "suggestedGroupName": row["suggested_group_name"],
                "analyzedAt": row["analyzed_at"],
                "analysisSource": row["analysis_source"] or "provider",
                "provider": row["provider"],
                "model": row["model"],
            }
            for row in rows
        ],
        "total": count_row["cnt"],
    }


class DeleteCacheUrlsRequest(BaseModel):
    urls: list[str] | None = None
    domainPattern: str | None = None


@app.delete("/cache/urls")
async def delete_cache_urls(payload: DeleteCacheUrlsRequest, req: Request):
    if not payload.urls and not payload.domainPattern:
        raise HTTPException(status_code=400, detail="Provide urls or domainPattern")
    db = get_db(req)
    deleted = 0
    if payload.urls:
        placeholders = ",".join("?" for _ in payload.urls)
        cursor = await db.execute(
            f"DELETE FROM url_analysis WHERE url IN ({placeholders})",
            payload.urls,
        )
        deleted += cursor.rowcount
    if payload.domainPattern:
        cursor = await db.execute(
            "DELETE FROM url_analysis WHERE url LIKE ?",
            (f"%{payload.domainPattern}%",),
        )
        deleted += cursor.rowcount
    await db.commit()
    return {"deleted": deleted}


@app.get("/sessions")
async def get_sessions(req: Request, limit: int = 50, offset: int = 0):
    db = get_db(req)
    bounded_limit = max(1, min(limit, 200))
    cursor = await db.execute(
        "SELECT * FROM analysis_sessions ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (bounded_limit, offset),
    )
    rows = await cursor.fetchall()
    return {
        "sessions": [
            {
                "id": row["id"],
                "timestamp": row["timestamp"],
                "tabCount": row["tab_count"],
                "tabsFromCache": row["tabs_from_cache"],
                "tabsAnalyzed": row["tabs_analyzed"],
                "durationMs": row["duration_ms"],
                "durationApiMs": row["duration_api_ms"],
                "wallTimeMs": row["wall_time_ms"],
                "totalCostUsd": row["total_cost_usd"],
                "inputTokens": row["input_tokens"],
                "outputTokens": row["output_tokens"],
            }
            for row in rows
        ],
    }


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: int, req: Request):
    db = get_db(req)
    cursor = await db.execute("DELETE FROM analysis_sessions WHERE id = ?", (session_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.commit()
    return {"deleted": True}


@app.get("/insights")
async def get_insights(req: Request):
    db = get_db(req)

    # Top domains from tab history
    domain_cursor = await db.execute(
        "SELECT domain, COUNT(*) as cnt FROM tab_history_events "
        "WHERE domain IS NOT NULL AND domain != '' "
        "GROUP BY domain ORDER BY cnt DESC LIMIT 10"
    )
    domain_rows = await domain_cursor.fetchall()
    top_domains = [{"domain": r["domain"], "count": r["cnt"]} for r in domain_rows]

    # Average analysis stats
    stats_cursor = await db.execute(
        "SELECT COUNT(*) as total, "
        "AVG(tab_count) as avg_tabs, "
        "AVG(total_cost_usd) as avg_cost, "
        "AVG(duration_ms) as avg_duration "
        "FROM analysis_sessions"
    )
    stats_row = await stats_cursor.fetchone()
    avg_analysis_stats = {
        "avgTabs": round(stats_row["avg_tabs"] or 0, 1),
        "avgCost": round(stats_row["avg_cost"], 6) if stats_row["avg_cost"] is not None else None,
        "avgDurationMs": round(stats_row["avg_duration"] or 0),
        "totalSessions": stats_row["total"],
    }

    # Snapshot trend (last 20 snapshots)
    snap_cursor = await db.execute(
        "SELECT created_at, total_tabs FROM snapshots ORDER BY created_at DESC LIMIT 20"
    )
    snap_rows = await snap_cursor.fetchall()
    snapshot_trend = [
        {"timestamp": r["created_at"], "tabCount": r["total_tabs"]}
        for r in reversed(list(snap_rows))
    ]

    return {
        "topDomains": top_domains,
        "avgAnalysisStats": avg_analysis_stats,
        "snapshotTrend": snapshot_trend,
    }


@app.get("/habits-score")
async def habits_score(req: Request):
    db = get_db(req)
    now_s = time.time()
    now_ms = int(now_s * 1000)

    # Component 1: Closable % from last 5 sessions with action_breakdown_json
    cursor = await db.execute(
        "SELECT action_breakdown_json FROM analysis_sessions "
        "WHERE action_breakdown_json IS NOT NULL "
        "ORDER BY timestamp DESC LIMIT 5"
    )
    breakdown_rows = await cursor.fetchall()
    if breakdown_rows:
        total_tabs = 0
        total_closable = 0
        for row in breakdown_rows:
            bd = json.loads(row["action_breakdown_json"])
            session_total = sum(bd.values())
            total_tabs += session_total
            total_closable += bd.get("close", 0)
        closable_pct = (total_closable / max(total_tabs, 1)) * 100
        closable_score = max(0.0, min(100.0, 100 - closable_pct * 2))
    else:
        closable_pct = 0
        closable_score = 50.0

    # Component 2: Cleanup frequency (pre-cleanup snapshots in last 30d)
    cutoff_30d = now_s - 30 * 86400
    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM snapshots WHERE trigger = 'pre-cleanup' AND created_at > ?",
        (cutoff_30d,),
    )
    cleanup_row = await cursor.fetchone()
    cleanup_count = cleanup_row["cnt"]
    cleanup_score = min(100.0, cleanup_count * 25.0)  # 4+ per month = 100

    # Component 3: Average tab age (open tabs without close event)
    cursor = await db.execute(
        "SELECT MIN(timestamp) as first_seen, url FROM tab_history_events "
        "WHERE event = 'opened' AND url NOT IN ("
        "  SELECT url FROM tab_history_events WHERE event = 'closed' "
        "  AND timestamp > (SELECT MAX(timestamp) FROM tab_history_events e2 WHERE e2.url = tab_history_events.url AND e2.event = 'opened')"
        ") GROUP BY url"
    )
    open_rows = await cursor.fetchall()
    if open_rows:
        avg_age_ms = sum(now_ms - row["first_seen"] for row in open_rows) / len(open_rows)
        avg_age_days = avg_age_ms / (86400 * 1000)
        age_score = max(0.0, min(100.0, 100 - (avg_age_days / 14) * 100))
    else:
        avg_age_days = 0
        age_score = 50.0

    # Component 4: Tab count trend (from last 10 snapshots, simple linear)
    cursor = await db.execute(
        "SELECT total_tabs FROM snapshots ORDER BY created_at DESC LIMIT 10"
    )
    snap_rows = await cursor.fetchall()
    if len(snap_rows) >= 2:
        counts = [row["total_tabs"] for row in reversed(list(snap_rows))]
        n = len(counts)
        x_mean = (n - 1) / 2
        y_mean = sum(counts) / n
        num = sum((i - x_mean) * (c - y_mean) for i, c in enumerate(counts))
        denom = sum((i - x_mean) ** 2 for i in range(n))
        slope = num / denom if denom != 0 else 0
        if slope < -1:
            trend_score = 100.0
        elif slope > 1:
            trend_score = 0.0
        else:
            trend_score = 50.0 - slope * 25
        trend_score = max(0.0, min(100.0, trend_score))
    else:
        trend_score = 50.0

    # Composite score
    composite = (
        closable_score * 0.30
        + cleanup_score * 0.20
        + age_score * 0.25
        + trend_score * 0.25
    )
    score = int(round(composite))

    # Trend: compare with 7d-ago (simplified: just report based on score level)
    trend: str = "stable"
    if breakdown_rows and len(snap_rows) >= 2:
        # Check if recent sessions have lower closable % than older
        if closable_score > 65 and trend_score > 55:
            trend = "improving"
        elif closable_score < 35 or trend_score < 30:
            trend = "declining"

    return {
        "score": score,
        "trend": trend,
        "components": [
            {"name": "closablePercent", "value": round(closable_pct, 1), "normalizedScore": round(closable_score, 1), "weight": 0.30},
            {"name": "cleanupFrequency", "value": cleanup_count, "normalizedScore": round(cleanup_score, 1), "weight": 0.20},
            {"name": "avgTabAge", "value": round(avg_age_days, 1), "normalizedScore": round(age_score, 1), "weight": 0.25},
            {"name": "tabCountTrend", "value": round(trend_score, 1), "normalizedScore": round(trend_score, 1), "weight": 0.25},
        ],
        "computedAt": int(now_s * 1000),
    }


class TrackRecommendationRequest(BaseModel):
    tabUrl: str
    tabTitle: str | None = None
    aiAction: str
    userAction: Literal["accepted", "skipped", "modified"]
    confidence: float
    sessionTimestamp: float | None = None


class MergeClustersRequest(BaseModel):
    clusters: list[dict[str, Any]]


class RenameClusterRequest(BaseModel):
    name: str


@app.post("/recommendation-actions")
async def track_recommendation(payload: TrackRecommendationRequest, req: Request):
    db = get_db(req)
    await db.execute(
        "INSERT INTO recommendation_actions "
        "(timestamp, tab_url, tab_title, ai_action, user_action, confidence, session_timestamp) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (time.time() * 1000, payload.tabUrl, payload.tabTitle, payload.aiAction,
         payload.userAction, payload.confidence, payload.sessionTimestamp),
    )
    await db.commit()
    return {"success": True}


@app.get("/recommendation-stats")
async def recommendation_stats(req: Request):
    db = get_db(req)
    cursor = await db.execute(
        "SELECT ai_action, user_action, COUNT(*) as cnt, AVG(confidence) as avg_conf "
        "FROM recommendation_actions GROUP BY ai_action, user_action"
    )
    rows = await cursor.fetchall()

    total = 0
    accepted = 0
    by_action: dict[str, dict[str, Any]] = {}
    for row in rows:
        ai_act = row["ai_action"]
        user_act = row["user_action"]
        cnt = row["cnt"]
        total += cnt
        if user_act == "accepted":
            accepted += cnt
        if ai_act not in by_action:
            by_action[ai_act] = {"total": 0, "accepted": 0, "skipped": 0, "modified": 0, "avgConfidence": 0}
        by_action[ai_act]["total"] += cnt
        by_action[ai_act][user_act] += cnt

    # Compute avg confidence per action
    for act in by_action:
        cursor2 = await db.execute(
            "SELECT AVG(confidence) as avg_conf FROM recommendation_actions WHERE ai_action = ?",
            (act,),
        )
        r = await cursor2.fetchone()
        by_action[act]["avgConfidence"] = round(r["avg_conf"] or 0, 3)

    # Confidence buckets
    bucket_cursor = await db.execute(
        "SELECT "
        "CASE WHEN confidence < 0.5 THEN '0-50%' "
        "     WHEN confidence < 0.7 THEN '50-70%' "
        "     WHEN confidence < 0.9 THEN '70-90%' "
        "     ELSE '90-100%' END as bucket, "
        "COUNT(*) as total, "
        "SUM(CASE WHEN user_action = 'accepted' THEN 1 ELSE 0 END) as accepted "
        "FROM recommendation_actions GROUP BY bucket"
    )
    bucket_rows = await bucket_cursor.fetchall()
    confidence_correlation = [
        {"bucket": row["bucket"], "acceptanceRate": round(row["accepted"] / max(row["total"], 1), 3)}
        for row in bucket_rows
    ]

    return {
        "totalActions": total,
        "acceptanceRate": round(accepted / max(total, 1), 3),
        "byAiAction": by_action,
        "confidenceCorrelation": confidence_correlation,
    }


@app.get("/activity-heatmap")
async def activity_heatmap(req: Request, domain: str | None = None):
    db = get_db(req)
    where_clause = "WHERE domain = ?" if domain else ""
    params: list[object] = [domain] if domain else []

    cursor = await db.execute(
        f"SELECT "
        f"  CAST(strftime('%w', timestamp / 1000, 'unixepoch') AS INTEGER) as day_of_week, "
        f"  CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) as hour, "
        f"  COUNT(*) as event_count "
        f"FROM tab_history_events {where_clause} "
        f"GROUP BY day_of_week, hour "
        f"ORDER BY day_of_week, hour",
        params,
    )
    rows = await cursor.fetchall()

    grid = [[0] * 24 for _ in range(7)]
    for row in rows:
        grid[row["day_of_week"]][row["hour"]] = row["event_count"]

    domain_cursor = await db.execute(
        "SELECT DISTINCT domain FROM tab_history_events "
        "WHERE domain IS NOT NULL AND domain != '' "
        "ORDER BY domain LIMIT 100"
    )
    domains = [r["domain"] for r in await domain_cursor.fetchall()]

    return {"grid": grid, "domains": domains}


@app.get("/clusters")
async def list_clusters(req: Request):
    db = get_db(req)
    rows = await db.execute_fetchall(
        "SELECT id, name, description, tags_json, tab_urls_json, created_at, updated_at "
        "FROM topic_clusters ORDER BY updated_at DESC"
    )
    clusters = []
    for row in rows:
        clusters.append({
            "id": row[0],
            "name": row[1],
            "description": row[2],
            "tags": json.loads(row[3]) if row[3] else [],
            "tabUrls": json.loads(row[4]) if row[4] else [],
            "createdAt": row[5],
            "updatedAt": row[6],
        })
    return {"clusters": clusters}


@app.post("/clusters/merge")
async def merge_clusters(payload: MergeClustersRequest, req: Request):
    db = get_db(req)
    now = time.time() * 1000
    merged_count = 0
    created_count = 0

    for incoming in payload.clusters:
        incoming_name = incoming.get("name", "").strip()
        incoming_desc = incoming.get("description", "")
        incoming_tags: list[str] = incoming.get("tags", [])
        incoming_urls: list[str] = incoming.get("tabUrls", [])
        if not incoming_name:
            continue

        # Try case-insensitive name match
        row = await db.execute_fetchall(
            "SELECT id, description, tags_json, tab_urls_json FROM topic_clusters WHERE LOWER(name) = LOWER(?)",
            (incoming_name,),
        )

        matched_id: int | None = None

        if row:
            matched_id = row[0][0]
        else:
            # Try tag overlap (2+ shared tags)
            if incoming_tags:
                all_rows = await db.execute_fetchall(
                    "SELECT id, tags_json FROM topic_clusters"
                )
                for existing_row in all_rows:
                    existing_tags = json.loads(existing_row[1]) if existing_row[1] else []
                    overlap = set(t.lower() for t in incoming_tags) & set(t.lower() for t in existing_tags)
                    if len(overlap) >= 2:
                        matched_id = existing_row[0]
                        break

        if matched_id is not None:
            # Merge: union URLs, merge tags, update description
            existing = await db.execute_fetchall(
                "SELECT description, tags_json, tab_urls_json FROM topic_clusters WHERE id = ?",
                (matched_id,),
            )
            existing_description = existing[0][0] or ""
            existing_tags = json.loads(existing[0][1]) if existing[0][1] else []
            existing_urls = json.loads(existing[0][2]) if existing[0][2] else []

            merged_tags = list(dict.fromkeys(existing_tags + incoming_tags))
            merged_urls = list(dict.fromkeys(existing_urls + incoming_urls))

            await db.execute(
                "UPDATE topic_clusters SET description = ?, tags_json = ?, tab_urls_json = ?, updated_at = ? WHERE id = ?",
                (incoming_desc or existing_description, json.dumps(merged_tags), json.dumps(merged_urls), now, matched_id),
            )
            merged_count += 1
        else:
            # Insert new cluster
            await db.execute(
                "INSERT INTO topic_clusters (name, description, tags_json, tab_urls_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (incoming_name, incoming_desc, json.dumps(incoming_tags), json.dumps(incoming_urls), now, now),
            )
            created_count += 1

    await db.commit()
    return {"merged": merged_count, "created": created_count}


@app.put("/clusters/{cluster_id}")
async def rename_cluster(cluster_id: int, payload: RenameClusterRequest, req: Request):
    db = get_db(req)
    now = time.time() * 1000
    result = await db.execute(
        "UPDATE topic_clusters SET name = ?, updated_at = ? WHERE id = ?",
        (payload.name, now, cluster_id),
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Cluster not found")
    await db.commit()
    return {"ok": True}


@app.delete("/clusters/{cluster_id}")
async def delete_cluster(cluster_id: int, req: Request):
    db = get_db(req)
    result = await db.execute(
        "DELETE FROM topic_clusters WHERE id = ?",
        (cluster_id,),
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Cluster not found")
    await db.commit()
    return {"ok": True}


@app.get("/llm-call-logs")
async def llm_call_logs(req: Request, limit: int = 50, session_timestamp: float | None = None, provider: str | None = None):
    db = get_db(req)
    logs = await list_llm_call_logs(db, limit=limit, session_timestamp=session_timestamp, provider=provider)
    return {"logs": [log.model_dump() for log in logs]}


CHAT_SEARCH_SYSTEM_PROMPT = """You are a browser tab copilot working over SQLite-backed browser memory.

You receive:
- the current user question,
- a short conversation history,
- retrieved tab/context snippets from SQLite.

Return JSON with this schema:
{
  "answer": "short helpful answer in the user's language",
  "results": [
    {
      "url": "exact url from context",
      "reason": "why this tab matters for the question",
      "relevanceScore": 0.0 to 1.0
    }
  ],
  "followUpSuggestions": ["optional short follow-up prompt"]
}

Rules:
- Use ONLY the provided context. Do not invent tabs or URLs.
- Keep the answer concise but useful.
- Respect the user's language.
- If the user asks for a review, summarize themes, cleanup opportunities, and notable items from the context.
- Only return URLs that were present in the retrieved context.
- Only include genuinely relevant results.
- Return ONLY valid JSON, no markdown fences, no extra text."""

CHAT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "reason": {"type": "string"},
                    "relevanceScore": {"type": "number"},
                },
                "required": ["url", "reason", "relevanceScore"],
                "additionalProperties": False,
            },
        },
        "followUpSuggestions": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["answer", "results", "followUpSuggestions"],
    "additionalProperties": False,
}

CHAT_TIMEOUT_SECONDS = 45


class ChatSearchHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    resultUrls: list[str] = Field(default_factory=list)


class ChatSearchRequest(BaseModel):
    query: str
    history: list[ChatSearchHistoryMessage] = Field(default_factory=list)
    maxResults: int = 30


def strip_provider_prefix(raw_url: str) -> str:
    if "::" in raw_url and not raw_url.startswith(("http", "file", "chrome")):
        return raw_url.split("::", 1)[1]
    return raw_url


def is_cyrillic_text(text: str) -> bool:
    return bool(re.search(r"[А-Яа-яЁё]", text))


def build_chat_fallback_answer(
    query_str: str,
    results: list[dict[str, Any]],
    fallback_notice: str | None = None,
) -> str:
    if not results:
        return (
            "Не нашёл подходящих вкладок в SQLite-данных."
            if is_cyrillic_text(query_str)
            else "I could not find matching tabs in the SQLite-backed data."
        )

    close_count = sum(1 for result in results if result.get("action") == "close")
    read_later_count = sum(1 for result in results if result.get("action") == "read_later")
    top_domains = dedupe_strings([result.get("domain", "") for result in results if result.get("domain")])[:3]
    prefix = f"{fallback_notice} " if fallback_notice else ""

    if is_cyrillic_text(query_str):
        parts = [f"Нашёл {len(results)} релевантных вкладок"]
        if top_domains:
            parts.append(f"основные домены: {', '.join(top_domains)}")
        if close_count:
            parts.append(f"{close_count} можно закрыть")
        if read_later_count:
            parts.append(f"{read_later_count} стоит отложить на потом")
        return prefix + ". ".join(parts) + "."

    parts = [f"I found {len(results)} relevant tabs"]
    if top_domains:
        parts.append(f"top domains: {', '.join(top_domains)}")
    if close_count:
        parts.append(f"{close_count} look closable")
    if read_later_count:
        parts.append(f"{read_later_count} fit a read-later pass")
    return prefix + ". ".join(parts) + "."


def build_chat_follow_ups(query_str: str, results: list[dict[str, Any]]) -> list[str]:
    if is_cyrillic_text(query_str):
        suggestions = [
            "Покажи только самые полезные вкладки",
            "Сделай короткое ревью по этим вкладкам",
            "Какие из них можно закрыть прямо сейчас?",
        ]
    else:
        suggestions = [
            "Show only the most important tabs",
            "Give me a short review of these tabs",
            "Which of these can I close right now?",
        ]

    if any(result.get("action") == "close" for result in results):
        suggestions.insert(0, "Сфокусируйся на кандидатах на закрытие" if is_cyrillic_text(query_str) else "Focus on close candidates")

    return dedupe_strings(suggestions)[:3]


async def run_claude_json_prompt(
    prompt: str,
    system_prompt: str,
    settings: AppSettings,
    timeout_seconds: int,
) -> tuple[dict[str, Any], AnalysisMetadata]:
    logger.info("run_claude_json_prompt: %d chars prompt, %d chars system, timeout=%ds", len(prompt), len(system_prompt), timeout_seconds)
    metadata = AnalysisMetadata(
        durationMs=0,
        durationApiMs=0,
        totalCostUsd=None,
        inputTokens=0,
        outputTokens=0,
        tabCount=0,
        providerUsed="claude_code",
        modelUsed=get_provider_model("claude_code", settings),
    )
    result_text: str | None = None
    stream_error: Exception | None = None
    stderr_lines: list[str] = []

    def capture_stderr(line: str) -> None:
        logger.warning("Claude CLI stderr: %s", line)
        stderr_lines.append(line)

    async def consume_query() -> None:
        nonlocal result_text, metadata
        async for message in query(
            prompt=prompt,
            options=ClaudeAgentOptions(
                system_prompt=system_prompt,
                max_turns=1,
                allowed_tools=[],
                output_format={"type": "json"},
                cli_path=resolve_cli_path(settings.claudeCliPath, "claude"),
                stderr=capture_stderr,
            ),
        ):
            if isinstance(message, ResultMessage):
                result_text = message.result
                metadata.durationMs = message.duration_ms
                metadata.durationApiMs = message.duration_api_ms
                metadata.totalCostUsd = message.total_cost_usd
                if message.usage:
                    metadata.inputTokens = message.usage.get("input_tokens", 0)
                    metadata.outputTokens = message.usage.get("output_tokens", 0)

    try:
        await asyncio.wait_for(consume_query(), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        stream_error = RuntimeError(f"Claude Code CLI timed out after {timeout_seconds}s")
    except Exception as exc:
        stream_error = exc

    if not result_text:
        base_error = stream_error or RuntimeError("Claude Code CLI returned no JSON response.")
        if stderr_lines:
            stderr_tail = "\n".join(stderr_lines[-10:])
            raise RuntimeError(f"{base_error} | stderr: {stderr_tail}") from base_error
        raise base_error
    return parse_ai_response(result_text), metadata


async def run_codex_json_prompt(
    prompt: str,
    system_prompt: str,
    schema: dict[str, Any],
    settings: AppSettings,
    timeout_seconds: int,
) -> tuple[dict[str, Any], AnalysisMetadata]:
    logger.info("run_codex_json_prompt: %d chars prompt, %d chars system, timeout=%ds", len(prompt), len(system_prompt), timeout_seconds)
    codex_path = resolve_cli_path(settings.codexCliPath, "codex")
    started_at = time.time()

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as schema_file:
        json.dump(schema, schema_file)
        schema_path = schema_file.name

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as output_file:
        output_path = output_file.name

    command = [
        codex_path,
        "exec",
        "--skip-git-repo-check",
        "--output-schema",
        schema_path,
        "-o",
        output_path,
        "--color",
        "never",
    ]
    if settings.codexModel.strip():
        command.extend(["-m", settings.codexModel.strip()])
    command.append(f"{system_prompt}\n\n{prompt}")

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(APP_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise RuntimeError(f"Codex CLI timed out after {timeout_seconds}s") from exc

        stdout_text = stdout_bytes.decode("utf-8", errors="replace")
        stderr_text = stderr_bytes.decode("utf-8", errors="replace")
        if stderr_text.strip():
            for line in stderr_text.strip().splitlines()[-5:]:
                logger.warning("Codex CLI stderr: %s", line.strip())
        result_text = Path(output_path).read_text(encoding="utf-8").strip()
        if process.returncode != 0 and not result_text:
            raise RuntimeError(
                f"Codex CLI exited with code {process.returncode}. {stderr_text or stdout_text}".strip()
            )
        if not result_text:
            raise RuntimeError("Codex CLI returned an empty JSON response.")

        duration_ms = int((time.time() - started_at) * 1000)
        metadata = AnalysisMetadata(
            durationMs=duration_ms,
            durationApiMs=duration_ms,
            totalCostUsd=None,
            inputTokens=0,
            outputTokens=parse_codex_total_tokens(stderr_text),
            tabCount=0,
            providerUsed="codex_cli",
            modelUsed=get_provider_model("codex_cli", settings),
        )
        return parse_ai_response(result_text), metadata
    finally:
        Path(schema_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)


def build_chat_search_prompt(
    query_str: str,
    history: list[ChatSearchHistoryMessage],
    candidates: list[dict[str, Any]],
) -> str:
    conversation_lines: list[str] = []
    for message in history[-6:]:
        role = "User" if message.role == "user" else "Assistant"
        conversation_lines.append(f"{role}: {message.content}")
        if message.resultUrls:
            conversation_lines.append(f"{role} result URLs: {', '.join(message.resultUrls[:5])}")
    conversation_lines.append(f"User: {query_str}")

    context_lines: list[str] = []
    for index, entry in enumerate(candidates, start=1):
        context_lines.append(
            f"[{index}] {entry['title']} | {entry['domain']} | {entry['url']}\n"
            f"source={entry['source']}; visits={entry.get('visitCount', 0)}; "
            f"lastVisitedAt={entry.get('lastVisitedAt')}; "
            f"action={entry.get('action')}; "
            f"clusterNames={', '.join(entry.get('clusterNames', []))}; "
            f"tags={', '.join(entry.get('tags', []))}; "
            f"aiReason={entry.get('reason', '')}"
        )

    return (
        "Conversation so far:\n"
        + "\n".join(conversation_lines)
        + "\n\nRetrieved SQLite context:\n"
        + "\n".join(context_lines)
        + "\n\nReturn the best answer and the most relevant URLs."
    )


async def collect_chat_candidates(
    db: aiosqlite.Connection,
    query_str: str,
    history: list[ChatSearchHistoryMessage],
) -> list[dict[str, Any]]:
    recent_user_context = [message.content for message in history[-4:] if message.role == "user"]
    recent_result_urls = dedupe_strings([
        url
        for message in history[-4:]
        for url in message.resultUrls[:8]
    ])
    search_text = " ".join(recent_user_context + [query_str]).strip()
    keywords = dedupe_strings(tokenize_theme_text(search_text))
    if not keywords:
        keywords = dedupe_strings([
            match.lower()
            for match in re.findall(r"[0-9A-Za-zА-Яа-яЁё]{2,}", search_text)
        ])

    def merge_candidate(
        candidates: dict[str, dict[str, Any]],
        url: str,
        payload: dict[str, Any],
    ) -> None:
        entry = candidates.get(url)
        if entry is None:
            candidates[url] = payload
            return

        entry["title"] = payload.get("title") or entry.get("title") or url
        entry["domain"] = payload.get("domain") or entry.get("domain") or ""
        entry["reason"] = payload.get("reason") or entry.get("reason") or ""
        entry["source"] = "url_analysis" if entry.get("source") == "url_analysis" else payload.get("source", entry.get("source"))
        entry["action"] = entry.get("action") or payload.get("action")
        entry["analyzedAt"] = max(entry.get("analyzedAt") or 0, payload.get("analyzedAt") or 0) or None
        entry["visitCount"] = max(entry.get("visitCount") or 0, payload.get("visitCount") or 0)
        entry["lastVisitedAt"] = max(entry.get("lastVisitedAt") or 0, payload.get("lastVisitedAt") or 0) or None
        entry["provider"] = entry.get("provider") or payload.get("provider")
        entry["model"] = entry.get("model") or payload.get("model")
        entry["clusterNames"] = dedupe_strings((entry.get("clusterNames") or []) + (payload.get("clusterNames") or []))
        entry["tags"] = dedupe_strings((entry.get("tags") or []) + (payload.get("tags") or []))

    candidates: dict[str, dict[str, Any]] = {}
    patterns = [f"%{keyword}%" for keyword in keywords[:6]]

    if patterns:
        analysis_like = " OR ".join(["url LIKE ? OR reason LIKE ? OR suggested_group_name LIKE ?"] * len(patterns))
        history_like = " OR ".join(["url LIKE ? OR title LIKE ? OR domain LIKE ?"] * len(patterns))
        pattern_params = [item for pattern in patterns for item in (pattern, pattern, pattern)]
        cursor = await db.execute(
            f"SELECT * FROM ("
            f"SELECT url, action, NULL as confidence, reason, suggested_group_name, analyzed_at, provider, model, "
            f"NULL as visit_count, NULL as last_ts, NULL as any_title, NULL as any_domain, 'url_analysis' as src "
            f"FROM url_analysis WHERE {analysis_like} ORDER BY analyzed_at DESC LIMIT 250"
            f") UNION ALL SELECT * FROM ("
            f"SELECT url, NULL, NULL, NULL, NULL, NULL, NULL, NULL, "
            f"COUNT(*) as visit_count, MAX(timestamp) as last_ts, "
            f"MAX(COALESCE(NULLIF(title, ''), url)) as any_title, MAX(domain) as any_domain, 'tab_history' as src "
            f"FROM tab_history_events WHERE {history_like} "
            f"GROUP BY url ORDER BY last_ts DESC LIMIT 250"
            f")",
            pattern_params + pattern_params,
        )
        for row in await cursor.fetchall():
            if row["src"] == "url_analysis":
                url = strip_provider_prefix(row["url"])
                domain = ""
                try:
                    domain = urlparse(url).hostname or ""
                except Exception:
                    pass
                merge_candidate(candidates, url, {
                    "url": url,
                    "title": url,
                    "domain": domain,
                    "reason": row["reason"] or "",
                    "source": "url_analysis",
                    "action": row["action"],
                    "analyzedAt": int((row["analyzed_at"] or 0) * 1000) if row["analyzed_at"] is not None else None,
                    "provider": row["provider"],
                    "model": row["model"],
                    "clusterNames": [row["suggested_group_name"]] if row["suggested_group_name"] else [],
                    "tags": [],
                })
            else:
                merge_candidate(candidates, row["url"], {
                    "url": row["url"],
                    "title": row["any_title"] or row["url"],
                    "domain": row["any_domain"] or "",
                    "reason": "",
                    "source": "tab_history",
                    "visitCount": row["visit_count"] or 0,
                    "lastVisitedAt": row["last_ts"],
                    "clusterNames": [],
                    "tags": [],
                })

        cluster_like = " OR ".join(["name LIKE ? OR description LIKE ? OR tags_json LIKE ?"] * len(patterns))
        cursor = await db.execute(
            f"SELECT name, description, tags_json, tab_urls_json FROM topic_clusters WHERE {cluster_like}",
            [item for pattern in patterns for item in (pattern, pattern, pattern)],
        )
        for row in await cursor.fetchall():
            tags = json.loads(row["tags_json"] or "[]")
            urls = json.loads(row["tab_urls_json"] or "[]")
            for url in urls[:60]:
                domain = ""
                try:
                    domain = urlparse(url).hostname or ""
                except Exception:
                    pass
                merge_candidate(candidates, url, {
                    "url": url,
                    "title": url,
                    "domain": domain,
                    "reason": row["description"] or f"From cluster: {row['name']}",
                    "source": "cluster",
                    "clusterNames": [row["name"]],
                    "tags": tags,
                })

    if recent_result_urls:
        placeholders = ",".join("?" for _ in recent_result_urls)
        cursor = await db.execute(
            f"SELECT url, MAX(timestamp) as last_ts, COUNT(*) as visit_count, "
            f"MAX(COALESCE(NULLIF(title, ''), url)) as any_title, MAX(domain) as any_domain "
            f"FROM tab_history_events WHERE url IN ({placeholders}) GROUP BY url",
            recent_result_urls,
        )
        for row in await cursor.fetchall():
            merge_candidate(candidates, row["url"], {
                "url": row["url"],
                "title": row["any_title"] or row["url"],
                "domain": row["any_domain"] or "",
                "reason": "From the previous chat result set." if not is_cyrillic_text(query_str) else "Из предыдущего набора результатов.",
                "source": "tab_history",
                "visitCount": row["visit_count"] or 0,
                "lastVisitedAt": row["last_ts"],
                "clusterNames": [],
                "tags": [],
            })

    if not candidates:
        cursor = await db.execute(
            "SELECT url, action, reason, suggested_group_name, analyzed_at, provider, model "
            "FROM url_analysis ORDER BY analyzed_at DESC LIMIT 40"
        )
        for row in await cursor.fetchall():
            url = strip_provider_prefix(row["url"])
            domain = ""
            try:
                domain = urlparse(url).hostname or ""
            except Exception:
                pass
            merge_candidate(candidates, url, {
                "url": url,
                "title": url,
                "domain": domain,
                "reason": row["reason"] or "",
                "source": "url_analysis",
                "action": row["action"],
                "analyzedAt": int((row["analyzed_at"] or 0) * 1000) if row["analyzed_at"] is not None else None,
                "provider": row["provider"],
                "model": row["model"],
                "clusterNames": [row["suggested_group_name"]] if row["suggested_group_name"] else [],
                "tags": [],
            })

    urls_needing_title = [url for url, entry in candidates.items() if not entry.get("title") or entry.get("title") == url]
    if urls_needing_title:
        placeholders = ",".join("?" for _ in urls_needing_title)
        cursor = await db.execute(
            f"SELECT url, title, domain, timestamp FROM tab_history_events "
            f"WHERE url IN ({placeholders}) AND title != '' ORDER BY timestamp DESC",
            urls_needing_title,
        )
        seen_urls: set[str] = set()
        for row in await cursor.fetchall():
            if row["url"] in seen_urls:
                continue
            seen_urls.add(row["url"])
            merge_candidate(candidates, row["url"], {
                "url": row["url"],
                "title": row["title"],
                "domain": row["domain"] or "",
                "reason": "",
                "source": "tab_history",
                "lastVisitedAt": row["timestamp"],
                "clusterNames": [],
                "tags": [],
            })

    scored: list[dict[str, Any]] = []
    query_lower = search_text.lower()
    cleanup_terms = {"close", "cleanup", "review", "archive", "закры", "очист", "разбери", "ревью"}
    read_terms = {"read", "later", "queue", "почит", "отлож"}
    for entry in candidates.values():
        text = " ".join([
            entry.get("title", ""),
            entry.get("url", ""),
            entry.get("domain", ""),
            entry.get("reason", ""),
            " ".join(entry.get("clusterNames", [])),
            " ".join(entry.get("tags", [])),
        ]).lower()
        match_count = sum(1 for keyword in keywords if keyword in text)
        phrase_hit = 1 if query_str.lower() in text else 0
        source_boost = {"url_analysis": 0.2, "cluster": 0.15, "tab_history": 0.1}.get(entry.get("source"), 0.05)
        context_boost = 0.15 if entry["url"] in recent_result_urls else 0.0
        action_boost = 0.0
        if any(term in query_lower for term in cleanup_terms) and entry.get("action") == "close":
            action_boost += 0.15
        if any(term in query_lower for term in read_terms) and entry.get("action") == "read_later":
            action_boost += 0.12
        visit_boost = min((entry.get("visitCount", 0) or 0) * 0.01, 0.08)
        entry["relevanceScore"] = round(min(0.99, 0.18 + source_boost + context_boost + action_boost + visit_boost + match_count * 0.12 + phrase_hit * 0.12), 3)
        scored.append(entry)

    scored.sort(key=lambda entry: (-entry["relevanceScore"], -(entry.get("visitCount", 0) or 0), -(entry.get("lastVisitedAt", 0) or 0)))
    return scored[:120]


async def chat_search_via_provider_chain(
    db: aiosqlite.Connection,
    settings: AppSettings,
    query_str: str,
    history: list[ChatSearchHistoryMessage],
    candidates: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, AnalysisMetadata | None, list[ProviderAttempt], str | None]:
    provider_chain = resolve_provider_chain(settings)
    if not provider_chain:
        return None, None, [], "AI provider is disabled."

    prompt = build_chat_search_prompt(query_str, history, candidates[:18])
    attempts: list[ProviderAttempt] = []
    session_timestamp = time.time()
    last_error: Exception | None = None

    await add_runtime_log(
        db, "info", "analysis",
        f"Chat search started: query='{query_str[:50]}', {len(candidates)} candidates, {len(prompt)} chars prompt, providers: {' -> '.join(provider_chain)}",
    )

    for provider in provider_chain:
        model = get_provider_model(provider, settings)
        await add_runtime_log(db, "info", "provider", f"Chat search: trying {provider}, sending {len(prompt)} chars")
        await add_llm_call_log(
            db,
            session_timestamp=session_timestamp,
            batch_index=0,
            provider=provider,
            model=model,
            phase="request",
            tab_count=len(candidates[:18]),
            prompt_chars=len(prompt),
            request_summary=prompt[:MAX_LLM_LOG_SUMMARY_CHARS],
        )
        started_at = time.time()
        try:
            if provider == "claude_code":
                parsed, metadata = await run_claude_json_prompt(prompt, CHAT_SEARCH_SYSTEM_PROMPT, settings, CHAT_TIMEOUT_SECONDS)
            elif provider == "codex_cli":
                parsed, metadata = await run_codex_json_prompt(prompt, CHAT_SEARCH_SYSTEM_PROMPT, CHAT_RESPONSE_SCHEMA, settings, CHAT_TIMEOUT_SECONDS)
            else:
                raise RuntimeError(f"Unsupported provider: {provider}")

            attempts.append(ProviderAttempt(
                provider=provider,
                model=metadata.modelUsed or model,
                status="succeeded",
            ))
            elapsed_ms = int((time.time() - started_at) * 1000)
            metadata.providerAttempts = attempts
            await add_runtime_log(db, "info", "provider", f"Chat search: {provider} succeeded ({elapsed_ms}ms, {metadata.inputTokens}+{metadata.outputTokens} tokens)")
            await add_llm_call_log(
                db,
                session_timestamp=session_timestamp,
                batch_index=0,
                provider=provider,
                model=metadata.modelUsed or model,
                phase="response",
                duration_ms=elapsed_ms,
                input_tokens=metadata.inputTokens,
                output_tokens=metadata.outputTokens,
                cost_usd=metadata.totalCostUsd,
                tab_count=len(candidates[:18]),
                response_chars=len(json.dumps(parsed, ensure_ascii=False)),
                response_summary=json.dumps(parsed, ensure_ascii=False)[:MAX_LLM_LOG_SUMMARY_CHARS],
            )
            return parsed, metadata, attempts, None
        except Exception as exc:
            last_error = exc
            attempts.append(ProviderAttempt(
                provider=provider,
                model=model,
                status="failed",
                error=summarize_provider_error(exc),
            ))
            await add_llm_call_log(
                db,
                session_timestamp=session_timestamp,
                batch_index=0,
                provider=provider,
                model=model,
                phase="error",
                duration_ms=int((time.time() - started_at) * 1000),
                tab_count=len(candidates[:18]),
                error_message=str(exc),
            )
            await add_runtime_log(
                db,
                "warning",
                "provider",
                f"Chat search: {provider} failed — {summarize_provider_error(exc)}",
            )

    await add_runtime_log(db, "error", "provider", f"Chat search: all providers failed ({len(attempts)} attempts)")
    return None, None, attempts, classify_fallback_issue(last_error or RuntimeError("No provider configured"))


@app.post("/chat")
async def chat_search(payload: ChatSearchRequest, req: Request):
    db = get_db(req)
    query_str = payload.query.strip()
    if not query_str:
        return {
            "answer": "",
            "results": [],
            "followUpSuggestions": [],
            "llmUsed": False,
            "totalCandidates": 0,
            "providerUsed": None,
            "modelUsed": None,
        }

    candidates = await collect_chat_candidates(db, query_str, payload.history)
    total_candidates = len(candidates)
    if total_candidates == 0:
        answer = build_chat_fallback_answer(query_str, [])
        return {
            "answer": answer,
            "results": [],
            "followUpSuggestions": build_chat_follow_ups(query_str, []),
            "llmUsed": False,
            "totalCandidates": 0,
            "providerUsed": None,
            "modelUsed": None,
        }

    trimmed_candidates = candidates[:payload.maxResults]
    settings = await get_app_settings(db)
    parsed: dict[str, Any] | None = None
    metadata: AnalysisMetadata | None = None
    fallback_notice: str | None = None

    if settings.aiProvider != "none":
        parsed, metadata, _, fallback_notice = await chat_search_via_provider_chain(
            db,
            settings,
            query_str,
            payload.history,
            candidates,
        )

    results = [candidate.copy() for candidate in trimmed_candidates]
    answer = build_chat_fallback_answer(query_str, results, fallback_notice)
    follow_ups = build_chat_follow_ups(query_str, results)
    llm_used = False

    if parsed:
        parsed_results = parsed.get("results", [])
        parsed_answer = str(parsed.get("answer", "")).strip()
        parsed_follow_ups = parsed.get("followUpSuggestions", [])
        url_to_entry = {entry["url"]: entry for entry in candidates}
        ranked: list[dict[str, Any]] = []
        if isinstance(parsed_results, list):
            for item in parsed_results[:payload.maxResults]:
                url = str(item.get("url", "")).strip()
                if url not in url_to_entry:
                    continue
                entry = url_to_entry[url].copy()
                entry["reason"] = str(item.get("reason", entry.get("reason", ""))).strip()
                try:
                    entry["relevanceScore"] = round(float(item.get("relevanceScore", entry.get("relevanceScore", 0.5))), 3)
                except Exception:
                    pass
                ranked.append(entry)
        if ranked:
            results = ranked
            llm_used = True
        if parsed_answer:
            answer = parsed_answer
            llm_used = True
        if isinstance(parsed_follow_ups, list):
            follow_ups = [str(item).strip() for item in parsed_follow_ups if str(item).strip()][:3] or follow_ups

    return {
        "answer": answer,
        "results": results[:payload.maxResults],
        "followUpSuggestions": follow_ups[:3],
        "llmUsed": llm_used,
        "totalCandidates": total_candidates,
        "providerUsed": metadata.providerUsed if metadata else None,
        "modelUsed": metadata.modelUsed if metadata else None,
    }


ANALYTICS_REFRESH_SYSTEM_PROMPT = """Return JSON: {"browsingPatterns":"2-3 sentences","suggestions":["tip1","tip2"],"clusterInsights":[{"clusterName":"...","insight":"..."}],"habitsCommentary":"1-2 sentences","topicClusters":[{"name":"...","tabIds":[1,2],"description":"...","tags":["t1"]}]}
Rules: concise, actionable, 3-5 suggestions. Group tabs into topicClusters (use tabId). Cyrillic data→answer in Russian. ONLY valid JSON."""

ANALYTICS_REFRESH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "browsingPatterns": {"type": "string"},
        "suggestions": {"type": "array", "items": {"type": "string"}},
        "clusterInsights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "clusterName": {"type": "string"},
                    "insight": {"type": "string"},
                },
                "required": ["clusterName", "insight"],
                "additionalProperties": False,
            },
        },
        "habitsCommentary": {"type": "string"},
        "topicClusters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "tabIds": {"type": "array", "items": {"type": "integer"}},
                    "description": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "tabIds", "description", "tags"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["browsingPatterns", "suggestions", "clusterInsights", "habitsCommentary", "topicClusters"],
    "additionalProperties": False,
}

ANALYTICS_REFRESH_TIMEOUT = 90


async def collect_analytics_context(db: aiosqlite.Connection) -> tuple[str, dict[int, str]]:
    lines: list[str] = []

    # Top domains
    cursor = await db.execute(
        "SELECT domain, COUNT(*) as cnt FROM tab_history_events "
        "WHERE domain IS NOT NULL AND domain != '' "
        "GROUP BY domain ORDER BY cnt DESC LIMIT 15"
    )
    domains = await cursor.fetchall()
    if domains:
        lines.append("Top domains: " + ", ".join(f"{r['domain']} ({r['cnt']})" for r in domains))

    # Analysis sessions stats
    cursor = await db.execute(
        "SELECT COUNT(*) as total, AVG(tab_count) as avg_tabs, "
        "AVG(total_cost_usd) as avg_cost, AVG(duration_ms) as avg_dur "
        "FROM analysis_sessions"
    )
    stats = await cursor.fetchone()
    if stats and stats["total"]:
        lines.append(
            f"Analysis sessions: {stats['total']} total, avg {round(stats['avg_tabs'] or 0, 1)} tabs, "
            f"avg cost ${round(stats['avg_cost'] or 0, 4)}, avg duration {round((stats['avg_dur'] or 0) / 1000, 1)}s"
        )

    # Habits score components
    cursor = await db.execute(
        "SELECT action_breakdown_json FROM analysis_sessions "
        "WHERE action_breakdown_json IS NOT NULL ORDER BY timestamp DESC LIMIT 5"
    )
    bd_rows = await cursor.fetchall()
    if bd_rows:
        total_tabs = 0
        closable = 0
        for row in bd_rows:
            bd = json.loads(row["action_breakdown_json"])
            total_tabs += sum(bd.values())
            closable += bd.get("close", 0)
        lines.append(f"Closable tabs: {round(closable / max(total_tabs, 1) * 100, 1)}% across last {len(bd_rows)} sessions")

    # Snapshot trend
    cursor = await db.execute("SELECT total_tabs FROM snapshots ORDER BY created_at DESC LIMIT 5")
    snaps = [r["total_tabs"] for r in await cursor.fetchall()]
    if snaps:
        lines.append(f"Recent tab counts (newest first): {', '.join(str(s) for s in snaps)}")

    # Persistent clusters
    cursor = await db.execute(
        "SELECT name, description, tags_json, tab_urls_json FROM topic_clusters ORDER BY updated_at DESC LIMIT 10"
    )
    clusters = await cursor.fetchall()
    for c in clusters:
        tags = json.loads(c["tags_json"] or "[]")
        url_count = len(json.loads(c["tab_urls_json"] or "[]"))
        lines.append(f"Cluster \"{c['name']}\": {url_count} URLs, tags={','.join(tags[:3])}")

    # Recommendation stats
    cursor = await db.execute(
        "SELECT user_action, COUNT(*) as cnt FROM recommendation_actions GROUP BY user_action"
    )
    rec_rows = await cursor.fetchall()
    if rec_rows:
        rec_parts = [f"{r['user_action']}={r['cnt']}" for r in rec_rows]
        lines.append(f"Recommendation actions: {', '.join(rec_parts)}")

    # Cached URL analyses (for cluster generation) — compact format
    idx_to_url: dict[int, str] = {}
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM url_analysis")
    total_analyses = (await cursor.fetchone())["cnt"]
    cursor = await db.execute(
        "SELECT url, action, reason, suggested_group_name "
        "FROM url_analysis ORDER BY analyzed_at DESC LIMIT 20"
    )
    url_rows = await cursor.fetchall()
    if url_rows:
        lines.append(f"\nCached tab analyses ({total_analyses} total, showing 20 most recent):")
        for idx, r in enumerate(url_rows, 1):
            raw_url = r["url"]
            url = raw_url.split("::", 1)[-1] if "::" in raw_url else raw_url
            idx_to_url[idx] = url
            domain = urlparse(url).hostname or url[:40]
            group = r["suggested_group_name"] or ""
            lines.append(f"  t{idx} {domain} {r['action']} g={group}")

    return "\n".join(lines), idx_to_url


@app.post("/analytics/refresh")
async def analytics_refresh(req: Request):
    db = get_db(req)
    settings = await get_app_settings(db)

    context, idx_to_url = await collect_analytics_context(db)
    if not context.strip():
        await add_runtime_log(db, "warning", "analysis", "Analytics refresh: no data in SQLite")
        return {"analyticsInsight": None, "error": "No analytics data available"}

    provider_chain = resolve_provider_chain(settings)
    if not provider_chain:
        await add_runtime_log(db, "warning", "provider", "Analytics refresh: AI provider is disabled in settings")
        return {"analyticsInsight": None, "error": "AI provider is disabled"}

    prompt = f"Browsing analytics data:\n{context}\n\nAnalyze this data and provide insights."
    session_timestamp = time.time()
    attempts: list[ProviderAttempt] = []

    await add_runtime_log(
        db, "info", "analysis",
        f"Analytics refresh started: {len(context)} chars context, {len(prompt)} chars prompt, providers: {' -> '.join(provider_chain)}",
    )

    for provider in provider_chain:
        model = get_provider_model(provider, settings)
        await add_runtime_log(db, "info", "provider", f"Analytics refresh: trying {provider}, sending {len(prompt)} chars")
        await add_llm_call_log(
            db, session_timestamp=session_timestamp, batch_index=0,
            provider=provider, model=model, phase="request",
            tab_count=0, prompt_chars=len(prompt),
            request_summary=prompt[:MAX_LLM_LOG_SUMMARY_CHARS],
        )
        started_at = time.time()
        try:
            if provider == "claude_code":
                parsed, metadata = await run_claude_json_prompt(prompt, ANALYTICS_REFRESH_SYSTEM_PROMPT, settings, ANALYTICS_REFRESH_TIMEOUT)
            elif provider == "codex_cli":
                parsed, metadata = await run_codex_json_prompt(prompt, ANALYTICS_REFRESH_SYSTEM_PROMPT, ANALYTICS_REFRESH_SCHEMA, settings, ANALYTICS_REFRESH_TIMEOUT)
            else:
                raise RuntimeError(f"Unsupported provider: {provider}")

            elapsed_ms = int((time.time() - started_at) * 1000)
            attempts.append(ProviderAttempt(provider=provider, model=metadata.modelUsed or model, status="succeeded"))
            await add_runtime_log(
                db, "info", "provider",
                f"Analytics refresh: {provider} succeeded ({elapsed_ms}ms, {metadata.inputTokens}+{metadata.outputTokens} tokens)",
            )
            await add_llm_call_log(
                db, session_timestamp=session_timestamp, batch_index=0,
                provider=provider, model=metadata.modelUsed or model, phase="response",
                duration_ms=elapsed_ms,
                input_tokens=metadata.inputTokens, output_tokens=metadata.outputTokens,
                cost_usd=metadata.totalCostUsd, tab_count=0,
                response_chars=len(json.dumps(parsed, ensure_ascii=False)),
                response_summary=json.dumps(parsed, ensure_ascii=False)[:MAX_LLM_LOG_SUMMARY_CHARS],
            )
            clusters_count = len(parsed.get("topicClusters", []))
            await add_runtime_log(
                db, "info", "analysis",
                f"Analytics refresh complete: {len(parsed.get('suggestions', []))} suggestions, {clusters_count} clusters",
            )
            raw_clusters = parsed.get("topicClusters", [])
            resolved_clusters = []
            for cl in raw_clusters:
                tab_urls = [idx_to_url[tid] for tid in cl.get("tabIds", []) if tid in idx_to_url]
                resolved_clusters.append({
                    "name": cl.get("name", ""),
                    "description": cl.get("description", ""),
                    "tags": cl.get("tags", []),
                    "tabUrls": tab_urls,
                })
            return {
                "analyticsInsight": {
                    "browsingPatterns": str(parsed.get("browsingPatterns", "")),
                    "suggestions": parsed.get("suggestions", []),
                    "clusterInsights": parsed.get("clusterInsights", []),
                    "habitsCommentary": str(parsed.get("habitsCommentary", "")),
                },
                "topicClusters": resolved_clusters,
                "providerUsed": metadata.providerUsed,
                "modelUsed": metadata.modelUsed,
                "error": None,
            }
        except Exception as exc:
            elapsed_ms = int((time.time() - started_at) * 1000)
            error_summary = summarize_provider_error(exc)
            attempts.append(ProviderAttempt(provider=provider, model=model, status="failed", error=error_summary))
            await add_runtime_log(db, "warning", "provider", f"Analytics refresh: {provider} failed ({elapsed_ms}ms) — {error_summary}")
            await add_llm_call_log(
                db, session_timestamp=session_timestamp, batch_index=0,
                provider=provider, model=model, phase="error",
                duration_ms=elapsed_ms,
                tab_count=0, error_message=str(exc)[:MAX_LLM_LOG_ERROR_CHARS],
            )

    await add_runtime_log(db, "error", "provider", f"Analytics refresh: all providers failed ({len(attempts)} attempts)")
    return {"analyticsInsight": None, "error": "All providers failed", "attempts": [a.model_dump() for a in attempts]}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    logger.info(f"Starting AI Tab Optimizer server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
