# Android Build #119 — SUCCESS, and F-70 raised against it

**Run** https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/33784681572
**Commit** `9c91eeb` on `main` ("Staging (#145)") · **Duration** 16m 36s · **Status** Success
**Class** VERIFIED — read from the run page, not inferred

## Artifacts

| name | size | sha256 |
|---|---|---|
| `app-release-aab` | 8.48 MB | `01d29918b76467c9a880a9feaef5f32c66ffbc997e59a9a36fd7aef181d56315` |
| `app-debug-apk-SIDELOAD-THIS` | 13.9 MB | `946a860dc1bd3b4074d59b7cb2ca9fdf8e7985bd482c3c60292d72f55bd39a8f` |
| `ui-sweep-screenshots` | 40.1 MB | `e9409c735a3a34d74166637cf99ea58fff1a0bc6edf8591284710f2fd44a4742` |

Gates: Security 7s ✅ · UI gate 8m 02s ✅ · build-aab 8m 25s ✅.
The bundle carries OWNER-01 (AUTHORIZED SIGNATORY), TC-v3's 30-day Home card, and OWNER-RULING-2026-09-03-03
(the withdrawn "Preview All Types" button).

**#118 → #119 is the proof the guard correction held.** #118 died in `build-aab` at vitest with 6 failed /
2474 passed; #119 ran the same job to completion on the corrected guards.

## Warning worth acting on

> `ANDROID_KEY_ALIAS does not name any alias in the keystore. Using the keystore's own single alias 'upload'
> instead — this is what builds <=75 effectively did. Fix the secret at your convenience; the build no longer
> depends on it.`

The build is signed and the workflow degrades correctly, but the secret is wrong and has been for a long time.
Owner item, not blocking.

---

# F-70 — the versionName is the only value in this build that nothing checks

**Raised by the Owner, not by any gate.** That is the finding.

`android-build.yml` sets two version fields:

```
versionCode = 1000 + github.run_number      # DERIVED
versionName = "1.2.18"                      # TYPED, by sed, as a literal
```

Build **1117 succeeded and was cut as 1.2.18**. Run 119 therefore produced a **second, different build also
called 1.2.18** — different code, spent name. Play would have accepted it, because `versionCode` 1119 is unique;
nothing failed, nothing warned, and no check exists that could have.

The comment block around that literal records **eight prior hand-corrections in three weeks** (1.2.3, 1.2.13,
1.2.14, 1.2.16, 1.2.17, 1.2.18 …), each written by someone who noticed. Eight is not a run of bad luck. It is a
missing gate.

**The asymmetry is the whole finding.** This build refuses a bundle with native code and no debug symbols. It is
gated on vitest, on `tsc -b`, on the security audit, on the UI sweep. The one field that a human types is the one
field with no check — and it is the field every member reads on the About screen and that the Console and every
crash report key on.

**Fix (for D2, NOT applied here):** the build refuses a `versionName` that a previous SUCCESSFUL run already
shipped, in the same shape as the native-symbols refusal. Not written in this unit because under C-34 a new
blocking gate must first be shown failing on unfixed input — and the unfixed input is exactly run 119.

**Interim:** `82a5374` on staging bumps 1.2.18 → 1.2.19, YAML-validated, blob `4cfaabf2f166a3a3693a7308fec6b89c494d2d96`.
`.github/workflows/android-build.yml` is itself a trigger path, so merging it to main fires versionCode 1120 /
versionName 1.2.19 with no further action.

## Blocked

The `staging` → `main` pull request for that bump cannot be created from this session. Five attempts across fresh
page loads with 4- and 7-minute cooldowns; the page reports *"There was an error creating your PullRequest."* and
no PR is created. `is:open head:staging` returns nothing, so no existing PR is blocking it. #144 and #145 were
created the same way earlier today, so this is a transient GitHub-side rejection, not a repository state.
Direct commits to `main` are classifier-refused, correctly. Owner action or a later retry is required.

*Auditor · 2026-09-03.*
