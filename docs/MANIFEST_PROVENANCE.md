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

## Drift, and the cycles that followed

The platform is live, so the fenced population is a snapshot and the manifest
is not. Each arrival was handled by its own cycle: measure at a **new** fence,
build a **cumulative** manifest (the prior rows verbatim plus the new ones),
prove containment, and migrate. **No frozen fence or manifest has ever been
edited** — the earlier ones still digest to the values recorded above and in
the entries below.

The cumulative shape is not a preference. `media_migration_fence_digest`
returns a digest of the *entire* candidate population up to the fence, not of a
window, so a delta-only manifest is refused by `MIG-1040`. That refusal is the
control working. Already-migrated posts return `verified-skip` after a
row-for-row comparison (`MIG-2020` / `MIG-2021`), so a cumulative manifest
re-verifies them rather than rewriting them.

| cycle | fence | rows | candidate digest | outcome |
|---|---|---|---|---|
| 1 | `2026-08-17 10:52:06.533572+00` | 207 | `f0a74d3e74d8a52f61de92a2e0ab429a` | 207 migrated |
| 2 | `2026-08-19 14:31:54+00` | 226 | `46c4cad2797a26c4b5613fdff36a4b3a` | +19 |
| 3 | `2026-08-19 15:38:02.195291+00` | 228 | `eff23edc6ede73221fd0a1b3aee6a275` | +2 |
| 4 | `2026-08-20 02:45:07.818428+00` | **229** | `c6173052cddf7119ba027f0f874544cd` | **+1 — fenced delta now 0** |

Cycle 4 manifest: `PHASE2_CUMULATIVE_MANIFEST_229_2026-08-20T0245.tsv`,
sha256 `9613580f813fab660a44c2dff8999f74f8307c11913f06ac38526dfbd8005666`,
95,469 bytes, 229 rows / 198 posts, 128,677,908 object bytes. Final reference-set
digest **`9dafcfa7bb00828f773d8da099dbc91c`**, computed from the manifest
*before* execution and matched exactly afterwards.

## What the fence deliberately does NOT cover

83 slides across 56 posts sit outside the candidate pattern
`cdn.50mmretina.com/post-images/<owner>/posts/<file>` and are therefore outside
every manifest above. They are not forgotten; they are classified, and three
groups cannot be migrated in place at all:

| group | slides | why |
|---|---|---|
| `post-images/<owner>/<file>` (older flat naming) | 19 | migratable data; blocked only by the engine's path pattern |
| `avatars/<owner>/my-photos/<album>/<file>` | 15 | migratable data; same |
| Supabase-hosted `…-thumb.webp` | 28 | **the CDN does not serve these keys** — measured; migrating would resolve to a 404 |
| `avatars/covers/<owner>/<file>` | 3 | owner is not the path's second segment, which `MIG-1019`/`MIG-2006` require |
| `avatars/<owner>/avatar.webp` \| `cover.webp` | 18 | **the path is mutable** — overwritten on every profile-photo change, and two posts already share one. Content-addressed identity cannot be applied to an address whose bytes change. |

See `claude/PHASE2_REMAINING_MEDIA_MATRIX_2026-08-20.md` for the full matrix.
