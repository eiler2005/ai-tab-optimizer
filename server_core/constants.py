"""Shared backend constants."""

URL_ANALYSIS_TTL_DAYS = 180
LLM_LOG_RETENTION_DAYS = 30
BATCH_SIZE = 30
CLAUDE_TIMEOUT_SECONDS = 120
CODEX_TIMEOUT_SECONDS = 60
MAX_RUNTIME_LOG_ENTRIES = 300

VALID_ACTIONS = {"keep", "group", "read_later", "archive", "close"}
SUPPORTED_SERVER_AI_PROVIDERS = {"none", "claude_code", "codex_cli"}

