# ANDROID BUILD — PRE-FLIGHT AUDIT BEFORE ANY RE-CUT
### 2026-08-31. Requested by the owner: *"1st check the process and sure on that, dont try, do proper way."*

**No build was triggered to produce this.** Everything below is read from `main`, from the two runs that already happened, or from a local build.

---

## 1. The shape of the thing

`android-build.yml` is three jobs. `build-aab` carries `needs: [security-gate, ui-gate]`, so a red gate means **no `.aab` is produced at all**.

| Job | Timeout | Status on run #114 |
|---|---|---|
| `security-gate` | 10 min | **PASSED**, 6s |
| `ui-gate` | 30 min | **PASSED**, 7m 36s |
| `build-aab` | 45 min | **FAILED at step 18 of 31**, 3m 19s |

**`build-aab` has 31 steps.** Run #114 completed 1–17 and died on 18.

---

## 2. What is already PROVEN, and by what

| Step(s) | What it does | Evidence | Status |
|---|---|---|---|
| security-gate | `scripts/security-audit.mjs` | passed on #114 | **VERIFIED** |
| ui-gate | reachability + baseline diff, 148 keys | passed on #114 **with the new harness scene and the MentionInput changes already in** | **VERIFIED** |
| 1–17 | install → typecheck → tests → capacitor → web build → cap add/sync | all ran green on #114 | **VERIFIED** |
| 2 Typecheck | `tsc -b tsconfig.json`, strict | passed #114; F-52's declaration is now on `main` | **VERIFIED** |
| 3 Test suite | vitest | passed #114; 2,480 pass locally | **VERIFIED** |
| 18 Six feature markers | greps the built bundle | **THE FAILURE.** Fix written; **all six pass in a local production build** | **FIXED, NOT PUSHED** |
| 21/22/28 Signing | keystore from secrets | **all four secrets exist** (names read from repo settings) | **VERIFIED** |

### Step 18 — the six markers, run exactly as the gate runs them

Built `origin/main` + the marker repair with production's environment, then ran the gate's own greps against `dist/assets/*.js`:

```
OK   get_contributor_scores
OK   Top Contributor
OK   All categories
OK   Photojournalism
OK   Pinned comment
OK   caretPlaced        <- was MISSING on #114; present now
```

---

## 3. Every file the later steps need — checked, present on `main`

| Step | Needs | On `main` |
|---|---|---|
| 15 icons/splash | `resources/icon.png`, `icon-foreground.png`, `icon-background.png`, `splash.png`, `splash-dark.png` | **present** |
| 16 Firebase | `google-services.json` at repo root | **present** |
| 19 notification icon | `resources/android/notification/ic_notification-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}.png` | **all five present** |
| 23 web-in-AAB | `capacitor.config.ts` `webDir: 'dist'`, and `dist/index.html` + `dist/assets/*.js` | **matches; local build produces both** |

**Step 4 vs step 5 are consistent.** Step 4 installs eleven pinned Capacitor packages; step 5 asserts those exact eleven versions. Pin and assertion agree line for line — no drift.

---

## 4. Versioning — no collision

| | |
|---|---|
| `versionCode` | `1000 + run_number`. Next run is #115 → **1115** |
| Highest previously built | 1112 (#112, 22 Aug). #113 and #114 produced nothing | 
| `versionName` | **1.2.17** — unused. 1.2.16 was spent by build 1111 |

Run #114 produced no artifact, so the name is not spent. Same handling the workflow's own notes record for builds 1105, 1107 and 1109.

---

## 5. ⚠ WHAT I CANNOT PROVE WITHOUT RUNNING — stated, not glossed

**Steps 19–31 have not executed since build #112 on 22 August.** #113 died at step 2, #114 at step 18. The promotion has landed 138 files since. I have checked every input those steps read and they are all present, but Gradle, AGP and plugin resolution can still surprise, and no amount of reading settles it.

### The one live fragility, named

**Step 20 runs `sudo apt-get update && sudo apt-get install -y webp`.**

This is the exact class of failure that killed builds **1107 and 1109** — apt could not reach Ubuntu's mirror and the job burned its whole timeout. The workflow's own header records the lesson and says `--with-deps` was removed "entirely … no system package manager is touched" — **but that fix was applied to the UI gate only. Step 20 still touches apt.**

Under `set -euo pipefail`, a failed apt fails the step, and a failed step fails the build. **WebP conversion is a Play size *recommendation*, not a requirement** — so a network hiccup on Ubuntu's mirror can throw away a 20-minute build for an optimisation the release does not need.

**Recommended hardening (NOT applied — owner's call):** make the apt install non-fatal and skip the conversion when `cwebp` is absent, leaving the PNGs in place. This weakens no correctness gate; it only stops an optional optimisation from being able to fail a release. It would have saved builds 1107 and 1109.

---

## 6. Verdict

**Two known blockers existed. Both are now accounted for:**

1. **F-52** — the missing type declaration. **Fixed and on `main`** (`86a17dd1`). Proven by #114 getting past step 2, which #113 could not.
2. **The moved marker** — fix written and verified in a real build. **Not pushed.**

With both in place, the build should reach step 19 — and every input from there to step 31 is present. **The residual risk is steps 19–31, unrun since 22 August, and step 20's apt call.**

**I am not cutting another build until the owner says so.**

---

## 7. Standing finding — the gate's instrument is brittle

The six markers are hardcoded strings from 2026-08-12. Four of the six are **UI copy** (`Top Contributor`, `All categories`, `Photojournalism`, `Pinned comment`); one is an RPC name; one is now a `dataset` key. **Any wording change or refactor breaks the release and reads exactly like a lost feature.**

The gate's intent is right and it has now caught something real. Its instrument keys on spelling rather than behaviour. This was written down in this repository on 2026-08-13 — *"it breaks on a copy change"* — and it did, eighteen days later.
