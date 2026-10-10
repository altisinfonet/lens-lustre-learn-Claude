# B3d-2 — dims backfill BUILT, awaiting deploy (2026-08-14)

Repairs the biggest measured image defect: 59% of slides (153/258) have no
`-wXhY` in their filename → no srcset, no frame aspect → every device downloads
the full original and cards fall back to 4:5.

**Mechanism per slide:** 64KiB ranged R2 read → refusal-first header parse
(WebP/JPEG/PNG, byte-tested; wrong-dims-worse-than-none) → server-side COPY to
dimensioned name → VERIFY new name answers → UPDATE row → read row back. Old
objects left as future Deletion-Protocol orphans; the job has no delete
capability (asserted).

**Ordering is the safety:** copy→verify→update — a post never points at a name
that doesn't answer; crashes leave harmless copies, never broken rows.

**Deletion's ceremony without deletion:** dry-run default, expected_count gate
(409 on drift), max_posts 25/hard 100, fail-loud paginated scan, per-slide skip
reasons (supabase-host ×28 out of scope this pass, unmanaged, missing,
unparseable), idempotent re-runs.

**Admin buttons added (AdminHealth):** "Purge Dry Run" + "Dims Backfill Dry
Run" — read-only wired; purge execution impossible from that surface (button
can't send expected_count). All owner maintenance steps are now clicks.

**Self-caught:** mutation D2 escaped a message-based assertion (dead-branched
gate's abort string still matched) → assertions re-anchored on live gate
conditions. Fifth loose-anchor lesson.

Tests: +26 (14 backfill incl. ordering-by-position, 12 byte parsers), 7/7
mutations. Gate: 1513 passed.

**Deploy set for GO:** backfill-image-dims `0aa2176f` · _shared/s3.ts
`75b05544` · _shared/imageDims.ts `bc5938b0`. Client buttons ride next build.

**Run order after deploy:** owner clicks Dims Backfill Dry Run → review plan →
execute passes happen with me (expected_count from the dry run), batch by
batch → re-run detect scan to watch old names age into collectable orphans.

State: AWAIT_GO_B3D2. Then B3d-3 legacy transform fallback (needs the real
Android-device check first) and B4 upload retry/resume.
