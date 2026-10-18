from server_core.security import trusted_origin


def test_untrusted_web_origin_is_rejected(client):
    assert client.get('/settings', headers={'Origin': 'https://untrusted.example'}).status_code == 403
    assert client.options('/db/clear', headers={
        'Origin': 'https://untrusted.example', 'Access-Control-Request-Method': 'POST',
    }).status_code == 403


def test_extension_and_native_clients_are_allowed(client):
    assert client.get('/settings').status_code == 200
    assert client.get('/settings', headers={'Origin': 'chrome-extension://' + 'a' * 32}).status_code == 200
    assert not trusted_origin('http://localhost.evil.example')
    assert not trusted_origin('null')


def test_optional_token(client, monkeypatch):
    monkeypatch.setenv('LOCAL_API_KEY', 'test-local-token')
    assert client.get('/settings').status_code == 401
    assert client.get('/settings', headers={'X-API-Key': 'test-local-token'}).status_code == 200
    assert client.get('/health').status_code == 200


def test_pinned_origin_list(client, monkeypatch):
    monkeypatch.setenv('AITAB_EXTENSION_ORIGINS', 'chrome-extension://' + 'a' * 32)
    assert client.get('/settings', headers={'Origin': 'chrome-extension://' + 'b' * 32}).status_code == 403
