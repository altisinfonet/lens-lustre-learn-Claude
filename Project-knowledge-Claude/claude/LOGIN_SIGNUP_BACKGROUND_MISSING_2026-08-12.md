# /login and /signup show no background image — 2026-08-12

Owner report: "again image broken in web /login and /signup".
Separate from the dead-Supabase-project fix earlier the same day (that one verified
still holding: 0 dead references, 28/28 photos loading).

## The server side is entirely healthy — ruled out first

| check | result |
|---|---|
| `cdn.../on-page/login_background.webp` | serves real image bytes |
| `cdn.../on-page/signup_background.webp` | serves real image bytes |
| `cdn.../on-page/site_logo-...webp` | serves real image bytes |
| control: `cdn.../this_file_does_not_exist_12345.webp` | proper **404** |
| `www.50mmretina.com/images/logo-fallback.webp` | serves real image bytes |
| `site_settings` rows | correct CDN URLs stored |
| `dashboard-init` invoked **anonymously** | returns `site_logo`, `login_background`, `signup_background` correctly (32 settings) |

The control 404 matters: it proves the CDN is reachable and answering honestly, so
"image content is not supported" on the real files means bytes came back.

## What the live pages actually render

Fetched `/login` and `/signup` and listed every image URL. Both pages contain ONLY:

```
https://cdn.50mmretina.com/site-assets/seo/1775321074863-k3b5rusybos.jpg   (og:image, SEO only)
https://www.50mmretina.com/images/logo-fallback.webp                        (the emergency fallback)
```

The configured background image is **not on the page at all**, and the logo is the
built-in fallback rather than the real one.

## ROOT CAUSE — `src/hooks/core/useAuthPageSettings.ts`

The hook imports only `useMemo` and `useQueryClient`. It reads the three values with
`qc.getQueryData(...)` inside a `useMemo`. **`getQueryData` is a one-shot read — it does
not subscribe to the cache.**

On a direct visit to /login:

1. Login mounts; dashboard-init has not answered yet.
2. `getQueryData` returns undefined for all three keys.
3. `background_image = ""` → `Login.tsx` renders `<div className="w-full h-full bg-muted" />`
   — an empty grey panel — and the logo falls back.
4. dashboard-init answers and seeds the cache.
5. **Nothing re-renders.** No subscription exists. The empty panel persists for the life
   of the page.

It looks correct only when the cache is already warm — i.e. arriving at /login by clicking
through from another page. A logged-out member landing straight on the login URL, or hard
refreshing, always gets the empty version. That is the normal member path, which is why
members hit it and click-through testing did not.

Note this renders an empty grey panel, not a broken-image icon — "image broken" in the
report means the photo is absent, not that the file is missing.

## Fix delivered

`useAuthPageSettings.FIXED.ts` — drop-in replacement for
`src/hooks/core/useAuthPageSettings.ts`. Switches to `useQuery` (which subscribes and
re-renders), prefers the dashboard-init seed when warm (no extra request), and falls back
to reading `site_settings` directly on a cold start.

Verified 2026-08-12:
- Type-checks clean under `tsc --noResolve --strict false` (only the three expected
  unresolved-import errors, by design).
- The cold-start query it issues, run as an anonymous caller against the live REST API,
  returns HTTP 200 with both background URLs.

**Website only — deploys from main in minutes. No Android build needed.**
Not pushed: this session has no write access to the repo.

## Secondary, still open

The logo on those pages resolves to `/images/logo-fallback.webp` rather than the real
`site_logo`. `useSiteLogo` does use `useQuery`, but it `await`s the dashboard-init
bootstrap gate first, so it may simply not have resolved at snapshot time. Re-check after
the above ships; if the logo is still the generic one, that gate is the next thing to look at.
