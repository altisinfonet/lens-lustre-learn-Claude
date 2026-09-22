# PHASE 2 · CONTROL CYCLE 5 — AUDIT OF `backfill-media-objects`

Date: 2026-08-17 · **Production changes: NONE.** Nothing migrated, nothing
inserted into `media_objects` or `post_media`, no post modified, no media
uploaded, deleted or replaced. `backfill-media-objects` **was not deployed and
was not executed.**

**VERDICT: FAIL. It must not be deployed.** Four defects would corrupt the
migration, and two of the tests that are supposed to catch them do not.

---

## 0. ONE ADDITION I MADE TO THE AUDIT SCOPE, AND WHY

You asked me to audit the function. I audited the function **and the schema
underneath it**, because roughly half of this function's safety is not in the
function — it is in triggers, constraints, unique indexes and grants. Auditing
the 360 lines alone would have produced a confident answer built on assumptions
about the database. Section 3 is where that paid off: several things the code
does not guard, the schema *does*, and one thing everyone would assume the
schema guards, it does not.

I also did not stop at reading. I re-implemented **the function's own rules** in
SQL and ran them against production to compute what it would actually do.
Reading code tells you intent; running its rules against the real data tells you
the outcome. That is what produced §2.1, the most important finding here.

---

## 1. THE FUNCTION, AS AUDITED

| # | question | answer |
|---|---|---|
| 1 | **exact inputs** | `dry_run: boolean`, `expected_count: integer`, `max_posts: integer`. Nothing else is read from the body. |
| 2 | **authentication** | `Authorization: Bearer` required; `auth.getClaims(token)`; 401 without a `sub`. Gateway `verify_jwt` is **not configured** for this function (no `config.toml` entry) — it would default to true on deploy, but it is not written down. |
| 3 | **authorization** | service-role lookup in `user_roles` for `role = 'admin'`; 403 otherwise. |
| 4 | **arbitrary URLs/paths suppliable?** | **No** from the caller. But see §2.3 — the URL's **host is discarded**, so the key is derived host-blind from `posts.image_urls`. |
| 5 | **arbitrary users/posts suppliable?** | No. The candidate set is derived, not supplied. But it is **unfenced** (§2.2). |
| 6 | **private storage reachable?** | Not via the allowlist: `entry-originals`, `national-ids`, `support-attachments` are absent from `BUCKETS`. The seven allowed prefixes are all public buckets. **Caveat in §2.4 (path traversal, unproven).** |
| 7 | **arbitrary external URLs reachable?** | No. Every read goes through `s3SignedFetch` to `s3Endpoint()`, whose host comes from `site_settings`, never from a post. |
| 8 | **SSRF exposure** | **None.** No caller input reaches a request target, and the foreign host in a post URL is never contacted — only its path is reused. |
| 9 | **service-role usage** | `post_media` scan, `posts` scan, `site_settings` read, `media_objects` select/insert, two RPCs, `post_media` insert, verification read. |
| 10 | **database writes** | Yes — this function writes. |
| 11 | **tables written** | `media_objects`, `post_media`. Only these two. |
| 12 | **columns written** | `media_objects`: `owner_id, sha256, width, height, bytes, mime, visibility` (+ `state`/`verified_at`/`derivatives` via the two RPCs). `post_media`: `post_id, ord, media_id`. |
| 13 | **storage writes** | None. |
| 14 | **storage deletes** | None. |
| 15 | **post updates** | **None.** `posts.image_urls` is never touched. Confirmed by reading every statement. |
| 16 | **post_media writes** | One bulk `insert` per post, then a count read-back. |
| 17 | **media_objects writes** | One `insert` per new fingerprint, then `media_mark_verified`, then `media_mark_ready`. |
| 18 | **transaction boundaries** | **NONE.** See §2.5 — this is the second-worst defect. |
| 19 | **idempotency** | Post-level: a post with any `post_media` row is skipped. Content-level: `(owner_id, sha256)` reuse. Both real. |
| 20 | **duplicate handling** | Reuse-before-create, backed by `UNIQUE (owner_id, sha256)`. Correct — **except** §2.6. |
| 21 | **retry behaviour** | Re-invoke; already-done posts skip. No internal retry, no backoff. |
| 22 | **partial-failure behaviour** | Per-post try/catch; failure recorded and the loop continues. **The claim that the post is "left completely untouched" is false** (§2.5). |
| 23 | **rollback/recovery** | **None.** Nothing is undone. |
| 24 | **orphan handling** | None. Orphaned `media_objects` rows are created and never cleaned (§2.5). |
| 25 | **concurrency handling** | None in the function. The DB saves it: `UNIQUE (owner_id, sha256)`, `PK (post_id, ord)`, `UNIQUE (post_id, media_id)`, and `SELECT … FOR UPDATE` inside the post_media trigger. A second concurrent run loses the insert race and reports a failure rather than duplicating. |
| 26 | **race with new posts** | Real. No fence; `expected_count` compares a **count**, not a set (§2.2). |
| 27 | **SHA-256 calculation** | `crypto.subtle.digest("SHA-256", bytes)` over the **whole object** from `readS3Object` (an unranged GET — verified in `_shared/s3.ts`). Correct. |
| 28 | **SHA-256 privacy** | Server-side only. `anon` and `authenticated` have **no table privilege at all** on `media_objects` — `has_column_privilege(anon,'sha256','SELECT') = false`. ✅ |
| 29 | **media_objects.id generation** | `gen_random_uuid()` default. Random, and it is the public identifier. ✅ |
| 30 | **owner_id derivation** | `post.user_id`. **Not** the object path (§2.7). |
| 31 | **width/height extraction** | `dimsFromName(key) ?? imageDimsFromBytes(bytes)` — **filename first, bytes second** (§2.8). |
| 32 | **MIME detection** | `MIME_BY_EXT[extOf(key)]` — **from the file extension, not the bytes** (§2.8). |
| 33 | **byte-size handling** | `bytes.byteLength` from the real body. Correct. Empty object refused. No maximum size cap. |
| 34 | **visibility handling** | **Hard-coded `"public"`** on every row, with no reference to `posts.privacy` (§2.9). |
| 35 | **derivatives handling** | `{ original: key }` via `media_mark_ready`. Satisfies the `ready_has_derivatives` CHECK. No ladder entries. |
| 36 | **authorization model** | Admin-only write path; the DB's own model (RLS + triggers) is described in §3. |
| 37 | **RLS interaction** | Bypassed entirely — service role. The DB's protection here is the **triggers and constraints**, not RLS. |
| 38 | **error handling** | Per-post try/catch; outer try/catch → 500. Every failure surfaces in the response. No silent swallow. |
| 39 | **logging** | **Effectively none.** One `console.error` on the outer catch. Per-post failures exist only in the HTTP response — lose the response, lose the record. |
| 40 | **rate/size limits** | `max_posts` default 10, hard ceiling 50. **No object-size cap**, no per-run byte budget, no wall-clock budget. |

