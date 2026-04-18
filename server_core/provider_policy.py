"""Provider error handling and fallback policy helpers."""

from __future__ import annotations


DISABLE_PROVIDER_MARKERS = (
    "not found",
    "command not found",
    "no such file or directory",
    "not authenticated",
    "authentication",
    "auth required",
    "permission denied",
    "api key",
    "invalid api key",
    "quota",
    "usage limit",
    "hit your limit",
    "you've hit your limit",
    "billing",
)


def classify_fallback_issue(error: Exception) -> str:
    message = str(error)
    lowered = message.lower()

    if "you've hit your limit" in lowered or "hit your limit" in lowered:
        return "The selected CLI provider hit its usage limit, so heuristic recommendations were used."
    if "failed to parse ai response as json" in lowered:
        return "The selected CLI provider returned a non-JSON response, so heuristic recommendations were used."
    if "codex" in lowered and "not found" in lowered:
        return "Codex CLI was not found, so heuristic recommendations were used."
    if "claude" in lowered and "not found" in lowered:
        return "Claude Code CLI was not found, so heuristic recommendations were used."
    if "no result from ai" in lowered or "empty response" in lowered:
        return "The selected CLI provider returned no result, so heuristic recommendations were used."

    return "Configured CLI providers were unavailable, so heuristic recommendations were used."


def summarize_provider_error(error: Exception) -> str:
    message = " ".join(str(error).strip().split())
    lowered = message.lower()

    if "you've hit your limit" in lowered or "hit your limit" in lowered:
        if "resets" in message:
            start = message.lower().find("you've hit your limit")
            return message[start:] if start >= 0 else message
        return "Usage limit reached."

    if "raw response:" in message:
        raw = message.split("Raw response:", 1)[1].strip()
        if raw:
            return raw[:300]

    if "| stderr:" in message:
        parts = message.split("| stderr:", 1)
        prefix = parts[0].strip()[:150]
        stderr_part = parts[1].strip()[:500]
        return f"{prefix} | stderr: {stderr_part}"

    if "CLI stderr:" in message:
        parts = message.split("CLI stderr:", 1)
        prefix = parts[0].strip()[:150]
        stderr_part = parts[1].strip()[:500]
        return f"{prefix} | stderr: {stderr_part}"

    return message[:500]


def should_disable_provider_for_run(error: Exception) -> bool:
    message = str(error).lower()
    return any(marker in message for marker in DISABLE_PROVIDER_MARKERS)

