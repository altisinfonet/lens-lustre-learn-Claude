# PHASE 2 — WORKSTREAM 3 CLOSURE

**Date:** 2026-08-20 · **Repo:** `main` (unchanged this workstream — no PR raised)
**Phase 3:** not started · **D-002/D-003:** documented only · **measure-post-media:** KEPT
**Production writes this workstream:** ZERO. No fence, no manifest, no migration, no storage change.

---

## THE HEADLINE, AND IT IS NOT WHAT THE BRIEF EXPECTED

> **The "29 migratable legacy slides" are not migratable.** Not by this engine, not
> without doing two things the brief forbids. The audit refutes the premise, so
> Workstream 3C's own gate — *"if and ONLY if the audit proves the 29 are safely
> migratable"* — is not met, and no fence or manifest was created.

Three things the audit found that were not previously on the record:

1. **27 of the 29 slides are not in R2 at all.** They are served from
   `jtdtehuqtinjxropkkcn.supabase.co`. All 23 distinct objects return **404** from
   `cdn.50mmretina.com`, verified by retrieval.
2. **Every one of those 27 is a 600-pixel `-thumb.webp` DERIVATIVE**, not an original.
   17 of the objects still have their 1920-pixel original sitting beside them in Supabase.
3. **The prepared Class-F repair would have aborted.** Its gate demands exactly 15 posts;
   evaluated read-only against production it changes **8**. It would have failed
   `REPAIR-001` on its first run, from the day it was written.

---

## 1. PHASE 2 PERCENTAGE — BEFORE

**94%**, per the WS2 closure model: 3 points D-002/D-003, 2 points the 29-slide backlog,
1 point the Class-F repair.

## 2. PHASE 2 PERCENTAGE — AFTER

**94%.** Unchanged, and deliberately so.

Nothing was migrated, so nothing moved. **I am not claiming a percentage increase for
audit work.** What changed is the *composition* of the remaining 6 points — two of them
turn out to be blocked rather than pending, which is a materially different thing to know
and is argued in §21.

---

## 3–6. MIGRATION COUNTS

| | |
|---|---|
| slides migrated | **0** |
| posts migrated | **0** |
| slides still legacy-only | **47** (29 migratable-in-name + 18 permanent floor) |
| posts still legacy-only | **35** (17 + 18) |

---

## 3A — THE AUDIT: THREE CLASSES, RE-PROVEN FROM PRODUCTION

Full 29-row, 22-fact matrix: **`WS3_LEGACY_MEDIA_EVIDENCE.tsv`** (attached).
Classification re-derived from production evidence, not from the old B/C/D/E/F labels.

| class | slides | posts | objects | what it is |
|---|---|---|---|---|
| **W3-1** | 20 | 8 | 17 | Supabase-hosted 600px thumbnail, **1920px original still present** |
| **W3-2** | 7 | 7 | 6 | Supabase-hosted 600px thumbnail, **original gone** (3 of them are `avatar-thumb.webp` — derivatives of a MUTABLE avatar) |
| **W3-3** | 2 | 2 | 2 | **Real R2 cover photographs**, `avatars/covers/<owner>/`, owner at path segment 3 |
| | **29** | **17** | **25** | |

Every object was retrieved and measured. All 29 exist. All are genuine photographs.
Ownership is provable from the path for all 29. Every W3-1 pair matches exactly as a
thumbnail/original should: **600px long edge ↔ 1920px long edge, aspect preserved**.

Four objects are shared by two posts each, so 29 slide positions come from 25 distinct
objects. That is the difference between "slides", "posts" and "objects" that the old
Class-F header got wrong (§3H).

---

## 3B — WHY NONE OF IT IS MIGRATABLE UNDER THE STATED CONSTRAINTS

### W3-1 and W3-2 (27 slides) — the object is not where the engine reads

The brief's preferred outcome is:

> existing storage object → verify → create `media_objects` → create `post_media` →
> **preserve existing `posts.image_urls`** → verify exact equivalence

**That sequence is architecturally impossible for these 27**, and the proof is one line of
the live `post_attach_media`:

```sql
WHERE _origin || '/' || (mo.derivatives->>'original') IS DISTINCT FROM _slides[t.ord]
  -> RAISE 'MEDIA-2205 % of % media do not resolve to the photographs this post shows'
```