---

## 2. THE DEFECTS

### 2.1 — 🔴 IT WOULD MIGRATE 47 THINGS THAT ARE NOT POST PHOTOGRAPHS

`BUCKETS` includes **`avatars`**. `keyFromUrl` therefore accepts
`https://cdn.50mmretina.com/avatars/<uuid>/avatar.webp?t=…` (the query string is
stripped first), the extension is `.webp`, and the slide is planned.

I re-implemented the function's own rules in SQL against production. Run to
completion it would migrate:

```
posts fully plannable                    219
slides it would migrate                  255
  ├─ in the Cycle 4 manifest             208
  └─ NOT in the manifest                  47
        avatars                           28
        legacy flat post-images           19
posts skipped as partial                  16
private posts in scope                     0   (all posts are public today)
```

**28 avatar images would become `media_objects` rows and `post_media`
references, as though a member's profile picture were a photograph they
posted.** That is the "process a non-post asset" failure, proven by code path
and data rather than assumed. The 19 legacy flat entries are arguably real
photographs, but they are outside the audited, hashed, verified 207 — they would
enter with no manifest behind them.

### 2.2 — 🔴 NO FENCE, AND `expected_count` IS A COUNT, NOT A SET

Candidates are `posts` ordered by `created_at`, with no upper time bound. The
drift guard compares `expected_count` to `wholePosts.length`. **If one post
leaves the plannable set and one arrives, the count is unchanged and the guard
passes while the set has changed.** A count is not a set. On a live platform
that adds a photograph every few hours, this is not theoretical.

### 2.3 — 🟠 THE URL'S HOST IS DISCARDED

```ts
const m = clean.match(/^https?:\/\/[^/]+\/(.+)$/);   // host thrown away
if (m) path = m[1];
for (const b of BUCKETS) if (path.startsWith(b + "/")) return path;
```

