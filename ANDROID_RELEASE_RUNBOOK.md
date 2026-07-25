# Android Release Runbook — 50mm Retina World

> **Status 2026-07-24: builds are AUTOMATIC and SELF-SIGNING.** For the fast path,
> read **`NEXT_RELEASE_RUNBOOK.md`** (one page). This file is the full detail.
> **No secrets are included in this file.**

App identity:
- **appId / bundle ID:** `com.fiftymmretina.app` (both platforms)
- **appName:** `50mm Retina World`
- **webDir:** `dist`
- **OAuth deep-link scheme:** `app.fiftymmretina`
- **GitHub repo:** `altisinfonet/lens-lustre-learn-Claude` (branch `main`)

---

## 1. How the app is built & published

Built **in the cloud with GitHub Actions** — not locally, not Android Studio. As of
2026-07-24 the CI output is a **SIGNED, upload-ready** `.aab` (previously unsigned).

- **Workflow file:** `.github/workflows/android-build.yml`
- **Trigger:** a push to `main` that changes **either** the workflow file **or** a file
  named **`ANDROID_BUILD_TRIGGER`** (repo root, contents are just a marker string).
- **Output:** a **SIGNED** Android App Bundle, artifact named **`app-release-aab`**
  → `android/app/build/outputs/bundle/release/app-release.aab` (14-day retention, ~13 MB).

### To cut a new build
1. (Optional) bump `versionName` in the workflow's "Set app version" step.
2. Edit `ANDROID_BUILD_TRIGGER` and commit to `main`.
3. Repo → **Actions** → **Android Build** → wait ~4–5 min for a green run.
4. Download the **`app-release-aab`** artifact (a zip containing `app-release.aab` — already
   signed) and upload to **Play Console → Production/Testing → Create new release**.
   See `NEXT_RELEASE_RUNBOOK.md` for the exact Play steps and the >10 MB upload caveat.

### What the workflow does, in order
1. `actions/checkout@v4`
2. Node 20 (`actions/setup-node@v4`)
3. Java 21 Temurin (`actions/setup-java@v4`)
4. `npm ci` (fallback `npm install`) — web dependencies
5. Installs Capacitor + native plugins (see §3)
6. `npm run build` — builds the web app into `dist/`
7. `npx cap add android` — **generates the native `android/` project fresh**
8. Patches `android/variables.gradle`: `minSdkVersion 23→24`, `compileSdkVersion 35→36`,
   **`targetSdkVersion → 36`**; patches `android/build.gradle`: AGP → `8.9.1`
