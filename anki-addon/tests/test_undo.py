"""Undo-queue regression tests for apply_pending (heuwels/lector#451).

Anki keeps only the newest 30 undo steps, so the single "Lector Sync" entry the
addon used to open per batch fell off the back of the queue on any batch of ~27
new cards. merge_undo_entries then raised "target undo op not found", which
failed the CollectionOp and skipped the ack, so the same batch broke every
later sync too.

FakeUndoQueue mirrors rslib/src/undo/mod.rs: a custom step counts as a step,
end_step truncates to UNDO_LIMIT - 1 before pushing, and merge searches for the
counter. Measured against real Anki 25.x, both agree — 29 note writes merge and
30 do not.

Run: python3 -m unittest discover -s anki-addon/tests (no Anki required).
"""

from __future__ import annotations

import sys
import types
import unittest
import unittest.mock
from pathlib import Path

ADDON_DIR = Path(__file__).resolve().parent.parent

package = types.ModuleType("lector")
package.__path__ = [str(ADDON_DIR / "lector")]
sys.modules.setdefault("lector", package)

from lector import sync  # noqa: E402
from lector.sync import UNDO_STEP_BUDGET, apply_pending  # noqa: E402

UNDO_LIMIT = 30  # rslib/src/undo/mod.rs


class FakeUndoQueue:
    """Anki's undo bookkeeping, minus the collection."""

    def __init__(self):
        self.counter = 0
        self.steps = []  # newest first, like the real VecDeque
        self.merges = 0

    def step(self, name: str) -> None:
        self.counter += 1
        del self.steps[UNDO_LIMIT - 1 :]
        self.steps.insert(0, (self.counter, name))

    def add_custom(self, name: str) -> int:
        self.step(name)
        return self.counter

    def merge(self, target: int) -> str:
        index = next((i for i, (c, _) in enumerate(self.steps) if c == target), None)
        if index is None:
            raise RuntimeError("target undo op not found")
        self.steps = self.steps[index:]
        self.counter = target
        self.merges += 1
        return f"OpChanges(merged={target})"


class FakeNote:
    def __init__(self, model, note_id: int):
        self.model = model
        self.id = note_id
        self.fields = {}
        self.tags = []

    def __setitem__(self, name, value):
        self.fields[name] = value

    def __getitem__(self, name):
        return self.fields[name]

    def add_tag(self, tag):
        self.tags.append(tag)


class FakeDecks:
    def __init__(self, col):
        self.col = col
        self.ids = {}

    def id(self, name: str) -> int:
        if name not in self.ids:
            self.ids[name] = len(self.ids) + 1
            self.col.undo.step(f"Add Deck {name}")  # a new deck costs a step
        return self.ids[name]


class FakeModels:
    """Both note types already exist, as they do on every sync but the first."""

    def __init__(self, col):
        self.col = col
        self.models = {
            "Lector": {"name": "Lector", "flds": [{"name": n} for n in (
                "Word", "Sentence", "Translation", "Meaning", "Source", "LectorId", "Lang")]},
            "Lector Cloze": {"name": "Lector Cloze", "flds": [{"name": n} for n in (
                "Text", "Word", "Translation", "Meaning", "Source", "LectorId", "Lang")]},
        }

    def by_name(self, name):
        return self.models.get(name)

    def new_field(self, name):
        return {"name": name}

    def add_field(self, model, field):
        model["flds"].append(field)

    def save(self, model):
        self.col.undo.step("Update Notetype")


class FakeCollection:
    def __init__(self):
        self.undo = FakeUndoQueue()
        self.decks = FakeDecks(self)
        self.models = FakeModels(self)
        self.notes = {}
        self._next_id = 1000

    # --- undo surface -------------------------------------------------
    def add_custom_undo_entry(self, name):
        return self.undo.add_custom(name)

    def merge_undo_entries(self, target):
        return self.undo.merge(target)

    def undo_status(self):
        return types.SimpleNamespace(last_step=self.undo.counter)

    # --- note surface -------------------------------------------------
    def find_notes(self, query):
        return [n.id for n in self.notes.values() if f'"LectorId:{n.fields.get("LectorId")}"' in query]

    def get_note(self, note_id):
        return self.notes[note_id]

    def new_note(self, model):
        self._next_id += 1
        return FakeNote(model, self._next_id)

    def add_note(self, note, deck_id):
        note.deck_id = deck_id
        self.notes[note.id] = note
        self.undo.step("Add Note")

    def update_note(self, note):
        self.undo.step("Update Note")


def items(count: int, card_type: str = "basic", lang: str = "it") -> list:
    return [
        {
            "lectorId": f"id-{i}",
            "cardType": card_type,
            "word": f"parola{i}",
            "sentenceHtml": f"Una <b>parola{i}</b>.",
            "clozeText": f"Una {{{{c1::parola{i}}}}}.",
            "translation": "a word",
            "lang": lang,
            "version": 1,
        }
        for i in range(count)
    ]


