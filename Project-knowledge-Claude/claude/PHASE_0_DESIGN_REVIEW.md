# Phase 0 — Design Review

**No migration has been written or applied.** This document is the checkpoint you asked for before any structural change. Production's newest applied migration is still `20260813171159 feed_author_identity`.

**Done before writing this, both approved by you:**
- `20260813190000_post_image_meta` **withdrawn** — commit `027dbf7`. Never applied. `supabase/rollback/` now contains only the `feed_author_identity` rollback. The two migration-reading guard tests re-run green (51 passed).
- `enqueue_email` blast radius **measured, not assumed** — §1.

---

## 1. NEW FINDING — THE 248 ANON-EXECUTABLE FUNCTIONS HAVE ONE ROOT CAUSE, NOT 248

The audit reported 248 SECURITY DEFINER functions executable by `anon` and recommended auditing each. That recommendation was wrong in an instructive way. Measured on production:

```sql
select n.nspname, d.defaclobjtype, array_to_string(d.defaclacl,' | ')
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public';
```
```
public | f | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
public | r | anon=arwdDxtm/postgres | authenticated=arwdDxtm/postgres | ...
public | S | anon=rwU/postgres  | authenticated=rwU/postgres  | ...
```

**`ALTER DEFAULT PRIVILEGES` grants EXECUTE on every function created in `public` to `anon` and `authenticated`, automatically.** This is Supabase's stock configuration. Every one of the 248 is a consequence of that single line — no developer chose them individually. It also means **every future function is anon-executable the moment it is created**, unless explicitly revoked.

That changes the fix from "audit 248 functions" to "change the default, then allow-list". It also means an audit-and-revoke pass would be undone by the next migration.

### 1.1 The original migration got it right and was silently undone

`supabase/migrations/20260322151646_email_infra.sql:193-196`:

```sql
-- Restrict queue RPC wrappers to service_role only (SECURITY DEFINER runs as owner,
-- so without this any authenticated user could manipulate the email queues)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
```

Whoever wrote that understood the risk exactly and wrote the correct fix. Production today reads `anon=X | authenticated=X | service_role=X | postgres=X`. **The protection was reverted, not absent** — the same failure mode as the `COALESCE` guard that went missing for eight days.

### 1.2 The project's own scanner found this and it was frozen into a baseline

`scripts/audits/baselines/rls-authority-baseline.json`:

```
description: "Phase 0B-6 frozen baseline of pre-existing RLS / SECURITY DEFINER
              findings. New entries beyond this set fail CI."
generated_at: 2026-05-12
total: 281   by_severity: { HIGH: 259, MEDIUM: 22 }
by_type: { SECDEF_NO_AUTH_GUARD: 258, ANON_READ_GRANT_SENSITIVE: 4, ... }
```

`public.enqueue_email` is in it, typed `SECDEF_NO_AUTH_GUARD`, severity HIGH.

So the scanner detected all 258, classified them HIGH, and they were frozen as accepted in May. `scripts/security-audit.mjs` reports `CRITICAL 0 · HIGH 0` because it is a **different scanner that does not read this file**. Two green gates, 259 HIGH findings sitting between them. This is the same class as the vacuous typecheck and the superseded-migration test: a gate that is green because it is not looking.

**Ratchet baselines are a legitimate technique — but only with an expiry and an owner.** This one has neither, and is 3 months old.

### 1.3 `enqueue_email` — measured blast radius of the revoke

| Caller | Auth used | Affected by revoking anon/authenticated? |
|---|---|---|
| `supabase/functions/auth-email-hook/index.ts:238-240` | `SUPABASE_SERVICE_ROLE_KEY` | **No** |
| `supabase/functions/send-transactional-email/index.ts:65,150` | `SUPABASE_SERVICE_ROLE_KEY` | **No** |
| 7 DB trigger functions (`PERFORM enqueue_email(...)`) | run inside SECURITY DEFINER owned by `postgres` | **No** |
| `src/` — any client call | **none exist** (only the generated `types.ts` entry) | **No** |

**Zero legitimate callers lose access.** The abort criterion I wrote for Phase 0 — "revoking breaks a live email path" — is measured false. The revoke is safe to apply on your word.

---

## 2. FINAL SCHEMA — `media_objects`

