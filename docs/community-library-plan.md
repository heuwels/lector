# Community library

Date: 19 August 2026. Product: Lector. Status: plan. Do not write code from this file until you open the child issues.

## Summary

The community library is a catalog of collections that learners share. A user submits a collection from their library. An admin approves the submission. Other users clone the item into a group in their own library. Users vote. When the score is `-5` or lower, the catalog buries the item.

The catalog lives on any Cloud-mode instance. Self-host (no accounts) does not have it. Lector Cloud and a local Cloud box with OIDC share the same behaviour: every signed-in user on that instance can submit, vote, and clone. The catalog is per instance. It is not a paid upsell.

This plan is version 1. The later work in the last section is an open idea. Do not build it in version 1.

## Why this is next

Lector has one paid user. The product is a reader. A reader with no texts after the first lesson loses that user. Starter content from Lector covers the first hour. The community library covers the next month for people who share an instance.

LingQ already sells a shared lesson catalog. The Lector site names that gap. Version 1 closes the gap with a small, staff-reviewed catalog. It does not open an unreviewed dump. It does not exist on single-user self-host.

## One name per thing

Use these names in code, UI, and issues. Do not invent synonyms.

| Name | Meaning |
|---|---|
| community library | The public catalog. Route `/community`. Table prefix `community_`. |
| item | One collection in the catalog. It holds a frozen copy of the source lessons. |
| source collection | The collection in the submitter library. |
| submission | An item with status `pending`. |
| queue | The admin list of submissions. Route `/admin` tab Community. |
| clone | A new collection in the reader library. It is a copy of an item. |
| group | A `collection_groups` row. Groups have no language. |
| score | Up-votes minus down-votes. |
| buried item | A published item with score `-5` or lower. |
| attestation | The submitter statement that they may share the text. |

## What version 1 does

1. A signed-in Cloud user submits one source collection.
2. The server writes a frozen item with status `pending`.
3. The admin opens the queue. The admin reads the text. The admin approves or rejects the item.
4. A signed-in Cloud user browses published items for the active language.
5. The user clones an item into a group that they pick or create.
6. The user casts one up-vote or one down-vote per item.
7. The catalog hides a buried item.

## What version 1 does not do

- Self-host (no accounts). The routes return 404, same as `/api/admin`. The page says the feature is Cloud-only.
- A pull of another host's catalog. Tabled. Each Cloud instance holds its own catalog.
- A paid-plan upsell. Free Cloud accounts on the instance use the same catalog.
- Audio lessons. The server refuses a source collection that has any audio lesson. Audio files are large and they create a storage cost on every clone.
- Edit of a published item. The text is frozen at submit time. A new submission is later work.
- User score, extra monthly usage, model review of text, or a copyright scan. See Later work.
- Share of word state, progress, or vocabulary. A clone is text only.
- Open upload with no review.

## Product rules

### The unit is a collection

A library card is a collection. A collection holds one or more lessons. The user submits the whole collection. A single lesson from a multi-lesson collection is not a valid submission.

### The catalog is not the user library

The starter seed copies pack files into ordinary user rows. The clone path must do the same. Do not put catalog rows on the tenant `userId` axis. Do not let one user read a collection that belongs to another user.

The item is a snapshot. Later edits to the source collection do not change the item. If the user deletes the source collection, the item stays.

### Cloud mode only

The community library needs accounts. Self-host has one implicit user and no catalog.

Gate every `/api/community` route in this order:

1. If `config.authRequired` is false, return 404. Self-host stops here.
2. If there is no session, return 401.
3. Any signed-in Cloud user passes. Admin review routes still use `requireAdmin`.

Show the Community nav link in Cloud mode. Hide the link in self-host.

A local Cloud box with OIDC is the same product as Lector Cloud. Users on that box share that box's catalog. They do not pull Lector Cloud.

Do not issue an instance key. Do not publish an anonymous list.

### Vote math

- One vote per user per item.
- A user may change their vote.
- A user may clear their vote.
- The submitter cannot vote on their own item.
- `score = upVoteCount - downVoteCount`.
- When `status` is `published` and `score > -5`, the public list shows the item.
- When the score rises above `-5`, the item is visible again. Burial is not sticky.