A row whose URL points at *any* host maps to the same key **in our own bucket**.
This is not SSRF — the foreign host is never contacted. It is worse in a quieter
way: the object that gets hashed and recorded may not be the object the post
displays. The manifest's whole value is that `sha256` describes the bytes a
viewer actually sees.

### 2.4 — 🟠 PATH TRAVERSAL IS UNGUARDED (UNPROVEN, NOT DISMISSED)

`post-images/../national-ids/x.webp` passes `startsWith("post-images/")`, and
`encodeURIComponent` does not encode `.`, so `..` survives into the request path.
Whether it escapes depends on whether Deno's `fetch` normalises the path before
signing and sending. **I did not test this, because testing it means attempting
to read a private object, and I will not do that to prove a point.** It is cheap
to close and must be closed regardless of which way it resolves.

### 2.5 — 🔴 "LEFT COMPLETELY UNTOUCHED" IS FALSE, AND ONE FAILURE MODE IS PERMANENT

The catch block carries this comment:

```ts
// Left completely untouched for the next run to retry from the start.
```

It is not true. There is no transaction. By the time a later slide or the
`post_media` insert fails, earlier slides of that post already have committed,
`ready` `media_objects` rows. They are **orphans**: real rows, referenced by
nothing, cleaned up by nobody.

Most of the time the next run absorbs them through the `(owner_id, sha256)`
reuse path. But there is a window that does not recover. If the run dies
**between the insert and `media_mark_ready`**, the row is left in `pending` or
`verified`, and the next run hits:

```ts
if (existing.state !== "ready") {
  throw new Error(`existing media ${existing.id} is in state ${existing.state}, not ready`);
}
```

That post now fails **on every future run, for ever**, with no code path that
repairs it. Recovery requires a human deleting the row by hand.

### 2.6 — 🟡 A POST CONTAINING THE SAME PHOTOGRAPH TWICE CANNOT BE MIGRATED

Reuse returns one `media_id` for identical bytes. Two slides of one post with
identical bytes therefore produce two `post_media` rows with the same
`(post_id, media_id)` — refused by `UNIQUE post_media_post_media_uniq`. The
whole post fails. Cycle 4 measured 0 duplicate hashes among the 207, so nothing
in the fenced population trips it today. It is a latent trap, not a live one.

### 2.7 — 🟡 `owner_id` COMES FROM THE POST, AND IS NEVER CROSS-CHECKED

Cycle 4 proved that for 207 of 207 candidates the UUID folder in the object path
**is** `posts.user_id`. That is a free, self-checking invariant and the function
does not use it. A mismatch would mean one member's bytes recorded under
another's ownership — and `media_objects.owner_id` cascades from `auth.users`,
so a wrong owner means the wrong person's deletion takes the photograph away.

### 2.8 — 🟠 IT TRUSTS FILENAMES OVER BYTES, AND THE PLATFORM'S OWN CODE DOES NOT

`dimsFromName(key) ?? imageDimsFromBytes(bytes)` and
`MIME_BY_EXT[extOf(key)]` — dimensions and MIME both come from the **name**
first, while the authoritative bytes are already in memory.

This directly contradicts `media-verify-upload`, whose own tests read:

> *"parseable bytes overrule the client's declared size"*
> *"dimensions are corrected from the bytes, not trusted"*

Two writers into the same table with opposite policies is a contradiction, and
the rule says stop rather than pick one silently. Cycle 4 measured 128/128
filenames matching the bytes, so the values would be right **today** — which is
exactly what makes it dangerous to leave.

### 2.9 — 🟠 `visibility` IS HARD-CODED `"public"`, AND `posts.privacy` IS NEVER READ

Every row is written `visibility: "public"` with no reference to the post's
privacy. All 234 posts are public today, so nothing is currently mislabelled.
The moment a private post exists, its photograph is recorded as public media.
The column default is `'private'`; the function overrides it to the least safe
value unconditionally.

### 2.10 — 🔴 TWO TESTS ASSERT SAFETY PROPERTIES THEY DO NOT CHECK

`src/__tests__/mediaBackfill.test.ts` has 14 tests. Two are worse than absent.

```ts
it("a failed post is reported and left untouched for the next run", () => {
  expect(/failures\.push\(\{ post_id: postId/.test(fn)).toBe(true);
});
```

