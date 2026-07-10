"""Lector Sync — the dedicated Lector ↔ Anki addon (heuwels/lector#241).

Wiring only: menu action, hooks, and background execution live here; the
sync logic (sync.py), note types (notetypes.py), and HTTP client (api.py)
are aqt-free so they can be reasoned about (and unit-tested) in isolation.

What it does:
  - On profile open (and Tools → "Lector: Sync now"): pulls Lector's pending
    card queue, upserts notes by LectorId into the Lector note types, acks
    them, and pushes every Lector card's review state back — structured
    fields, no HTML parsing, no AnkiConnect, no CORS/mixed-content/Local
    Network Access constraints.
  - After each answered Lector card: buffers the new card state and flushes
    the buffer when the profile closes, so Lector's word states track your
    actual reviews without a manual sync.
"""

from __future__ import annotations

from aqt import gui_hooks, mw
from aqt.operations import QueryOp
from aqt.qt import QAction
from aqt.utils import showWarning, tooltip

from .api import LectorApiError
from .sync import flush_reviews, review_state_for_card, run_sync

# Card states captured by the reviewer hook, keyed by card id so re-answers
# overwrite instead of duplicating; flushed on profile close.
_pending_reviews: dict = {}


def _config() -> dict:
    return mw.addonManager.getConfig(__name__) or {}


def _configured() -> bool:
    config = _config()
    return bool(config.get("api_url")) and bool(config.get("api_token"))


def _sync_now(auto: bool = False) -> None:
    if not _configured():
        if not auto:
            showWarning(
                "Lector Sync isn't configured yet.\n\n"
                "Set api_url and api_token under Tools → Add-ons → Lector Sync → Config. "
                "Mint the token in Lector's Settings → API Tokens with the anki scope.",
                title="Lector Sync",
            )
        return

    def on_success(summary: str) -> None:
        _pending_reviews.clear()  # the full push covered everything buffered
        tooltip(summary)

    def on_failure(err: Exception) -> None:
        message = str(err) if isinstance(err, LectorApiError) else f"Lector sync failed: {err}"
        if auto:
            tooltip(message)
        else:
            showWarning(message, title="Lector Sync")

    QueryOp(parent=mw, op=lambda col: run_sync(col, _config()), success=on_success) \
        .failure(on_failure) \
        .with_progress("Syncing with Lector…") \
        .run_in_background()


def _on_profile_open() -> None:
    if _config().get("sync_on_profile_open", True):
        _sync_now(auto=True)


def _on_answer(reviewer, card, ease) -> None:
    # Buffer the just-reviewed card's new state; cheap, main-thread, and
    # guarded so a hiccup here can never break reviewing itself.
    try:
        note = card.note()
        if note.note_type()["name"] not in ("Lector", "Lector Cloze"):
            return
        _pending_reviews[card.id] = review_state_for_card(note, card)
    except Exception:
        pass


def _on_profile_close() -> None:
    if not _pending_reviews or not _configured():
        _pending_reviews.clear()
        return
    try:
        flush_reviews(_config(), list(_pending_reviews.values()))
    except Exception:
        pass  # best-effort: never block Anki's shutdown
    _pending_reviews.clear()


action = QAction("Lector: Sync now", mw)
action.triggered.connect(lambda _checked=False: _sync_now(auto=False))
mw.form.menuTools.addAction(action)

gui_hooks.profile_did_open.append(_on_profile_open)
gui_hooks.reviewer_did_answer_card.append(_on_answer)
gui_hooks.profile_will_close.append(_on_profile_close)
