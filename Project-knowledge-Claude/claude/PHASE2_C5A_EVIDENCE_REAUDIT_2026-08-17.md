# PHASE 2 · CONTROL CYCLE 5A — INDEPENDENT EVIDENCE RE-AUDIT

Date: 2026-08-17 · **PRODUCTION CHANGES: NONE.** Nothing deployed, nothing
migrated, no schema change, no grant change, no gate weakened.
`backfill-media-objects` was **not deployed and not executed.**

This document is written for a reviewer who does not trust it. Every probe is
reproducible and the exact command or SQL is given. Where I cannot prove
something I say so.

**Audited artefact:** `supabase/functions/backfill-media-objects/index.ts`,
360 lines, `git hash-object = cfc5051e7dadf488e2c34bb963892d7d39e69f03`,
at `origin/main = 5ebbca55f8442cc786a75a7fc9d1bbc3020162da`.
The working tree was verified clean **before and after** this audit; the hash
above was re-checked after every mutation probe was reverted.

---

## 0. CORRECTIONS TO MY OWN CYCLE 5 REPORT

Three things I got wrong or overstated. They are corrected here, not buried.

**C-1. I said `mediaBackfill.test.ts` has 14 tests. It has 18.**
`grep -c "  it("  src/__tests__/mediaBackfill.test.ts` → `18`. My count was
wrong. The two defective tests are still defective; the denominator was not.

**C-2. I overstated the host-blind and path-traversal weaknesses.**
Cycle 5 §2.3/§2.4 read as live risks. **They are not reachable with the data
that exists today.** Measured:

```
reachability_foreign_host_rows  : 0
reachability_urls_with_dotdot   : 0
hosts present in posts.image_urls: cdn.50mmretina.com 255, jtdtehuqtinjxropkkcn.supabase.co 28
```

The code weakness is real and VERIFIED (§B, §M below). Its *exploitability
today* is **zero**, because no row in production has a foreign host or a `..`.
They are hardening items, not live defects. I should have measured before
characterising.

**C-3. I said wrong-owner risk was "unlikely but unchecked". It is measurable,
and in the avatar subset it is already non-zero.**
Of the 28 avatar slides the function would migrate, **3 have an avatar-folder
UUID that differs from the post's author**. Within the 208 manifest slides the
folder equals the author 208/208. So the risk is real and concentrated exactly
in the population that should not be migrated at all. This strengthens the
finding rather than weakening it, but my original wording was too soft.

---

## 1. PER-CLAIM EVIDENCE

### A. 255 vs 207 population

**CLAIM:** Run to completion the function would migrate 255 slides, not the 207
in the accepted manifest.

**SOURCE EVIDENCE:** the population is re-derived at execution time from a
`posts` scan, never from a manifest.
**EXACT FILE / LINE:** `backfill-media-objects/index.ts:176`
```ts
.from("posts").select("id, user_id, image_urls").order("created_at").range(from, from + PAGE - 1);
```
No manifest is read anywhere in the file (`grep -n manifest` → no match).

**PRODUCTION EVIDENCE / QUERY PROBE:** the function's own rules
(`keyFromUrl` + `MIME_BY_EXT` + whole-post rule, lines 73–86, 205, 220–226)
re-implemented in SQL and run read-only against production:

```
A_slides_it_would_migrate : 255
A_posts_it_would_migrate  : 219
A_posts_skipped_partial   :  16
A_in_manifest_207         : 208
A_NOT_in_manifest         :  47
```

**RESULT:** 255 slides / 219 posts, of which 47 slides are outside the manifest.
(208, not 207, because the manifest population has since gained one arrival.)

**VERIFIED.** Caveat stated honestly: the counts come from a SQL
re-implementation of the TypeScript, not from executing the function. The
re-implementation was cross-checked against the **actual shipped `keyFromUrl`**
in §B, which agrees on every URL shape present in production.

**RISK: HIGH.** The migration would not be the audited population.

---

### B. Avatars and legacy-flat entries entering the migration

**CLAIM:** `BUCKETS` includes `avatars`, so avatar images are planned as post
photographs.

