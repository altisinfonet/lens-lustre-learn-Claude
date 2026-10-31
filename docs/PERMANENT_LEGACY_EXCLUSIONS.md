# PERMANENT LEGACY EXCLUSIONS — the 29 slides that will never be migrated

**Decided by the owner, 2026-08-20**, on the evidence of the Workstream 3 audit and the
Phase 2 Final Decision Package. This register is the authoritative record of that
decision. From this date, these 29 slides are **not pending migration work** — they are
a documented, permanent exclusion, and any report that counts them as backlog is wrong.

> ⚠ NOTHING HERE IS DELETED, COPIED OR REWRITTEN. Every object named below still
> exists exactly where it was. The Class-F repoint (applied the same day, migration
> `20260820180836`) changed which *sibling* 20 of these slides display — thumbnail →
> surviving 1920px original, same owner folder, same host — and nothing else.

---

## Exclusion 1 — the 27 Supabase-hosted slides (Decision 1: ACCEPTED as permanent legacy)

**27 slides · 15 posts · 23 distinct objects**, all under
`https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/…`.

Why they are excluded, each fact re-proven from production on 2026-08-20:

1. **They are not in R2.** All 23 objects return **404** from `cdn.50mmretina.com`,
   verified by retrieval. The media engine reads only from the CDN origin
   (`MIG-1015`/`MIG-1080`; `CDN_HOST` is pinned by value and by mutation W1).
2. **They are thumbnail derivatives, not originals.** Every object is a 600px-long-edge
   `-thumb.webp`. 17 of the 23 have their 1920px original beside them in Supabase
   storage; for the other 6 the original is gone (3 are derivatives of a MUTABLE
   `avatar.webp` that has since been overwritten).
3. **Migrating them would require two prohibited operations at once:** a byte copy
   Supabase→R2 AND a rewrite of `posts.image_urls` — because `post_attach_media`'s
   MEDIA-2205 requires the derived CDN URL to equal the stored slide URL, which a
   Supabase URL can never satisfy.
4. **Migrating them would also be wrong:** it would enshrine a 600px derivative as a
   canonical original in `media_objects`, permanently.

The per-slide evidence (22 facts per slide: existence, bytes, MIME, dimensions,
original-sibling status, sharing, ownership, pattern analysis) is preserved in the
Workstream 3 evidence matrix in the project records, summarised in
`docs/LEGACY_MEDIA_EVIDENCE_MATRIX.md`, and the refusal of the real production keys is
**pinned by test**: `src/__tests__/candidatePatternWidening.test.ts` asserts that these
exact keys are not candidates and that `CDN_HOST` is the CDN, with mutations W1/W3
proving the assertions bite.

**Effect on members: none.** These posts render today from `image_urls` fallback and
continue to, at higher fidelity where the repoint applied.

## Exclusion 2 — the 2 R2 cover photographs (Decision 2: migration REJECTED)

**2 slides · 2 posts · 1 owner**, both real originals in R2, both serving 200 from the
CDN today:

- `avatars/covers/569aa88e-…/1773897608964-2150573909.jpg` (1500×1000 JPEG, 1,198,670 B)
- `avatars/covers/569aa88e-…/1773897806339-Faces of the World.jpg` (2000×1333 JPEG, 2,843,079 B)

**The security rationale, which is the whole reason:** their path shape puts the owner
at **segment 3** (`avatars/covers/<owner>/…`), while every ownership proof in the media
engine — `MIG-1019` in the manifest plan, MEDIA-2102 in `media_mark_ready` — requires
the owner at **segment 2**. Migrating them would mean widening an ownership control to
accept a shape where ownership sits at a different depth: the single
highest-consequence class of change available in this engine, for 2 slides out of 310.

The owner rejected that trade. The controls stay exactly as written, and stay
mutation-protected: mutations **W2** (a class admitting `avatars/covers/<owner>/`) and
**W4** (`media_mark_ready` widened to accept the prefix) each turn the suite red.

**Effect on members: none.** Both photographs render correctly from the CDN today.

---

## What this register changes, and what it does not

| | before | after |
|---|---|---|
| "migratable legacy backlog" | 29 slides / 17 posts | **0 — closed by decision** |
| permanent legacy population | 18 slides (mutable avatar/cover posts) | **47 slides / 35 posts** (18 + 29) |
| legacy-only posts/slides in the database | 35 / 47 | 35 / 47 — unchanged, correctly |
| anything a member sees | — | unchanged (except 20 slides now at 1920px) |

⚠ `media_write_path_delta()` still reports the 29 under `migratable_legacy_*`, because
its classifier splits by URL shape, not by this register. That is a **reporting label
only** — `delta_growing` and `new_unexplained_legacy_posts` are unaffected. Updating the
classifier's labels to match this register is an optional follow-up requiring its own
reviewed migration; this document is authoritative in the meantime.

⚠ REVERSIBILITY. This is a decision record, not a destruction record. Every object,
every surviving original, and the full evidence matrix remain. If a future owner wants a
copy+rewrite programme for the 27, nothing here prevents designing one — it would be new
scope, outside Phase 2, under the shipped manifest tooling.