```sql
CREATE TABLE public.media_objects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sha256      bytea NOT NULL,
  width       int    NOT NULL CHECK (width  > 0 AND width  <= 100000),
  height      int    NOT NULL CHECK (height > 0 AND height <= 100000),
  bytes       bigint NOT NULL CHECK (bytes > 0),
  mime        text   NOT NULL CHECK (mime IN ('image/webp','image/jpeg','image/png','image/avif')),
  visibility  text   NOT NULL DEFAULT 'private'
                     CHECK (visibility IN ('public','restricted','private')),
  derivatives jsonb  NOT NULL DEFAULT '{}'::jsonb,
  state       text   NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending','verified','ready','quarantined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

-- Per-owner dedup + retry idempotency. Deliberately NOT global — see §4.
CREATE UNIQUE INDEX media_objects_owner_content
  ON public.media_objects (owner_id, sha256);

-- The orphan sweep and the derivative worker both drive off this.
CREATE INDEX media_objects_state_created
  ON public.media_objects (state, created_at)
  WHERE state <> 'ready';

ALTER TABLE public.media_objects ENABLE ROW LEVEL SECURITY;
```

**`state` is the integrity gate, and it is why a row is not usable on the client's word:**

| state | meaning |
|---|---|
| `pending` | row created, bytes not confirmed |
| `verified` | server recomputed `sha256` from stored bytes and it matches the claim |
| `ready` | all required derivatives written; **only this state may be referenced by a published post** |
| `quarantined` | recomputed hash disagreed with the claim, or the file failed decode |

**`sha256` is `bytea`, not `text`, and never appears in any return type.** It is enforced, not documented — see §11, test T3.

**`visibility` defaults to `private`.** A newly created object is not public until a reference makes it so. Defaulting the other way is how the current friends-privacy gap (§4.2) came to exist.

---

## 3. FINAL SCHEMA — `post_media`

```sql
CREATE TABLE public.post_media (
  post_id   uuid NOT NULL REFERENCES public.posts(id)         ON DELETE CASCADE,
  ord       int  NOT NULL CHECK (ord >= 0),
  media_id  uuid NOT NULL REFERENCES public.media_objects(id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, ord)
);

CREATE INDEX post_media_media_id ON public.post_media (media_id);  -- ref-count sweep

ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
```

`ON DELETE RESTRICT` on `media_id` is deliberate: **a media object cannot be deleted while a post still points at it.** Deletion goes through the sweep, which checks references first. `ON DELETE CASCADE` here would let a race delete bytes out from under a live post.

`ord` is the slide order, replacing array-index alignment — which is the mechanism behind the mismatched `thumbnail_urls`/`image_urls` lengths that `PostMedia.tsx:355-357` records as one of three routine paths into the 14.7 MB backdrop. A composite primary key makes misalignment unrepresentable rather than merely detectable.

**Generalisation:** the same shape serves `entry_media`, `gallery_media`, `journal_media`. Phase 2 creates `post_media` only. The others migrate later, unchanged in design.

---

## 4. AUTHORIZATION MODEL — PUBLIC vs FRIENDS MEDIA

### 4.1 The rule

> **A media object's storage visibility is the strictest privacy of any reference to it. Authorization is always evaluated on the reference row. Object existence proves nothing and grants nothing.**

| `visibility` | Storage | Delivery | Cache |
|---|---|---|---|
| `public` | public bucket, `media/<id>/…` | CDN direct | `public, max-age=31536000, immutable` |
| `restricted` (friends-only) | **private bucket** | signed URL, TTL 300 s, issued only after `can_view_post` passes | `private, no-store` |
| `private` (unpublished, pending, quarantined) | private bucket | owner only, signed | `private, no-store` |

Visibility is maintained by trigger on `post_media` and on `posts.privacy`: on insert or privacy change, recompute as the strictest across all references. A downgrade public → restricted **moves the object between buckets**; the old public key must be deleted, not merely dereferenced, or the bytes stay fetchable.

### 4.2 The gap this closes — stated plainly

Today every post object is publicly readable on the CDN regardless of `posts.privacy`. This is currently harmless **only** because 100% of the 210 production posts are `privacy='public'` — verified by query, not assumed. The first friends-only photograph makes its bytes publicly fetchable while the post row is correctly protected by `can_view_post`. Unguessable addressing raises the cost of exploiting that; it does not make it correct.

