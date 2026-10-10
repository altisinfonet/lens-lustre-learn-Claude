# PHASE B — CYCLE 1: media_objects + post_media — **APPLIED**

**Date:** 2026-08-14
**State:** `DEPLOYED` · `next_action: PHASE_B2_DESIGN`
**Applied version:** `20260814084711` (connector-assigned)
**Authorised against:** `71c65795975d90f744859856d4dc4d04f91b696c`

---

## Filename drift — again

Drafted as `20260814100000`. Production recorded `20260814084711`. **The
connector assigns the version, not the filename** — identical to cycle A8. Both
repo files were renamed to match, because a migration whose repo name disagrees
with its applied version is a rollback nobody can find.

| File | `git hash-object` |
|---|---|
| `supabase/migrations/20260814084711_media_objects.sql` | `71c65795975d90f744859856d4dc4d04f91b696c` |
| `supabase/rollback/20260814084711_media_objects_ROLLBACK.sql` | `f8c26ec8efdc2c2ac4248b84598fa9efe15cfddc` |

---

## What shipped

Purely additive: two tables, five RLS policies, one trigger, two revokes.
**Nothing reads them.** `posts.image_urls` and `posts.thumbnail_urls` stay
authoritative. No existing query changed. Backfill, derivative worker and feed
contract are each their own cycle.

### Three identities, kept separate

| Identity | Column | Rule |
|---|---|---|
| content | `media_objects.sha256` | server-side ONLY — never a URL, return type, or response |
| object | `media_objects.id` (random uuid) | the only public address |
| reference | `post_media` rows | the only basis for "may this viewer see it" |

Post media is served from a **public CDN**. A content-derived address means
anyone holding candidate bytes computes the URL and issues one GET to learn
whether that photograph is on the platform — no upload, no account. Dedup is
therefore `UNIQUE (owner_id, sha256)`, not global: two members with identical
bytes get two rows and two unguessable addresses. It also makes takedown and
account deletion correct — a shared object would mean a DMCA notice silently
affects a stranger's post.

### `state` is the integrity gate

`pending → verified → ready`, or `quarantined`. Only `ready` may be referenced,
enforced by `trg_post_media_requires_ready` **BEFORE INSERT OR UPDATE**.

---

## Post-apply verification on production (15 checks, all pass)

| Check | Result |
|---|---|
| tables present | `media_objects, post_media` |
| RLS enabled | `true / true` |
| policy count | `5` |
| member UPDATE/DELETE policies on `media_objects` | `0` — server owns state transitions |
| trigger | `trg_post_media_requires_ready BEFORE INSERT UPDATE` |
| trigger fn EXECUTE — anon / authenticated | `false / false` |
| table privileges held by anon + authenticated (2 roles × 2 tables × 7 verbs) | `0 / 28` |
| table privileges retained by service_role | `14 / 14` — worker path intact |
| unique index | `(owner_id, sha256)` |
| global unique on `sha256` alone | `0` |
| FK `confdeltype` | `r` (RESTRICT) |
| rows | `0 / 0` |
| public tables with RLS | `143` |

### The gate was proven LIVE, not only on the harness

A `DO` block on production inserted a pending media row, attached it to a real
post, retried the same owner with the same bytes, then raised so the whole
transaction unwound:

```
gate:  PASS — post_media: media 911d6241-… is in state pending, only ready may be referenced
dedup: PASS — same owner + same bytes rejected
```

Both tables verified empty afterwards: `0 / 0`.

---

## Two defects found in my own work, both before production

**1. The rollback file could not run at all.**
`post_media` FKs `media_objects`, while policy `media_objects_select` reads
`post_media`. Neither drop order works — exit 3, "other objects depend on it".
Fixed by dropping the policy by name. **Not** `DROP ... CASCADE`, which would
also silently drop whatever a later migration had attached.

**2. `ALTER DEFAULT PRIVILEGES` covers TABLES, not only functions.**

```
pg_default_acl objtype 'r' -> anon=arwdDxtm | authenticated=arwdDxtm | service_role=arwdDxtm
```

The first draft revoked the trigger *function* correctly and said nothing about
the two *tables* — so `anon` would have held SELECT, INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.

**RLS covers the first four only.** TRUNCATE, REFERENCES and TRIGGER are checked
against the grant alone; no policy can refuse them. "RLS is enabled" was a
necessary answer, not a sufficient one.

Fixed with `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated`. The
migration ships with no reader and no writer, so the correct grant is none. The
upload cycle grants the exact verbs it needs, in its own diff. `service_role`
keeps its grant — the hash verifier and derivative worker path — now asserted
rather than assumed.

### And two in my own test harness

- The first RLS check used `SET LOCAL ROLE` **outside a transaction**. Postgres
  warned, ignored it, and ran as superuser with RLS bypassed — 3 of 3 rows,
  proving nothing. Re-run inside `BEGIN/COMMIT`.
- The fixture granted default privileges on FUNCTIONS only (so the new table
  REVOKE would have passed vacuously) and omitted `service_role` (so the
  service_role probe read `false` and looked like a migration defect).

---

## Local round-trip before apply (PG16.13 harness; production is PG17.6.1)

`forward → rollback → forward → rollback → forward` all exit `0`. Rollback
aborts (exit `3`) rather than dropping populated tables, and is idempotent on an
absent schema. Fourteen behavioural checks: state gate on INSERT *and* UPDATE,
`verified` without a timestamp rejected, per-owner dedup collides on retry but
not across members, `ON DELETE RESTRICT` held, RLS visibility follows post
privacy (owner B sees 2 → 1 when the post goes private), anonymous caller sees
public-post media only, foreign `owner_id` rejected by `WITH CHECK`.

## New invariant locks (both mutation-tested)

| File | Tests | Mutations caught |
|---|---|---|
| `src/__tests__/mediaIdentityContainment.test.ts` | 7 | 6/6 — sha256 in a RETURNS TABLE, global `UNIQUE(sha256)`, trigger removed, column renamed, `media/${sha}` path, gate made INSERT-only |
| `src/__tests__/newTableGrants.test.ts` | 6 | 3/3 — table REVOKEs dropped, ENABLE RLS dropped, `REVOKE ... FROM PUBLIC` only |

The second is deliberately **generic over every in-scope migration**. The
project's recurring pattern has been class-level defects fixed one instance at a
time; this locks the class.

`mediaIdentityContainment.test.ts` also exists because the migration's own
comment claimed enforcement by it — a comment claiming a test that does not
exist is trap #11 with extra confidence.

**Gate:** `tsc -b` 0 · 1382 passed, 1 skipped · security-audit PASS
(CRITICAL 0 · HIGH 0).

---

## Still outstanding

- **Transport.** 27 local commits are not on `origin/main`, and the source of
  **six** applied migrations exists only in this container. `git push` is
  proxy-blocked (403). This grows every cycle and is now the largest single risk
  in the program.
- **Phase A item 3** — feed RPC verified on a real device/web: not done.
- **Phase A item 7** — unfiltered realtime bindings: blocked on the
  Broadcast-from-trigger vs accept-and-document decision.
