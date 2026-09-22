# Phase 2 — the live media write path is in production

**2026-08-20.** `main` = `6f76d14` (PR #76). Priority 1 of the closure workstream.

## The one-sentence version

The fenced migration reached zero and would have gone non-zero with the next
upload; the write path now creates `media_objects` + `post_media` for every new
post published from the main composer, so the legacy-only population stops
growing.

## The finding that changed the plan

`media-verify-upload` was in the repo, undeployed, and **must not be deployed**.
It derives the storage key as `post-images/<owner>/media/<id>/original.<ext>`.
Measured 2026-08-20:

```
media_objects rows                                       229
  stored as post-images/<owner>/media/<id>/original.*      0
  stored as post-images/<owner>/posts/<name>.webp        229
  carrying any rung derivative (1440/1080/600)             0
  carrying the '-l3' ladder marker in the filename        32
```

Deploying it strands every upload at `pending` for ever. Switching layouts would
also silently kill the responsive ladder and thumbnails, which are FILENAME
conventions (`-l3`, `w×h`, `-thumb`), not `derivatives` entries.

**Decision: keep the production layout, register the object that was uploaded** —
the same thing `media_migrate_post` does for the 229, so the live and migrated
paths converge. Full trace and diagram: `docs/WRITE_PATH.md`.

## What shipped

| piece | detail |
|---|---|
| migration `20260820061500_media_write_path_live` | `media_mark_ready` refuses an `original` outside `post-images/<owner>/` (MEDIA-2102) or a non-bucket-relative path (MEDIA-2103); `post_publish_with_media` gains `_thumbnail_urls` and dual-writes the legacy arrays |
| edge `media-register-upload` v1 | `ezbr 9f034433a0a395c9f6c547d15000a9ab88db269b8e48a5dbc42481fd9fd5231e`, `verify_jwt=false` with in-code `getClaims` + owner check |
| `src/lib/media/storedObject.ts` | hashes the ENCODED bytes, never the picked file; returns null rather than guess dimensions |
| `src/lib/media/postMediaWrite.ts` | the one client write path; all-or-nothing per post; `MEDIA-4001/2/3/4` |
| `src/components/WallPosts.tsx` | media path FIRST, logged legacy fallback |
| `src/__tests__/mediaWritePath.test.ts` | 51 tests, pins D-004 |
| `tools/mutate-write-path.mjs` | 18 mutations, all detected |

## D-004 — the dual-write, and how it ends

`image_urls` is DERIVED inside the transaction from
`media_objects.derivatives->>'original'`; `thumbnail_urls` is SUPPLIED but
constrained to the photograph or its `-thumb` sibling. Mandatory because the
**Android binary** reads `image_urls` and cannot be deployed from this
repository, six repo consumers still read it directly, and `thumbnail_urls` has
no representation in `media_objects` at all.

Ends when all three hold: the six consumers switch to `resolvePostImageUrls`;
`thumbnail_urls` gains a schema home (a `thumb` rung, a security-control edit);
the Android binary ships the new read path.

## Evidence

- 19 behavioural cases against production in rolled-back transactions — all pass
- 18/18 mutations detected
- suite 2114 passed / 1 skipped; `tsc -p tsconfig.app.json` clean
- deployed function 401s on no-auth and bogus-bearer before reading a byte
- 7/7 CI checks green on `d2fda8c`, read per-run

## Mistake recorded

Ran `npx tsc --noEmit` (root config) instead of the project gate
`tsc --noEmit -p tsconfig.app.json`. It passed; CI failed with two real errors
(`media_begin_upload` / `post_publish_with_media` absent from the generated
`types.ts`). Fixed with a narrow call-site signature, the shape already used for
`post_media_for`.

## Still open

1. drafts (`publish_post_draft`), scheduled posts (`publish-scheduled-posts`) and
   system posts (`create_system_post`, MyPhotos/album) still publish legacy-only
2. Priority 2 — the 83 non-fenced slides (B 19, C 15, D 18, E 3, F 28)
3. Priority 3 — D-002/D-003, still an external Cloudflare/R2 dependency