**SOURCE EVIDENCE:** `index.ts:53–57`
```ts
const BUCKETS = [
  "avatars", "competition-photos", "course-images", "email-assets",
  "journal-images", "portfolio-images", "post-images",
];
```
`index.ts:73–81` — `keyFromUrl` strips the query string, discards the host, and
accepts any path beginning with one of those seven prefixes.

**RUNTIME PROBE — the shipped source, executed.** `keyFromUrl`, `extOf` and the
`BUCKETS`/`MIME_BY_EXT` literals were **sliced out of the file at runtime and
evaluated** (no retyping), then run against real URL shapes:

```
PLANNED  | /posts/ real photograph  | key=post-images/01c5059c-…/posts/1785868053062-…-w2560h1707.webp
PLANNED  | AVATAR with cache-buster | key=avatars/319d26bf-…/avatar.webp
PLANNED  | legacy flat post-images  | key=post-images/5745a9c9-…/1773414794791_0.webp
skipped  | supabase object host     | key=null
skipped  | supabase COVER           | key=null
PLANNED  | FOREIGN HOST, our path   | key=post-images/01c5059c-…/posts/x.webp
PLANNED  | TRAVERSAL attempt        | key=post-images/../national-ids/secret.webp
skipped  | private bucket direct    | key=null
```

**PRODUCTION EVIDENCE:**
```
B_breakdown_not_in_manifest            : { avatar: 28, legacy-flat-post-images: 19 }
B_distinct_posts_that_are_avatar_only  : 26
B_avatar_folder_uuid_equals_post_author: 25
B_avatar_folder_uuid_DIFFERENT         :  3
```

**RESULT:** 28 avatar slides across 26 posts would be migrated as post
photographs; 3 of them carry a folder UUID belonging to someone other than the
post's author.

**VERIFIED.** **RISK: HIGH.**

Two sub-claims from Cycle 5, now separated:
- *host is discarded* — **VERIFIED** by the `FOREIGN HOST` line above.
  **Exploitable today: NO** (0 foreign-host rows). **RISK: LOW (latent).**
- *`..` survives key derivation* — **VERIFIED** by the `TRAVERSAL` line above.
  Whether the signed S3 request would actually escape the prefix is
  **UNVERIFIED and will stay that way**: proving it means attempting to read a
  private object, which rule 13 forbids and I will not do.
  **Exploitable today: NO** (0 rows containing `..`). **RISK: LOW (latent),
  cheap to close.**

---

### C. Absence of a true manifest / set fence

**CLAIM:** there is no fence and no manifest.

**SOURCE EVIDENCE:** `index.ts:176` — the posts scan has **no `where` clause at
all**: no `created_at` bound, no id bound, no privacy filter.
`grep -n "manifest\|fence\|created_at <\|lte(" index.ts` → **no match** other
than the `order("created_at")` on line 176.

**RESULT:** the only bound on the population is `max_posts` (line 137/143).

**VERIFIED.** **RISK: HIGH.**

---

### D. `expected_count` is insufficient

**CLAIM:** the drift guard compares a count, not a set.

**SOURCE EVIDENCE:** `index.ts:253`
```ts
if (expectedCount !== wholePosts.length) {
```
`wholePosts` is a `string[]` of post ids (built at lines 220–226); only its
`.length` is compared. No digest, no set comparison, no id list is carried from
the dry run.

**RESULT:** one post leaving the plannable set and one arriving leaves
`.length` unchanged, and the guard passes on a different set.

**VERIFIED** (that the guard is count-based). The *scenario* is
**VERIFIED-BY-CONSTRUCTION**, not observed in production — I did not induce it.
**RISK: MEDIUM.** Note the guard is not useless: the common case (an arrival
with no departure) does abort.

---

### E. Transaction / partial-failure behaviour

**CLAIM:** there is no transaction; a post that fails midway leaves committed
rows behind.

**SOURCE EVIDENCE:** the per-post body runs from `index.ts:266` to `:339`. The
writes inside it are separate PostgREST calls:
- `:297` `media_objects` insert (per slide, in a loop)
- `:309` `media_mark_verified`
- `:312` `media_mark_ready`
- `:326` `post_media` insert (once, after the loop)
- `:331` verification read

