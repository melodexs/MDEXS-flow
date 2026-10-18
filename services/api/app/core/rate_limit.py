"""Dev-grade in-process rate limiting (fixed window, per key).

Suitable for local development and as a safety net. Production deployments
should rate-limit at the edge (e.g. Render/CDN) or with a shared store;
this module does not survive multi-process or multi-instance setups.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class _Window:
    hits: int = 0
    reset_at: float = field(default_factory=lambda: time.monotonic())


class RateLimiter:
    def __init__(self, per_minute: int) -> None:
        self._per_minute = max(1, per_minute)
        self._windows: dict[str, _Window] = {}

    def allow(self, key: str) -> bool:
        """Record a hit; return False when the key exceeds its window quota."""
        now = time.monotonic()
        window = self._windows.get(key)
        if window is None or now >= window.reset_at:
            self._windows[key] = _Window(hits=1, reset_at=now + 60.0)
            return True
        window.hits += 1
        return window.hits <= self._per_minute


_login_limiter: RateLimiter | None = None


def login_limiter() -> RateLimiter:
    global _login_limiter
    if _login_limiter is None:
        from app.core import config

        _login_limiter = RateLimiter(config.get_settings().auth_rate_limit_per_minute)
    return _login_limiter
