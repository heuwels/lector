"""HTTP client for the Lector API's addon endpoints (heuwels/lector#241).

Standard library only (urllib) — Anki addons can't assume third-party
packages. Every call is outbound from the user's machine to the Lector API,
authenticated with a personal API token (mint one in Lector's Settings with
the `anki:*` scope), so no CORS, mixed-content, or Local Network Access rules
apply — the browser is out of the loop entirely.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

TIMEOUT_SECONDS = 15


class LectorApiError(Exception):
    """Raised for transport failures and non-2xx responses, with a readable message."""


class LectorApi:
    def __init__(self, api_url: str, api_token: str) -> None:
        self.base_url = (api_url or "").rstrip("/")
        self.token = (api_token or "").strip()

    def _request(self, method: str, path: str, payload: Optional[dict] = None) -> Any:
        if not self.base_url:
            raise LectorApiError("api_url is not configured (Tools → Add-ons → Lector Sync → Config)")
        if not self.token:
            raise LectorApiError("api_token is not configured — mint one in Lector's Settings → API Tokens")

        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "lector-anki-addon/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            detail = ""
            try:
                detail = json.loads(err.read().decode("utf-8")).get("error", "")
            except Exception:
                pass
            raise LectorApiError(f"Lector API {err.code} on {path}: {detail or err.reason}") from err
        except urllib.error.URLError as err:
            raise LectorApiError(f"Could not reach the Lector API at {self.base_url}: {err.reason}") from err

        try:
            return json.loads(body) if body else None
        except json.JSONDecodeError as err:
            raise LectorApiError(f"Lector API returned invalid JSON on {path}") from err

    def get_pending(self) -> tuple:
        """One batch of pending cards plus the count still queued behind it.
        The server pages at its own /ack ceiling, so a returned batch is
        always fully ack-able; drain by looping pull→apply→ack while batches
        keep coming."""
        result = self._request("GET", "/api/anki/pending")
        if not isinstance(result, dict):
            return [], 0
        return result.get("pending", []) or [], int(result.get("remaining", 0) or 0)

    def post_ack(self, results: list) -> dict:
        return self._request("POST", "/api/anki/ack", {"results": results}) or {}

    def post_reviews(self, reviews: list, reviews_by_day: Optional[list] = None) -> dict:
        payload: dict = {"reviews": reviews}
        if reviews_by_day is not None:
            payload["reviewsByDay"] = reviews_by_day
        return self._request("POST", "/api/anki/reviews", payload) or {}
