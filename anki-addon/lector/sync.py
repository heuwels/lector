"""Pull pending cards from Lector, upsert notes, push review state back.

The direction reversal of heuwels/lector#241: everything here runs inside
Anki Desktop on the user's machine and talks OUT to the Lector API, so the
integration works no matter where Lector is hosted, and Anki only needs to be
open at some point — not at the moment a word is saved.

This module is deliberately aqt-free: it contains the pure steps (collection
mutation, collection reads, HTTP posts) that __init__.py sequences on the
correct Anki execution paths (CollectionOp for undoable writes, QueryOp for
reads, taskman for network). That split also makes it unit-testable — see
../tests/test_contract.py.
"""

from __future__ import annotations

import re

from .api import LectorApi
from .notetypes import BASIC_MODEL, CLOZE_MODEL, ensure_models

# Server batch ceilings (api/src/routes/anki.ts): /ack and /queue accept 500
# items, /reviews 10,000. Chunk below them so a big collection can never
# wedge a sync with a permanent 400 (#350 review P1).
ACK_CHUNK = 400
REVIEWS_CHUNK = 5000
# Backstop for the pull→apply→ack drain loop, far above any sane queue
# (25 rounds × 500 cards); the loop also stops whenever a round acks nothing.
MAX_PULL_ROUNDS = 25

# Anki keeps only the newest UNDO_LIMIT = 30 undo steps (rslib/src/undo/mod.rs).
# Every write in apply_pending costs at least one step, and note type or deck
# creation costs more, so a batch of ~27 new cards pushed the "Lector Sync"
# entry off the back of the queue and merge_undo_entries raised "target undo op
# not found" — which skipped the ack, so the same batch failed forever (#451).
# Close the entry and open a new one every UNDO_STEP_BUDGET steps instead: the
# batch becomes one undo step per group rather than one failure.
UNDO_NAME = "Lector Sync"
UNDO_STEP_BUDGET = 20

# Deck names for the {lang} placeholder in the configured deck pattern.
LANGUAGE_NAMES = {
    "af": "Afrikaans",
    "de": "Deutsch",
    "es": "Español",
    "fr": "Français",
    "nl": "Nederlands",
    "ru": "Русский",
}

FIELD_MAP = {
    # card type → note field → pending-item key. sentenceHtml arrives
    # pre-bolded from the server (same rendering the browser path produced);
    # word cards leave Sentence empty so the template's word-only front shows.
    "basic": {"Word": "word", "Sentence": "sentenceHtml", "Translation": "translation", "Meaning": "meaning", "Source": "source"},
    "word": {"Word": "word", "Sentence": "", "Translation": "translation", "Meaning": "meaning", "Source": "source"},
    "cloze": {"Text": "clozeText", "Word": "word", "Translation": "translation", "Meaning": "meaning", "Source": "source"},
}


def chunked(items: list, size: int) -> list:
    return [items[i : i + size] for i in range(0, len(items), size)]


def deck_name_for(pattern: str, lang: str) -> str:
    name = LANGUAGE_NAMES.get(lang, lang)
    try:
        return pattern.format(lang=name) or "Lector"
    except (KeyError, IndexError, ValueError):
        return "Lector"


def field(note, name: str) -> str:
    """A note field's value, or '' when the (possibly foreign) model lacks it."""
    try:
        return note[name] or ""
    except KeyError:
        return ""