When the catalog buries an item, a clone that a user already holds stays in their library.

### Rights

The submitter must tick an attestation before the submit call succeeds.

> I have the right to share this text. I did not copy it from a source that forbids share.

Store the attestation time on the item. The admin can reject an item for a rights problem. The reject reason is visible to the submitter on My submissions.

Update the Lector Cloud terms on `lector-site` before you ship. State that users grant Lector a licence to host and to clone the snapshot. State that Lector can remove an item at any time.

### Plan limits

Submit, list, vote, and clone require Cloud mode and a session. See Cloud mode only.

Submit does not consume `maxCollections` or `maxLessons`. The catalog is not the user library.

Clone then consumes the same limits as a create of one collection and N lessons. Use `entitlements.reserveCount` in one transaction, same as `api/src/routes/starter.ts`. A paid user who is at the cap gets `429 { error: 'plan_limit' }`.

## Data

Add three tables in `api/src/db.ts`. Follow the `(userId, id)` pattern only on the vote table. Catalog rows have no tenant `userId`.

```sql
CREATE TABLE IF NOT EXISTS community_items (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT,
  coverUrl TEXT,
  submitterUserId TEXT NOT NULL,
  sourceCollectionId TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  lessonCount INTEGER NOT NULL,
  wordCount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
  attestationAt TEXT NOT NULL,
  rejectReason TEXT,
  reviewedAt TEXT,
  reviewedByUserId TEXT,
  upVoteCount INTEGER NOT NULL DEFAULT 0,
  downVoteCount INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  publishedAt TEXT
);

CREATE TABLE IF NOT EXISTS community_lessons (
  itemId TEXT NOT NULL,
  sortOrder INTEGER NOT NULL,
  title TEXT NOT NULL,
  textContent TEXT NOT NULL,
  wordCount INTEGER NOT NULL,
  sourceType TEXT,
  sourceMeta TEXT,
  segments TEXT,
  PRIMARY KEY (itemId, sortOrder),
  FOREIGN KEY (itemId) REFERENCES community_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS community_votes (
  userId TEXT NOT NULL,
  itemId TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (userId, itemId),
  FOREIGN KEY (itemId) REFERENCES community_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_community_items_catalog
  ON community_items(language, status, score, publishedAt);
CREATE INDEX IF NOT EXISTS idx_community_items_queue
  ON community_items(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_community_items_submitter
  ON community_items(submitterUserId, createdAt);
```

Add one column on `collections`:

```sql
ALTER TABLE collections ADD COLUMN sourceCommunityItemId TEXT;
```

This column is the provenance of a clone. It is null for every other collection.

### Snapshot rules

When a user submits, copy these fields from each lesson:

- `title`, `textContent`, `wordCount`, `sortOrder`
- For a YouTube transcript: `sourceType`, `sourceMeta`, `segments`

Do not copy:

- `progress_scrollPosition`, `progress_percentComplete`
- audio paths or audio bytes
- vocabulary, known words, cloze cards

`contentHash` is the SHA-256 of the language, the title, the author, and every lesson body in sort order. Use it to refuse an exact duplicate of a published item.

### Refuse these submissions

Return `400` with a stable `error` string.

| Condition | `error` |
|---|---|
| Not cloud, or no session | same 404 or 401 as admin |
| Collection is not owned by the caller | `not_found` |
| Collection id starts with `starter-` | `starter_not_allowed` |
| Any lesson has stored audio | `audio_not_allowed` |
| No lessons, or every lesson body is empty | `empty_collection` |
| A pending item already exists for this source collection | `already_pending` |
| A published item with the same `contentHash` exists | `duplicate` |
| The user already has 3 pending items | `pending_limit` |
| Attestation is missing | `attestation_required` |
| Title or body is larger than the Plus text caps | `too_large` |

Cap a submission at the Plus values of `maxLessonTextBytes` and `maxLessons`. This keeps a huge paste out of every clone.

## API

Mount at `/api/community`. Session required. Personal access tokens must not reach submit, vote, or review. If a token test needs catalog read or clone, map those calls onto `collections:read` and `collections:write`. Default deny for tokens, same as admin.