It checks that a line pushing to an array exists. It does not check that the
post is left untouched — **and it is not** (§2.5). A green test carrying that
name is why this defect survived.

```ts
it("dimensions are recovered or the slide is refused — never guessed", () => {
  expect(/dimsFromName\(sl\.key\) \?\? imageDimsFromBytes\(bytes\)/.test(fn)).toBe(true);
});
```

This one **pins the defect in place**: it would fail if someone corrected the
order to bytes-first. The test enforces the weaker behaviour.

---

## 3. WHAT THE SCHEMA GETS RIGHT (AND THE ONE THING IT DOES NOT)

Measured from production, not assumed:

| control | status |
|---|---|
| `media_objects.id` = `gen_random_uuid()`, random public identifier | ✅ |
| `UNIQUE (owner_id, sha256)` — dedup scoped per owner, so one member's deletion cannot take another's photograph | ✅ |
| `sha256 bytea` + `CHECK octet_length = 32` | ✅ |
| `anon` / `authenticated` have **no** privilege on `media_objects` or `post_media`; `has_column_privilege(...,'sha256','SELECT') = false` | ✅ |
| `media_mark_verified` / `media_mark_ready` / `media_quarantine` — SECURITY DEFINER, **not executable** by `anon` or `authenticated` | ✅ |
| `tg_media_state_transition` — `owner_id` and `sha256` immutable; only `pending→verified→ready`, `any→quarantined` | ✅ |
| `tg_post_media_requires_ready` — BEFORE INSERT, `SELECT … FOR UPDATE`, refuses any media not `ready` | ✅ |
| `post_media` PK `(post_id, ord)` + `UNIQUE (post_id, media_id)` + FK `media_id … ON DELETE RESTRICT` | ✅ |
| `post_media.post_id → posts ON DELETE CASCADE`; `media_objects.owner_id → auth.users ON DELETE CASCADE` | ✅ |
| CHECKs: `bytes > 0`, `0 < width ≤ 100000`, `0 < height ≤ 100000`, mime in 4 values, visibility in 3, ready ⇒ has `original` derivative, quarantined ⇒ has reason | ✅ |

**The one gap, and it is forward-looking:** `anon` and `authenticated` have no
privileges on these tables *at all*. That is correct today and is what keeps
`sha256` server-side. But the RLS SELECT policies on both tables are currently
unreachable — and **the client switch will fail with permission denied** unless
grants are issued at that point. Worth knowing now rather than discovering it
during the switch.

---

## 4. CRITICAL SAFETY CHECK — ACTUAL CODE PATHS

| could it ever… | verdict | why |
|---|---|---|
| delete a live photograph | **NO** | no delete of any kind exists |
| replace an original | **NO** | no storage write exists |
| modify an existing post incorrectly | **NO** | `posts` is never written |
| create duplicate `media_objects` | **NO** | reuse path + `UNIQUE (owner_id, sha256)` |
| create duplicate `post_media` | **NO** | PK `(post_id, ord)` + `UNIQUE (post_id, media_id)` |
| assign media to the wrong owner | **UNLIKELY, UNCHECKED** | §2.7 — the free cross-check exists and is unused |
| publish an unverified object | **NO** | `tg_post_media_requires_ready` refuses anything not `ready` |
| bypass media authorization | **NO** | service role by design; no client path |
| **process a non-post asset** | **YES — 47 of them** | §2.1 |
| process a private object | **NO today** | private buckets absent from the allowlist; §2.4 caveat |
| process arbitrary URLs | **NO** | but the host is ignored, §2.3 |
| **race with a newly-created post** | **YES** | §2.2 |
| **leave an orphaned `media_objects` row** | **YES** | §2.5 |
| leave a `post_media` row pointing at missing media | **NO** | FK + `ON DELETE RESTRICT` |

---

## 5. MIGRATION MODEL — DOES IT SUPPORT FENCE → MANIFEST → BOUNDED → VERIFY → INVARIANT?

| stage | supported? |
|---|---|
| **FENCE** | ❌ absent. No time or id boundary anywhere. |
| **MANIFEST** | ❌ absent. It re-derives its own population at execution time and never reads a manifest. Its population is a **superset** of the manifest by 47 slides. |
| **BOUNDED EXECUTION** | ⚠️ partial. `max_posts` ≤ 50 exists; no byte, time or object-size budget. |
| **VERIFICATION** | ⚠️ partial. It counts `post_media` rows after insert. It never re-checks that the recorded `sha256`, width, height or MIME match the manifest. |
| **INVARIANT CHECK** | ❌ absent. No post-run invariant pass. |

