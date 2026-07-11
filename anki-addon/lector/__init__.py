"""Lector Sync — the dedicated Lector ↔ Anki addon (heuwels/lector#241).

Wiring only: menu action, hooks, and execution-path sequencing live here; the
sync logic (sync.py), note types (notetypes.py), and HTTP client (api.py) are
aqt-free so they can be unit-tested in isolation (../tests/).

A sync round runs each phase on the path Anki expects (#350 review):

  1. network pull        — mw.taskman.run_in_background (no collection access)
  2. note upserts        — CollectionOp with a custom undo entry, so the
                           write is undoable and OpChanges drives autosave +
                           UI refresh
  3. network ack         — background again; repeat from 1 while batches keep
                           coming (the server pages the queue)
  4. review-state read   — QueryOp (read-only collection access)
  5. network push        — background; tooltip on the main thread

Answered cards are buffered by the reviewer hook and flushed on a debounced
background timer — never synchronously in profile_will_close, which must not
block shutdown on a slow network. A missed flush loses nothing: step 5
re-sends every owned card's state on the next sync.
"""

from __future__ import annotations

from aqt import gui_hooks, mw
from aqt.operations import CollectionOp, QueryOp
from aqt.qt import QAction, QTimer
from aqt.utils import showWarning, tooltip

from .api import LectorApi, LectorApiError
from .sync import (
    MAX_PULL_ROUNDS,
    apply_pending,
    collect_review_states,
    flush_reviews,
    lector_owned,
    post_acks,
    post_reviews,
    review_state_for_card,
    reviews_by_day,
)

# Card states captured by the reviewer hook, keyed by card id so re-answers
# overwrite instead of duplicating; flushed on a debounce timer.
_pending_reviews: dict = {}
_flush_timer: QTimer | None = None
_sync_running = False
FLUSH_DEBOUNCE_MS = 30_000


def _config() -> dict:
    return mw.addonManager.getConfig(__name__) or {}


def _configured() -> bool:
    config = _config()
    return bool(config.get("api_url")) and bool(config.get("api_token"))


def _fail(message: str, auto: bool) -> None:
    global _sync_running
    _sync_running = False
    if auto:
        tooltip(message)
    else:
        showWarning(message, title="Lector Sync")


def _finish(summary: str) -> None:
    global _sync_running
    _sync_running = False
    _pending_reviews.clear()  # the full push covered everything buffered
    tooltip(summary)


def _sync_now(auto: bool = False) -> None:
    global _sync_running
    if _sync_running:
        return
    if not _configured():
        if not auto:
            showWarning(
                "Lector Sync isn't configured yet.\n\n"
                "Set api_url and api_token under Tools → Add-ons → Lector Sync → Config. "
                "Mint the token in Lector's Settings → API Tokens with the anki scope.",
                title="Lector Sync",
            )
        return

    _sync_running = True
    config = _config()
    api = LectorApi(config.get("api_url", ""), config.get("api_token", ""))
    deck_pattern = str(config.get("deck") or "Lector::{lang}")
    _pull_round(api, deck_pattern, auto, round_no=1, pulled_total=0, failed_total=0)


def _pull_round(api: LectorApi, deck_pattern: str, auto: bool, round_no: int, pulled_total: int, failed_total: int) -> None:
    """Phase 1: fetch one queue batch off the main thread."""

    def on_fetched(future) -> None:
        try:
            pending, _remaining = future.result()
        except Exception as err:
            _fail(str(err) if isinstance(err, LectorApiError) else f"Lector sync failed: {err}", auto)
            return
        if not pending or round_no > MAX_PULL_ROUNDS:
            _review_phase(api, auto, pulled_total, failed_total)
            return
        _apply_batch(api, deck_pattern, auto, round_no, pulled_total, failed_total, pending)

    mw.taskman.run_in_background(api.get_pending, on_fetched)