**This ships inside Phase 2, per your instruction — not deferred until someone uploads a private photograph.**

### 4.3 Why address unguessability is defence-in-depth, never the control

Random `media_objects.id` means an address cannot be derived from content, which is what closes the side channel (§5). It is **not** an access control: a URL that leaks is a URL that works. For `restricted` and `private`, the control is the signed URL plus the reference check. Public objects are public by intent, and their address being unguessable is a bonus, not a mechanism.

### 4.4 RLS

```sql
-- media_objects: a member may see rows they own, or rows referenced by a post they may view.
CREATE POLICY media_objects_select ON public.media_objects FOR SELECT USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.post_media pm
    JOIN public.posts p ON p.id = pm.post_id
    WHERE pm.media_id = media_objects.id
      AND public.can_view_post(auth.uid(), p.user_id, p.privacy)
  )
);
```

⚠ That `EXISTS` is a per-row function call — the identical shape that makes the feed non-sargable. **It must never be the feed's read path.** The feed reads media through the SECURITY DEFINER RPC, which resolves URLs server-side after its own visibility filter. This policy governs direct table access only. Recording it here so it is a decision, not an accident.

---

## 5. WHY PER-OWNER DEDUP, RESTATED FOR THE RECORD

`UNIQUE (owner_id, sha256)` — not global.

| Requirement | Satisfied how |
|---|---|
| No user can infer another possesses an image from a shared hash | Two owners → two rows → two unguessable addresses. **Structural, not policy.** The hash never appears in an address, so there is nothing to compute and probe |
| Retry idempotency | A retry is the same owner re-sending the same bytes — exactly what the unique index catches |
| Deletion isolation | Deleting one member's post cannot affect another's bytes |
| Takedown isolation | A DMCA notice against one upload cannot remove a different member's file |

**Cost:** cross-user byte-identical storage dedup is given up. On a platform of original photographs that population is near-empty, and where it isn't (a stolen re-upload), merging is the wrong behaviour.

---

## 6. UPLOAD STATE MACHINE

`idempotency_key` is generated **once** on the client, before any network call, and reused across every retry of that composition.

```
 1  INSERT posts (status='pending_media', idempotency_key)   UNIQUE (user_id, idempotency_key)
 2  per photo: INSERT media_objects (owner_id, sha256, w, h, bytes, mime, state='pending')
                                                            UNIQUE (owner_id, sha256) → idempotent
 3  presign → PUT media/<media_id>/original.webp             deterministic key
 4  server verifies checksum, recomputes sha256 → state='verified' | 'quarantined'
 5  derivative worker writes 600/1080/1440 → derivatives, state='ready'
 6  INSERT post_media (post_id, ord, media_id)               requires state='ready'
 7  UPDATE posts SET status='published'                      requires every ord present
```

| Kill point | State found on relaunch | Recovery |
|---|---|---|
| 1 before presign | post `pending_media`, no media | resume at 2, or swept |
| 2 after presign | as above; presign just expires | re-presign, nothing written, no orphan |
| 3 10% uploaded | partial object at a **known** key | re-PUT same key, overwrites itself |
| 4 50% | same | same |
| 5 90% | same | same |
| 6 original uploaded | row `verified`, `derivatives` empty | worker resumes at 5 |
| 7 derivatives done | `ready`, no `post_media` | resume at 6 |
| 8 post created | `published` | no-op; same key returns the same post |

**Enforced invariants:** `UNIQUE (user_id, idempotency_key)` → zero duplicate posts. Deterministic keys → zero orphans from retry. `UNIQUE (owner_id, sha256)` → zero duplicate media. Step 6 gated on `state='ready'` → **no published post can reference bytes that were never verified.**

### 6.1 Race handling — your point 2

