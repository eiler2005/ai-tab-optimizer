"""Runtime state helpers for long-running analysis jobs."""

from __future__ import annotations

import asyncio


class AnalysisRuntimeState:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._cancel_event: asyncio.Event | None = None
        self._running_task: asyncio.Task | None = None
        self._codex_process: asyncio.subprocess.Process | None = None

    async def start_run(self) -> asyncio.Event:
        async with self._lock:
            self._cancel_event = asyncio.Event()
            self._running_task = None
            self._codex_process = None
            return self._cancel_event

    async def finish_run(self) -> None:
        async with self._lock:
            self._cancel_event = None
            self._running_task = None
            self._codex_process = None

    async def get_cancel_event(self) -> asyncio.Event | None:
        async with self._lock:
            return self._cancel_event

    async def is_cancelled(self) -> bool:
        async with self._lock:
            return self._cancel_event.is_set() if self._cancel_event is not None else False

    async def set_running_task(self, task: asyncio.Task | None) -> None:
        async with self._lock:
            self._running_task = task

    async def clear_running_task(self, task: asyncio.Task | None = None) -> None:
        async with self._lock:
            if task is None or self._running_task is task:
                self._running_task = None

    async def set_codex_process(self, process: asyncio.subprocess.Process | None) -> None:
        async with self._lock:
            self._codex_process = process

    async def clear_codex_process(self, process: asyncio.subprocess.Process | None = None) -> None:
        async with self._lock:
            if process is None or self._codex_process is process:
                self._codex_process = None

    async def cancel(self) -> bool:
        async with self._lock:
            cancel_event = self._cancel_event
            running_task = self._running_task
            codex_process = self._codex_process
            self._running_task = None
            self._codex_process = None

        cancelled = False
        if cancel_event is not None:
            cancel_event.set()
            cancelled = True
        if running_task is not None and not running_task.done():
            running_task.cancel()
            cancelled = True
        if codex_process is not None:
            try:
                codex_process.kill()
            except ProcessLookupError:
                pass
            cancelled = True
        return cancelled
