# MEDIA MIGRATION MANIFEST — PROVENANCE

**The manifest is not in this repository, and it must not be put here.**
This repository is public. The manifest's 207 rows carry member post ids and
owner ids. What lives here is the commitment — a digest, which reveals nothing
about who posted what — and the instructions for checking it.

## The approved manifest

| | |
|---|---|
| rows | **207** photographs |
| bytes | **86,055** |
| SHA-256 | **`6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84`** |
| fence | `2026-08-17 10:52:06.533572+00` (`posts.created_at <=`) |
| candidate-set digest | md5 **`f0a74d3e74d8a52f61de92a2e0ab429a`** over sorted `post_id\|ord\|source_url` |
| reference-set digest | md5 **`326834efcf11c7620634f4cbda821bc4`** over sorted `post_id\|ord-1\|sha256` |

Columns, tab-separated, newline-terminated, sorted by `(post_id, ord)`:

```
post_id  owner_id  ord  source_url  source_host  object_path
width  height  aspect_ratio  mime  bytes  sha256  visibility
```

## Where the bytes live

In the owner's **Claude Project**, at `claude/PHASE2_MANIFEST_207_2026-08-17.tsv`.
Private to the owner's organisation, persistent across sessions, and verified
byte-identical to the working copy on 2026-08-17 (`cmp`: no difference).

Rejected alternatives, and why:

- **This repository** — public; member identifiers must never be committed.
- **GitHub Actions artifacts** — on a public repository they are reachable by
  anyone who can see the run.
- **A private Supabase bucket** — viable, but writing one is a production
  change and has not been approved.

## How it was produced

Measured in Control Cycle 4 by `supabase/functions/measure-post-media`, a
read-only, admin-only Edge Function that reads each object over public HTTPS and
reports metadata only. 207 objects, 0 failures, **119,717,670 bytes actually
read**. Width, height and MIME come from the object's own bytes; SHA-256 is
computed over the complete body. Nothing is taken from a filename, and an ETag
is never treated as a hash.

## How to check it

1. `sha256sum` the file → must equal the SHA-256 above.
2. Run the migrator with `approved_hash` set to that value. It refuses with
   **`MIG-1003`** before reading a single row if the bytes differ.
3. The engine then compares the live fenced population to the manifest as a
   **set**, not a count (`MIG-1040`), using the candidate-set digest above.
4. After a run, reconciliation compares the reference set as a set
   (`MIG-1075`), so equal counts cannot produce a pass.

## Drift

The platform is live. At the fence the population is 207. As of 2026-08-17 the
live population is **208** — one photograph arrived at 13:23:31+00, after the
fence. It is deliberately **outside** the fenced set and is not migrated. Any
arrival is handled by its own delta manifest, measured the same way, approved
separately.
