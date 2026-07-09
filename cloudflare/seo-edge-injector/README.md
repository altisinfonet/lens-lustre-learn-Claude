# SEO Edge Injector — Cloudflare Worker

This Worker injects per-route SEO metadata (title, description, Open Graph, Twitter Card, canonical, JSON-LD) into the HTML served by Lovable, **before** crawlers (Google, Bing, Facebook, X/Twitter, LinkedIn) ever see it.

## How it works

```
Crawler / User
      │
      ▼
50mmretina.com  ◄── Cloudflare proxied (orange cloud)
      │
      ▼
Worker (this code)
      ├─► 1. Fetches raw HTML from ORIGIN_HOST (fiftymmretinaworld.lovable.app)
      ├─► 2. Calls Supabase `seo-route-metadata?path=/whatever`
      ├─► 3. Rewrites <head> on the fly using HTMLRewriter
      └─► 4. Streams modified HTML to client (zero added latency for body)
```

If anything fails (timeout, error, missing data), the Worker passes the **original HTML through unchanged** — your site never breaks.

## Deploy (copy-paste)

You already created the Worker `seo-edge-injector` and bound the routes:
- `50mmretina.com/*`
- `www.50mmretina.com/*`

To deploy this code:

1. Open Cloudflare Dashboard → **Workers & Pages** → `seo-edge-injector` → **Edit code**.
2. Delete the placeholder code in the editor.
3. Open `cloudflare/seo-edge-injector/worker.js` from this repo, **copy everything**.
4. Paste into the Cloudflare editor.
5. Click **Save and deploy**.

## Required environment variables

Set these under **Settings → Variables and Secrets** (you already have them):

| Variable | Value |
|---|---|
| `ORIGIN_HOST` | `fiftymmretinaworld.lovable.app` |
| `SUPABASE_PROJECT_REF` | `isywidnfnjhtydmdfgtk` |
| `ENABLE_REWRITE` | `false` (start in observe mode!) |
| `METADATA_FUNCTION_URL` *(optional)* | `https://isywidnfnjhtydmdfgtk.functions.supabase.co/seo-route-metadata` |

## Verify (3 quick checks after deploy)

Open Terminal / PowerShell and run:

### Check 1 — Worker is in the path (observe mode)
```bash
curl -sI https://50mmretina.com/ | grep -i x-seo-edge
```
Expected: `x-seo-edge: observe`

### Check 2 — Site still works
Open `https://50mmretina.com/` in a browser. It should look exactly like before. Nothing visibly changes in observe mode.

### Check 3 — Flip the switch
Once Check 1 + 2 pass, go back to **Settings → Variables** and change:
```
ENABLE_REWRITE = true
```
Click **Save and deploy**. Then:
```bash
curl -s https://50mmretina.com/competitions/ | grep -E '(<title>|og:title|application/ld\+json)' | head -20
```
Expected: you'll see your real titles, OG tags, and JSON-LD blocks injected — even though the page is a React SPA.

You can also confirm with:
```bash
curl -sI https://50mmretina.com/ | grep -i x-seo-edge
```
Expected: `x-seo-edge: injected:default` (or `injected:competition`, etc., on dynamic pages).

## Rollback

If anything ever looks wrong, set `ENABLE_REWRITE = false` and **Save and deploy**. The Worker reverts to pure passthrough within seconds.

## What gets skipped

The Worker never touches:
- Static assets (`.js`, `.css`, images, fonts, video, PDFs, zip)
- API/function paths (`/api/`, `/functions/`, `/rest/v1/`, `/auth/v1/`, `/storage/v1/`)
- Sitemap, robots.txt, manifest, favicon
- Non-GET requests
- Non-HTML responses
- Error responses (4xx, 5xx)
