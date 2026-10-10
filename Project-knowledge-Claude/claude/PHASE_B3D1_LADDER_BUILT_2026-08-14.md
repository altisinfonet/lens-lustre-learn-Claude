# B3d-1 — stored derivative ladder BUILT (2026-08-14)

Ladder 600/1080/1440/original, sizes from the 08-13 measurements. Phone feed
card ~335 KB → ~56 KB for new uploads.

**Mechanism:** rungs generated at upload (canvas exports; metadata stripped
inherently); announced by `-l3` filename marker so availability is knowable
from the URL alone (no schema/RPC change). **The marker is a promise never
published broken**: rungs upload FIRST; all four failure paths revert to the
legacy name (each strip site individually asserted after mutation L5 escaped a
count-based check — fourth loose-anchor lesson).

No upscaling (LONG edge decides — portraits keep their ladder). Portrait
srcset descriptors are scaled widths (608w, not 1080w) — the exact
"quality very poor" mechanism from the live measurement, not repeated.

**Deletion Protocol at design time:** detect-orphan-files derives
`-l3-r1080/-r1440` from marked keys (rungs live in no DB column).

Tests: 13 (values + three-party naming agreement: uploader/renderer/orphan
set), 6/6 mutations after strengthening. Gate: 1487 passed.

**Pending ONE ask:** `GO 606e56f6` redeploys detect-orphan-files with the rung
derivation. Client half rides the next app build (with EXIF guard + B3c
compose changes). Then: B3d-2 (dims backfill for the 59% no-srcset slides).

State: READY · AWAIT_GO_B3D1 · unpushed ~44 commits.