`grep -n "begin\|BEGIN\|transaction\|rollback" index.ts` → **no match.**
The catch at `:339–341` records the failure and does nothing else:
```ts
} catch (e) {
  // Left completely untouched for the next run to retry from the start.
  failures.push({ post_id: postId, reason: (e as Error).message });
}
```

**RESULT:** slide 1 of a 3-slide post can be committed `ready` while slide 3
fails. Nothing removes it. **The comment on line 340 is false.**

**VERIFIED.** **RISK: HIGH.**

---

### F. Permanent `pending` dead end

**CLAIM:** a run that dies between the insert and `media_mark_ready` leaves a
row that poisons that post for ever.

**SOURCE EVIDENCE:** `:279–287`
```ts
const { data: existing } = await adminClient
  .from("media_objects").select("id, state")
  .eq("owner_id", sl.user_id).eq("sha256", sha).maybeSingle();
…
if (existing.state !== "ready") {
  throw new Error(`existing media ${existing.id} is in state ${existing.state}, not ready`);
}
```
There is no branch that advances or quarantines a non-`ready` row.

**PRODUCTION RUNTIME PROBE** (inside a `DO` block ending in `RAISE`, so the
whole transaction aborts — see §M for the full probe):
```
insert_default_state       : "pending"
same_owner_same_sha_twice  : REFUSED: duplicate key value violates unique constraint "media_object…"
```

**RESULT:** the row is created `pending`; the unique index makes creating a
replacement impossible; the code refuses to use the existing one. The post
fails on **every** subsequent run. Recovery requires a human deleting the row.

**VERIFIED** — both the code path and the DB behaviour that makes it terminal.
**RISK: HIGH** (low probability, unbounded duration, no automatic recovery).

---

### G. Orphan `media_objects` risk

**CLAIM:** orphaned rows are created and never cleaned.

**SOURCE EVIDENCE:** as §E. `grep -n "\.delete(" index.ts` → **no match**;
there is no cleanup path of any kind.

**RESULT:** every slide committed before a failure is an orphan —
a `ready` row referenced by no `post_media`.

**VERIFIED.** **RISK: MEDIUM.** They are invisible to members (nothing reads
these tables yet) and mostly self-absorbing via the reuse path — except in the
§F case.

---

### H. Concurrency / race with newly-created posts

**CLAIM (two parts).**

*(i) Race with new posts:* **VERIFIED** — no fence (§C) and a count-only guard
(§D). Mitigating detail I owe the reviewer: the scan is
`order("created_at")` **ascending** (`:176`), so an arrival lands at the end and
does not shift the first `max_posts` candidates. The realistic failure is the
compensating pair in §D, not simple displacement.

*(ii) Concurrent invocations:* the function has **no** locking, but the database
refuses the collision. **PRODUCTION RUNTIME PROBE:**
```
same_owner_same_sha_twice    : REFUSED (unique media_objects_owner_content)
same_media_twice_in_one_post : REFUSED (unique post_media_pkey / post_media_post_media_uniq)
reference_a_PENDING_media    : REFUSED (tg_post_media_requires_ready)
```
The loser of a race gets an error, is recorded as a failed post, and leaves
orphans per §G. **No duplicate rows are possible.**

**VERIFIED.** **RISK: MEDIUM** for (i), **LOW** for (ii).

---

### I. Wrong-owner protection

**CLAIM:** `owner_id` is taken from the post and never cross-checked against the
object path.

**SOURCE EVIDENCE:** `:299` — `owner_id: sl.user_id`, where `sl.user_id` is
`post.user_id` (`:209`). `grep -n "split(\"/\")\[1\]\|folder\|owner.*path" index.ts`
→ no cross-check exists.

**PRODUCTION EVIDENCE:**
```
I_owner_folder_equals_author_all_slides : 208 / 208   (manifest population)
B_avatar_folder_uuid_DIFFERENT          :   3 / 28    (avatar population)
```

**RESULT:** for the manifest population the invariant holds perfectly and the
function simply does not use it. For the avatar population — which it should not
be touching — it is already violated 3 times.

**VERIFIED.** **RISK: MEDIUM** (HIGH if avatars stay in scope).