| Method | Path | Who | Result |
|---|---|---|---|
| `POST` | `/api/community/items` | owner | Body: `{ collectionId, description?, attested: true }`. Creates a pending item. |
| `GET` | `/api/community/items` | session | Query: `language`, `sort=new\|score`. Published items with `score > -5`. |
| `GET` | `/api/community/items/:id` | session | One published item plus lessons. `404` if pending, rejected, or buried, unless the caller is the submitter or an admin. |
| `GET` | `/api/community/mine` | owner | The caller submissions, all statuses. |
| `POST` | `/api/community/items/:id/vote` | session except submitter | Body: `{ value: 1 \| -1 \| 0 }`. `0` deletes the vote. Recalculates score in one transaction. |
| `POST` | `/api/community/items/:id/clone` | session | Body: `{ groupId }` or `{ groupName }`. Creates a collection and its lessons. Writes `sourceCommunityItemId`. |
| `GET` | `/api/admin/community` | admin | Query: `status=pending\|published\|rejected\|all`. Default `pending`. |
| `POST` | `/api/admin/community/:id/approve` | admin | Sets `published`, `publishedAt`, `reviewedAt`, `reviewedByUserId`. |
| `POST` | `/api/admin/community/:id/reject` | admin | Body: `{ reason }`. Sets `rejected` and `rejectReason`. |

### Clone body

The client must send exactly one of `groupId` or `groupName`.

- `groupId` must be a group that the caller owns. Reuse `validateOwnedReference`.
- `groupName` creates a group. Then the server clones into that group. Apply `maxCollectionGroups` and `maxGroupNameBytes` in the same transaction as the collection insert.

If the user already holds a clone of this item in the same language, return `200` with `{ cloned: false, reason: 'already-cloned', collectionId }`. Do not insert a second copy.

New collection ids and lesson ids are `randomUUID()`, same as `POST /api/collections`.

### List payload

Do not send lesson bodies on the list. Send:

- `id`, `language`, `title`, `author`, `description`, `coverUrl`
- `lessonCount`, `wordCount`, `score`, `publishedAt`
- `submitterLabel`
- `viewerVote` (`1`, `-1`, or `null`)
- `cloned`. True if the caller already holds a clone.

When Better Auth has a `name`, `submitterLabel` is that name. If the name is empty, use `A learner`. Never send the email.

## UI

### Library

On the collection menu, add **Submit to community**. Hide the control in self-host. Hide the control for a starter collection. Hide the control for a collection that has audio.

The submit dialog has:

1. The title and the lesson count.
2. An optional description field.
3. The attestation tick box.
4. Submit.

After submit, show the status `pending`. Link to My submissions on `/community?mine=1`.

### Community page

Add a nav link **Community** at `/community`, between Library and Practice. Hide the link in self-host. Show the link on Cloud for every account.

The page has two views:

- **Catalog.** Filter by the active language. Sort by score or by new. Each card shows title, author, lesson count, score, and vote controls. The primary action is **Add to library**.
- **My submissions.** Status and reject reason. If the admin published the item, show a link to it.

**Add to library** opens a small dialog. The user picks a group they already have, or they type a new group name. Default the new name to `Community`. Confirm clones the item. Then route to `/collection/:id`.

Buried items are absent from the catalog. They remain on My submissions for the submitter.

### Admin

Add a Community tab on `/admin`. The queue lists items with status `pending` first. The admin can open the full lesson text. Actions are Approve and Reject. Reject asks for a reason.

The same tab can list published and rejected items. The admin can reject a published item. That is the take-down path.

Do not add a new admin email list. Reuse `LECTOR_ADMIN_EMAILS`.

## Export and restore

Do not put catalog tables in a user takeout. The catalog is service data.

A clone is an ordinary collection. It already rides `collections` in `user-export.ts`. Add `sourceCommunityItemId` to the export row so a restore keeps provenance.

Votes and submissions stay on the server. They are not portable across hosts. Do not add them to `USER_EXPORT_VERSION`.

## Tests

### API unit tests (`api/src/routes/community.test.ts`)

