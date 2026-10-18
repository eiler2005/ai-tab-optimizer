"""Browser-origin guard for the loopback API and optional token authentication."""

import hmac
import os
import re
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


def trusted_origin(origin: str) -> bool:
    configured = os.environ.get("AITAB_EXTENSION_ORIGINS", "").split(",")
    if any(configured):
        return origin in {value.strip() for value in configured}
    if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
        return True
    parsed = urlsplit(origin)
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"} and not parsed.username


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