---

### J. Do the tests exercise the safety claims?

**CLAIM:** two of the 18 tests assert properties they do not test, and one pins
a defect in place.

**MUTATION PROBE 1 — the dimensions test enforces the WEAKER behaviour.**
Baseline: 18 passed. Then the source was corrected to bytes-first:
```
-  const dims = dimsFromName(sl.key) ?? imageDimsFromBytes(bytes);
+  const dims = imageDimsFromBytes(bytes) ?? dimsFromName(sl.key);
```
Result:
```
× dimensions are recovered or the slide is refused — never guessed
  Tests  1 failed | 17 passed (18)
```
**Making the code safer breaks the test.** The test (line 102) asserts the
literal string `dimsFromName(sl.key) ?? imageDimsFromBytes(bytes)`.

**MUTATION PROBE 2 — the "left untouched" test is vacuous.** The catch block was
changed so the failure path demonstrably *does* touch the post, while keeping
the text the test greps for:
```ts
} catch (e) {
  await adminClient.from("post_media").insert([{ post_id: postId, ord: 999, media_id: postId }]);
  failures.push({ post_id: postId, reason: (e as Error).message });
```
Result:
```
  Tests  18 passed (18)
```
**All 18 still pass**, including `it("a failed post is reported and left
untouched for the next run")` (line 134), whose only assertion (line 135) is
`expect(/failures\.push\(\{ post_id: postId/.test(fn)).toBe(true)`.

Both mutations were reverted; `git hash-object` re-verified as
`cfc5051e…`, working tree clean.

**VERIFIED.** **RISK: HIGH** — this is why §E survived review.

---

### K. `verify_jwt` configuration

**CLAIM:** `backfill-media-objects` has no `config.toml` entry.

**SOURCE EVIDENCE:**
```
$ grep -n "backfill-media-objects" supabase/config.toml   → (no match)
$ grep -c "^  \[functions\." supabase/config.toml         → 26
$ grep -n "measure-post-media" supabase/config.toml       → 63:  [functions.measure-post-media]
```

**RESULT:** 26 functions are configured; this one is not. On deploy it would
take the platform default (`verify_jwt = true`), so the practical posture is
fine — but it is undeclared, and the in-code admin gate at `:126–133` is the
only thing written down.

**VERIFIED.** **RISK: LOW.** Correction of emphasis: Cycle 5 listed this under
auth concerns; it is a documentation gap, not an auth hole.

---

### L. Production grants on `media_objects` / `post_media`

**PRODUCTION QUERY PROBE:**
```
anon.media_objects          : select F insert F update F delete F
anon.post_media             : select F insert F update F delete F
authenticated.media_objects : select F insert F update F delete F
authenticated.post_media    : select F insert F update F delete F
anon_can_select_sha256              : false
authenticated_can_select_sha256     : false
authenticated_can_exec_mark_ready   : false
authenticated_can_exec_mark_verified: false
anon_can_exec_mark_ready            : false
```

**RESULT:** neither client role has any privilege on either table, and neither
can execute the state-advancing functions. `sha256` is unreachable from any
client.

**VERIFIED.** **RISK: none today.** Forward-looking: the RLS SELECT policies on
both tables are currently unreachable, so **the client switch will fail with
permission denied until grants are issued.** That is a fact about the future,
not a defect now — and when grants are issued they must be **column-scoped** or
`sha256` becomes readable.

---

### M. Trigger / constraint protections

**PRODUCTION RUNTIME PROBE** — a single `DO $probe$ … RAISE EXCEPTION` block, so
every write is rolled back by construction. It used the owner's **own** account
and one of his **own** posts, so no other member's data was touched even
transiently. Verified before the probe: `media_objects` 0 rows, `post_media`
0 rows. Verified after: **0 rows and 0 rows.**

