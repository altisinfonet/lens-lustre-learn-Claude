# BUILD #117 — VERIFIED, AND THE PLAY DEBUG-SYMBOLS ADVISORY
Date: 2026-09-01 · Repo: altisinfonet/lens-lustre-learn-Claude · Branch: main

## 1. What was merged
- PR #112 `ci(android): the three AndroidX libs Google ships stripped — allowed by name, with the proof`
- Merge method: squash. Resulting commit on `main`: **ba200cf**.
- File changed: `.github/workflows/android-build.yml` (one file).
- **Identity check (VERIFIED):** sha256 of `.github/workflows/android-build.yml` read back from `main`
  = `ed524d8352d1c3abf55d4dd145170a8c0457553a1e6a1c235edfaaca6e98391e`
  — byte-identical to the file that was tested before the merge. Size 81,301 bytes.

## 2. Build #117 — run 33478685018
| Requirement | Instrument | Evidence | Result | Status |
|---|---|---|---|---|
| Build completes | GitHub Actions run page | Status **Success**, total 16m 08s | pass | VERIFIED |
| Security gate | job "Security gate (blocks the build)" | succeeded, 6s | pass | VERIFIED |
| UI gate | job "UI gate — reachability + baseline" | succeeded, 7m 59s | pass | VERIFIED |
| Typecheck + tests | steps in build-aab | both succeeded (35s / 1m 13s) | pass | VERIFIED |
| Version identity | step "Set app version" log lines 45–47 | `versionCode=1117 versionName=1.2.18`; gradle shows `versionCode 1117`, `versionName "1.2.18"` | pass | VERIFIED |
| Web bundle inside AAB | blocking step | succeeded | pass | VERIFIED |
| Native symbol gate | blocking step, log lines 77–97 | 12 `.so`, 3 distinct libs, all three on the allowlist | pass | VERIFIED |
| Bundle is signed | step "Prove the release bundle is signed" line 24 | `OK: the release bundle carries a signature block` | pass | VERIFIED |

### Artefacts produced
- `app-release-aab` — 8.48 MB — sha256 `3b12450d144dff4ee1655f65987005eb79f23a95ef37e8ee622b3e00ebab4da4`
- `app-debug-apk-SIDELOAD-THIS` — 13.9 MB — sha256 `f6101f11dbda9f380311ff5b0046da957392866b269a8c3f3e588551600151b8`
- `ui-sweep-screenshots` — 40 MB — sha256 `6325a31f357d68b2f514ca1bd8bda592597d208e3a6b4f688fc45dba1c849727`

## 3. The Play "no debug symbols" advisory — the accurate position
Verbatim gate output from run #117, step "Prove native debug symbols are in the bundle (blocking)":

```
native .so files: 12   distinct libraries: 3
--- debug symbol metadata ---
(none)
debug symbol entries: 0
  allowed (Google ships it stripped): libdatastore_shared_counter.so
  allowed (Google ships it stripped): libimage_processing_util_jni.so
  allowed (Google ships it stripped): libsurface_util_jni.so
OK: every native library present is one Google ships stripped. Play will still show its
advisory 'no debug symbols' message; it cannot be satisfied for these three and it does
not block publishing.
```

The 12 files are 3 libraries × 4 ABIs (arm64-v8a, armeabi-v7a, x86, x86_64):
`libdatastore_shared_counter.so` (arrives via Firebase → androidx.datastore),
`libimage_processing_util_jni.so` and `libsurface_util_jni.so` (androidx.camera).

Prior evidence, unchanged: `readelf -S` on these `.so` shows only `.dynsym` and `.shstrtab`;
`nm --debug-syms` reports "no symbols"; the file inside the AAR is byte-for-byte the same
size as the file in the bundle (29008 == 29008). AGP's `ndk { debugSymbolLevel }` can only
extract what is present, so at both `SYMBOL_TABLE` (build #115) and `FULL` (builds #116/#117)
it emits nothing and Play keeps showing the advisory.

**Status of the warning: NOT FIXABLE by any change to our own code.** It is an advisory, not
a publishing blocker. Removing `@capacitor/camera` would remove two of the three libraries but
NOT `libdatastore_shared_counter.so`, which comes with Firebase — so the advisory would remain.

### The one remaining option, stated honestly (OWNER DECISION, not executed)
A `native-debug-symbols.zip` could be assembled from those same 12 `.so` and injected into
`BUNDLE-METADATA/com.android.tools.build.debugsymbols/` (or uploaded to the Play Console
against this version). Play would then stop showing the message. What it actually buys:
the dynamic symbol table only — exported function names — which is what `SYMBOL_TABLE`
fidelity means. There is no fuller debug data anywhere to ship, because Google does not
publish it. This is a real, Google-documented artefact, not a fake file, but it is close to
cosmetic and it changes how the release AAB is assembled. **Not done. Awaiting the owner's
explicit instruction.**

## 4. Open items unchanged by this build
F-47, F-50, F-52 (strict typecheck never runs on a PR), F-54, F-55; `apply-migration.yml`
still cannot authenticate; the two `COMMENT ON POLICY` statements never applied to production;
Cloudflare production still has no `VITE_SITE_ORIGIN`; `main`/`staging` histories still diverge;
story-image failure undiagnosed (link expired). Workflow warning: `ANDROID_KEY_ALIAS` holds a
value that is not a real alias; the build falls back to the keystore's single alias `upload`.
Deleting that secret or setting it to `upload` silences it; it affects neither the bundle nor Play.

## 5. Ledger status (added 2026-09-01, after this document was first written)
The GitHub ledger `docs/PROMOTION_LEDGER.md` had stopped at REV-18 (§30) and contained none of
this. **§31 · REV-19 has now been written and merged to `main`** via PR #113
(branch `docs/ledger-rev19-20260901`, squash merge, 1 file, +263 / −0, previous 2,612 lines
byte-identical). Ledger on `main` is now 2,875 lines, sha256
`5b7bbcb6183a6730a770b577be77ecc58a691165cb25e4f1d2c893b30cee8e22`.
REV-19 records builds #115/#116/#117, F-56, STANDING RULE 19, pending decision D-14,
the camera scope note, corrections C-36…C-41, and the open list.
The docs commit triggered **no** Android build — the workflow list still reads 117 runs.

## 6. D-14 ruled — ACCEPTED (2026-09-01)
The owner elected to accept the Play debug-symbols advisory and publish build #117 as it stands.
The symbols-archive change is **not** to be built; the release path is unchanged. F-56 becomes an
accepted standing condition under STANDING RULE 19, and D-14 is closed.
Recorded as **§31.14** in the GitHub ledger via PR #114 (squash, 1 file, +33 / −0, previous
2,875 lines byte-identical). Ledger on `main` is now 2,908 lines, sha256
`70ddbd9cdd264f3406b22c1d8256a31846f89e8d203b5b2738d5b39a6ae0f2e4`.
§31.10 was left exactly as written — the declined option stays on the record.
Android workflow-run count still reads 117: no build was triggered by either docs commit.

