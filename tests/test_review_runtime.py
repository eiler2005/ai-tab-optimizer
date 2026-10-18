import asyncio

import pytest

import agent
from server_core.review_runtime import await_review_call


@pytest.mark.asyncio
async def test_disconnecting_client_cancels_provider_work():
    cancelled = asyncio.Event()

    async def provider():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    class Request:
        async def is_disconnected(self):
            return True

    with pytest.raises(asyncio.CancelledError):
        await await_review_call(provider(), Request())
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_cancelled_codex_request_terminates_owned_process(monkeypatch):
    started = asyncio.Event()

    class Process:
        returncode = None
        terminated = False

        async def communicate(self, input=None):
            if self.terminated:
                return b'', b''
            started.set()
            await asyncio.Event().wait()

        def terminate(self):
            self.terminated = True

    process = Process()

    async def create(*_args, **_kwargs):
        return process

    monkeypatch.setattr(agent.asyncio, 'create_subprocess_exec', create)
    monkeypatch.setattr(agent, 'resolve_cli_path', lambda *_: '/fake/codex')
    task = asyncio.create_task(agent.run_codex_json_prompt('Review', 'No tools', {}, agent.AppSettings(), 90))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert process.terminated