| exercised | result |
|---|---|
| default state on insert | `pending` |
| `pending → ready` (skip verification) | **REFUSED** — *illegal media state transition pending -> ready* |
| `pending → verified` | allowed (expected) |
| `verified → ready` | allowed (expected) |
| change `owner_id` after insert | **REFUSED** — *media_objects.owner_id is immutable* |
| change `sha256` after insert | **REFUSED** — *media_objects.sha256 is immutable* |
| same `(owner_id, sha256)` twice | **REFUSED** — unique `media_objects_owner_content` |
| reference a **pending** media from `post_media` | **REFUSED** — *media … is in state pending, only ready may be referenced* |
| reference a **ready** media | allowed (expected) |
| same media twice in one post | **REFUSED** — unique |
| delete a referenced `media_objects` row | **REFUSED** — foreign key |

**VERIFIED — by execution, not by reading the trigger source.**
**RISK: none. These are the strongest protections in the whole system.**

---

### N. Duplicate / idempotency behaviour

**SOURCE EVIDENCE:** post-level skip — `:155–166` builds a `done` set from
`post_media` and `:180` excludes those posts. Content-level reuse — `:279–291`.
**PRODUCTION EVIDENCE:** unique `(owner_id, sha256)` and unique
`(post_id, media_id)` both **REFUSED** duplicates in the runtime probe.
**RESULT:** idempotent at both levels, enforced by the database rather than
trusted to the code.
**VERIFIED. RISK: LOW.** One latent trap: a post legitimately containing the
same photograph twice cannot be migrated (the unique index refuses the second
reference). Cycle 4 measured **0 duplicate hashes** among the 207, so nothing in
the fenced population trips it. **Latent, not live.**

---

### O. Exact behaviour when one photograph fails

Traced end to end at `:266–341`:

1. `readS3Object` returns `null` (404) → `throw` at `:272`. **No rows written
   for this slide.** Earlier slides of the same post are already committed.
2. Object is empty → `throw` at `:273`. Same.
3. Dimensions unrecoverable → `throw` at `:294`, **after** the bytes were read
   but **before** any insert. Same.
4. `media_objects` insert fails → `throw` at `:305`. Earlier slides committed.
5. **`media_mark_verified` fails → `throw` at `:310`. The row exists, state
   `pending`. This is the §F dead end.**
6. **`media_mark_ready` fails → `throw` at `:314`. Row exists, state `verified`.
   Also the §F dead end.**
7. `post_media` insert fails → `throw` at `:327`. **Every media row for the post
   is committed and orphaned.** The insert itself is one statement, so it is
   all-or-nothing for the references.
8. Verification read-back mismatch → `throw` at `:335`. References **are**
   committed; the post is nonetheless reported failed and will be skipped next
   run (it now has `post_media` rows), so **the failure is recorded but never
   retried** — a false-failure that is actually a success.

**VERIFIED.** **RISK: HIGH** for 5, 6 and 7; case 8 is a reporting defect I did
not identify in Cycle 5 and am adding here.

---

## 2. ANSWERS TO THE SIX QUESTIONS

**1. Definitely real (VERIFIED).**
A (255 vs 207) · B (28 avatars + 19 legacy, 3 with a foreign folder UUID) ·
C (no fence, no manifest) · D (count-not-set guard) · E (no transaction; the
line-340 comment is false) · F (permanent `pending` dead end) · G (orphans) ·
H-i (race with arrivals) · I (owner cross-check unused) · J (one vacuous test,
one test pinning the defect) · O (all eight failure points, including the new
case 8).

**2. Previously incorrect.**
The three corrections in §0: the test count (14 → **18**); host-blind and `..`
characterised as live when they are **latent and unreachable today**;
wrong-owner called "unlikely" when it is **measurably 3/28 in the avatar
subset**. Also a correction of emphasis on K — a documentation gap, not an auth
hole.

**3. Still unverified.**
Whether `..` would actually escape the bucket prefix in a signed S3 request —
**UNVERIFIED, deliberately.** Proving it requires attempting to read a private
object. Close it by construction instead of testing it.
Also UNVERIFIED: end-to-end behaviour of the function itself, because it has
never been executed. Everything above is source-traced, runtime-probed on the
database, or computed from production data — none of it is a live run.