9. Sets version: `versionCode = 1000 + <github.run_number>`, `versionName = "1.1.1"`
10. Injects OAuth deep-link `<intent-filter>` (scheme `app.fiftymmretina`) into the manifest
11. Generates icons/splash via `@capacitor/assets` (background `#0f172a`)
12. Copies `google-services.json` → `android/app/google-services.json`
13. `npx cap sync android`
14. **Configure release signing** — if `ANDROID_KEYSTORE_BASE64` is set, decodes the keystore
    and injects a `signingConfig` into `android/app/build.gradle` (logs "this build will be
    SIGNED"). No secret → falls back to unsigned (safe default).
15. `./gradlew bundleRelease --no-daemon` → produces the **signed** `.aab`
16. Uploads the `app-release-aab` artifact (and, if `PLAY_SERVICE_ACCOUNT_JSON` is ever added,
    can auto-push to Play internal testing — currently not configured)

---

## 2. Native `android/` project
- **NOT committed** — regenerated every CI run by `npx cap add android`, then patched.
- **Implication:** any permanent native change (SDK levels, manifest, signing, icons) must
  live **in the workflow**; editing a local `android/` folder does not persist.

---

## 3. Capacitor & SDK versions
- **Capacitor version: NOT pinned** — CI installs latest `@capacitor/*` at build time.
  Pin exact versions in `package.json` if you want reproducible builds.
- **compileSdkVersion = 36**, **minSdkVersion = 24**, **targetSdkVersion = 36** (all set in CI).
  targetSdk 36 (Android 16) **clears** the Play "update target API by 31 Aug 2026" warning —
  verified in the built bundle 1010 via `bundletool dump manifest`.
- **Android Gradle Plugin:** `8.9.1`
- **Native plugins:** `@capacitor/core|cli|android|camera|share|splash-screen|app|browser`,
  `@capacitor-firebase/messaging`

---

## 4. Version numbers
- **versionName:** `1.1.1` (hardcoded in the workflow — edit it there to change the shown version).
- **versionCode:** `1000 + <run_number>`, monotonic. Latest built = **1010** (run #10).
  Live on Play before it = **1005**.

---

## 5. Signing / keystore  ← SOLVED, do not re-investigate

CI **signs automatically**. Details:
- The workflow's "Configure release signing" step injects a gradle `signingConfig` using the
  keystore decoded from a secret. **`keyAlias` is HARDCODED to `upload`** in the workflow
  (the alias name is not sensitive). This replaced a corrupted `ANDROID_KEY_ALIAS` **secret**
  that had trailing whitespace and caused repeated "No key with alias 'upload' found" build
  failures on 2026-07-24. **Do not reintroduce a KEY_ALIAS secret.**
- **GitHub secrets used** (Settings → Secrets and variables → Actions) — already set:
  - `ANDROID_KEYSTORE_BASE64` — base64 of the upload keystore (`.jks`)
  - `ANDROID_KEYSTORE_PASSWORD` — keystore password (also used as the key password; they're equal)
  - *(legacy `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` secrets may still exist but are
    NOT used by the workflow.)*
- **Keystore identity (verified with keytool/bundletool):** PKCS12, **1 entry**, alias
  **`upload`**, **PrivateKeyEntry**, owner `CN=50mm Retina World, O=ALTIS INFONET PVT LTD`,
  cert **SHA-256 `35:2F:82:CF:6F:E1:77:5E:3D:9C:EF:8A:2E:63:45:9F:EB:0A:F0:47:01:1D:C6:29:A3:A0:73:C1:A8:1D:99:12`**
  — matches Play's expected upload certificate.
- **Owner holds** the `.jks` file + password (password manager / `KEYSTOREREADME.txt`).
  **Never commit the keystore or password.** Losing it forces a Play upload-key reset.
- **Play App Signing** is ON (Google holds the app signing key; we sign uploads with the
  `upload` key above).

---

## 6. GitHub / CI
- **Remote:** `github.com/altisinfonet/lens-lustre-learn-Claude`, account **altisinfonet**.
- Pushing to `main` auto-deploys the **web app** (via Lovable); touching `ANDROID_BUILD_TRIGGER`
  or the workflow fires the **Android** build.
- **Workflows:** `.github/workflows/android-build.yml`, `.github/workflows/typecheck.yml`
- **Firebase:** `google-services.json` committed at repo root; workflow copies it into `android/app/`.
- Editing repo files from a read-only AI session: use GitHub's web **"Upload files"** UI to
  overwrite in place (reliable), or the web editor. Direct `git push` may be blocked.

---

## 7. Play Console publishing
- App: **50mm Retina World**. **Managed publishing is OFF** → after you "Submit for review",
  the release auto-publishes to production once Google's review passes (hours–1 day).
- Release flow: Production → Create new release → upload `.aab` → name + notes → Next → **Save**
  (saves a draft to Publishing overview). The **owner's** final action is
  **"Submit N changes for review"** in Publishing overview. AI should stop at Save.
- **2026-07-24:** release **1010 (1.1.1), targetSdk 36** was built, verified, uploaded, and
  prepared as a Production draft — left awaiting the owner's Submit.

---

## 8. Related docs in the repo
- `NEXT_RELEASE_RUNBOOK.md` — **one-page fast path (read this first)**
- `PROJECT_MASTER_RECORD.md` — whole-project cold-start reference
- `.github/workflows/android-build.yml` — the build+sign recipe
- `ANDROID_BUILD_TRIGGER` — edit to trigger a build
- `CAPACITOR_SETUP.md`, `STORE_LISTING.md`, `resources/android/*`, `google-services.json`

---

## Quick checklist for the next release
- [ ] (If needed) bump `versionName` in the workflow.
- [ ] Edit `ANDROID_BUILD_TRIGGER`, commit → wait for a green **Android Build** run.
- [ ] Confirm the run logged "this build will be SIGNED" and produced `app-release-aab`.
- [ ] Upload the signed `.aab` to Play → Create release → Save (draft).
- [ ] Hand off to the owner for **Submit for review** (that's the go-live click).
- [ ] Signing/keystore/targetSdk are already solved — don't re-investigate them.
