# TRANSPORT BLOCKED — read this first if the session was lost

**Date:** 2026-08-14

## The situation

`git push` fails at the proxy, not on credentials:

```
remote: access denied by the git proxy: altisinfonet/lens-lustre-learn-Claude
        is not in this session's authorized repository set, so the proxy will
        not inject a credential for it. To fix, add the repository to the
        session's sources.
fatal: ... The requested URL returned error: 403
```

This is not something I can work around from inside the session. **The repo has
to be added to the session's authorized sources.** Until then, 28 commits and
the source of six applied production migrations live only in a container that
gets reclaimed.

## What was done about it

A tarball was delivered to the owner in chat:
**`50mm-transport-2026-08-14.tar.gz`** (192K), containing

- `50mm-unpushed-commits.bundle` — a verified git bundle of `origin/main..HEAD`
  (28 commits, base `6cb095d`)
- the 6 applied migrations and their 6 rollback files

### To restore from the bundle

```bash
git clone https://github.com/altisinfonet/lens-lustre-learn-Claude repo
cd repo
git fetch /path/to/50mm-unpushed-commits.bundle HEAD:recovered
git merge --ff-only recovered      # base is 6cb095d, so this fast-forwards
```

## Applied production migrations — repo filenames now match

| Applied version | Migration | Rollback |
|---|---|---|
| `20260813171159` | feed_author_identity | ✅ |
| `20260814042609` | email_queue_authority | ✅ |
| `20260814070357` | feed_candidate_pool | ✅ |
| `20260814074922` | feed_rpc_candidate_pool | ✅ |
| `20260814080227` | queue_and_writer_authority | ✅ |
| `20260814084711` | media_objects | ✅ |

## Filename drift is systematic, not occasional

**The Supabase connector assigns the migration version. The filename I choose is
ignored.** Seven instances so far. It matters for one concrete reason:
`supabase/rollback/` is keyed by version, so a rollback filed under a version
the database never heard of is a rollback nobody can find at the moment they
need it.

The oldest instance — `feed_author_identity`, repo `20260813120000` vs applied
`20260813171159` — was found on 2026-08-14 while inventorying what would be lost
if the container went away, and has been corrected along with two stale
references in `src/hooks/feed/useFeedQuery.ts` and one inside the rollback file's
own run instructions.

**Standing rule for every future cycle:** after `apply_migration`, read the
version back from `list_migrations` and rename the repo files to match, before
committing. Do not trust the drafted filename.

## Current CONTROL state

```
phase: B
state: DEPLOYED
base_commit: 6cb095d
db_migration: 20260814084711
last_cycle: B1_MEDIA_OBJECTS
next_action: PHASE_B2_DESIGN
unpushed: 28 commits
```
