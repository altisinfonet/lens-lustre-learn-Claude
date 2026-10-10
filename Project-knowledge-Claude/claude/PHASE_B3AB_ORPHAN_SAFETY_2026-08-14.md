# B3a DEPLOYED + B3b BUILT — orphan safety, both halves (2026-08-14)

## B3a — DEPLOYED
`detect-orphan-files` v21 ACTIVE, verified by read-back: deployed bytes = the
authorised file (hash `0555226f`). Read-only, admin-only, verify_jwt true.
Deletion Protocol written into AI_CONTROL.md as a standing rule.

## Play Console notice (build 1088 / v1.2.5) — triaged, no owner action
4 recommendations, 0 violations, no deadline. Edge-to-edge ×2 → Phase F Android
matrix; bitmap optimization → B3d + F budgets; R8 → F CI work, deliberately NOT
auto-applied (can break Capacitor reflection; owner forbids background build
changes).

## B3b — BUILT, awaiting deploy (`GO 91b2cf6c`)

**Two MORE protocol violations found in the DELETING file itself** — same
classes as the near-miss:
1. `const { data: comps } = await ...select("id")` — error ignored → empty
   live-id set → every uuid folder "orphan" → on a non-dry run, the archive.
2. Un-paginated live-id reads — PostgREST caps at 1,000 rows; past 1,000
   entries, every additional entry's folder is deleted. Survivable only
   because production hasn't crossed 1,000 yet.

**Shipped in the cycle:**
- `_shared/s3.ts` — ONE SigV4 client (two copies of storage code is how the
  dead reference list happened). `deleteS3Objects` throws on failed batch
  with already-deleted count (old copy console.error'd and kept counting).
- `purge-s3-orphans` → full protocol: paginated fail-loud live-ids, empty-set
  SAFETY ABORT, dry_run default, execute requires `expected_count` (409 on
  drift), MAX_DELETE 200 / HARD ceiling 1000, post-delete verification with
  residue report.
- `detect-orphan-files` → R2-aware via shared client: per-bucket stats,
  unknown prefixes surfaced never orphaned, scan-failure unmistakable for
  clean, still deletion-free (asserted).
- `deletionProtocol.test.ts` — the promised alarm: auto-discovers bulk
  deleters, exemptions (`hard-delete-competition`, `s3-delete`) named with
  reasons and existence-checked. 8/8 mutations caught. AI_CONTROL "rule not
  alarm" caveat retired.

**Gate:** tsc 0 · deno lint clean · 1460 passed · security PASS.
**Limitation:** no runtime run against real R2 from sandbox (no admin JWT;
credentials not extracted). First real run must be dry, report reviewed.

## Deploy set for GO
| File | hash |
|---|---|
| detect-orphan-files/index.ts | `91b2cf6c0bb30e89668eb7b3693f26b2b20b7ab2` |
| purge-s3-orphans/index.ts | `99ef8bf0edb6d8a6fab34d2b0326225b23918557` |
| _shared/s3.ts | `9365385ccd792140e53cd538c1116ae80020460b` |

State: `READY_FOR_REVIEW` · next `AWAIT_GO_B3B`. 35 commits unpushed (transport
still blocked). After B3b deploy: B3c scheduled-post thumbnails, then EXIF.
