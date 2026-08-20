# AnkiWeb listing copy for Lector Sync

The listing is at https://ankiweb.net/shared/info/1098736891 and the add-on code
is `1098736891`. Update that same listing for a new version. Never make a second
one. Keep this file in step with the listing.

Build the upload artifact with the AnkiWeb flag, not the sideload one:

```bash
python3 scripts/build-anki-addon.py --ankiweb
```

## Title

Lector Sync

## Add-on file

`dist/lector-anki-addon-1.3.0-ankiweb.ankiaddon`. Build it with the `--ankiweb`
flag above. The plain `scripts/build-anki-addon.py` makes the sideload file,
which has no `conflicts` key. Do not upload that one.

## Branches (supported Anki versions)

One branch. The minimum is `2.1.50`, which matches `min_point_version` in the
manifest. The maximum is the version you tested, such as `25.09.2`.

A positive maximum tells Anki the version you tested and Anki then ignores it,
so a later Anki release still installs the add-on. Only a negative value sets a
hard maximum. See `compatible()` in `aqt/addons.py`.

For a new release, edit the branch that is already there. Replace its file and
change its maximum. Do not add a second branch. AnkiWeb refuses an upload with
the message `overlapping versions` when two branches cover the same Anki
version, and both branches start at `2.1.50` here.

## Tags

`vocabulary` `language-learning` `sync` `reading` `cloze`

## Description

Lector Sync connects Anki to Lector, a reading tool for language learners.
Lector is at https://lector.dev and the source is at
https://github.com/heuwels/lector.

**Pull.** Words and cloze phrases that you save in Lector become notes in Anki.
They use the Lector and Lector Cloze note types, and they go into one deck for
each language, such as `Lector::Italiano`. The add-on matches each note by a
stable id, so a repeat export updates the note and never makes a duplicate.

**Push.** Your Anki review states flow back to Lector and raise the mastery level
of each word. Lector never lowers a level because a card lapsed. Daily review
counts feed the activity heatmap in Lector.

**Remote by design.** The add-on talks to your Lector server directly with a
scoped API token. Anki does not need to run on the same machine as your browser,
and Lector can sit behind HTTPS on another host. Anki Desktop must be open for a
sync, because AnkiDroid and AnkiMobile cannot run add-ons.

**Hand-made cards.** Add the `lector` tag to your own cards on the Lector note
types. Tagged cards join the sync, and Lector imports them with their sentence
and translation. Untagged cards stay private to Anki.

**Deleted cards.** When you delete a Lector card in Anki, Lector marks the word
as no longer synced. You can then export the word again from the vocab page.
Lector never makes the card again on its own, so a card that you delete on
purpose stays deleted. A deletion takes two syncs to register. The first sync
records your collection and the second reports what is gone.

### Setup

1. In Lector, open **Settings → API Tokens** and mint a token with the **anki**
   scope.
2. In Anki, open **Tools → Add-ons → Lector Sync → Config**.
3. Set `api_url`. Use `https://app.lector.dev` for the hosted service, or your
   own API origin for a self-hosted server.
4. Paste the token into `api_token`.
5. Select **Tools → Lector: Sync now**. The add-on also syncs when you open the
   profile.

### If you sideloaded an earlier version

Delete the old copy first. Open **Tools → Add-ons**, select the entry named
Lector Sync with no AnkiWeb id, and select **Delete**. Two copies of the add-on
sync the same queue twice.

### Support

Report a problem at https://github.com/heuwels/lector/issues. Include the text of
the sync tooltip or the error dialog.

## Notes for the upload itself

- AnkiWeb reads only the `conflicts` key from the bundled `manifest.json`. The
  form supplies the rest of the metadata.
- The `--ankiweb` build adds `"conflicts": ["lector"]`. An AnkiWeb install lands
  in a folder with the numeric id as its name. That key then disables a copy
  that the user installed by hand.
- The sideload build must not carry that key. `_disableConflicting` in
  `aqt/addons.py` includes the package under installation. A manifest that names
  its own folder therefore disables itself on upgrade.
- AnkiWeb rejects a zip that holds a top level folder or a `__pycache__` folder.
  The build script covers both rules.