| Race | Resolution |
|---|---|
| Two simultaneous uploads of the same image, same owner | Unique index; loser takes `ON CONFLICT DO NOTHING … RETURNING` then re-selects. Both converge on one row |
| Same idempotency key from two requests | Unique index on posts; loser reads the winner's row |
| Two derivative workers on one media | Advisory lock keyed on `media_id`; worker writes are idempotent (same input → same output at the same key) |
| Publish racing derivative completion | Step 6 requires `state='ready'`. Publish cannot win |
| Deletion racing derivative generation | `ON DELETE RESTRICT` + the worker re-checks the row still exists before its final write; a deleted row leaves an unreferenced object the sweep collects |
| Account deletion racing media processing | `owner_id` cascade removes rows; the sweep removes bytes. Worker writes to a deleted row fail the existence re-check |

These are Phase 3 test cases, not prose — see §11.

---

## 7. RANKING AND SESSION SEED

```sql
ORDER BY COALESCE(p.viewer_bucket, 0)
       + (hashtextextended(p.id::text || _seed, 0) & 2147483647)::float8
         / 2147483647.0 * 6.0
       ASC, p.id
```

`_seed` — client-generated per feed session (`crypto.randomUUID()`), persisted for the session, sent with every page, regenerated on pull-to-refresh. Cursor is `(rank_score, id)`; the exclusion array is deleted.

**Compatibility:** the seed is a new optional parameter. Callers that omit it get today's behaviour. Payload-shape gating (`useFeedQuery.ts:214-227`) keeps installed APKs working.

---

## 8. `viewer_count` MUTATION — R7, AND WHY IT IS THE DANGEROUS ONE

The rank score depends on `viewer_count`, which the Phase 1 trigger now maintains **live**. A post whose count changes between page 2 and page 3 moves in the ordering and can be returned twice or skipped — **defeating R1 in production while R1 passes on a frozen harness.** That is precisely the false-green pattern this project has been bitten by three times.

**Decision: coarse bucketing, not per-session materialisation.**

```sql
viewer_bucket int GENERATED ALWAYS AS (LEAST(viewer_count / 5, 40)) STORED
```

- Ordering only changes when a post crosses a bucket boundary — roughly 1 in 5 views instead of every view.
- Requires no per-session state, no extra table, no TTL, no cleanup.
- The cap at 40 (200+ viewers) stops popular posts sorting arbitrarily far back and preserves the reach-equalising intent.
- Residual risk is bounded and measurable, not eliminated — **R1 must therefore run under concurrent writes**, and the acceptance threshold is **zero duplicates and zero omissions across a full paginated traversal while a writer is actively generating views.**

Rejected alternative: materialising per (viewer, seed) gives perfect stability and costs a table, a TTL, a cleanup job and a write per feed session. Revisit only if bucketing fails R1 under concurrency.

**R6 restated as product behaviour, not a bug:** a post created mid-session whose score sorts before the cursor is not seen until refresh. Correct for a keyset cursor. It requires a "new posts available" affordance, which is a Phase 4 UI deliverable.

---

## 9. DERIVATIVE ARCHITECTURE

| Tier | Long edge | Serves | Phase 2 format |
|---|---|---|---|
| `600` | 600 | 117px strip, grids, DPR-1 desktop card | WebP |
| `1080` | 1080 | phone card at the dominant DPR cluster; desktop 590@DPR2 = 1180 | WebP |
| `1440` | 1440 | 412×3.5 phones, retina desktop, full-screen viewer | WebP |
| `original` | ≤2560 | zoom + download **only**; untransformed, CORS-clean | WebP |

**WebP only in Phase 2. AVIF is its own later change**, benchmarked against your own photography corpus — per your instruction not to make the first media migration five variables at once.

Generation: an edge function modelled on `supabase/functions/backfill-thumbnails/`, which already parses both Supabase and CDN URL shapes. **Server-side, never the client** — the client already performs 2 encodes and 4 full decodes per photo on the main thread; two more tiers would make it 4 and 6.

