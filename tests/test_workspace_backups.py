import json
import sqlite3
import asyncio
import aiosqlite
from server_core.workspace_backups import copy_database

import pytest


def payload(retention=2):
    return {"workspace": {"format": "aitab-backup", "version": 1, "collections": [], "operations": [],
                          "legacy": {"settings": {"apiKey": "SHOULD_NOT_BACK_UP", "protectedDomains": ["example.com"]}, "apiToken": "SHOULD_NOT_BACK_UP"}}, "retention": retention}


def test_full_backup_is_consistent_private_and_restorable(client, tmp_path, monkeypatch):
    monkeypatch.setenv("AITAB_BACKUP_DIR", str(tmp_path))
    marker = 'PRIVATE_PROVIDER_SETTING_MARKER'
    assert client.post('/settings', json={'settings': {'obsidianVaultPath': marker}}).status_code == 200
    response = client.post('/workspace-backups', json=payload())
    assert response.status_code == 200
    backup = response.json()['backup']
    folder = tmp_path / backup['id']
    assert set(backup['sha256']) == {'workspace.json', 'database.sqlite'}
    assert 'SHOULD_NOT_BACK_UP' not in (folder / 'workspace.json').read_text()
    assert marker.encode() not in (folder / 'database.sqlite').read_bytes()
    assert client.get('/settings').json()['settings']['obsidianVaultPath'] == marker
    with sqlite3.connect(folder / 'database.sqlite') as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert db.execute('SELECT COUNT(*) FROM app_settings').fetchone()[0] == 0
        assert db.execute("SELECT name FROM sqlite_master WHERE name='topic_clusters'").fetchone()
    restored = client.get('/workspace-backups/' + backup['id'])
    assert restored.status_code == 200
    assert restored.json()['workspace']['legacy']['settings'] == {'protectedDomains': ['example.com']}
    assert client.get('/workspace-backups').json()['backups'][0]['id'] == backup['id']


def test_backup_rotation_tampering_and_unrelated_files(client, tmp_path, monkeypatch):
    monkeypatch.setenv('AITAB_BACKUP_DIR', str(tmp_path))
    unrelated = tmp_path / 'personal-data'
    unrelated.mkdir()
    for _ in range(3):
        response = client.post('/workspace-backups', json=payload(retention=2))
        assert response.status_code == 200
    backups = client.get('/workspace-backups').json()['backups']
    assert len(backups) == 2
    assert unrelated.exists()
    folder = tmp_path / backups[0]['id']
    (folder / 'workspace.json').write_text('{}')
    assert client.get('/workspace-backups/' + backups[0]['id']).status_code == 409
    assert client.get('/workspace-backups/not-a-backup').status_code == 404


@pytest.mark.parametrize('body', [{}, {'workspace': {}}, payload(retention=0)])
def test_backup_rejects_invalid_requests(client, tmp_path, monkeypatch, body):
    monkeypatch.setenv('AITAB_BACKUP_DIR', str(tmp_path))
    assert client.post('/workspace-backups', json=body).status_code == 422
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_backup_does_not_deadlock_a_concurrent_writer(tmp_path):
    async with aiosqlite.connect(tmp_path / 'source.sqlite') as writer, aiosqlite.connect(tmp_path / 'copy.sqlite') as target:
        await writer.execute('CREATE TABLE sample (value INTEGER)')
        await writer.commit()
        await writer.execute('INSERT INTO sample VALUES (1)')
        await asyncio.wait_for(copy_database(writer, target), timeout=3)
        row = await (await target.execute('SELECT COUNT(*) FROM sample')).fetchone()
        assert row[0] == 0  # Only committed state is copied; the writer can still commit.
        await writer.commit()