**4. Safeguards that already exist in the database** (all runtime-proven, §M):
random `gen_random_uuid()` public id · `sha256` immutable and unreachable by
clients · `owner_id` immutable · state machine `pending→verified→ready` with no
skipping · `post_media` may only reference `ready` media, taken with
`SELECT … FOR UPDATE` · unique `(owner_id, sha256)` · unique `(post_id, ord)`
and `(post_id, media_id)` · FK `media_id … ON DELETE RESTRICT` · FK
`post_id → posts ON DELETE CASCADE` · `owner_id → auth.users ON DELETE CASCADE` ·
CHECKs on bytes, width, height, mime, visibility, ready-has-derivative,
quarantine-has-reason, sha256 length. **These are excellent and are not the
problem.**

**5. What the migration engine must actually change.**
The database layer needs nothing. Every defect is in the *driver*: it must be
manifest-driven rather than self-deriving (A, B, C), set-fenced rather than
count-fenced (D), atomic per post (E, G, O), able to recover a non-`ready` row
(F), bytes-before-names (the dimensions/MIME ordering), owner-cross-checked (I),
privacy-derived rather than hard-coded `public`, and honest about case 8.

**6. Repair or abandon?**
Of the seven things that must change, **five are the function's central control
flow**: where the population comes from, how it is fenced, how a post is
committed, how failure is recovered, and how success is verified. What would
survive a repair is the S3 read, the hashing, and the two RPC calls — roughly
40 of 360 lines. **Repairing it means rewriting it and keeping the name.**

---

## 3. RECOMMENDATION — B, BUILD A NEW MANIFEST-DRIVEN MIGRATOR

**Not implemented. Not started.**

Reasoning, briefly: a migrator that takes `manifest_hash` + rows as input and
refuses to touch anything not in the manifest makes defects **A, B, C and D
structurally impossible** rather than patched — there is no population to
re-derive, so there is no avatar to include and no fence to forget. Repairing
the existing one leaves the self-deriving scan in place and relies on a filter
being correct for ever.

Two conditions I would attach:
- `backfill-media-objects` should be **deleted, not left dormant**, when the
  replacement lands. A dead write-capable migrator in the repo is exactly how
  this cycle started.
- The two defective tests must be fixed **and mutation-verified**, or they will
  do the same job for the replacement that they did for this one.

---

## 4. THE 208TH PHOTOGRAPH — HOW A LIVE MIGRATION SHOULD HANDLE ARRIVALS

Determined from the actual system, not designed:

- The database **already refuses** every dangerous arrival case: a half-written
  post cannot reference unready media, a duplicate cannot be created, and a
  reference cannot outlive its media. Arrivals are therefore a *completeness*
  problem, not a safety one.
- `posts.created_at` is a usable fence: 235 posts, 208 candidates at or before
  the Cycle 3 fence, 1 after — measured, not assumed.
- Post-level idempotency already exists (`done` set from `post_media`), so a
  delta pass cannot re-migrate a fenced post.

So the model you proposed is the right one, with two corrections:
`fence → migrate fenced → delta fence → migrate arrivals → reconcile`, where
**(a)** the fence travels *in the execution request* alongside the manifest hash
and the function refuses any post created after it, and **(b)** each arrival is
measured exactly as Cycle 4 measured the 207 — real bytes, real hash — before it
is eligible. No arrival is migrated on the strength of its filename.

Reconciliation should assert: every fenced post has references; every reference's
media matches its manifest row on `sha256`, width, height, bytes and mime; no
`media_objects` row lacks a reference; `count(post_media) == count(manifest)`.

---

## 5. STATE

- **PRODUCTION CHANGES: NONE.** `media_objects` 0 rows and `post_media` 0 rows,
  verified before and after the runtime probe. Ledger `20260817102540`,
  unchanged. `backfill-media-objects` undeployed.
- **GIT:** `origin/main = 5ebbca55f8442cc786a75a7fc9d1bbc3020162da`, working tree
  clean, `backfill-media-objects/index.ts` = `cfc5051e7dadf488e2c34bb963892d7d39e69f03`
  (re-verified after both mutation probes were reverted). Nothing committed.
- **TESTS:** no gate weakened. `mediaBackfill.test.ts` 18/18 on unmodified
  source. Both mutations reverted.
- **Manifest:** `6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84`,
  unchanged, 207 rows.
