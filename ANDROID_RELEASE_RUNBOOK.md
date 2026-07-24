# Android Release Runbook — 50mm Retina World

> **Source of truth note:** Everything below was read directly out of this repository's
> committed files (`.github/workflows/android-build.yml`, `capacitor.config.ts`,
> `package.json`, `CAPACITOR_SETUP.md`, `STORE_LISTING.md`). It is **not** a memory of
> having run the build. Where the repo does not record something (e.g. the exact upload
> keystore location), it is marked **UNKNOWN — verify manually** rather than guessed.
> **No secrets are included in this file.**

App identity:
- **appId / bundle ID:** `com.fiftymmretina.app` (both platforms)
- **appName:** `50mm Retina World`
- **webDir:** `dist`
- **OAuth deep-link scheme:** `app.fiftymmretina`
- **GitHub repo:** `altisinfonet/lens-lustre-learn-claude` (branch `main`)

---

## 1. How the app is built & published

Built **in the cloud with GitHub Actions** — not locally, not Android Studio.

- **Workflow file:** `.github/workflows/android-build.yml`
- **Trigger:** a push to `main` that changes **either** the workflow file **or** a file
  named **`ANDROID_BUILD_TRIGGER`** (repo root). The July release was fired by updating
  `ANDROID_BUILD_TRIGGER` (its contents are just a timestamp).
- **Output:** an **UNSIGNED** Android App Bundle uploaded as a GitHub Actions artifact
  named **`app-release-unsigned`** → `android/app/build/outputs/bundle/release/app-release.aab`
  (14-day artifact retention).

### To cut a new build
1. Edit `ANDROID_BUILD_TRIGGER` (e.g. paste a fresh `date` timestamp) and commit to `main`.
2. Open the repo's **Actions** tab → **Android Build** → wait for the run to finish.
3. Download the **`app-release-unsigned`** artifact (the `.aab`).
4. **Sign it** (see §5) and upload to **Play Console → Internal testing → Production**.

### What the workflow does, in order
1. `actions/checkout@v4`
2. Node 20 (`actions/setup-node@v4`)
3. Java 21 Temurin (`actions/setup-java@v4`)
4. `npm ci` (fallback `npm install`) — web dependencies
5. Installs Capacitor + native plugins (see §3)
6. `npm run build` — builds the web app into `dist/`
7. `npx cap add android` — **generates the native `android/` project fresh**
8. Patches `android/variables.gradle`: `minSdkVersion 23→24`, `compileSdkVersion 35→36`;
   patches `android/build.gradle`: Android Gradle Plugin → `8.9.1`
9. Sets version: `versionCode = 1000 + <github.run_number>`, `versionName = "1.1.1"`
10. Injects an OAuth deep-link `<intent-filter>` (scheme `app.fiftymmretina`) into
    `AndroidManifest.xml`
11. Generates icons/splash via `@capacitor/assets` (background `#0f172a`)
12. Copies `google-services.json` → `android/app/google-services.json`
13. `npx cap sync android`
14. `./gradlew bundleRelease --no-daemon` → produces the unsigned `.aab`
15. Uploads the `.aab` artifact (and build reports on failure)

---

## 2. Native `android/` project

- **NOT committed** anywhere in this repo (no separate repo either).
- It is **generated on every CI run** by `npx cap add android` and then patched by the
  workflow steps above, so the folder is ephemeral.
- **Implication:** any permanent native change (SDK levels, manifest entries, Firebase,
  icons) must live **in the workflow** — editing a local `android/` folder will not
  persist, because CI regenerates it each build.

---

## 3. Capacitor & SDK versions

- **Capacitor version: NOT pinned.** `package.json` contains no `@capacitor/*` entries;
  the workflow runs a bare `npm install @capacitor/core @capacitor/cli @capacitor/android …`
  with no version, so each build pulls **whatever is latest on npm at build time.**
  → **UNKNOWN exact version — read it from the specific Actions build log.**
- **compileSdkVersion = 36** (explicitly set in CI)
- **minSdkVersion = 24** (explicitly set in CI)
- **targetSdkVersion = NOT overridden in CI** → uses the Capacitor template default
  (the pre-patch template used compileSdk 35 / minSdk 23).
  → **verify the exact target in the build log if it matters for Play requirements.**
- **Android Gradle Plugin:** `8.9.1`
- **Native plugins installed:** `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
  `@capacitor/camera`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/app`,
  `@capacitor/browser`, `@capacitor-firebase/messaging`

---

## 4. Version numbers

- **versionName:** `1.1.1` (hardcoded in the workflow)
- **versionCode:** `1000 + <GitHub Actions run number>` (monotonic)
  → The exact integer for any given release = 1000 + that run's number, visible on the
  run in the **Actions** tab. **UNKNOWN from code alone.**
- ⚠ To ship a **new** Play release you must bump the version. `versionCode` auto-increments
  via the run number, but **`versionName` is hardcoded to `1.1.1`** — update it in the
  workflow's "Set app version" step for a user-visible version change.

---

## 5. Signing / keystore

- CI produces an **UNSIGNED** `.aab`. There is **no signing step in the workflow** and
  **no keystore (`.jks`/`.keystore`) committed anywhere in this repo.**
- Intended approach (per `CAPACITOR_SETUP.md` checklist): **Play App Signing** — "let
  Google manage the signing key." Under that model you still sign the upload with an
  **upload key** before uploading to Play Console.
- **UNKNOWN — verify manually:** where the unsigned bundle gets signed and where the
  **upload keystore** lives is **not recorded in the repo.** Whoever performed the last
  upload holds it (a local keystore on their machine, or an upload key created in Play
  Console). **Do not assume it is in the repo — it is not.** Locate it before the next
  release, and back it up somewhere safe; losing the upload key requires a Play Console
  key reset.

---

## 6. GitHub / CI

- **Remote:** `github.com/altisinfonet/lens-lustre-learn-claude`, account **altisinfonet**.
- Pushing to **`main`** auto-deploys the **web app**; touching `ANDROID_BUILD_TRIGGER` on
  `main` fires the **Android** build.
- **Existing workflows:** `.github/workflows/android-build.yml`, `.github/workflows/typecheck.yml`
- **Firebase:** `google-services.json` is committed at repo root; the workflow copies it
  into `android/app/`.

> **⚠ SECURITY:** the working copy's git remote URL had a **GitHub personal-access token
> embedded in it**. Treat that token as exposed — **rotate it** in GitHub settings and
> re-clone using SSH or a credential helper instead of a token-in-URL.

---

## 7. Related docs already in the repo

- `CAPACITOR_SETUP.md` — push-notification wiring + store-submission checklist + signing note
- `STORE_LISTING.md` — store listing copy, bundle ID, version-bump notes
- `.github/workflows/android-build.yml` — the build recipe (source of most of this doc)
- `ANDROID_BUILD_TRIGGER` — the file you edit to trigger a build
- `resources/android/` — `icon-foreground.png`, `icon-background.png` (icon/splash source art)
- `google-services.json` — Firebase config (repo root)

---

## Quick "gotchas" checklist for the next release
- [ ] Bump **`versionName`** in the workflow if the user-visible version should change.
- [ ] Confirm the **Capacitor version** that resolves in CI (it floats — pin it if you
      want reproducible builds: add exact `@capacitor/*` versions to `package.json`).
- [ ] Have the **upload keystore** in hand and backed up (see §5).
- [ ] Sign the downloaded `.aab` before uploading (CI output is unsigned).
- [ ] **Rotate** the exposed GitHub token (see §6).
