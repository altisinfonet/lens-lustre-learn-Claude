# PHASE 2 · CONTROL CYCLE 7 — BLOCKER RESOLUTION + RE-AUDIT (READ-ONLY)

**PRODUCTION CHANGES: ZERO.** Nothing deployed, applied, executed, granted or
deleted. Verified: ledger `20260817102540`, `media_objects` 0 rows, `post_media`
0 rows. `origin/main = 8acb9c69f621e64f90de201f44526bac0e7a356e`, tree clean.

**Headline: I found a real defect in my own Cycle 6 build.** See §3.

---

## 1. MANIFEST — REPRODUCIBLE AND PRIVACY-SAFE

### Infrastructure actually available (audited, not assumed)

| mechanism | verdict |
|---|---|
| **The Claude Project attached to this work** | ✅ already holds it, private to the owner and his org, survives sessions |
| The public GitHub repo | ❌ **`Public` on the repo page.** 207 rows × (post_id, owner_id) is member data. Never. |
| GitHub Actions artifact | ❌ on a public repo, run artifacts are reachable by anyone who can see the run |
| Supabase private bucket (`entry-originals`, `national-ids`, `support-attachments` are `public=false`) | ⚠ viable, but writing one is a production change and is out of scope this cycle |
| Session workspace | ⚠ ephemeral; fine as a working copy, not as the store |

### The mechanism, and its proof

**The manifest stays in the Claude Project. The repository carries only its
SHA-256.** A digest is not member data — it reveals nothing about who posted
what — so the public repo can hold the commitment while the bytes stay private.

Round-trip proven this cycle:

```
project copy    6f91b572…4673c84   207 lines   86055 bytes
workspace copy  6f91b572…4673c84   207 lines   86055 bytes
cmp             no difference — byte-identical
```

Security properties: private to the owner's Claude organisation · not
world-readable · no member identifier in any public artefact · the bytes are
supplied to the migrator **as input at run time**, never embedded · integrity is
enforced by `assertManifestIntegrity` before a single row is read, so a
substituted or altered manifest is refused by `MIG-1003`.

Reproducibility chain: **project bytes → SHA-256 → `MIG-1003` gate → 207-row
parse → fence digest `f0a74d3e…` matched against production → execution.** Every
link is checkable by a third party who is handed the file.

**RESULT: RESOLVED.** One thing still needed from you, because it is a
governance choice not a technical one: the repo should carry a short
`docs/MANIFEST_PROVENANCE.md` naming the hash, the fence and where the bytes
live. I have **not** written it — it is a decision about what your public repo
says, and that is yours.

---

## 2. CLIENT MEDIA AUTHORIZATION — MINIMUM SAFE MODEL (DESIGN ONLY, NOTHING ISSUED)

Measured from production and from the shipped client.

**What the client reads today:** `posts.image_urls` and `posts.thumbnail_urls`
(`useFeedQuery.ts:114`, `PostMedia.tsx`). **Zero client code touches
`media_objects` or `post_media`** — grep across `src/` outside tests returns
nothing. So there is no existing access path to preserve; the model is chosen
from scratch.

**Current grants (re-probed):** `anon` and `authenticated` have **no privilege**
on either table; `has_column_privilege(…, 'sha256', 'SELECT') = false` for both.

### The finding that decides the design

`media_objects` has **no URL column**. The address of the file lives in
`derivatives->>'original'`, which is the **internal storage key**. So a client
cannot render a photograph from `media_objects` unless it is given either
`derivatives` (leaking internal paths) or a **server-constructed URL**.

That rules out the obvious answer. A column-scoped `GRANT SELECT` would still
have to include `derivatives`, and would additionally expose `state`,
`quarantine_reason` and `verified_at` unless every column is enumerated — and it
would let any client enumerate `media_objects` by id and probe for existence.

**Minimum safe model: a SECURITY DEFINER read function (or a security-invoker
view over one), returning per post only:**

```
post_id · ord · media_id · width · height · mime · url   (constructed server-side)
```

and nothing else. Authorization reuses the pattern already in both RLS policies:
`can_view_post(auth.uid(), p.user_id, p.privacy)`. No table grant is issued.

| role | may read |
|---|---|
| **ANON** | the 7 fields above, for posts where `can_view_post(NULL, …)` is true (public posts only). Nothing else. |
| **AUTHENTICATED NON-OWNER** | the same 7 fields, for posts `can_view_post` allows them. Nothing else. |
| **AUTHENTICATED OWNER** | the same 7 fields for their own posts. **No extra fields** — the owner has no product need for `sha256`, `state` or `derivatives`, and giving it to them creates a path to giving it to everyone. |
| **ADMIN / SERVICE ROLE** | everything, as today, through the service role only. |

**Never exposed to any client role:** `sha256` · `derivatives` (internal storage
paths) · `state` · `verified_at` · `quarantine_reason` · `owner_id` beyond what
`posts.user_id` already reveals · unreferenced or non-`ready` media · any media
whose post the caller cannot see.

**RESULT: DESIGNED, NOT ISSUED.** No grant, no RLS change, no function created.

---

## 3. SKIP / IDEMPOTENCY — ⚠ DEFECT IN MY OWN CYCLE 6 BUILD

### Exact condition

`supabase/migrations/20260817170000_media_migration_engine.sql:126–128`

```sql
if exists (select 1 from public.post_media where post_id = _post_id) then
  return jsonb_build_object('post_id', _post_id, 'result', 'skipped',
                            'reason', 'already has references');
```

