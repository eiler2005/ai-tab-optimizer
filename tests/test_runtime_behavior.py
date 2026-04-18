import time

import aiosqlite
import pytest

import agent


def _make_metadata(provider: str | None, model: str | None, tab_count: int) -> agent.AnalysisMetadata:
    return agent.AnalysisMetadata(
        durationMs=1,
        durationApiMs=1,
        totalCostUsd=None,
        inputTokens=0,
        outputTokens=1,
        tabCount=tab_count,
        providerUsed=provider,
        modelUsed=model,
        providerAttempts=[],
    )


def _make_recommendations(batch: list[agent.TabInput]) -> list[dict[str, object]]:
    return [
        {
            "tabId": tab.id,
            "action": "keep",
            "confidence": 0.9,
            "reason": "Synthetic recommendation",
            "suggestedGroupName": None,
        }
        for tab in batch
    ]


@pytest.mark.asyncio
async def test_retention_cleanup_keeps_recent_url_analysis_rows():
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await agent.init_db(db)

    recent_ts = time.time() - 30 * 86400
    expired_ts = time.time() - 181 * 86400
    recent_log_ts = (time.time() - 5 * 86400) * 1000
    expired_log_ts = (time.time() - 31 * 86400) * 1000

    await db.execute(
        "INSERT INTO url_analysis (url, action, confidence, reason, suggested_group_name, analyzed_at, analysis_source, provider, model) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("recent", "keep", 0.9, "recent", None, recent_ts, "provider", "codex_cli", "gpt-5.4"),
    )
    await db.execute(
        "INSERT INTO url_analysis (url, action, confidence, reason, suggested_group_name, analyzed_at, analysis_source, provider, model) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("expired", "keep", 0.9, "expired", None, expired_ts, "provider", "codex_cli", "gpt-5.4"),
    )
    await db.execute(
        "INSERT INTO llm_call_logs (timestamp, session_timestamp, batch_index, provider, model, phase, duration_ms, input_tokens, output_tokens, cost_usd, prompt_chars, response_chars, tab_count, error_message, request_summary, response_summary) "
        "VALUES (?, NULL, 0, ?, ?, ?, NULL, 0, 0, NULL, 0, 0, 0, NULL, NULL, NULL)",
        (recent_log_ts, "codex_cli", "gpt-5.4", "response"),
    )
    await db.execute(
        "INSERT INTO llm_call_logs (timestamp, session_timestamp, batch_index, provider, model, phase, duration_ms, input_tokens, output_tokens, cost_usd, prompt_chars, response_chars, tab_count, error_message, request_summary, response_summary) "
        "VALUES (?, NULL, 0, ?, ?, ?, NULL, 0, 0, NULL, 0, 0, 0, NULL, NULL, NULL)",
        (expired_log_ts, "codex_cli", "gpt-5.4", "response"),
    )
    await db.commit()

    await agent.apply_retention_policies(db)

    cursor = await db.execute("SELECT url FROM url_analysis ORDER BY url")
    urls = [row["url"] for row in await cursor.fetchall()]
    assert urls == ["recent"]

    cursor = await db.execute("SELECT COUNT(*) AS count FROM llm_call_logs")
    assert (await cursor.fetchone())["count"] == 1
    await db.close()


def test_should_disable_provider_for_permanent_errors():
    assert agent.should_disable_provider_for_run(RuntimeError("Codex CLI not found")) is True
    assert agent.should_disable_provider_for_run(RuntimeError("You've hit your limit for today")) is True


def test_should_not_disable_provider_for_transient_parse_failures():
    assert agent.should_disable_provider_for_run(RuntimeError("Failed to parse AI response as JSON")) is False
    assert agent.should_disable_provider_for_run(RuntimeError("Codex CLI timed out after 60s")) is False


def test_analyze_keeps_primary_provider_for_later_batches_after_transient_error(client, monkeypatch):
    client.post("/settings", json={"settings": {"serverAiProvider": "claude_code", "fallbackAiProvider": "codex_cli"}})

    calls: list[str] = []

    async def fake_analyze_batch_via_provider(provider: str, batch: list[agent.TabInput], settings: agent.AppSettings, **kwargs):
        calls.append(provider)
        if provider == "claude_code":
            raise RuntimeError("Failed to parse AI response as JSON")
        return _make_recommendations(batch), _make_metadata(provider, agent.get_provider_model(provider, settings), len(batch))

    monkeypatch.setattr(agent, "analyze_batch_via_provider", fake_analyze_batch_via_provider)

    tabs = [
        {
            "id": idx,
            "url": f"https://example.com/{idx}",
            "title": f"Tab {idx}",
            "domain": "example.com",
            "pinned": False,
            "active": idx == 1,
        }
        for idx in range(1, 32)
    ]
    response = client.post("/analyze", json={"tabs": tabs, "forceRefresh": True})
    assert response.status_code == 200
    assert calls == ["claude_code", "codex_cli", "claude_code", "codex_cli"]


def test_analyze_disables_provider_for_later_batches_after_usage_limit(client, monkeypatch):
    client.post("/settings", json={"settings": {"serverAiProvider": "claude_code", "fallbackAiProvider": "codex_cli"}})

    calls: list[str] = []

    async def fake_analyze_batch_via_provider(provider: str, batch: list[agent.TabInput], settings: agent.AppSettings, **kwargs):
        calls.append(provider)
        if provider == "claude_code":
            raise RuntimeError("You've hit your limit. Resets at midnight.")
        return _make_recommendations(batch), _make_metadata(provider, agent.get_provider_model(provider, settings), len(batch))

    monkeypatch.setattr(agent, "analyze_batch_via_provider", fake_analyze_batch_via_provider)

    tabs = [
        {
            "id": idx,
            "url": f"https://example.com/{idx}",
            "title": f"Tab {idx}",
            "domain": "example.com",
            "pinned": False,
            "active": idx == 1,
        }
        for idx in range(1, 32)
    ]
    response = client.post("/analyze", json={"tabs": tabs, "forceRefresh": True})
    assert response.status_code == 200
    assert calls == ["claude_code", "codex_cli", "codex_cli"]