Cloudflare `/cdn-cgi/image/` is **not** the pipeline. Verified working from `www` and `cdn` today, but it is zone config outside this repo that has flipped once (trap #1), sends **no CORS headers** so it can never serve the download or canvas path, and the free plan caps at 5,000 unique transforms/month. Legacy fallback only, behind `originalOnError`.

**Quality:** `webpQuality: 0.92` today, measured at 335 KB where q82 of the same pixels is 157 KB. Phase 2 encodes to a perceptual target per image rather than a fixed number.

---

## 10. MIGRATION ORDER AND ROLLBACK

Every migration has a matching file in `supabase/rollback/`, round-trip tested on a branch before production. **No two structural changes share a migration.**

| # | Migration | Rollback | Reversible? |
|---|---|---|---|
| M1 | `enqueue_email` revoke + queue allow-list + `auth.uid()` gate | restore prior ACL | fully |
| M2 | `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM anon, authenticated` + explicit allow-list for every function the client legitimately calls | restore the default | fully — **but see the warning below** |
| M3 | `posts.is_public` generated + partial index | drop both | fully, generated column loses no data |
| M4 | `posts.viewer_count` + trigger + `viewer_bucket` generated | drop; feed falls back to the LATERAL | fully |
| M5 | `get_broadcast_feed` — sargable + `_seed` + cursor. **One DROP/CREATE, three overloads, explicit re-GRANT** (trap #3) | matching rollback restores the 15-column definition | fully |
| M6 | `media_objects` + `post_media` + RLS + triggers | drop tables | fully — additive, nothing reads them yet |
| M7 | `get_broadcast_feed` returns resolved `media` | matching rollback | fully; `image_urls`/`thumbnail_urls` stay correct throughout |
| M8 | `posts.status` + `idempotency_key` + unique index | drop | fully |

⚠ **M2 is the highest-risk migration in this list and must not ride with anything else.** Revoking the default EXECUTE grant will break every RPC the client legitimately calls that is not on the allow-list, and the failure mode is a blank feature for real members while the owner (as `postgres`) sees everything working — the exact asymmetry trap #3 describes. It requires: a complete enumeration of client-called RPCs from `src/`, allow-listed by name; application to a **branch** first; and a verification pass that exercises the real anon and authenticated paths, not the catalog (trap #5).

**M1 → M5 need no app build. M6 → M8 are server-side; only the client half of Phase 2 and Phase 3 need builds — two in total.**

---

## 11. TESTS THAT MUST PASS BEFORE THE FIRST MIGRATION

Full gate green first: `tsc -b` · `vitest` · `npm run build` · `security-audit.mjs` 0/0 · advisor ERROR 0.

### Design-gate tests — before M6

| id | Test | Pass |
|---|---|---|
| T1 | Two accounts upload identical bytes | 2 rows, 2 distinct addresses, no observable difference |
| T2 | Address derivability | no URL anywhere derivable from content |
| T3 | `sha256` containment | zero occurrences in any RPC return type, view, or client payload — catalog query **and** source assertion |
| T4 | Friends-privacy bytes | **anonymous HTTP request** to the object → denied. Not a catalog check (trap #5) |
| T5 | Visibility downgrade | public → restricted deletes the public key; old URL 404s |
| T6 | Hash integrity | claimed hash ≠ recomputed → `quarantined`, never referenceable |
| T7 | Reference gate | `post_media` insert with `state<>'ready'` is rejected |
| T8 | RLS parity | `media_objects`/`post_media` RLS matches the 141/141 standard |

### Ranking tests — before M5

| id | Test | Pass |
|---|---|---|
| R1 | Completeness + uniqueness, exhaustive | every visible id exactly once |
| R1c | **R1 under concurrent writes** | same, while a writer generates views |
| R2 | Determinism | same seed twice → identical ordering |
| R3 | Fairness | Spearman(viewer_count, position) within **±0.05** of today's `random()` |
| R4 | Reshuffle | mean Kendall τ **< 0.3** over 100 seed pairs; mean rank displacement **> 20%** |
| R5 | No viewer-linkability | two viewers, same seed → uncorrelated |
| R6 | Mid-session insert | documented behaviour, no omission of already-orderable posts |
| R7 | Bucket stability | a view that does not cross a boundary does not reorder |

### Concurrency tests — before M8 (your point 2)

C1 simultaneous identical upload, same owner · C2 same idempotency key twice · C3 two derivative workers on one media · C4 publish racing derivative completion · C5 deletion racing generation · C6 account deletion racing processing.
**Pass for all six: exactly one logical post · zero orphan objects · zero duplicate media objects.**

### Disaster / recovery track (your point 1) — before the Production Readiness Gate

| id | Scenario | Pass |
|---|---|---|
| D1 | PITR restore to a branch, verified against a known row set | RPO/RTO **measured and stated**, not assumed |
| D2 | R2/storage unreachable | feed degrades to cached/placeholder, no blank page, error surfaced |
| D3 | CDN unreachable | per-image fallback holds (`originalOnError`); no permanent placeholder |
| D4 | Supabase unreachable | app shows a connection state, telemetry queues locally — **today both senders swallow their own rejection, so an outage is invisible by construction** |
| D5 | Edge function outage | uploads fail loudly and resumably, never silently orphan |
| D6 | Corrupted derivative | detected by hash recheck → regenerated, not served |
| D7 | Partial migration | every migration is transactional; verify no half-state is reachable |
| D8 | Failed rollback | each rollback file executed on a branch against the post-migration state |
| D9 | Backup restoration drill | full restore into a branch, application boots, feed renders |

---

## 12. COST MODEL (your point 3) — ELEVATED TO AN ARCHITECTURE METRIC

Tracked per phase, not only in observability. **A system can be technically scalable and economically impossible**, and for an image platform egress is the dominant line.

| Metric | Baseline | Phase 2 target |
|---|---|---|
| **CDN egress per 1,000 feed views** | not measured today | **≥ 70% below baseline** |
| Storage bytes per uploaded photo (all tiers) | ~335 KB original + 15 KB thumb | original + 3 tiers, original re-encoded to a perceptual target |
| Image processing cost per upload | 0 server (all client, main thread) | server-side, measured per derivative |
| Database cost per 1,000 feed views | 1,072 buffers/page today | < 2,000 buffers at 100k posts |
| Edge invocations per upload | 1 presign | presign + verify + derivatives |
| Realtime messages per reaction | up to N per connected client | ≈ 1 per interested client |
| Cost per 1,000 uploads | not measured | measured |
| Storage growth rate | not measured | measured, projected 12 months |

⚠ Phase 2 **increases** storage per photo (three new derivatives) while **decreasing** egress. On a photo platform egress dominates storage by a wide margin, so the net is strongly favourable — but it must be measured, not assumed. That measurement is a Phase 2 gate deliverable.

---

## 13. PRODUCTION READINESS GATE (your point 4) — FINAL GO / NO-GO

Not "the feed works at 1M posts." All six sections must pass, each with a stated number, before a production-readiness claim is made.

| Section | Criteria |
|---|---|
| **Security** | 0 critical/high npm advisories · 0 advisor ERRORs · **0 unauthorized storage reads** proven by real anonymous requests · RLS verified on every table incl. the new ones · the frozen RLS baseline retired to 0 open HIGH, or each entry re-accepted with a named owner and an expiry |
| **Reliability** | RTO/RPO **defined and demonstrated** · backup restoration drill passed (D9) · upload recovery 8/8 (§6) · concurrency C1–C6 |
| **Performance** | feed p95 target met at 100k on the harness · image transfer ≥70% reduction device-observed · memory target under a long scroll on a real mid-range Android · cold-start target |
| **Scalability** | 1M-post benchmark · concurrency benchmark · realtime fan-out at 500 concurrent |
| **Observability** | errors · crashes · latency p50/p95/p99 · upload success rate · CDN egress · DB — all queryable, **with alerting from a second sink independent of Supabase** |
| **Economics** | cost per 1,000 feed views · cost per 1,000 uploads · storage growth rate — all measured, with a 12-month projection |

---

## 14. WHAT I NEED FROM YOU TO PROCEED

**Approve this design**, or mark up the parts you want changed. On approval I will:

1. Write M1 (`enqueue_email`) — pre-flight, apply, verify, gate report. Blast radius is measured at zero legitimate callers (§1.3).
2. Write M2 (**default privileges**) as its own migration with a complete client-RPC allow-list, applied to a **branch** first. This is now the largest security item, and it is systemic rather than per-function.
3. Change the Android workflow typecheck to `tsc -b` and fix the two errors it exposes.
4. Build the seeded harness on a branch, including a realistic share of `friends`-privacy posts — **without which every scale number stays an extrapolation.**

Then the Phase 0 gate report, in the §6 format from plan v2, before any Phase 1 work begins.

**Nothing in this document has been applied.** The only production change I am asking permission for is M1.