`supabase/functions/migrate-post-media/index.ts:147–157`

```ts
await admin.from("post_media").select("post_id").in("post_id", slice);
…
if (done.has(postId)) { skipped++; … result: "skipped" … continue; }
```

### Invariants actually checked when skipping: **NONE**

Not `ord`, not `owner_id`, not `media_id`, not `sha256`, not width, height,
MIME, bytes, visibility, `derivatives`, `state`, not the reference count, not
readiness. **The condition is row existence and nothing else — exactly what your
instruction said is insufficient.** My Cycle 6 report called this "idempotent";
that was true of the *happy* path and I did not qualify it. Corrected here.

### Can a wrong state actually exist?

`media_migrate_post` is all-or-nothing, so **it** cannot leave a partial set. But
the skip check does not know who wrote the rows. Anything else that writes
`post_media` produces rows this migrator will treat as done without looking:
`post_publish_with_media` (the live publish path, `authenticated` may execute
it), the abandoned `backfill-media-objects` if it were ever run, or a manual
repair. Today both tables are empty, so **the defect is latent, not live.**

### Does anything else catch it?

Partly, and not well enough. `reconcile()` would catch a global count mismatch
(`MIG-1070`), but only when the run reaches `finished`, and it compares
**totals** — a post carrying the right *number* of references pointing at the
*wrong* media reconciles clean.

### Required change (NOT implemented)

Before returning `skipped`, verify the existing set against the manifest: same
count; ords contiguous from 0 in manifest order; each `media_id` resolving to a
row with the manifest's `sha256`, width, height, bytes, mime, `owner_id` and
`state = 'ready'`. Then **confirm-skip**, **repair**, or **refuse** — never
skip silently. `verified-skip` and `skipped` must be different words in the
report.

**RESULT: FAIL. This must be fixed before any production run.**

---

## 4. CYCLE 6 RE-VERIFICATION

| | claim | exact source | evidence | result |
|---|---|---|---|---|
| **A** | 207/207 manifest membership | `manifestPlan.ts:95` integrity, `:110+` parse; `index.ts:123,127` | dry run: hash `6f91b572…` PASS, 207 rows, 180 posts, 48 owners, 0 refusals | **VERIFIED** |
| **B** | fence excludes the 208th | `…engine.sql:51` `p.created_at <= _fence`; `index.ts:136` | live digest `f0a74d3e…` == manifest digest, count 207; arrival at 13:23:31 outside | **VERIFIED** |
| **C** | owner/path verification | `manifestPlan.ts:165`; `…engine.sql:144` | mutation 4 → suite RED; test 6/6b/7 | **VERIFIED** |
| **D** | SHA verification | `manifestPlan.ts:331` | mutation 5 → suite RED; test 8 | **VERIFIED** |
| **E** | duplicate handling | `manifestPlan.ts:192,201` | mutations 6/6b → RED; DB uniques runtime-proven Cycle 5A | **VERIFIED** |
| **F** | per-post transaction | `…engine.sql:85` plpgsql fn; ≥9 `raise` paths | a plpgsql function is one transaction; mutation 8 → RED | **VERIFIED** |
| **G** | failure recovery | `…engine.sql:102,181,233` `_repaired` | mutation 9 → RED (after the test was sharpened) | **VERIFIED** |
| **H** | retry behaviour | `…engine.sql:126`; `index.ts:157` | **the skip is existence-only** — §3 | **UNVERIFIED / DEFECT** |
| **I** | concurrency | `manifestPlan.ts` fence; DB uniques | mutation 2 → RED; test 18/18b (count-equal swap still refused) | **VERIFIED** |
| **J** | final reconciliation | `manifestPlan.ts` `reconcile()`; `index.ts:189` | mutation 7 → RED; test 20. **Caveat: totals only, and only when `finished`** | **VERIFIED with a stated limit** |
| **K** | no `posts.image_urls` write | `…engine.sql` — no `update public.posts` anywhere; `index.ts` — none | grep + test | **VERIFIED** |
| **L** | no client privilege escalation | `…engine.sql:60–62, 237–239, 273–275` | three `revoke … from anon` / `from authenticated`; production re-probe: still no privilege | **VERIFIED** |
| **M** | no SHA exposure | insert names 7 columns, `id` not among them | `has_column_privilege(anon\|authenticated,'sha256','SELECT') = false` | **VERIFIED** |

### Corrected findings

- **H is downgraded from Cycle 6.** I reported "IDEMPOTENCY: a post with
  references returns `skipped`" as a safety property. It is a *behaviour*; it is
  only *safe* if the existing rows are correct, and nothing checks that.
- **J is qualified.** Cycle 6 presented reconciliation without noting it compares
  totals and runs only at `finished`. Both limits are real.

### Unverified

Everything above is source-traced, mutation-probed or database-probed. **Nothing
has been proven by an actual migration run**, because none has happened. The
first real execution remains the only untested path.

---

## 5. OPEN RED

1. **§3 skip defect — must be fixed before any run.** Not implemented.
2. `docs/MANIFEST_PROVENANCE.md` not written — your call on public wording.
3. Deployment of `migrate-post-media` and application of `20260817170000`: both
   unapproved.
4. Client access model designed, not issued.
5. `measure-post-media` still deployed (auto-expires 2026-09-01).
6. `backfill-media-objects` abandoned, `cfc5051e…`, pending controlled removal.
7. Drift continues while the platform is live.
8. RED-B3d-IMG-2 — Supabase transformation 403, 11 shipped code paths.
9. Phase 1 carry-over unchanged.
