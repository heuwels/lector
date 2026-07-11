"""Tests for the addon's HTTP client — the protocol handshake side.

They lock the addon's half of the version handshake (server half:
api/src/lib/anki-protocol.ts):
  - every request carries X-Lector-Anki-Protocol and a versioned User-Agent,
  - the server's advertised protocol is captured and drives update_available,
  - a 426 surfaces the server's message verbatim (no transport prefix).

Run: python3 -m unittest discover -s anki-addon/tests
"""

from __future__ import annotations

import io
import json
import sys
import types
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest import mock

ADDON_DIR = Path(__file__).resolve().parent.parent

# Import lector.api without executing lector/__init__.py (which imports aqt):
# register a synthetic package whose __path__ points at the real directory.
package = types.ModuleType("lector")
package.__path__ = [str(ADDON_DIR / "lector")]
sys.modules.setdefault("lector", package)

from lector.api import ADDON_VERSION, PROTOCOL, LectorApi, LectorApiError  # noqa: E402


class FakeResponse:
    def __init__(self, body: dict, protocol_current: str | None = None):
        self._body = json.dumps(body).encode("utf-8")
        self.headers = Message()
        if protocol_current is not None:
            self.headers["X-Lector-Anki-Protocol-Current"] = protocol_current

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def http_error(code: int, body: dict) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="https://lector.example/api/anki/pending",
        code=code,
        msg="",
        hdrs=Message(),
        fp=io.BytesIO(json.dumps(body).encode("utf-8")),
    )


class TestHandshakeHeaders(unittest.TestCase):
    def test_requests_carry_protocol_and_versioned_user_agent(self):
        api = LectorApi("https://lector.example", "token")
        seen = {}

        def fake_urlopen(request, timeout=None):
            seen["headers"] = dict(request.header_items())
            return FakeResponse({"pending": [], "remaining": 0})

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            api.get_pending()

        headers = {k.lower(): v for k, v in seen["headers"].items()}
        self.assertEqual(headers["x-lector-anki-protocol"], str(PROTOCOL))
        self.assertEqual(headers["user-agent"], f"lector-anki-addon/{ADDON_VERSION}")

    def test_manifest_human_version_matches_addon_version(self):
        manifest = json.loads((ADDON_DIR / "lector" / "manifest.json").read_text())
        self.assertEqual(manifest["human_version"], ADDON_VERSION)


class TestServerProtocolCapture(unittest.TestCase):
    def _api_after_response(self, response: FakeResponse) -> LectorApi:
        api = LectorApi("https://lector.example", "token")
        with mock.patch("urllib.request.urlopen", lambda *a, **k: response):
            api.get_pending()
        return api

    def test_advertised_protocol_is_captured(self):
        api = self._api_after_response(FakeResponse({"pending": []}, protocol_current=str(PROTOCOL)))
        self.assertEqual(api.server_protocol_current, PROTOCOL)
        self.assertFalse(api.update_available)

    def test_newer_server_protocol_flags_update_available(self):
        api = self._api_after_response(FakeResponse({"pending": []}, protocol_current=str(PROTOCOL + 1)))
        self.assertTrue(api.update_available)

    def test_missing_or_garbage_header_is_harmless(self):
        api = self._api_after_response(FakeResponse({"pending": []}))
        self.assertEqual(api.server_protocol_current, 0)
        self.assertFalse(api.update_available)

        api = self._api_after_response(FakeResponse({"pending": []}, protocol_current="soon"))
        self.assertFalse(api.update_available)


class TestOutdated426(unittest.TestCase):
    def test_426_surfaces_the_server_message_verbatim(self):
        api = LectorApi("https://lector.example", "token")
        message = "This Lector add-on is too old for this server — update it in Anki (Tools → Add-ons)."

        def fake_urlopen(request, timeout=None):
            raise http_error(426, {"error": message, "code": "addon_outdated"})

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(LectorApiError) as caught:
                api.get_pending()

        self.assertEqual(str(caught.exception), message)

    def test_other_http_errors_keep_the_transport_prefix(self):
        api = LectorApi("https://lector.example", "token")

        def fake_urlopen(request, timeout=None):
            raise http_error(401, {"error": "bad token"})

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(LectorApiError) as caught:
                api.get_pending()

        self.assertIn("401", str(caught.exception))
        self.assertIn("bad token", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