`_origin` is `s3_storage_settings.public_url` = `https://cdn.50mmretina.com`. These posts'
`image_urls` begin `https://jtdtehuqtinjxropkkcn.supabase.co/...`. **A CDN-derived URL can
never equal a Supabase URL**, so "attach media" and "preserve `image_urls`" are mutually
exclusive here. The brief says not to rewrite `image_urls` *unless the architecture proves
it unavoidable* — it is now proven unavoidable.

And rewriting alone is not enough: the object must first **be** in R2. All 23 return 404
there. So migrating these 27 requires **a byte copy Supabase→R2 AND an `image_urls`
rewrite** — two forbidden operations, not one.

**And it would be the wrong thing anyway.** For the 20 W3-1 slides the object is a
*thumbnail*. Migrating it would enshrine a 600px derivative as the canonical "original"
in `media_objects`, permanently, while the real 1920px photograph sits beside it unused.
That is worse than the current state, not better.

### W3-3 (2 slides) — the object is right, the path shape is refused

These two are the interesting ones. They **are** in R2, they **are** originals
(1500×1000 and 2000×1333 JPEGs, retrieved and measured), and MEDIA-2205 **would** be
satisfied with **no rewrite at all** — the post already shows the CDN URL.

They are refused because the owner sits at path segment 3:

```
avatars/covers/569aa88e-.../file.jpg
        ^^^^^^ not a uuid, so MIG-1019's "owner at segment 2" cannot prove ownership
```

Two independent controls refuse them, and the second says so in terms:

```
-- DO NOT REMOVE, AND DO NOT WIDEN THE PREFIX LIST. ... The owner segment is
-- the part that must never move.
IF _orig !~ ('^(post-images|avatars)/' || _owner::text || '/') THEN
  RAISE 'MEDIA-2102 ...'
```

`docs/CANDIDATE_PATTERN_AUDIT.md` already records this exclusion as deliberate. Admitting
them means widening an **ownership** control to accept a shape where ownership is at a
different depth — the single highest-consequence change available in this engine. For two
slides. **My recommendation is: do not.** They are 2 slides out of 310, and the 2-slide
gain does not buy a weakened ownership proof.

### Summary

| class | copy needed | rewrite needed | security control change needed | migratable as-is |
|---|---|---|---|---|
| W3-1 (20) | **yes** | **yes** | no | **no** |
| W3-2 (7) | **yes** | **yes** | no | **no** |
| W3-3 (2) | no | no | **yes (ownership)** | **no** |

Source storage is untouched in every case, because nothing was done.

---

## 3C / 3E / 3F — NOT PERFORMED, BY THE BRIEF'S OWN GATE

3C is conditional: *"If — and ONLY if — the audit proves the 29 are safely migratable."*
It does not. No new fence, no candidate digest, no manifest, no SHA, no expected counts.
The frozen 229 fence and every historical manifest are **untouched**, as required.

No dry run and no real migration, because there is no manifest to run them against.
Inventing one would have been exactly the *"migration strategy before proving the
evidence"* the brief forbids.

---

## 3D — MUTATION RESULTS

The audit exposed a real gap, so coverage was extended even though no migration will run.

**The gap:** nothing asserted the **value** of `manifestPlan.CDN_HOST`. Only its *use*
(`host !== CDN_HOST`) was pinned. Retargeting that one constant at
`jtdtehuqtinjxropkkcn.supabase.co` admits all 27 Supabase-hosted thumbnails as migration
candidates — **and every existing assertion stays green.** Closed with a value assertion
plus a mutation that proves it bites.

| harness | mutations | detected | baseline |
|---|---|---|---|
| `tools/mutate-candidate-widening.mjs` | **19** (was 14) | **19 / 19** | GREEN |
| `tools/mutate-write-path.mjs` | 58 | 58 / 58 | GREEN |
| `tools/mutate-scheduled-duplicate.mjs` | 24 | 24 / 24 | GREEN |

New this workstream, all detected:

- **W1** `CDN_HOST` retargeted at Supabase — the whole 27 becomes migratable
- **W2** a class D admitting `avatars/covers/<owner>/` — owner moves to segment 3
- **W3** the class pattern admitting the `storage/v1/object/public/` prefix
- **W4** `media_mark_ready` widened to accept `avatars/covers/` — ownership unreadable
- **W5** the migrator gains a copy step — a source object is written, not just read

