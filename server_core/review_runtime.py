"""Cancel a provider request when the local review client disconnects."""
import asyncio


async def await_review_call(awaitable, request):
    task = asyncio.create_task(awaitable)
    stop = asyncio.Event()

    async def disconnected():
        while not stop.is_set():
            if await request.is_disconnected():
                return
            try:
                await asyncio.wait_for(stop.wait(), timeout=.25)
            except asyncio.TimeoutError:
                pass

    watcher = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait({task, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return await task
        raise asyncio.CancelledError()
    finally:
        stop.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, watcher, return_exceptions=True)
