# PHASE B — CYCLE 2: the media write path and state machine — **APPLIED**

**Date:** 2026-08-14
**State:** `DEPLOYED` · `next_action: PHASE_B3_DESIGN`
**Applied version:** `20260814104119` (connector-assigned; drafted as `20260814120000`)
**Authorised against:** `6c73cdf1f177ef525a02cad76a0a5c3702c5d2db`

---

## The security property, in one line

Grant triples read from production after apply — `anon` / `authenticated` / `service_role`:

| Function | | |
|---|---|---|
| `media_begin_upload` | `0 1 1` | a member may start an upload |
| `media_mark_verified` | `0 0 1` | only the server may assert verification |
| `media_mark_ready` | `0 0 1` | only the server may publish |
| `media_quarantine` | `0 0 1` | only the server may reject |
| `tg_media_state_transition` | `0 0 1` | |

Members hold **0 of 28** table privileges on `media_objects` and `post_media`,
so there is no statement they can issue that reaches `ready` by another route.

## Why RPCs and not a table grant

The obvious move is `GRANT INSERT ON media_objects TO authenticated` and let the
`WITH CHECK (owner_id = auth.uid())` policy do the work. It is weaker than it
looks: **RLS constrains which ROWS a statement may touch, never which COLUMN
VALUES.** With a direct INSERT grant a member sets `state = 'ready'` in the same
statement that creates the row, and B1's `post_media` gate waves it through —
because the row does say `ready`.

So `media_objects` stays ungranted. The RLS policies remain as defence in depth
for any future direct grant; they are not the live path.

## The state machine is a trigger, not the worker being correct

```
pending ──▶ verified ──▶ ready
   │            │           │
   └────────────┴───────────┴──▶ quarantined  (terminal)
```

`tg_media_state_transition` refuses everything else **including for
`service_role` and `postgres`**. The worker is the component most likely to
carry a bug, and "skip verification, mark it ready" is the bug that matters. A
trigger cannot be forgotten by whoever writes the next worker.

It also freezes `owner_id` and `sha256` after insert — otherwise a row could
reach `ready` honestly and then have its content identity rewritten, making
every verification that preceded it meaningless.

---

## A third defect in B1, found while designing B2

```sql
CHECK (state = 'pending' OR verified_at IS NOT NULL)
```

Quarantine is what happens when the server recomputes the hash and it
**disagrees**. At that moment the row was never verified, so `verified_at` must
legitimately be NULL — and this constraint forbade it. The worker would have had
to write a timestamp asserting a verification that failed.

A constraint satisfiable only by lying is worse than no constraint, because the
lie lands in the audit trail. Fixed to exempt `quarantined`, with
`quarantine_reason` added so a quarantine is reviewable rather than merely
terminal.

Two further constraints make bad states unrepresentable: `ready` requires a
`derivatives.original`, and `quarantined` requires a reason.

**Only `original` is required**, not the full 600/1080/1440 ladder — an image
narrower than a rung has no honest derivative at that rung, and demanding one
would be the same defect in a different costume.

---

## Proven live on production, committing nothing

A single `DO` block that raises at the end so the whole transaction unwinds:

```
idempotency: 1 row from 6 calls
skip-verify: PASS — illegal media state transition pending -> ready   (as postgres)
sha256:      PASS — media_objects.sha256 is immutable
legal path:  reached ready
quarantine:  quarantined, verified_at NULL
re-upload:   PASS
```

Both tables verified empty afterwards: `0 / 0`.

## Local round-trip (PG16 harness over the B1 schema)

`guard → rollback → fwd → rollback → fwd → rollback ×2 → fwd`, exits
`3 0 0 0 0 0 0`. The rollback **refuses** (exit 3) rather than fabricating a
verification timestamp for quarantined rows the old constraint forbids.

Sixteen behavioural checks including: a real non-superuser member refused at all
three routes to `ready`; six retries producing one object; quarantined bytes not
handed back (or the client retries forever); quarantine terminal; the in-flight
cap firing at 50; a narrow image allowed a partial ladder.

**One check of mine was vacuous and was caught:** W16 read state *after* a
PL/pgSQL exception block, and a caught exception rolls back its whole
subtransaction — so the 50 rows it was counting had already vanished. Re-run
without one.

## Invariant lock

`src/__tests__/mediaWritePath.test.ts` — 13 tests, **8/8 mutations caught**:
table grant to authenticated, `mark_ready` to authenticated, revoke from anon
only, `pending -> ready` legalised, trigger dropped, `sha256` made mutable,
`begin_upload` opened to anon, quarantine constraint reverted.

**Gate:** `tsc -b` 0 · 1402 passed, 1 skipped · security-audit PASS.

---

## Filename drift is now 8 for 8

Every migration this program has applied has been recorded under a version
different from the filename I drafted. The standing rule holds: **after
`apply_migration`, read the version back from `list_migrations` and rename the
repo files before committing.**

## Applied to production so far

| Version | Name |
|---|---|
| `20260813171159` | feed_author_identity |
| `20260814042609` | email_queue_authority |
| `20260814070357` | feed_candidate_pool |
| `20260814074922` | feed_rpc_candidate_pool |
| `20260814080227` | queue_and_writer_authority |
| `20260814084711` | media_objects |
| `20260814104119` | media_write_path |

## Still outstanding

- **Transport.** 30 unpushed commits; seven applied migrations whose source
  exists only in this container. Push is proxy-blocked (403) — the repo must be
  added to the session's authorized sources. Latest tarball delivered covers
  through B2.
- **Phase A item 3** — feed RPC verified on a real device/web: not done.
- **Phase A item 7** — unfiltered realtime bindings: blocked on the
  Broadcast-from-trigger vs accept-and-document decision.
- **Next (B3)** — the derivative worker, R2 storage layout, EXIF/GPS stripping.
  Nothing yet writes bytes; `posts.image_urls` remains authoritative and the
  media tables are still empty by design.