The 13 controls the brief named are now covered across the three harnesses: pattern
widening (1, 5, W2, W3), wrong bucket/host (W1, 11), ownership extraction (8, W4),
SHA-256 (migrator 5), dimensions/MIME/bytes (migrator 11), duplicate owner/hash and
post/ord (new assertions + migrator 6), manifest changed (2, migrator 1), fence ignored
(9, migrator 2), wrong post (migrator 3), wrong ord (migrator 6), source rewritten or
deleted (**W5** + a new assertion that the migrator contains no Put/Delete/Copy verb),
unresolved object treated as migratable (7).

`mutate-candidate-widening.mjs` now **refuses to run against a red baseline**, matching
the other two.

---

## 3G — INDEPENDENT VERIFICATION (measured directly, not via the engine)

| metric | value |
|---|---|
| total posts | **252** |
| total slides | **310** |
| `post_media` rows | **263** |
| `media_objects` rows | **265** |
| posts with `post_media` | 217 |
| **legacy-only posts** | **35** |
| **legacy-only slides** | **47** |
| media state distribution | `{ready: 265}` — nothing else |
| unreferenced media | 2 |
| non-ready media | **0** |
| references to non-ready media | **0** |
| owner mismatches | **0** |
| ordinal gaps | **0** |
| duplicate `(owner_id, sha256)` | **0** |
| duplicate `(post_id, ord)` | **0** |
| missing object paths | **0** |
| **`ref_set_md5`** | **`dce7bec802523fca3b0a4123ea0a2a6f`** |
| newest `media_objects` row | 2026-08-20 16:12:27 UTC |
| posts max `updated_at` | 2026-08-20 07:08:49 UTC |
| **`delta_growing`** | **false** |
| `new_unexplained_legacy_posts` | **0** |

### ⚠ PRODUCTION CHANGED BETWEEN WS2 AND WS3, AND THE NUMBERS MOVED

The WS2 verification post `98b2d052…` **has been deleted** (I flagged it as safe to
delete; it is gone). Consequences, stated plainly rather than glossed:

- total posts 253 → **252**; `post_media` 264 → **263**
- `posts_with_idempotency_key` 1 → **0**
- `NEW_POSTS_AFTER_WRITE_PATH_FIX` → **0**
- `NEW_LEGACY_ONLY_POSTS_AFTER_WRITE_PATH_FIX` → **0**, but now **vacuously** (0 of 0)

**The deletion behaved exactly as designed and is itself evidence:** `post_media` cascaded
away with the post, and the verified `media_objects` row `ff8108e6…` **survived**
(`ON DELETE RESTRICT` on `media_id`) and is one of the 2 unreferenced rows. Retention held
— deleting a post does not destroy the verified media object.

**What this does and does not change.** The WS2 production proof happened and was verified
at the time against 13 required facts, including an independent byte-level SHA-256 match
against the object in R2. That evidence stands. What no longer stands is a *live* row
demonstrating it. **The zero in "new legacy-only posts after the fix" is currently true of
an empty set**, and I will not present it as ongoing proof. The next real member post will
restore a non-vacuous measurement.

The other unreferenced media row is `18b96d23…`, the D-002 delivery probe. Retained by
policy. Neither is an anomaly.

---

## 7. CLASS-F COUNT AND CLASSIFICATION

**Class F is not a separate item from the 29 — it is the same population.** The brief
treated "29 migratable slides" and "1 Class-F repair" as items 1 and 2; the audit shows
item 2 covers 27 of item 1's 29.

| | objects | slides | posts |
|---|---|---|---|
| thumbnails **with** a surviving original (repairable) | **17** | **20** | **8** |
| thumbnails **without** an original (must not be touched) | **6** | **7** | **7** |
| **total Class-F** | **23** | **27** | **15** |