**It does not support the model.** Per your instruction I have **not** rewritten
it. The exact changes required:

1. **Accept a manifest, do not re-derive a population.** Input becomes a
   `manifest_hash` plus the rows; refuse to execute if the hash is not
   `6f91b572…`. Anything absent from the manifest is not migrated. This alone
   closes §2.1, §2.2 and §2.3.
2. **Fence on `posts.created_at <= <fence>`**, and record the fence in the run
   report.
3. **Replace the count guard with a set guard** — compare a digest of the
   `(post_id, ord, url)` key set, not a length.
4. **Make each post atomic.** One RPC per post that inserts its media rows and
   its references in a single server-side transaction, or an explicit
   compensating delete of rows created during a failed post. Either closes §2.5.
5. **Repair the `pending`/`verified` dead end** — an existing non-`ready` row
   for the same `(owner_id, sha256)` must be driven forward or quarantined, not
   thrown on for ever.
6. **Bytes before names.** `imageDimsFromBytes(bytes) ?? dimsFromName(key)`, and
   MIME from magic bytes with the extension as a cross-check only. Matches
   `media-verify-upload` and the manifest.
7. **Cross-check `owner_id`** against the UUID folder in the object path; refuse
   the slide on mismatch.
8. **Derive `visibility` from `posts.privacy`**; never hard-code `"public"`.
9. **Verify against the manifest after writing** — recorded `sha256`, width,
   height, bytes and MIME must equal the manifest row, or the post fails.
10. **Reject `..` and enforce the CDN host** in key derivation.
11. **Handle a post that legitimately repeats one photograph** (§2.6), or refuse
    it with a clear reason instead of a constraint error.
12. **Log per-post outcomes server-side**, not only in the response.
13. **Cap object size and add a wall-clock budget.**
14. **Fix the two tests in §2.10** — and mutation-verify them, because both
    currently pass against code that does not do what they claim.

---

## 6. THE 208TH PHOTOGRAPH

Not migrated. Not planned. Your preferred model is the right one:

```
initial fence  →  migrate the fenced 207  →  delta fence  →  migrate arrivals  →  final reconciliation
```

Two things to fix in it before it runs:

- **The fence must be recorded in the run, not held in a document.** The
  execution request should carry `fence_created_at` and `manifest_hash`, and the
  function should refuse to touch any post created after the fence.
- **The delta fence must be measured, not assumed.** Every arrival goes through
  the same Cycle 4 measurement — real bytes, real hash — and produces a delta
  manifest with its own hash. No arrival is migrated on the strength of its
  filename.

Final reconciliation should assert: every fenced post has references; every
reference's media matches its manifest row byte-for-byte; no `media_objects` row
exists without a reference; `count(post_media) == count(manifest rows)`.

---

## 7. STATE

- **Production:** unchanged. Ledger `20260817102540`. `media_objects` **0 rows**,
  `post_media` **0 rows** — re-verified. `backfill-media-objects` remains
  **undeployed**.
- **Git:** `origin/main` = `5ebbca55f8442cc786a75a7fc9d1bbc3020162da`, clean,
  nothing committed this cycle.
- **Tests:** not re-run — no code changed. Last full run 1,924 passed / 1
  skipped / 0 failures.
- **Manifest hash reviewed:** `6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84` —
  unchanged, still the accepted fence. Note the fenced population is 207 while
  this function would take 255.

## OPEN RED

1. `backfill-media-objects` — **FAILS this audit.** 14 changes required. Must
   not be deployed.
2. Two tests in `mediaBackfill.test.ts` assert safety that does not exist; one
   pins a defect in place.
3. `measure-post-media` still deployed; delete once you are done with it
   (auto-expires 2026-09-01).
4. Client switch will hit permission-denied — no grants on `media_objects` /
   `post_media` for `authenticated`.
5. Drift: 208 candidates now vs the 207 fence.
6. CDN/R2 orphan completeness unknowable — I must never handle Cloudflare
   credentials.
7. RED-B3d-IMG-2 — Supabase transformation 403, 11 shipped code paths.
8. Phase 1 carry-over: `20260429071225` mirror triggers · 27 anon write grants on
   9 judging tables · ledger baseline 599 rows · B3d-IMG-1 · TypeScript strict
   cleanup · Android device verification (yours).
