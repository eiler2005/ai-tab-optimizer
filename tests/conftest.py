"""
Shared pytest fixtures for AI Tab Optimizer server tests.
Uses an in-memory SQLite DB so tests are fully isolated from tab_analysis.db.
"""
import asyncio
from contextlib import asynccontextmanager

import pytest
import aiosqlite

from fastapi import FastAPI
from fastapi.testclient import TestClient

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from agent import app, init_db


@pytest.fixture(scope="function")
def client():
    """
    Synchronous TestClient backed by an in-memory SQLite database.
    Each test gets a fresh, isolated database.
    The real lifespan (which opens tab_analysis.db) is replaced with a
    test-only lifespan that injects the in-memory connection.
    """
    async def _setup():
        db = await aiosqlite.connect(":memory:")
        db.row_factory = aiosqlite.Row
        await init_db(db)
        return db

    db = asyncio.get_event_loop().run_until_complete(_setup())

    @asynccontextmanager
    async def test_lifespan(application: FastAPI):
        application.state.db = db
        yield

    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = test_lifespan

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.router.lifespan_context = original_lifespan
    asyncio.get_event_loop().run_until_complete(db.close())