def _apply_batch(api: LectorApi, deck_pattern: str, auto: bool, round_no: int, pulled_total: int, failed_total: int, pending: list) -> None:
    """Phase 2: undoable collection writes via CollectionOp."""
    result: dict = {}

    def op(col):
        undo_pos = col.add_custom_undo_entry("Lector Sync")
        result["acks"], result["failures"] = apply_pending(col, pending, deck_pattern)
        return col.merge_undo_entries(undo_pos)

    def on_applied(_changes) -> None:
        acks = result.get("acks", [])
        failures = result.get("failures", 0)

        def send():
            post_acks(api, acks)

        def on_acked(future) -> None:
            try:
                future.result()
            except Exception as err:
                _fail(str(err) if isinstance(err, LectorApiError) else f"Lector sync failed: {err}", auto)
                return
            if acks:
                # More batches may be queued behind this one — keep draining.
                _pull_round(api, deck_pattern, auto, round_no + 1, pulled_total + len(acks), failed_total + failures)
            else:
                # Nothing progressed (every item failed): stop rather than
                # spin on the same broken batch forever.
                _review_phase(api, auto, pulled_total, failed_total + failures)

        mw.taskman.run_in_background(send, on_acked)

    CollectionOp(parent=mw, op=op).success(on_applied).failure(
        lambda err: _fail(f"Lector sync failed: {err}", auto)
    ).run_in_background()


def _review_phase(api: LectorApi, auto: bool, pulled_total: int, failed_total: int) -> None:
    """Phases 4+5: read every owned card's state, then push it."""

    def push(states) -> None:
        reviews, by_day = states

        def send():
            return post_reviews(api, reviews, by_day)

        def on_pushed(future) -> None:
            try:
                summary = future.result()
            except Exception as err:
                _fail(str(err) if isinstance(err, LectorApiError) else f"Lector sync failed: {err}", auto)
                return
            parts = [f"{pulled_total} card{'s' if pulled_total != 1 else ''} pulled"]
            if failed_total:
                parts.append(f"{failed_total} failed")
            parts.append(f"reviews: {summary['updated']} upgraded, {summary['created']} imported")
            if api.update_available:
                parts.append("add-on update available")
            _finish("Lector sync — " + ", ".join(parts))

        mw.taskman.run_in_background(send, on_pushed)

    QueryOp(
        parent=mw,
        op=lambda col: (collect_review_states(col), reviews_by_day(col)),
        success=push,
    ).failure(lambda err: _fail(f"Lector sync failed: {err}", auto)).with_progress(
        "Syncing with Lector…"
    ).run_in_background()


def _on_profile_open() -> None:
    if _config().get("sync_on_profile_open", True):
        _sync_now(auto=True)


def _on_answer(reviewer, card, ease) -> None:
    # Buffer the just-reviewed card's new state; cheap, main-thread, and
    # guarded so a hiccup here can never break reviewing itself.
    try:
        note = card.note()
        if not lector_owned(note):
            return
        _pending_reviews[card.id] = review_state_for_card(note, card)
        _schedule_flush()
    except Exception:
        pass


def _schedule_flush() -> None:
    """Debounced background flush of buffered review states — keeps Lector's
    word states fresh mid-session without a network call per answer."""
    global _flush_timer
    if _flush_timer is not None:
        _flush_timer.stop()
    timer = QTimer(mw)
    timer.setSingleShot(True)
    timer.timeout.connect(_flush_buffered)
    timer.start(FLUSH_DEBOUNCE_MS)
    _flush_timer = timer


def _flush_buffered() -> None:
    states = list(_pending_reviews.values())
    _pending_reviews.clear()
    if not states or not _configured():
        return
    config = _config()

    def send():
        try:
            flush_reviews(config, states)
        except Exception:
            pass  # best-effort: the next full sync re-sends every state

    mw.taskman.run_in_background(send)


def _on_profile_close() -> None:
    # No network here (#350 review): a synchronous flush could hold profile
    # switch / quit hostage for the request timeout. Anything still buffered
    # is re-sent by the next sync's full review push.
    global _flush_timer
    if _flush_timer is not None:
        _flush_timer.stop()
        _flush_timer = None
    _pending_reviews.clear()


action = QAction("Lector: Sync now", mw)
action.triggered.connect(lambda _checked=False: _sync_now(auto=False))
mw.form.menuTools.addAction(action)

gui_hooks.profile_did_open.append(_on_profile_open)
gui_hooks.reviewer_did_answer_card.append(_on_answer)
gui_hooks.profile_will_close.append(_on_profile_close)