## 7. REV-20 — the open list worked down (2026-09-01)
**Closed with execution evidence:** F-47 (context interpolation in `web-build.yml` lane-guard) and
F-52 (the strict tsconfig project was compiled by nothing on a PR) — PR #115, squash-merged to `main`.
Proof of execution: Typecheck run 33487131550 job 99789730972 shows the new step
"TypeScript check — BOTH projects, app and strict" (29s, passed); Web build run 33487131543 ran the
new `env:` lane-guard and passed.

**Closed and verified on production:** the two `COMMENT ON POLICY` statements from §30.3.1.
`obj_description` returned null for both policies before, and both full comment strings after.
Metadata only; no policy expression, table or row touched.

**Neutralised, mechanism recorded:** F-55 / F-50. Measured first — `main..staging` was 3 files,
+5 / −799, and all 5 staging-only lines were superseded older revisions, so staging held no
unpromoted work. The back-merge (PR #116) could not be merged: the repository allows squash merges
only, so a merge commit is impossible and merge-base cannot advance. Instead staging's divergent
files were replaced with main's byte-identical versions. **`main..staging` now reads 0 changed
files, 0 additions, 0 deletions.** STANDING RULE 20 makes that sync part of every promotion.

**Blocked, honestly:** `VITE_SITE_ORIGIN` on Cloudflare production — the dashboard's Add control
would not create a row; nothing was changed. New fact recorded: production already carries a
correct `SITE_ORIGIN` (`https://www.50mmretina.com`); the missing one is the Vite-prefixed
build-time variable, and production HTML is correct anyway via the F-53 default.

**Corrections filed:** C-42 (I asserted a back-merge would fix the merge-base before checking that
merge commits are disabled) and C-43 (I described production as having no site-origin value when it
has `SITE_ORIGIN`).

Ledger on `main` is now 3,077 lines, sha256
`3c94041081e8e2473f76c01c1c6c8aeab3f24c57bed5c0132bfe92b36dd25982`; staging carries the identical file.

## 8. REV-21 — apply-migration.yml ran (2026-09-01)
Run **#10** of "Apply a database migration" **succeeded** against production in 38s: all 12 steps
green including `Run it` and `Confirm`. The workflow has now executed SQL against the production
database for the first time. The SQL was `supabase/migrations/PROBE_credential_connectivity_readonly.sql`
— BEGIN, four SELECTs about the server, COMMIT. Nothing was changed.

**The real fault was never a missing secret.** `SUPABASE_DB_URL` had existed as an *environment*
secret on both `production` and `staging` since Aug 31; the job reads the environment secret, and a
repository-level secret of the same name is shadowed. Four runs, four different faults:
#7 password wrong · #8 a DIRECT connection string, refused by the ref gate before connecting ·
#9 pooler shape restored, password still wrong · #10 green. None of them reached data.

**F-57 (new, closed same day):** two paragraphs in `apply-migration.yml`'s header described a system
that did not exist — one told the reader to store the DIRECT string that the file's own gate refuses,
the other said the `environment:` line was commented out when it is live. Both misdirections were
acted on and cost a day. Fixed by PR #119, **comments only**, proved by diffing with comment lines
stripped. STANDING RULE 21 added: an instructing comment is a control; when comment and code
disagree that is a finding, not cosmetics.

**Corrections C-44 and C-45** filed against the compiler for asserting from a document instead of
from the system — the third and fourth occurrence of the pattern named at §25.6.1.

Ledger on `main` is now 3,214 lines, sha256
`61e2799c3de9e90bceeb05087687b2adc76996d337f2ecf1f3ac05ad68952c74`; `main..staging` reads 0/0/0.
