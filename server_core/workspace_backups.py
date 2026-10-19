"""Versioned local workspace + consistent SQLite backups; never restores over a live DB."""
import asyncio
import hashlib
import json
import os
import re
import shutil
import time
from pathlib import Path
from uuid import uuid4

import aiosqlite
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/workspace-backups", tags=["workspace backups"])
BACKUP_ID = re.compile(r"^[0-9]{13}-[a-f0-9]{12}$")


def backup_root() -> Path:
    return Path(os.environ.get("AITAB_BACKUP_DIR", str(Path.home() / ".local/share/aitab/backups/workspace"))).expanduser()


def sanitize_workspace(raw: dict) -> dict:
    if raw.get("format") != "aitab-backup" or raw.get("version") != 1 or not isinstance(raw.get("collections"), list):
        raise HTTPException(422, "Expected an AITab backup version 1")
    result = {key: raw[key] for key in ("format", "version", "exportedAt", "collections", "operations", "reviewDecisions", "urlRules", "topicCatalog") if key in raw}
    legacy = raw.get("legacy") if isinstance(raw.get("legacy"), dict) else {}
    result["legacy"] = {key: legacy[key] for key in ("snapshots", "tabHistory", "userFlagsV2", "exportedUrls", "locale", "aitab.review-focus") if key in legacy}
    if isinstance(legacy.get("settings"), dict):
        allowed = ("protectedDomains", "staleDaysThreshold", "maxStoredSnapshots", "autoSnapshotIntervalHours", "historyRetentionDays", "autoSnapshotEnabled")
        result["legacy"]["settings"] = {key: legacy["settings"][key] for key in allowed if key in legacy["settings"]}
    if len(json.dumps(result, ensure_ascii=False).encode()) > 8_000_000:
        raise HTTPException(413, "Workspace backup exceeds 8 MB")
    return result


def list_backups(root: Path) -> list[dict]:
    if not root.exists():
        return []
    result = []
    for folder in root.iterdir():
        if not BACKUP_ID.fullmatch(folder.name) or not folder.is_dir() or folder.is_symlink():
            continue
        try:
            manifest = json.loads((folder / "manifest.json").read_text())
            if manifest.get("format") == "aitab-full-backup" and manifest.get("version") == 1 and manifest.get("id") == folder.name:
                result.append(manifest | {"path": str(folder)})
        except (OSError, ValueError):
            continue
    return sorted(result, key=lambda item: item["id"], reverse=True)


def checksum(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


async def copy_database(source: aiosqlite.Connection, target: aiosqlite.Connection):
    databases = await source.execute('PRAGMA database_list')
    row = next((row for row in await databases.fetchall() if row[1] == 'main'), None)
    if row and row[2]:
        # A separate reader lets the application commit a concurrent write transaction.
        # backup() on that same writer would otherwise block its queued commit.
        async with aiosqlite.connect(Path(row[2]).as_uri() + '?mode=ro', uri=True) as reader:
            await reader.backup(target)
    else:
        await source.backup(target)


class BackupRequest(BaseModel):
    workspace: dict
    retention: int = Field(default=10, ge=1, le=30)


@router.get("")
async def get_backups():
    return {"backups": await asyncio.to_thread(list_backups, backup_root())}


@router.post("")
async def create_backup(body: BackupRequest, request: Request):
    workspace = sanitize_workspace(body.workspace)
    if not hasattr(request.app.state, "workspace_backup_lock"):
        request.app.state.workspace_backup_lock = asyncio.Lock()
    async with request.app.state.workspace_backup_lock:
        root = backup_root()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup_id = f"{int(time.time() * 1000):013d}-{uuid4().hex[:12]}"
        temporary = root / (".pending-" + backup_id)
        destination = root / backup_id
        temporary.mkdir(mode=0o700)
        try:
            workspace_file = temporary / "workspace.json"
            workspace_file.write_text(json.dumps(workspace, ensure_ascii=False, indent=2), encoding="utf-8")
            database_file = temporary / "database.sqlite"
            async with aiosqlite.connect(database_file) as target:
                await copy_database(request.app.state.db, target)
                # Provider settings are device-specific. Purge their bytes from the copy too.
                tables = await target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")
                if await tables.fetchone():
                    await target.execute("PRAGMA secure_delete=ON")
                    await target.execute("DELETE FROM app_settings")
                    await target.commit()
                    await target.execute("VACUUM")
            checksums = {}
            for file in (workspace_file, database_file):
                file.chmod(0o600)
                checksums[file.name] = await asyncio.to_thread(checksum, file)
            manifest = {"format": "aitab-full-backup", "version": 1, "id": backup_id, "createdAt": int(time.time() * 1000),
                        "sha256": checksums, "collections": len(workspace["collections"]),
                        "scope": ["extension workspace", "SQLite analysis/history/snapshots"],
                        "excluded": ["provider settings and credentials", "derived evidence cache", "unsaved page state"]}
            manifest_file = temporary / "manifest.json"
            manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            manifest_file.chmod(0o600)
            temporary.rename(destination)
            for old in list_backups(root)[body.retention:]:
                shutil.rmtree(root / old["id"])
            return {"backup": manifest | {"path": str(destination)}}
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)


@router.get("/{backup_id}")
async def get_workspace_backup(backup_id: str):
    root = backup_root()
    entry = next((item for item in list_backups(root) if item["id"] == backup_id), None)
    if entry is None:
        raise HTTPException(404, "Backup not found")
    folder = root / backup_id
    for name in ("workspace.json", "database.sqlite"):
        if await asyncio.to_thread(checksum, folder / name) != entry.get("sha256", {}).get(name):
            raise HTTPException(409, "Backup checksum mismatch")
    return {"workspace": json.loads((folder / "workspace.json").read_text(encoding="utf-8")), "backup": entry}