Of the 6 unrepairable: **3 slides are `avatar-thumb.webp`** — derivatives of a mutable
avatar whose original is already gone. These belong conceptually with the permanent floor,
not the backlog. They are currently counted as *migratable* only because the shipped
classifier matches `.../avatars/<uuid>/(avatar|cover).<ext>` on the CDN host, and these are
`post-images/<uuid>/avatar-thumb.webp` on the Supabase host. **The floor is undercounted by
3 slides and the backlog overcounted by 3.** I have not changed the classifier — that would
move a published number without an instruction to.

### ⚠ THE PREPARED REPAIR HAS A LATENT DEFECT — FOUND, CORRECTED, STILL UNAPPLIED

`UNAPPLIED_20260820140000_classF_repoint_originals.sql` carried:

```sql
if _n <> 15 then raise exception 'REPAIR-001: expected 15 posts, audited %', _n;
```

`_n` counts posts that **changed**. 15 is the number of posts in the **population**. Only
8 can change, because for the other 7 the original is gone and they are filtered out one
CTE earlier. **Evaluated read-only against production the statement selects 8 posts / 20
slides — so the file would have aborted on its first run.** The gate was right to refuse;
the constant was wrong.

Corrected in place (the file **remains `UNAPPLIED_`**):

- gate now `_n <> 8`, and a new **`REPAIR-003`** independently requires exactly **20**
  changed slides — posts alone cannot tell a 4-slide post from a 1-slide one
- the header's "17 slides across 15 posts" replaced with the four distinct counts

### The proposed operation, for your decision — NOT EXECUTED

- **What:** rewrite 20 slide positions across 8 posts from `X-thumb.webp` to `X.webp`.
- **Source hash / destination hash:** unchanged — no bytes are touched. This is a
  reference repoint, not a copy.
- **Byte / MIME / dimension equality:** deliberately NOT equal — that is the point. 600px
  → 1920px, same photograph, same aspect (verified per object by retrieval).
- **Ownership:** unchanged; both objects sit in the same owner folder.
- **Reference mapping:** captured whole in `media_repair_audit` before the update.
- **Rollback:** exact restore from that table, not a reconstruction.
- **CDN implications:** the `.webp` URLs are already publicly served and were retrieved
  during this audit; no cache purge needed.
- **Duplicate protection:** not applicable — no `media_objects` rows are created.
- **⚠ It does NOT reduce the legacy-only population by one.** These objects stay on
  supabase.co, so they remain legacy-only afterwards. It buys **fidelity**, not migration.

**NO COPY. NO DELETE. NO REWRITE performed.** Awaiting your decision.

---

## 8. NEW LEGACY-ONLY POSTS AFTER THE WRITE-PATH FIX

**0** — but see §3G: currently **vacuous**, because the only post created after the fix
has since been deleted. Zero posts have been created since 2026-08-20 07:08 UTC by anyone.

## 9. `delta_growing`

**false.** `new_unexplained_legacy_posts = 0`, `new_permanent_legacy_posts = 0`.

## 10–12. COUNTS AND DIGEST

`post_media` = **263** · `media_objects` = **265** · `ref_set_md5` = **`dce7bec802523fca3b0a4123ea0a2a6f`**

## 13. ANOMALY COUNTERS

All zero: partial posts, ordinal gaps, owner mismatches, duplicate `(post_id, ord)`,
duplicate `(owner_id, sha256)`, non-ready media, references to non-ready media, missing
object paths. Unreferenced media = 2, both explained above.

## 14. MUTATION RESULTS

**101 / 101 detected across three harnesses**, all from GREEN baselines. See §3D.

## 15. TEST SUITE

```
Test Files  163 passed | 1 skipped (164)
     Tests  2259 passed | 1 skipped (2260)
```
`tsc --noEmit -p tsconfig.app.json` clean (the CI config). ESLint clean on touched files.

## 16. CI RESULT

**Not run — nothing was pushed.** This workstream produced an audit, test/mutation
additions and a corrected `UNAPPLIED_` file, all held locally pending your decision on
§3H and §21. Raising a PR would imply a repair was agreed.

## 17. UI RESULT

**Not affected.** No client code changed. No post's `image_urls` changed, so no member
sees any difference.

## 18. DEPLOYMENT VERSIONS / HASHES

**No deployment.** `main` remains at `d5906ef` (WS2). Live functions unchanged:
`post_publish_with_media` `b38d88b5…`, `post_attach_media` `fef4bf75…`,
`create_system_post` `2a90beb4…`, `publish_post_draft` `3c208e23…`,
`media_mark_ready` `546879aa…`.

