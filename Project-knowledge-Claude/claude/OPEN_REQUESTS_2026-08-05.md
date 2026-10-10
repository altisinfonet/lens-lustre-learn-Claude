# Open requests — captured 2026-08-05, NOT yet built

Recorded verbatim so nothing is lost or paraphrased into something he did not ask for.

## 1. Logout row: version number beside the button

> "logout button will on the left half of the current size and on the left
>  portion same alignment show app version so that user can understand
>  1050 (1.2.2) or 10151 (1.2.3) what is the current app version loaded"

Reading: the Logout button becomes **half its current width, sitting on the
left**, and the **other half of that row** carries the app version on the same
baseline/alignment. Purpose is explicit: a member (and he, when testing) must be
able to see **which build is actually loaded** — e.g. `1050 (1.2.2)`.

Where the numbers come from:

- **versionCode** (`1050`, `1051`, …) = `1000 + github.run_number`, set in
  `.github/workflows/android-build.yml`. It is NOT currently exposed to the web
  layer — it will have to be injected at build time or read from the native app
  (`@capacitor/app` `getInfo()` returns `version` and `build`).
- **versionName** (`1.2.2`) is hard-coded in the same workflow step.
- On the **web** there is no versionCode. `window.__APP_BUILD` (currently
  `2026-08-05-1`, set in `src/main.tsx`) is the web equivalent and should be
  shown there instead of a fake build number.

⚠️ Do not invent a versionCode on web. Show the real thing for each surface.

## 2. Admin users list: last active + where they signed in from

> "on the admin users list show last activated time and login from app or
>  website on the same list nicely show"

Two columns on the existing admin users table:

- **Last active** — `profiles.last_active_at` already exists and is maintained by
  `useLastActive()`. Verify it is actually being written before displaying it.
- **App or website** — **this is not currently recorded anywhere.** Check before
  building: `client_errors.platform` stores `app` / `web` (from
  `isNativeCapacitorApp()`), but that is only written when something FAILS, so it
  is not a source of truth for sign-in origin. A new column (e.g.
  `profiles.last_platform`) written on login, or a small `sessions` record, will
  be needed. Do not derive it from error rows.

## Note for whoever picks this up

Both are additive UI. Neither should be started before the three unpushed fixes
in `claude/SESSION_2026-08-05_STATE.md` are on `main` — one of those is the
app-wide freeze fix, and one is the owner's FINAL NOTICE that nothing may block
posting for a missing DP.
