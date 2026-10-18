import json

import pytest
from pydantic import ValidationError

import agent
from server_core.content_review import ContentReviewRequest, normalize_content_review


def pages():
    return [
        {'id': 1, 'url': 'https://a.test/old', 'title': 'React 17 setup guide', 'excerpt': 'Use the legacy ReactDOM.render API.'},
        {'id': 2, 'url': 'https://b.test/new', 'title': 'React 19 setup guide', 'excerpt': 'Current createRoot setup.'},
        {'id': 3, 'url': 'https://c.test/reference', 'title': 'Timeless programming reference', 'excerpt': ''},
    ]


def test_chats_never_become_ai_close_candidates():
    request = ContentReviewRequest(tabs=[{**page, 'url': f'https://chatgpt.com/c/{page["id"]}'} for page in pages()])
    result = normalize_content_review({'similarGroups': [{'tabIds': [1, 2], 'reason': 'Same title', 'confidence': .99, 'relation': 'redundant'}],
                                     'outdatedTabs': [{'tabId': 1, 'reason': 'Old', 'evidence': 'React 17', 'confidence': .99}]}, request)
    assert result == {'similarGroups': [], 'outdatedTabs': []}


def test_missing_relation_defaults_to_complementary_material():
    result = normalize_content_review({'similarGroups': [{'tabIds': [1, 2], 'reason': 'Different approaches', 'confidence': .9}]}, ContentReviewRequest(tabs=pages()))
    assert result['similarGroups'][0]['relation'] == 'related'


def test_review_rejects_hallucinated_ids_quotes_and_replacement_cycles():
    request = ContentReviewRequest(tabs=pages())
    result = normalize_content_review({
        'similarGroups': [
            {'tabIds': [1, 999], 'reason': 'Invented ID', 'confidence': .9},
            {'tabIds': [1, 2], 'reason': 'Different versions; review differences', 'confidence': .8},
        ],
        'outdatedTabs': [
            {'tabId': 1, 'reason': 'Use React 19 for the stated current focus', 'evidence': 'React 17', 'confidence': .9, 'replacementTabId': 2},
            {'tabId': 2, 'reason': 'Invented claim', 'evidence': '2021 deadline', 'confidence': .99},
            {'tabId': 3, 'reason': 'Unused for years', 'evidence': 'Never appeared in the page', 'confidence': .99},
        ],
    }, request)
    assert len(result['similarGroups']) == 1
    assert [item['tabId'] for item in result['outdatedTabs']] == [1]
    assert result['outdatedTabs'][0]['replacementTabId'] == 2


def test_request_bounds_and_duplicate_ids():
    with pytest.raises(ValidationError):
        ContentReviewRequest(tabs=[pages()[0], pages()[0]])
    with pytest.raises(ValidationError):
        ContentReviewRequest(tabs=[{**pages()[0], 'id': i} for i in range(601)])
    with pytest.raises(ValidationError):
        ContentReviewRequest(tabs=[{**pages()[0], 'url': 'javascript:alert(1)'}])


def test_endpoint_supplies_focus_current_date_and_no_visit_age(client, monkeypatch):
    client.post('/settings', json={'settings': {'serverAiProvider': 'codex_cli', 'fallbackAiProvider': 'none'}})

    async def fake(prompt, system, schema, settings, timeout):
        payload = json.loads(prompt)
        assert payload['currentFocus'] == 'React 19 only'
        assert 'today' in payload
        assert 'lastAccessed' not in prompt
        assert 'time since last visit DO NOT' in system
        return {'similarGroups': [], 'outdatedTabs': [{'tabId': 1, 'reason': 'Superseded for React 19 focus', 'evidence': 'React 17', 'confidence': .9, 'replacementTabId': 2}]}, agent.AnalysisMetadata(durationMs=1, durationApiMs=1, totalCostUsd=None, inputTokens=0, outputTokens=0, tabCount=3, providerUsed='codex_cli')

    monkeypatch.setattr(agent, 'run_codex_json_prompt', fake)
    response = client.post('/workspace-review', json={'tabs': pages(), 'focus': 'React 19 only'})
    assert response.status_code == 200
    assert response.json()['outdatedTabs'][0]['tabId'] == 1


def test_unavailable_ai_does_not_fabricate_outdated_pages(client):
    client.post('/settings', json={'settings': {'serverAiProvider': 'none', 'fallbackAiProvider': 'none'}})
    assert client.post('/workspace-review', json={'tabs': pages()}).status_code == 503


@pytest.mark.asyncio
async def test_large_review_prompt_is_sent_through_stdin(monkeypatch):
    captured = {}

    async def create(*command, **kwargs):
        from pathlib import Path
        captured['command'] = command
        captured['stdin'] = kwargs['stdin']
        Path(command[command.index('-o') + 1]).write_text('{"similarGroups":[],"outdatedTabs":[]}', encoding='utf-8')

        class Process:
            returncode = 0

            async def communicate(self, input=None):
                captured['input'] = input
                return b'', b''

        return Process()

    monkeypatch.setattr(agent.asyncio, 'create_subprocess_exec', create)
    monkeypatch.setattr(agent, 'resolve_cli_path', lambda *_: '/fake/codex')
    prompt = 'x' * 200_000
    result, _ = await agent.run_codex_json_prompt(prompt, 'Review only', {}, agent.AppSettings(), 90)
    assert result == {'similarGroups': [], 'outdatedTabs': []}
    assert captured['command'][-1] == '-'
    assert prompt not in captured['command']
    assert captured['input'].endswith(prompt.encode())
