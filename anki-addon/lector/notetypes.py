"""The structured Lector note types (heuwels/lector#241).

Both models carry a `LectorId` field — the vocab entry's id — which is the
whole point: the addon upserts notes by LectorId (no duplicates, no
allowDuplicate) and the review push reports it back, so neither side ever
reverse-engineers a word out of card HTML again. `Lang` rides along so
reviews resolve against the right language pack.

Existing models are never rebuilt — missing fields are appended so a user's
template customizations survive addon updates.
"""

from __future__ import annotations

BASIC_MODEL = "Lector"
CLOZE_MODEL = "Lector Cloze"

# Field order matters only for Anki's first-field-is-sort-key rule: Word leads
# so the browser column reads naturally; LectorId/Lang sit at the back. Source
# (heuwels/lector#334) carries a link back to a video transcript's timestamp;
# it's empty for ordinary cards.
BASIC_FIELDS = ["Word", "Sentence", "Translation", "Meaning", "Source", "LectorId", "Lang"]
CLOZE_FIELDS = ["Text", "Word", "Translation", "Meaning", "Source", "LectorId", "Lang"]

CSS = """\
.card {
  font-family: -apple-system, "Segoe UI", sans-serif;
  font-size: 22px;
  text-align: center;
  color: #1f2937;
  background-color: #fafaf9;
}
.night_mode.card { color: #e7e5e4; background-color: #1c1917; }
small { color: #78716c; font-size: 15px; }
b { color: #16a34a; }
.cloze { font-weight: bold; color: #16a34a; }
"""

# {{#Sentence}} conditionals collapse the same model onto both card shapes the
# browser used to build: a sentence card (bolded context + word beneath) and a
# word-only card (bare word front) when the queue item has no sentence.
#
# Every target-language field is wrapped in <bdi> (heuwels/lector#253). A card
# puts target-language text and English on one line, separated by neutral
# characters — `Word: `, ` = `, an <hr> — and the bidi algorithm resolves those
# neutrals against the paragraph. So an Arabic sentence followed by
# "Word: <b>كتاب</b>" renders the colon on the wrong side of the label, and a
# sentence-final full stop jumps to the left edge of the card.
#
# <bdi> is the right element and needs no per-language branching: it isolates
# the run, and its default dir="auto" takes the direction from the field's own
# first strong character. A pack that reads left to right is unaffected.
#
# An existing model keeps its templates (see _ensure_model — only missing
# FIELDS are appended), so this reaches new installs and anyone who has not
# created the note types yet. That is deliberate: rebuilding a template would
# throw away a user's own customizations.
# The isolation wraps the <b>, never the text inside it. lector's own AnkiConnect
# path reads a word back out of a card with /<b>([^<]+)<\/b>/, and that class
# stops at the first <, so <b><bdi>word</bdi></b> would break the round trip.
# Keep the two nestings the same shape here and in src/lib/anki.ts.
BASIC_FRONT = (
    "{{#Sentence}}<bdi>{{Sentence}}</bdi><br><br>"
    "<small>Word: <bdi><b>{{Word}}</b></bdi></small>{{/Sentence}}"
    "{{^Sentence}}<b>{{Word}}</b>{{/Sentence}}"
)
BASIC_BACK = (
    "{{FrontSide}}<hr id=answer>{{Translation}}"
    "{{#Meaning}}<br><br><bdi><b>{{Word}}</b></bdi> = {{Meaning}}{{/Meaning}}"
    "{{#Source}}<br><br><small>{{Source}}</small>{{/Source}}"
)
CLOZE_FRONT = (
    "<bdi>{{cloze:Text}}</bdi>"
    "{{#Translation}}<br><br><small>{{Translation}}</small>{{/Translation}}"
)
CLOZE_BACK = (
    "<bdi>{{cloze:Text}}</bdi>"
    "{{#Translation}}<br><br><small>{{Translation}}</small>{{/Translation}}"
    "{{#Meaning}}<br><br><bdi><b>{{Word}}</b></bdi> = {{Meaning}}{{/Meaning}}"
    "{{#Source}}<br><br><small>{{Source}}</small>{{/Source}}"
)


def _ensure_fields(col, model, wanted: list) -> bool:
    existing = {field["name"] for field in model["flds"]}
    changed = False
    for name in wanted:
        if name not in existing:
            col.models.add_field(model, col.models.new_field(name))
            changed = True
    return changed


def _ensure_model(col, name: str, fields: list, front: str, back: str, cloze: bool):
    models = col.models
    model = models.by_name(name)
    if model is None:
        model = models.new(name)
        if cloze:
            model["type"] = 1  # MODEL_CLOZE
        for field_name in fields:
            models.add_field(model, models.new_field(field_name))
        template = models.new_template("Card 1")
        template["qfmt"] = front
        template["afmt"] = back
        models.add_template(model, template)
        model["css"] = CSS
        models.add(model)
        return models.by_name(name)

    if _ensure_fields(col, model, fields):
        models.save(model)
    return model


def ensure_models(col) -> dict:
    """Create (or top up) both Lector models; returns {card_type: model}."""
    basic = _ensure_model(col, BASIC_MODEL, BASIC_FIELDS, BASIC_FRONT, BASIC_BACK, cloze=False)
    cloze = _ensure_model(col, CLOZE_MODEL, CLOZE_FIELDS, CLOZE_FRONT, CLOZE_BACK, cloze=True)
    return {"basic": basic, "word": basic, "cloze": cloze}
