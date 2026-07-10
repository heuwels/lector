"""Pull pending cards from Lector, upsert notes, push review state back.

The direction reversal of heuwels/lector#241: everything here runs inside
Anki Desktop on the user's machine and talks OUT to the Lector API, so the
integration works no matter where Lector is hosted, and Anki only needs to be
open at some point — not at the moment a word is saved.
"""

from __future__ import annotations

from .api import LectorApi
from .notetypes import BASIC_MODEL, CLOZE_MODEL, ensure_models

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
    "basic": {"Word": "word", "Sentence": "sentenceHtml", "Translation": "translation", "Meaning": "meaning"},
    "word": {"Word": "word", "Sentence": "", "Translation": "translation", "Meaning": "meaning"},
    "cloze": {"Text": "clozeText", "Word": "word", "Translation": "translation", "Meaning": "meaning"},
}


def deck_name_for(pattern: str, lang: str) -> str:
    name = LANGUAGE_NAMES.get(lang, lang)
    try:
        return pattern.format(lang=name) or "Lector"
    except (KeyError, IndexError, ValueError):
        return "Lector"


def _set_fields(note, card_type: str, item: dict) -> None:
    for field, key in FIELD_MAP[card_type].items():
        note[field] = str(item.get(key, "") or "") if key else ""
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


def _is_lector_note(note) -> bool:
    try:
        return note.note_type()["name"] in (BASIC_MODEL, CLOZE_MODEL)
    except Exception:
        return False


def review_state_for_card(note, card) -> dict:
    """The structured review payload for one card — what replaces HTML parsing."""
    interval = card.ivl if card.ivl and card.ivl > 0 else 0  # learning ivls are negative seconds
    return {
        "lectorId": note["LectorId"] or None,
        "word": note["Word"],
        "lang": note["Lang"] or None,
        "type": card.type,
        "interval": interval,
        "noteId": note.id,
    }


def collect_review_states(col) -> list:
    reviews = []
    for model_name in (BASIC_MODEL, CLOZE_MODEL):
        if col.models.by_name(model_name) is None:
            continue
        for note_id in col.find_notes(f'"note:{model_name}"'):
            note = col.get_note(note_id)
            if not _is_lector_note(note):
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


def run_sync(col, config: dict) -> str:
    """Full sync: pending → notes → ack, then review push. Returns a summary
    line for the tooltip. Runs under QueryOp on a background thread with the
    collection lock held — no aqt imports here, so it stays testable."""
    api = LectorApi(config.get("api_url", ""), config.get("api_token", ""))
    deck_pattern = str(config.get("deck") or "Lector::{lang}")

    pending = api.get_pending()
    models = ensure_models(col)

    acks = []
    failures = 0
    for item in pending:
        card_type = item.get("cardType")
        model = models.get(card_type)
        if model is None or not item.get("lectorId"):
            failures += 1
            continue
        try:
            deck_id = col.decks.id(deck_name_for(deck_pattern, str(item.get("lang", ""))))
            note_id = _upsert_note(col, model, deck_id, card_type, item)
            acks.append({"lectorId": item["lectorId"], "cardType": card_type, "noteId": int(note_id)})
        except Exception:
            failures += 1

    if acks:
        api.post_ack(acks)

    reviews = collect_review_states(col)
    summary = api.post_reviews(reviews, reviews_by_day(col))

    parts = [f"{len(acks)} card{'s' if len(acks) != 1 else ''} pulled"]
    if failures:
        parts.append(f"{failures} failed")
    parts.append(
        f"reviews: {summary.get('updated', 0)} upgraded, "
        f"{summary.get('created', 0)} imported"
    )
    return "Lector sync — " + ", ".join(parts)


def flush_reviews(config: dict, reviews: list) -> None:
    """Push a captured batch of review states (the reviewer-hook buffer).
    Best-effort: called at profile close, so it must never block shutdown on
    an unreachable server beyond the request timeout."""
    if not reviews:
        return
    api = LectorApi(config.get("api_url", ""), config.get("api_token", ""))
    api.post_reviews(reviews)