## 19. `measure-post-media` DECISION — **KEEP**

Dependency search across source, migrations, edge functions, tests, manifests, provenance
docs and tooling found **five live dependents**:

| dependent | why it still matters |
|---|---|
| `supabase/config.toml` | deployed, `verify_jwt = true` |
| `docs/MANIFEST_PROVENANCE.md` | it **produced** the approved manifests — 207 objects, 119,717,670 bytes read |
| `docs/CANDIDATE_PATTERN_AUDIT.md` | the evidence for classes B and C |
| `src/__tests__/measurePostMediaReadOnly.test.ts` | pins its read-only contract |
| `tools/mutate-candidate-widening.mjs` (mut. 12) | mutation target for the measurement population |

Decisive on its own: **WS3C requires any future manifest to be generated by this tooling,
not hand-written.** The audit did not eliminate the remaining work — it reclassified it —
so the tool that would measure any future population is still needed. **Not removed. No
removal change prepared.**

## 20. D-002 / D-003 STATUS — **UNCHANGED, EXTERNALLY BLOCKED**

Documented only, as instructed. The Cloudflare connector in this session is read-only for
Workers: it lists and reads Worker code and exposes no deploy, binding, route or DNS tool.
D-003 needs all four.

**D-002 is NOT closed and I did not run the negative test.** The brief is explicit that it
must not be closed without an actual unauthenticated-byte test, and the infrastructure to
make that test meaningful does not exist yet. The composer states the limitation honestly
to members today (*"The photo file itself can still be opened by anyone who has its direct
link — we are still building that protection"*), which I saw on screen during WS2.

## 21. EXACT REMAINING PHASE 2 BLOCKERS

| # | blocker | slides | nature | who can clear it |
|---|---|---|---|---|
| 1 | **D-002 / D-003** authorized media delivery | — | external infrastructure | Cloudflare/R2 access |
| 2 | **W3-1 + W3-2**: 27 slides on Supabase, all thumbnails | 27 | **needs an owner decision**, not more engineering — migrating them requires a byte copy into R2 *and* an `image_urls` rewrite | you |
| 3 | **W3-3**: 2 R2 cover photographs | 2 | **needs an ownership-control change** I recommend against | you |
| 4 | **Class-F repoint** (subset of #2) | 20 | prepared, corrected, gated, reversible — awaiting approval | you |

**The material change this workstream makes:** items 2 and 3 were on the books as
*pending migration work*. They are not. They are **decisions**, and one of them
(#3) I recommend answering "no".

## 22. EXACT REMAINING PERCENTAGE

**6% remaining. Phase 2 stands at 94%** — the same number as before, because nothing
shipped. Composition, using the WS2 model unchanged:

| remaining | points | status after this audit |
|---|---|---|
| D-002 / D-003 | 3% | blocked (external) |
| the 29-slide backlog | 2% | **reclassified: blocked on an owner decision, not pending work** |
| Class-F repair | 1% | prepared and corrected; awaiting approval |

**I have not manufactured a percentage.** If you rule D-002/D-003 outside Phase 2, it is
~97%. If you also decide the 29 will not be migrated — which the evidence supports — then
the remaining 2% is not *work*, it is a **documented, permanent exclusion**, and Phase 2
closes at that point rather than being carried indefinitely. That is the decision this
workstream exists to hand you.

---

## WHAT I WOULD FLAG

1. **The brief's premise was wrong, and it was wrong in the safe direction.** "29
   migratable slides" came from a URL-shape classifier that never checked whether the
   object was in R2. Nothing was broken by it; a number was just carried forward as work
   when it was actually a blocker.
2. **A prepared, reviewed, gated repair had a defect that only production could reveal.**
   Reading it was not enough — it had to be evaluated against the real population.
3. **`CDN_HOST` had no value assertion.** One word, and the entire Supabase population
   becomes migration candidates with a green suite. That is now closed and mutation-proven.
4. **Three slides are in the wrong bucket in the published numbers** (`avatar-thumb.webp`
   counted as backlog, not floor). Small, but it means the floor and backlog figures are
   both off by 3. I have not silently corrected a published number.
