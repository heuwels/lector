"""Contract tests for the addon's aqt-free core (heuwels/lector#350 review).

They lock the addon's side of the client/server contract:
  - chunk sizes stay under the server's batch ceilings,
  - review payloads carry sentence/translation ONLY for hand-made notes,
  - ownership scoping keeps foreign notes out of the upload,
  - acks echo the queue version and are posted in server-sized chunks.

Run: python3 -m unittest discover -s anki-addon/tests
(no Anki required — lector/__init__.py, which imports aqt, is bypassed by
pre-registering a synthetic package module).
"""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

ADDON_DIR = Path(__file__).resolve().parent.parent

# Import lector.sync without executing lector/__init__.py (which imports aqt):
# register a synthetic package whose __path__ points at the real directory.
package = types.ModuleType("lector")
package.__path__ = [str(ADDON_DIR / "lector")]
sys.modules.setdefault("lector", package)

from lector.sync import (  # noqa: E402
    ACK_CHUNK,
    REVIEWS_CHUNK,
    chunked,
    collect_sync_state,
    collection_crt,
    deck_name_for,
    lector_owned,
    post_acks,
    post_reviews,
    review_state_for_card,
    strip_cloze,
)

# Server ceilings from api/src/routes/anki.ts — the contract under test.
SERVER_ACK_MAX = 500
SERVER_REVIEWS_MAX = 10_000


class FakeNote:
    def __init__(self, model_name, fields, tags=(), note_id=101):
        self._model = {"name": model_name}
        self.fields = dict(fields)
        self.tags = list(tags)
        self.id = note_id

    def note_type(self):
        return self._model

    def cards(self):
        return [FakeCard(card_id=self.id)]

    def __getitem__(self, name):
        if name in self.fields:
            return self.fields[name]
        raise KeyError(name)


class FakeCard:
    def __init__(self, card_type=2, ivl=30, card_id=7):
        self.type = card_type
        self.ivl = ivl
        self.id = card_id


class FakeCollection:
    """Enough of Anki's Collection for the owned-note walk: model lookup, a
    note search per model name, and the creation timestamp."""

    def __init__(self, notes, crt=1400000000):
        self.crt = crt
        self._notes = {note.id: note for note in notes}
        self.models = types.SimpleNamespace(by_name=self._by_name)

    def _by_name(self, name):
        present = {note.note_type()["name"] for note in self._notes.values()}
        return {"name": name} if name in present else None

    def find_notes(self, query):
        name = query.strip('"').removeprefix("note:")
        return [
            note_id
            for note_id, note in sorted(self._notes.items())
            if note.note_type()["name"] == name
        ]

    def get_note(self, note_id):
        return self._notes[note_id]


class FakeApi:
    def __init__(self):
        self.ack_calls = []
        self.review_calls = []

    def post_ack(self, results):
        self.ack_calls.append(list(results))
        return {"acked": len(results)}

    def post_reviews(self, reviews, reviews_by_day=None, inventory=None):
        self.review_calls.append((list(reviews), reviews_by_day, inventory))
        return {"updated": len(reviews), "created": 0, "unsynced": 0}


class ChunkContract(unittest.TestCase):
    def test_chunk_sizes_respect_server_ceilings(self):
        self.assertLessEqual(ACK_CHUNK, SERVER_ACK_MAX)
        self.assertLessEqual(REVIEWS_CHUNK, SERVER_REVIEWS_MAX)

    def test_chunked_splits_exactly(self):
        self.assertEqual(
            [len(c) for c in chunked(list(range(1001)), 400)],
            [400, 400, 201],
        )
        self.assertEqual(chunked([], 400), [])

    def test_post_acks_chunks_to_the_server_cap(self):
        api = FakeApi()
        post_acks(api, [{"lectorId": str(i)} for i in range(900)])
        self.assertEqual([len(c) for c in api.ack_calls], [ACK_CHUNK, ACK_CHUNK, 900 - 2 * ACK_CHUNK])

    def test_post_reviews_chunks_and_sends_day_counts_once(self):
        api = FakeApi()
        by_day = [["2026-07-10", 3]]
        totals = post_reviews(api, [{"word": str(i)} for i in range(REVIEWS_CHUNK * 2 + 5)], by_day)
        self.assertEqual(
            [len(reviews) for reviews, _, _ in api.review_calls],
            [REVIEWS_CHUNK, REVIEWS_CHUNK, 5],
        )
        self.assertEqual([day for _, day, _ in api.review_calls], [by_day, None, None])
        self.assertEqual(totals["updated"], REVIEWS_CHUNK * 2 + 5)

    def test_post_reviews_with_only_day_counts_posts_once(self):
        api = FakeApi()
        post_reviews(api, [], [["2026-07-10", 3]])
        self.assertEqual(len(api.review_calls), 1)
        self.assertEqual(api.review_calls[0][0], [])


