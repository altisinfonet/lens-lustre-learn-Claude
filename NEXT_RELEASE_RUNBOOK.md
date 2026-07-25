# Cut the Next Android Release — One Page

> **Read this first. The build is fully automatic and SELF-SIGNING now.**
> You do **not** need Android Studio, a local build, or manual signing. Do **not**
> re-investigate signing — it is solved (see "How signing works"). Repo:
> `altisinfonet/lens-lustre-learn-Claude`, branch `main`.

## To ship a new release (5 steps)

1. **(Only if the user-visible version should change)** edit `.github/workflows/android-build.yml`
   → step **"Set app version"** → change `versionName "1.1.1"` to the new name.
   `versionCode` auto-increments (`1000 + run_number`), so you never touch it.

2. **Trigger the build:** edit the file **`ANDROID_BUILD_TRIGGER`** (repo root) — change the
   text to anything new (e.g. a date) — and commit to `main`.
   *(Committing the workflow file itself also triggers it.)*

3. **Watch it:** repo → **Actions** → **Android Build**. Takes ~4–5 min. The step
   **"Configure release signing"** must log **"this build will be SIGNED."** Success = a green
   run with one artifact named **`app-release-aab`** (~13 MB). This artifact is a **signed**
   `.aab`, targetSdk 36.

4. **Get the bundle to Play:** download the `app-release-aab` artifact (it's a **zip**
   containing `app-release.aab`). Two ways to hand it to Play Console:
   - **Auto (if a desktop is bridged):** stage the zip from the user's Downloads, `unzip` it,
     `SendUserFile` the `.aab`, then `device_commit_files` it to Downloads as `app-release.aab`.
     The raw `.aab` is **>10 MB**, so the browser `file_upload` tool **cannot** inject it — the
     user must pick it in the file dialog, OR use the auto path above and still have them click
     the file. (Play's upload input is `<input type=file>`; only the 10 MB bridge limit blocks
     direct injection.)
   - **Manual:** user unzips and uploads `app-release.aab` themselves.

5. **Create the Play release:** Play Console → app **50mm Retina World** →
   **Production** (or Testing) → **Create new release** → upload the `.aab` →
   fill Release name (auto "`<code> (<name>)`") + notes → **Next** → **Save**.
   **STOP THERE.** The final **"Submit … for review"** in **Publishing overview** is the
   owner's click (managed publishing is OFF, so submit = it goes live after Google review).

## How signing works (do NOT redo this)

- CI signs automatically. The gradle `signingConfig` is injected by the workflow at build time.
- **keyAlias is HARDCODED to `upload`** in the workflow (it is not a secret — it's the alias
  name). This was deliberate: the old `ANDROID_KEY_ALIAS` **secret** was corrupted (trailing
  whitespace) and caused repeated "No key with alias" failures. Do not reintroduce a
  `KEY_ALIAS` secret dependency.
- Two GitHub secrets do the rest (Settings → Secrets and variables → Actions):
  `ANDROID_KEYSTORE_BASE64` (base64 of the upload keystore) and `ANDROID_KEYSTORE_PASSWORD`.
  The key password equals the keystore password, so the workflow reuses
  `ANDROID_KEYSTORE_PASSWORD` for both. **All are already set — do not recreate them.**
- The keystore's real identity (verified): **1 entry, alias `upload`, PrivateKeyEntry**,
  cert **SHA-256 `35:2F:82:CF:6F:E1:77:5E:3D:9C:EF:8A:2E:63:45:9F:EB:0A:F0:47:01:1D:C6:29:A3:A0:73:C1:A8:1D:99:12`**
  — this matches Play's expected upload certificate. Owner holds the `.jks` + password
  (in their password manager / `KEYSTOREREADME.txt`). **Never commit the keystore or its
  password.**

## Facts you'll need

| Thing | Value |
|---|---|
| Package / appId | `com.fiftymmretina.app` |
| Current live versionCode on Play | **1005** (before this release) |
| This release | **versionCode 1010**, versionName **1.1.1**, targetSdk **36** — prepared, awaiting owner's Submit |
| targetSdk requirement | API 36 clears the "update target API by 31 Aug 2026" warning |
| Artifact name | `app-release-aab` (signed) |
| Managed publishing | **OFF** → "Submit for review" publishes after Google review |

## Do NOT waste time on (already solved / verified)
- ❌ "Is the build signed?" → yes, automatically.
- ❌ "Where's the keystore / what's the alias?" → alias `upload`, hardcoded; keystore in the
  base64 secret + owner's copy.
- ❌ "Is targetSdk 36?" → yes, verified in the built bundle via bundletool.
- ❌ Re-adding `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` secrets → not used; alias hardcoded,
  key password = keystore password.
