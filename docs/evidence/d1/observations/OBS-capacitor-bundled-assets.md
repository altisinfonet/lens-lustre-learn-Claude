# Observation — the web lane and the app lane are not the same lane

**Filed for the register. Not a defect, not a unit — a fact about this product that had not been
written down, and it changes how every user-facing fix should be reasoned about.**

## The instrument

`capacitor.config.ts`, read on `main` 2026-09-04:

```ts
const config: CapacitorConfig = {
  appId: 'com.fiftymmretina.app',
  appName: '50mm Retina World',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ...
```

⚠ **Precision, because the obvious grep misleads.** There **is** a `server` block — so
`grep -n "server" capacitor.config.ts` returns a hit and could be read as "it points at a URL". It
does not. The block contains only `androidScheme`. **There is no `server.url`.**

## What follows

`webDir: 'dist'` with no `server.url` means the app **bundles** the built web assets into the APK/AAB.
It does **not** load `www.50mmretina.com` at runtime.

**Therefore:**

| change | reaches a website visitor | reaches an installed app user |
|---|---|---|
| a web deploy (Cloudflare Pages on `main`) | **immediately** | **never** |
| an Android build + store release | — | only after build, review and the user updating |

**Every user-facing web fix needs a build and a store release to reach the app.** A fix that is "live"
on the website is not live for app users, and nothing in the deploy pipeline says so.

## Why it is worth a register entry

Two decisions today turned on it, and both were nearly got wrong:

1. **F-70 / C-66** — an Android build off a promotion containing **zero** bundled-asset changes would
   have produced a functionally identical app carrying a **new version number**. Version numbers are
   one-way. The build was correctly withheld.
2. The converse: a promotion that **does** change `src/pages/**` genuinely needs a build, or app users
   keep the old behaviour indefinitely while the website shows the new one — and the discrepancy is
   invisible from either side.

## The standing precondition this justifies

An Android build is justified by a change to the **bundled web assets or the native project**, and by
nothing else:

```
git diff --name-only <main-before> <main-after> | grep -E "^(src/|public/|index.html|capacitor.config.ts|android/)"
```

Empty → the build is not justified and is not fired. Non-empty → it is.

⚠ **Refine it by hand before firing:** the pattern also matches `src/**/__tests__/**`, which is *not*
bundled. Measured on the `ecdad73 → 7e93dd8` promotion: **8 matches, of which only 3 are bundled**
(`src/pages/ManagedPageView.tsx`, `src/pages/VerifyCertificate.tsx`,
`src/pages/verifyCertificateErrors.ts`). A promotion whose only matches were test files would pass the
grep and still not deserve a version number.