class UndoQueueFidelity(unittest.TestCase):
    """The fake has to break the way Anki breaks, or the tests below prove
    nothing. Anchor once, write N steps, then merge."""

    def anchor_then_write(self, writes: int) -> bool:
        queue = FakeUndoQueue()
        target = queue.add_custom("Lector Sync")
        for i in range(writes):
            queue.step(f"Add Note {i}")
        try:
            queue.merge(target)
            return True
        except RuntimeError:
            return False

    def test_matches_real_anki_thresholds(self):
        self.assertTrue(self.anchor_then_write(29))
        self.assertFalse(self.anchor_then_write(30))

    def test_budget_leaves_headroom(self):
        self.assertLess(UNDO_STEP_BUDGET, UNDO_LIMIT - 1)

    def test_one_entry_per_batch_loses_the_merge(self):
        """The pre-fix strategy, reproduced through apply_pending itself: with
        re-anchoring switched off, a 30-card batch evicts the entry and the
        merge returns nothing. This is #451 as the user met it."""
        col = FakeCollection()
        with unittest.mock.patch.object(sync, "UNDO_STEP_BUDGET", 10**9):
            acks, failures, changes = apply_pending(col, items(30), "Lector::{lang}")
        self.assertIsNone(changes)
        self.assertEqual(len(acks), 30)  # the writes landed; only the merge failed
        self.assertEqual(failures, 0)


class ApplyPendingUndo(unittest.TestCase):
    def test_large_batch_of_new_cards_merges(self):
        col = FakeCollection()
        acks, failures, changes = apply_pending(col, items(500), "Lector::{lang}")
        self.assertEqual(len(acks), 500)
        self.assertEqual(failures, 0)
        self.assertIsNotNone(changes)
        self.assertEqual(len(col.notes), 500)

    def test_every_batch_size_around_the_limit_merges(self):
        for count in (1, 19, 20, 21, 26, 27, 29, 30, 31, 61):
            with self.subTest(count=count):
                col = FakeCollection()
                acks, failures, changes = apply_pending(col, items(count), "Lector::{lang}")
                self.assertEqual(len(acks), count)
                self.assertEqual(failures, 0)
                self.assertIsNotNone(changes)

    def test_batch_becomes_one_undo_step_per_group(self):
        col = FakeCollection()
        apply_pending(col, items(100), "Lector::{lang}")
        # 100 writes + 1 deck, grouped at UNDO_STEP_BUDGET, plus the final merge.
        self.assertGreaterEqual(col.undo.merges, 100 // UNDO_STEP_BUDGET)
        self.assertLessEqual(len(col.undo.steps), UNDO_LIMIT)

    def test_batch_spanning_languages_merges(self):
        col = FakeCollection()
        batch = []
        for index, lang in enumerate(("it", "de", "fr", "es", "af", "nl")):
            batch.extend(
                dict(item, lectorId=f"{lang}-{index}-{position}")
                for position, item in enumerate(items(9, lang=lang))
            )
        acks, failures, changes = apply_pending(col, batch, "Lector::{lang}")
        self.assertEqual(len(acks), 54)
        self.assertEqual(failures, 0)
        self.assertIsNotNone(changes)

    def test_re_queued_cards_update_in_place(self):
        col = FakeCollection()
        batch = items(40)
        apply_pending(col, batch, "Lector::{lang}")
        acks, failures, changes = apply_pending(col, batch, "Lector::{lang}")
        self.assertEqual(len(acks), 40)
        self.assertEqual(failures, 0)
        self.assertIsNotNone(changes)
        self.assertEqual(len(col.notes), 40)  # upserted, never duplicated

    def test_empty_batch_is_harmless(self):
        col = FakeCollection()
        acks, failures, changes = apply_pending(col, [], "Lector::{lang}")
        self.assertEqual(acks, [])
        self.assertEqual(failures, 0)
        self.assertIsNotNone(changes)

    def test_unusable_items_are_counted_not_raised(self):
        col = FakeCollection()
        batch = items(30) + [{"cardType": "basic"}, {"cardType": "nope", "lectorId": "x"}]
        acks, failures, changes = apply_pending(col, batch, "Lector::{lang}")
        self.assertEqual(len(acks), 30)
        self.assertEqual(failures, 2)
        self.assertIsNotNone(changes)

    def test_lost_merge_still_returns_the_acks(self):
        """Belt and braces: if a merge fails anyway, the notes are written, so
        the acks must still come back — losing them is what stalled the queue."""
        col = FakeCollection()

        def always_missing(_target):
            raise RuntimeError("target undo op not found")

        col.merge_undo_entries = always_missing
        acks, failures, changes = apply_pending(col, items(50), "Lector::{lang}")
        self.assertEqual(len(acks), 50)
        self.assertEqual(failures, 0)
        self.assertIsNone(changes)  # the caller substitutes OpChanges


if __name__ == "__main__":
    unittest.main()
