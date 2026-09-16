# START PROMPT FOR A NEW SESSION — 2026-08-14

Paste this whole block as the first message of the new task. **Start the task
with `altisinfonet/lens-lustre-learn-Claude` attached with PUSH access**, or the
same transport problem repeats immediately.

---

You are continuing the 50mm Retina World engineering program. Do this in order
and do not skip a step.

**1. Confirm you can push before doing anything else.**
Run `git push --dry-run origin main` in the clone. If it 403s with "not in this
session's authorized repository set", STOP and tell me — the repo was not
attached with push access, and there is no point continuing until it is.

**2. Recover 30 unpushed commits.** The prior session could not push. The owner
has a tarball named `50mm-transport-<date>.tar.gz`. Ask for it, then:

```bash
git clone https://github.com/altisinfonet/lens-lustre-learn-Claude repo && cd repo
tar xzf /path/to/50mm-transport-*.tar.gz -C /tmp/transport
git fetch /tmp/transport/50mm-unpushed-commits.bundle HEAD:recovered
git merge --ff-only recovered      # base is 6cb095d, so this fast-forwards
git push origin main               # this is the whole point
```

Verify with `git log --oneline origin/main..HEAD | wc -l` → must be `0`.

**3. Read these project docs, in this order, before touching anything:**

- `claude/AI_CONTROL_PROTOCOL_AND_STANDING_AUTHORITY.md` — how every
  production-changing cycle must run
- `claude/HANDOVER_2_KNOWN_TRAPS_READ_FIRST.md` — the numbered traps
- `claude/PHASE_B2_MEDIA_WRITE_PATH_APPLIED_2026-08-14.md` — where the work stands
- `claude/TRANSPORT_BLOCKED_READ_IF_SESSION_LOST_2026-08-14.md` — why this
  handover exists

**4. Reconcile.** `node scripts/ai-control.mjs`. When the machine disagrees with
`AI_CONTROL.md`, the machine is right.

---

## State as of this handover

```
phase: B
state: DEPLOYED
base_commit: 6cb095d
db_migration: 20260814104119
last_cycle: B2_MEDIA_WRITE_PATH
next_action: PHASE_B3_DESIGN
unpushed: 30 commits
```

**Applied to production** — source existed only in the old container:

| Version | Name |
|---|---|
| `20260813171159` | feed_author_identity |
| `20260814042609` | email_queue_authority |
| `20260814070357` | feed_candidate_pool |
| `20260814074922` | feed_rpc_candidate_pool |
| `20260814080227` | queue_and_writer_authority |
| `20260814084711` | media_objects |
| `20260814104119` | media_write_path |

Nothing is awaiting GO. Every prepared migration has been applied.

## Rules that are not negotiable

- **SQL** goes through the Supabase connector. Pre-flight with `execute_sql`
  before `apply_migration`, verify with `execute_sql` after. Every migration
  needs a matching file in `supabase/rollback/`.
- **Filename drift is 8 for 8.** The connector assigns the migration version and
  ignores your filename. After every apply, read the version back from
  `list_migrations` and rename both repo files to match — `supabase/rollback/`
  is keyed by version, and a rollback filed under a version the database never
  heard of cannot be found when it is needed.
- **NO REELS and NO LIVE anywhere in this product. Ever.**
- Never touch the upload keystore, its passwords, or the Play service-account
  JSON. Only the owner uploads builds to Play, and only when a batch is
  complete — never a part-done build.
- No guesswork, no assumptions, no hidden operations, no auto-fix.
- Comment the WHY, not the what.
- If the evidence contradicts the design, stop and report it. Do not modify the
  acceptance criteria to make the design pass.

## Open debts, oldest first

1. **Phase A item 3** — the feed RPC (`get_broadcast_feed`, candidate-pool
   rewrite) has **never been verified on a real device or in a browser**. Two
   further cycles have been built on top of it. This is the oldest unpaid debt
   in the program and should be cleared before B3 adds a worker and object
   storage.
2. **Phase A item 7** — unfiltered realtime bindings on the four busiest tables.
   Blocked on an architectural decision: Broadcast-from-trigger vs
   accept-and-document.
3. **Phase B3** — derivative worker, R2 storage layout, EXIF/GPS stripping.
   Nothing writes bytes yet; `posts.image_urls` remains authoritative and the
   media tables are empty by design.
