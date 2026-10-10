# Phase 2 — Option A pre-flight: the 226-row cumulative manifest (read-only)

**Fresh fence established:** `2026-08-19 14:31:54.025005+00`
**VERDICT: the fresh fence matches the cumulative manifest exactly. Executable with the engine unchanged. One correction to the plan.**

Nothing was modified: no migration, no deploy, no SQL applied, no grants, no code, no manifest edit. `dry_run=false` not used.

## Correction to my own earlier number

I told you **9 pages, offsets up to 200**. That was wrong. 195 posts ÷ 25 = **7.8 → 8 pages**, offsets `0, 25, 50, 75, 100, 125, 150, 175`. The last page carries **20** posts; an offset of 200 would return an empty slice. The plan below is 8 pages.

## 1 — the cumulative manifest file

| check | value | required | |
|---|---|---|---|
| rows | 226 | 226 | ✓ |
| posts | 195 | 195 | ✓ |
| distinct `owner_id\|sha256` | 226 | 226 | ✓ |
| columns per row | 13 uniformly | 13 | ✓ |
| file bytes | 94,176 | — | |
| **SHA-256** | `fd2d2432f1cea09899c7c64501b31591241ee1978e3f0dc61488bedb1c1b53d1` | same | ✓ |
| **candidate-set MD5** | `46c4cad2797a26c4b5613fdff36a4b3a` | same | ✓ |

## 2–3 — the fresh fence, re-read live

```
fresh fence          2026-08-19 14:31:54.025005+00
live key_set_md5     46c4cad2797a26c4b5613fdff36a4b3a
live item_count      226
live post_count      195
arrivals since the 14:14 snapshot   0
frozen 207 fence     f0a74d3e74d8a52f61de92a2e0ab429a, 207 / 180  (untouched)
```

Live digest **equals** the manifest's candidate-set digest. No STOP condition. No manifest edit was needed or made.

## 4 — deployment unchanged

| | |
|---|---|
| `migrate-post-media` | version **1**, ACTIVE, `verify_jwt: true` |
| bundle `ezbr_sha256` | `28db46a90897c80261ba8065bf3a9841a97f4299a18d4fd7d4a4f87797dae93d` ✓ |
| repo sources | `3a7b399a…`, `caa40061…`, `29499a56…` |
| combined digest | `6a0d8d73521973b193c139cc8872dd76e5e655fa803b5cd5df23c7e71264dbab` ✓ |
| working tree | clean at `d6d24b8` |
| `measure-post-media` | version 1, ACTIVE, `verify_jwt: true`, `ezbr 82977dc6…` — still deployed, as required |

## 5 — production clean

```
post_media_rows 207   media_objects_rows 207
unreferenced_media 0  non_ready_media 0   refs_to_non_ready 0
refs_with_owner_mismatch 0   posts_with_gapped_ords 0
ref_set_md5  326834efcf11c7620634f4cbda821bc4
posts with references 180
```

## 6 — expected final reference-set MD5, computed from the manifest

```
expected post_media       226
expected media_objects    226   (distinct owner|sha256 = 226; no content reuse)
expected ref_set_md5      d243b755b3f5b8a76ba0cc8454c130d3
```

Derived by applying the engine's own formula — `md5(sorted "post_id|ord-1|sha256", newline-joined)` — to the 226 manifest rows. Not assumed.

## 7 — the 207 and the 19 are exactly represented

```
frozen 207 rows present verbatim in cumulative     207 / 207   ✓
delta   19 rows present verbatim in cumulative      19 /  19   ✓
cumulative == 207 ∪ 19 exactly, nothing else                   ✓
cumulative minus frozen == the delta, exactly                  ✓
frozen ∩ delta                                          0      ✓
ref-set md5 of the 207 subset  326834efcf11c7620634f4cbda821bc4
live ref_set_md5 in production 326834efcf11c7620634f4cbda821bc4   MATCH ✓
```

The last line is the strongest single check here: the 207 rows inside the cumulative manifest reproduce, exactly, the reference set already committed in production. The manifest describes what is there plus what is missing — nothing else.

## The 8-page dry-run plan

Computed from the manifest by sorted `post_id`, the way the engine slices.

| page | offset | posts | slides | verified-skip | migrate | cumulative refs |
|---|---|---|---|---|---|---|
| 1 | 0 | 25 | 29 | 23 | 2 | 29 |
| 2 | 25 | 25 | 37 | 24 | 1 | 66 |
| 3 | 50 | 25 | 27 | 23 | 2 | 93 |
| 4 | 75 | 25 | 26 | 20 | 5 | 119 |
| 5 | 100 | 25 | 30 | 23 | 2 | 149 |
| 6 | 125 | 25 | 26 | 22 | 3 | 175 |
| 7 | 150 | 25 | 29 | 25 | 0 | 204 |
| 8 | 175 | **20** | 22 | 20 | 0 | **226** |
| | | **195** | **226** | **180** | **15** | |

In a **dry run** every post returns either `would-migrate` (the 15 new) or `would-verify-existing-references` (the 180 already migrated), `production_writes: 0` on every page, `finished` false ×7 and true on offset 175.

Objects re-read: **127,928,162 bytes** across the run — the engine re-measures every item it is given, including the already-migrated ones. Add a 30-second pause between pages, as the resume cycle proved necessary.

## Blockers

**None.** The cumulative manifest is executable against the deployed engine with **no code change, no redeploy, no schema change and no grant.**

Two things to hold in mind rather than fix:

1. **The fence is a snapshot.** Zero arrivals in the last 17 minutes, but the platform is live. If a photograph lands before execution, `MIG-1040` refuses every page — correctly — and the manifest must be re-measured and re-approved. That is the control working.
2. **The 207 are re-verified, not rewritten.** `media_migrate_post` compares each existing post row-for-row against the manifest and returns `verified-skip`; MIG-2020 / MIG-2021 refuse if anything disagrees. A refusal there would mean production drifted since the migration — worth knowing, not something to work around.

## Next decision

GO for the **dry run only**, 8 pages, `dry_run: true`, `approved_hash = fd2d2432f1cea09899c7c64501b31591241ee1978e3f0dc61488bedb1c1b53d1`, `fence = 2026-08-19 14:31:54.025005+00`, `max_posts = 25`. The real run stays unapproved.