def strip_html(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", value)).strip()


def strip_cloze(value: str) -> str:
    """{{c1::word}} / {{c1::word::hint}} → word."""
    return re.sub(r"\{\{c\d+::(.+?)(?:::[^}]*)?\}\}", r"\1", value)


def lector_owned(note) -> bool:
    """Only notes the addon owns take part in sync (#350 review: a user's
    pre-existing note type that happens to be named "Lector" must not have
    its unrelated notes uploaded). Ownership = one of our model names AND
    (a LectorId value — everything the addon creates — or the `lector` tag,
    which is also the documented opt-in for hand-made cards)."""
    try:
        if note.note_type()["name"] not in (BASIC_MODEL, CLOZE_MODEL):
            return False
        return bool(field(note, "LectorId").strip()) or ("lector" in note.tags)
    except Exception:
        return False


def _set_fields(note, card_type: str, item: dict) -> None:
    for name, key in FIELD_MAP[card_type].items():
        note[name] = str(item.get(key, "") or "") if key else ""
    note["LectorId"] = str(item.get("lectorId", ""))
    note["Lang"] = str(item.get("lang", ""))


def _upsert_note(col, model, deck_id: int, card_type: str, item: dict):
    """Create or update the note for this (model, LectorId); returns its id."""
    lector_id = str(item.get("lectorId", ""))
    existing = col.find_notes(f'"note:{model["name"]}" "LectorId:{lector_id}"')
    if existing:
        note = col.get_note(existing[0])
        _set_fields(note, card_type, item)
        col.update_note(note)
        return existing[0]

    note = col.new_note(model)
    _set_fields(note, card_type, item)
    note.add_tag("lector")
    col.add_note(note, deck_id)
    return note.id


def _merge_undo(col, undo_pos: int):
    """Fold the writes since `undo_pos` into one undo step; None if Anki
    already dropped that entry. The writes are committed either way, so a lost
    undo grouping must never fail the sync and cost the ack (#451)."""
    try:
        return col.merge_undo_entries(undo_pos)
    except Exception:
        return None


def _steps_since(col, undo_pos: int) -> int:
    """Undo steps Anki recorded since the entry at `undo_pos` opened. The step
    counter is exact, so this holds however many steps one item costs."""
    try:
        return col.undo_status().last_step - undo_pos
    except Exception:
        return 0


def apply_pending(col, pending: list, deck_pattern: str) -> tuple:
    """Collection-mutation phase: upsert one pulled batch into Anki.
    Returns (acks, failures, changes), where changes is the OpChanges of the
    last merged undo step (None if the merge was lost). Runs inside a
    CollectionOp op (undoable); performs NO network I/O."""
    models = ensure_models(col)
    acks = []
    failures = 0
    changes = None
    undo_pos = col.add_custom_undo_entry(UNDO_NAME)
    for item in pending:
        # Re-anchor before Anki's 30-step queue evicts the open entry. Checked
        # ahead of the write, so the entry we merge at the end always covers
        # one item at minimum.
        if _steps_since(col, undo_pos) >= UNDO_STEP_BUDGET:
            merged = _merge_undo(col, undo_pos)
            if merged is not None:
                changes = merged
            undo_pos = col.add_custom_undo_entry(UNDO_NAME)
        card_type = item.get("cardType")
        model = models.get(card_type)
        if model is None or not item.get("lectorId"):
            failures += 1
            continue
        try:
            deck_id = col.decks.id(deck_name_for(deck_pattern, str(item.get("lang", ""))))
            note_id = _upsert_note(col, model, deck_id, card_type, item)
            acks.append({
                "lectorId": item["lectorId"],
                "cardType": card_type,
                "noteId": int(note_id),
                # Echoed so a re-queue between this pull and the ack survives
                # (the server's delete is version-conditional).
                "version": item.get("version"),
            })
        except Exception:
            failures += 1
    merged = _merge_undo(col, undo_pos)
    return acks, failures, merged if merged is not None else changes


def review_state_for_card(note, card) -> dict:
    """The structured review payload for one card — what replaces HTML
    parsing. Hand-made notes (no LectorId) also carry their sentence and
    translation so the server-side import lands with real context."""
    interval = card.ivl if card.ivl and card.ivl > 0 else 0  # learning ivls are negative seconds
    lector_id = field(note, "LectorId").strip()
    state = {
        "lectorId": lector_id or None,
        "word": field(note, "Word"),
        "lang": field(note, "Lang") or None,
        "type": card.type,
        "interval": interval,
        "noteId": note.id,
    }
    if not lector_id:
        raw_sentence = field(note, "Sentence") or strip_cloze(field(note, "Text"))
        state["sentence"] = strip_html(raw_sentence)
        state["translation"] = strip_html(field(note, "Translation"))
    return state


def collect_review_states(col) -> list:
    """Collection-read phase (QueryOp): every owned card's current state."""
    reviews = []
    for model_name in (BASIC_MODEL, CLOZE_MODEL):
        if col.models.by_name(model_name) is None:
            continue
        for note_id in col.find_notes(f'"note:{model_name}"'):
            note = col.get_note(note_id)
            if not lector_owned(note):
                continue
            for card in note.cards():
                reviews.append(review_state_for_card(note, card))
    return reviews


def reviews_by_day(col) -> list:
    """Per-day review counts, day boundary at the collection's rollover hour —
    the same shape AnkiConnect's getNumCardsReviewedByDay returns, feeding the
    heatmap/streak without a server→AnkiConnect path."""
    try:
        rollover = int(col.get_config("rollover", 4))
    except Exception:
        rollover = 4
    try:
        return [
            list(row)
            for row in col.db.all(
                "select cast(strftime('%Y-%m-%d', id/1000 - ?, 'unixepoch', 'localtime') as text) as day,"
                " count() from revlog group by day order by day desc limit 365",
                rollover * 3600,
            )
        ]
    except Exception:
        return []


def post_acks(api: LectorApi, acks: list) -> None:
    """Network phase: confirm created/updated notes, chunked to the server cap."""
    for chunk in chunked(acks, ACK_CHUNK):
        api.post_ack(chunk)


def post_reviews(api: LectorApi, reviews: list, by_day) -> dict:
    """Network phase: push review states, chunked; day counts ride the first
    chunk only (they're idempotent per-day upserts — once is enough)."""
    totals = {"updated": 0, "created": 0}
    batches = chunked(reviews, REVIEWS_CHUNK) or [[]]
    for index, chunk in enumerate(batches):
        if not chunk and index > 0:
            continue
        summary = api.post_reviews(chunk, by_day if index == 0 else None)
        totals["updated"] += int(summary.get("updated", 0) or 0)
        totals["created"] += int(summary.get("created", 0) or 0)
    return totals


def flush_reviews(config: dict, reviews: list) -> None:
    """Push a captured batch of review states (the reviewer-hook buffer),
    chunked like any other push. Best-effort — callers run it off the main
    thread and swallow failures; the next full sync re-sends every state."""
    if not reviews:
        return
    api = LectorApi(config.get("api_url", ""), config.get("api_token", ""))
    post_reviews(api, reviews, None)
