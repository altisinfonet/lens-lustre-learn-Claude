# D3 · TC-v3 AFTER measurement · delivery manifest for commit `b77d03e`

**Why this file exists.** The Auditor asked for `b77d03e` as a single `git format-patch` with every
blob id in the body. The complete patch is **327,388 bytes** — four PNGs carried as git binary
diffs — and the Project refused the write at its size ceiling (~81,847 tokens over). Rather than
alter the patch to make it fit, which would break its hash, the delivery is split and this manifest
is the index. **Nothing is omitted; the binaries move by a different channel.**

## The commit

`b77d03e` — *D2: TC-v3 AFTER — ellipsis proved in a real engine; bar proved on production data*
Base `origin/staging`. Not on origin: `docs/evidence/d3/` does not exist and D3 never held push
authority, so the patch **is** the deliverable.

## Post-image blob ids — all six files in the commit

| blob | file | in which artefact |
|---|---|---|
| `20434641eeff71b32104ae32cd2c107388820d99` | `docs/evidence/d2/tc-v3/AFTER-2026-09-03.md` | text patch below |
| `f85985cbf07f2ce811c073084daad803436d2699` | `docs/evidence/d2/tc-v3/local-render-measure.mjs` | text patch below |
| `e51bcdd98e96d66e4177e1b6e8864970eb226175` | `after-phone-360x800-NAME-21.png` | delivered in chat |
| `8d559f201d44aa836375c9132ee6eaf7d7d6e992` | `after-phone-360x800-PROD-NAMES.png` | delivered in chat |
| `e84f7eb6778cddd5db2c6c77e88203acb4d3fe71` | `after-desktop-1280x800-NAME-21.png` | delivered in chat |
| `bf101884ab75fbe48c4808c9800c5cfa2c7bd713` | `after-desktop-1280x800-PROD-NAMES.png` | delivered in chat |

Blob ids are content-addressed: they do not change under rebase, and they are the same values
whether the file arrives by patch, by chat, or by courier. **Verify by `git hash-object`, not by
filename.**

## The two patch files

| artefact | bytes | sha256 |
|---|---|---|
| `d3-after-measurement.patch` (complete, **with** binaries) | 327,388 | `84ad813199666b527048f84b670a24d698b693c7421349e1fc237c436ded5223` |
| `d3-after-measurement-text.patch` (the two text files only) | see Project doc | printed with this manifest |

Both are pristine `git format-patch` output — **neither was edited to carry this manifest**, so both
hashes verify against a clean regeneration from `b77d03e`.

## Applying it

The text patch applies alone and yields the report and the harness. The four PNGs must be added from
the chat delivery and checked with `git hash-object` against the table above; only then does the tree
match `b77d03e`. **A tree missing the screenshots is not this commit** — the ellipsis evidence is
partly visual, and §3.1's obligation 2 is the clause they illustrate.

## What this commit does and does not establish

**Establishes:** the ellipsis is active at 360 px on a 21-character name (clientWidth 105/105/99
against scrollWidth 115, `text-overflow: ellipsis`, row height 48 px unchanged — it truncates, it
does not wrap and does not overflow); the same name **fits** at real desktop width with nothing to
spare (115 = 115); rows did not grow harmfully (card 250×324 phone / 258×370.66 desktop,
`cardExtendsBelowFold: false`); the progress bar reads 100/98/94 on production data with **no row
over 100 %**, against the old formula's 104 % and 126 %; and §3.4 passes discriminatingly, the
displayed figures descending while the lifetime figures the card also shows do not.

**Does not establish:** any reading from a deployed lane — every render is SUBSTITUTED, from a local
bundle with injected data — and **not** the real mid-range Android reading, which remains an Owner
item on the runbook and is not closed by an emulated 360×800 viewport.