class InventoryContract(unittest.TestCase):
    """The deleted-note reconcile's client half: the server only reconciles when
    it receives an inventory, so WHEN the addon sends one is the contract."""

    def test_inventory_rides_the_last_chunk_only(self):
        api = FakeApi()
        inventory = {"crt": 1400000000, "lectorIds": ["a"], "noteIds": [1]}
        post_reviews(
            api,
            [{"word": str(i)} for i in range(REVIEWS_CHUNK * 2 + 5)],
            None,
            inventory,
        )
        # Anything earlier would let the server treat a fragment of a chunked
        # push as the whole collection and unsync the rest.
        self.assertEqual([inv for _, _, inv in api.review_calls], [None, None, inventory])

    def test_empty_collection_still_reports_its_inventory(self):
        # The deleted-deck case: nothing left to review, but the server must
        # still hear that the collection is empty.
        api = FakeApi()
        inventory = {"crt": 1400000000, "lectorIds": [], "noteIds": []}
        post_reviews(api, [], None, inventory)
        self.assertEqual(len(api.review_calls), 1)
        self.assertEqual(api.review_calls[0][2], inventory)

    def test_no_inventory_is_sent_when_none_is_given(self):
        # flush_reviews' path: a partial batch must never carry an inventory.
        api = FakeApi()
        post_reviews(api, [{"word": "huis"}], None)
        self.assertEqual([inv for _, _, inv in api.review_calls], [None])

    def test_collect_sync_state_lists_both_id_kinds_once(self):
        exported = FakeNote("Lector", {"LectorId": "uuid-1", "Word": "huis"}, note_id=11)
        hand_made = FakeNote("Lector", {"LectorId": "", "Word": "berge"}, tags=["lector"], note_id=12)
        foreign = FakeNote("Basic", {"Word": "nope"}, note_id=13)
        col = FakeCollection([exported, hand_made, foreign])

        reviews, inventory = collect_sync_state(col)

        # Two cards each for the two owned notes; the foreign note is excluded.
        self.assertEqual(len(reviews), 2)
        self.assertEqual(inventory["lectorIds"], ["uuid-1"])
        # The hand-made note has no LectorId, so its note id is what keeps the
        # entry Lector imported from it out of the deleted set.
        self.assertEqual(inventory["noteIds"], [11, 12])

    def test_collection_crt_falls_back_to_zero(self):
        # A zero fingerprint makes the caller send no inventory at all, rather
        # than one the server cannot tie to a known collection.
        self.assertEqual(collection_crt(FakeCollection([], crt=1400000000)), 1400000000)
        self.assertEqual(collection_crt(FakeCollection([], crt=None)), 0)


class ReviewPayloadContract(unittest.TestCase):
    def test_lector_created_note_sends_ids_not_content(self):
        note = FakeNote(
            "Lector",
            {"LectorId": "uuid-1", "Lang": "af", "Word": "huis", "Sentence": "Die <b>huis</b>.", "Translation": "The house."},
        )
        state = review_state_for_card(note, FakeCard(card_type=2, ivl=30))
        self.assertEqual(state["lectorId"], "uuid-1")
        self.assertEqual(state["word"], "huis")
        self.assertEqual(state["lang"], "af")
        self.assertEqual(state["type"], 2)
        self.assertEqual(state["interval"], 30)
        self.assertEqual(state["noteId"], 101)
        self.assertNotIn("sentence", state)
        self.assertNotIn("translation", state)

    def test_hand_made_note_carries_context_for_the_import(self):
        note = FakeNote(
            "Lector",
            {"LectorId": "", "Lang": "af", "Word": "berge", "Sentence": "Die <b>berge</b> is hoog.", "Translation": "<i>The mountains are high.</i>"},
            tags=["lector"],
        )
        state = review_state_for_card(note, FakeCard())
        self.assertIsNone(state["lectorId"])
        self.assertEqual(state["sentence"], "Die berge is hoog.")
        self.assertEqual(state["translation"], "The mountains are high.")

    def test_hand_made_cloze_note_strips_the_blank(self):
        note = FakeNote(
            "Lector Cloze",
            {"LectorId": "", "Lang": "af", "Word": "huis", "Text": "Die {{c1::huis::hint}} is groot.", "Translation": "T."},
            tags=["lector"],
        )
        state = review_state_for_card(note, FakeCard())
        self.assertEqual(state["sentence"], "Die huis is groot.")

    def test_learning_negative_interval_clamps_to_zero(self):
        note = FakeNote("Lector", {"LectorId": "x", "Lang": "af", "Word": "w"})
        state = review_state_for_card(note, FakeCard(card_type=1, ivl=-600))
        self.assertEqual(state["interval"], 0)

    def test_missing_fields_on_a_foreign_shaped_model_do_not_raise(self):
        note = FakeNote("Lector", {"LectorId": ""}, tags=["lector"])
        state = review_state_for_card(note, FakeCard())
        self.assertEqual(state["word"], "")
        self.assertEqual(state["sentence"], "")


class OwnershipContract(unittest.TestCase):
    def test_lector_id_marks_ownership(self):
        self.assertTrue(lector_owned(FakeNote("Lector", {"LectorId": "uuid"})))

    def test_lector_tag_marks_hand_made_ownership(self):
        self.assertTrue(lector_owned(FakeNote("Lector Cloze", {"LectorId": ""}, tags=["lector"])))

    def test_same_named_foreign_notes_are_excluded(self):
        # A user's pre-existing "Lector" note type: no LectorId value, no tag.
        self.assertFalse(lector_owned(FakeNote("Lector", {"LectorId": ""})))
        self.assertFalse(lector_owned(FakeNote("Lector", {"Word": "unrelated"})))

    def test_other_models_are_excluded(self):
        self.assertFalse(lector_owned(FakeNote("Basic", {"LectorId": "uuid"}, tags=["lector"])))


class DeckNameContract(unittest.TestCase):
    def test_lang_placeholder_and_fallbacks(self):
        self.assertEqual(deck_name_for("Lector::{lang}", "af"), "Lector::Afrikaans")
        self.assertEqual(deck_name_for("Lector::{lang}", "xx"), "Lector::xx")
        self.assertEqual(deck_name_for("{nope}", "af"), "Lector")

    def test_strip_cloze_handles_hints(self):
        self.assertEqual(strip_cloze("A {{c1::b}} c {{c2::d::hint}}"), "A b c d")


if __name__ == "__main__":
    unittest.main()