- Submit copies the lesson text. It ignores progress.
- Submit refuses starter, audio, empty, and duplicate hash. It also refuses a fourth item with status `pending`.
- Submit without attestation returns `attestation_required`.
- Approve then list: the item appears for the active language.
- Reject then list: the item is absent. The submitter still sees it on `/mine`.
- Vote: one row per user. Change and clear both update `score`.
- Submitter vote returns `400`.
- Five net down-votes hide the item from the public list. An up-vote that then lifts the score shows it again.
- Clone writes new ids. It sets `groupId` and `sourceCommunityItemId`. It copies YouTube `sourceType`.
- Clone at the collection cap returns `plan_limit`.
- Self-host: every route returns 404.
- A Cloud Free-tier account can submit.
- A token cannot submit, vote, or review.

### E2E (`e2e/community.spec.ts`)

Run in cloud mode only, same as the admin specs. User A and User B are signed-in Cloud accounts.

1. User A imports a short collection. User A submits it with the attestation.
2. Admin opens the queue. Admin reads the text. Admin approves.
3. User B opens the Community page. User B clones into a new group named `Community`.
4. User B opens the clone and taps a word.
5. User B down-votes. The score changes.
6. User A sees the published item on My submissions.

## Files

| Area | Path |
|---|---|
| Schema | `api/src/db.ts` |
| Routes | `api/src/routes/community.ts`, mount in `api/src/index.ts` |
| Admin routes | `api/src/routes/admin.ts` |
| Auth map | `api/src/lib/auth.ts` (default deny) |
| Export column | `api/src/lib/user-export.ts` |
| Client | `src/lib/data-layer.ts` or `src/lib/community.ts` |
| Page | `src/app/community/page.tsx` |
| Nav | `src/components/NavHeader/constants.ts` |
| Submit control | collection menu on `src/app/(index)/` and `src/app/collection/[id]/` |
| Admin tab | `src/app/admin/page.tsx` |
| Terms | `lector-site` legal page |

## Risks

| Risk | Response |
|---|---|
| A user submits text they do not own | Attestation plus a human queue. Take-down is reject on a published item. |
| The queue grows past one operator | Version 1 accepts that. Later work adds a model pass. Do not skip the human approve in version 1. |
| A clone blows a paid library cap | The reserve path already exists. Show the same plan-limit toast. |
| Self-host users expect the catalog | Point them at Lector Cloud. Do not build a pull. |
| A YouTube transcript is a copy of captions | Treat it as text. The attestation covers it. Refuse if this becomes a complaint pattern. |
| Vote brigades bury good items | Burial is reversible. The admin can reject a bad item. There is one vote per account. |

## Later work

Leave these as open ideas. Do not create tables or UI for them in version 1.

1. **Contributor score.** Sum of up-votes on the user published items. Show it on the item card.
2. **Usage reward.** A high contributor score raises a monthly cap. Example: extra `llmRequestsPerMonth` or extra `maxCollections`. This changes plan limits. Design it with the plan-limits engine, not as a one-off.
3. **Model review.** On submit, send the snapshot to a model. Ask if the text is spam, hate, or sexual content with a minor. Store the verdict on the item. The admin still decides. If the verdict is a hard fail, reject the item.
4. **Copyright scan.** Hash pages against a known-book list, or send a sample to a rights API. Auto-reject a clear match. This needs a legal review before you build it.
5. **Update of a published item.** The submitter sends a new snapshot. The item stays published. The admin reviews a diff.
6. **Read of another host's catalog.** Tabled. Each Cloud instance holds its own catalog. Do not build a pull in version 1.

## Child issues

Open these after you accept the plan. Keep this file as the spec.

1. Schema and API. Tables, submit, list, vote, clone, admin approve and reject. Tests in `community.test.ts`.
2. Admin queue tab on `/admin`.
3. Community page, nav link, clone dialog.
4. Submit control on the library card and the collection page.
5. Cloud e2e spec. Terms update on `lector-site`.

Do issue 1 first. Issues 2, 3, and 4 can start after the API is stable. Issue 5 last.

## Kill criteria

After issue 1, stop if any of these hold.

- You cannot review a submission in under 2 minutes.
- The first 10 submissions are all rights problems or empty jokes.
- The one paid user does not clone a single item in the first month after launch.

If the kill criteria fire, keep the tables. Turn off the nav link. Do not start Later work.
