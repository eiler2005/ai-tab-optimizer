"""Browser-origin guard for the loopback API and optional token authentication."""

import hmac
import os
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


def trusted_origin(origin: str) -> bool:
    configured = os.environ.get("AITAB_EXTENSION_ORIGINS", "").split(",")
    if any(configured):
        return origin in {value.strip() for value in configured}
    if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
        return True
    return re.fullmatch(r"http://(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?", origin) is not None


class LocalApiGuard(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        origin = request.headers.get("origin")
        if origin and not trusted_origin(origin):
            return JSONResponse({"detail": "Untrusted browser origin"}, status_code=403)
        secret = os.environ.get("LOCAL_API_KEY", "")
        if secret and request.method != "OPTIONS" and request.url.path != "/health":
            if not hmac.compare_digest(request.headers.get("x-api-key", ""), secret):
                return JSONResponse({"detail": "Local API token required"}, status_code=401)
        return await call_next(request)
