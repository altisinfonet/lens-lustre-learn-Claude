# B3d DESIGN — the derivative ladder (owner-approved Option C, data-driven)

**Basis:** IMAGE_DERIVATIVE_MEASUREMENTS_2026-08-13 (real slots, real byte
curve, trap #1 re-verified) + owner's decision: **C — store derivatives for
new uploads, Cloudflare transform as legacy fallback, always with
per-image originalOnError** + "add width/height columns, backfill".

## The ladder (from measurements, not round numbers)
**600 / 1080 / 1440 / original.**
600 exists already (thumb); 1080 = phone feed card at dominant DPR cluster;
1440 = 3.5-DPR phones + desktop retina headroom; original = zoom/download only
and MUST remain the untransformed URL (the `/cdn-cgi/image/` responses carry no
CORS headers — a transformed URL in the download path silently breaks Save).

Approximate effect on a phone feed card: 335 KB → ~56 KB (~83%).

## Why client-generated for the legacy pipeline (and what that does NOT decide)
Today's live path writes `posts.image_urls` directly; the B1/B2 media tables
are empty by design until B5. B3d serves members NOW on the legacy path:
the client already canvas-encodes 2560 + 600; adding 1080/1440 is two more
canvas exports at upload time (no server CPU, no edge-function image codec
limits, metadata stripped inherently). Integrity note: for the legacy path the
client already controls the full bytes it uploads, so client-generated rungs
add NO new trust beyond what exists; when B5 moves to media_objects, rung
generation moves server-side under the B2 state machine (mark_ready validates
the ladder) — that decision is unchanged.

## Sub-cycles (one variable each)
- **B3d-1 (next):** upload generates 600/1080/1440 alongside the capped
  original; single batched presign (extend the existing pair-presign to N
  files); rung URLs derived by suffix (`-w1080`, `-w1440` beside the existing
  `-thumb`); srcset builder offers the rungs for NEW uploads (widths known
  from the ladder, dims from the existing `-wXhY` filename). No schema change,
  no RPC change, no deploy beyond the app build.
- **B3d-2:** dims backfill for the **59% of slides with no srcset at all**
  (153/258 — the single biggest visible image-quality/speed defect measured).
  Server job reads image headers from R2 → writes `posts.image_meta jsonb`
  (array of {w,h} aligned with image_urls); srcset builder falls back to
  image_meta when the filename lacks dims. NO feed-RPC contract change in this
  sub-cycle: image_meta is fetched with the post payload the cards already
  read, or joined client-side; if a 16th RPC column ever becomes necessary it
  goes through the API-compat matrix in Phase E, not here.
- **B3d-3:** legacy fallback wiring per owner's Option C: for legacy posts
  without stored rungs, srcset uses the `www`/`cdn` `/cdn-cgi/image/` hosts
  (the two verified working; NEVER the apex — trap #1) with per-image
  originalOnError; Android WebView origin must be tested on a real device
  BEFORE this sub-cycle ships (measurement doc's standing warning).
- **B3d-4:** re-encode heaviness: stored originals measured ~2× heavier than
  their resolution requires (335 KB vs 157 KB q82). Tune upload encoder
  quality; verify visually on real photos before changing member output.

## Guardrails carried in
- Trap #1: no apex `/cdn-cgi/image/`; zone-config dependence only as fallback,
  never primary for new uploads.
- Free-plan 5,000 unique-transform ceiling (PostMedia.tsx:428) bounds the
  legacy fallback — another reason stored rungs are primary.
- Download/zoom paths keep the untransformed original (CORS).
- Orphan safety: new rung suffixes must be added to nothing — they live
  beside the original under the SAME `posts.image_urls`-referenced basename…
  ⚠ NO: rungs are separate objects with their own keys, and the orphan
  reference set matches EXACT keys. B3d-1 MUST extend the reference derivation
  (detect-orphan-files) to treat `-w1080/-w1440` (like `-thumb`) as referenced
  when their base is referenced — or list them in a column. Decision: derive
  in detect-orphan-files (same place `-thumb` handling lives), with a test.
  This is the Deletion Protocol applied at design time.

## Review question for owner/ChatGPT (non-blocking)
B3d-2's image_meta placement (jsonb on posts vs per-slide table) — jsonb
chosen for zero-migration-risk alignment with image_urls; flag if the
reviewer disagrees.
