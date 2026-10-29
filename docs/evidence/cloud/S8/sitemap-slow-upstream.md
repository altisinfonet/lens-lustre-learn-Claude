# S8 F-D3-3 — why #504 was held, and the root cause (2026-10-29)

**Held because:** staging's `/sitemap.xml` showed 0 URLs vs live's static 12.

**That part is by design:** `scripts/generate-seo-assets.mjs` writes an EMPTY
sitemap on every non-production lane (staging tells crawlers to stay out), and
the route returns the static file untouched when it is empty. Staging cannot
show the dynamic path.

**The real defect (found with production-shaped inputs):** the real
`functions/sitemap.xml.ts` run against live www's static sitemap (12 URLs) and
production's generator `jtdtehuqtinjxropkkcn.supabase.co/functions/v1/sitemap`:

| | source | URLs served |
|---|---|---|
| before (#504 code) | static-fallback | 12 |
| after, 1st request | dynamic | 729 (visitor waited 3.9 s) |
| after, 2nd request | dynamic-cached | 729 (3 ms) |

The generator answers in 4.7–5.6 s (curl, 5 samples: ttfb 4.68 / 4.75 s, total
5.60 / 5.53 / 5.62 / 5.34 s); the route aborted every upstream read at 4 s, so
on production it would ALWAYS serve the static file, never fill its cache, and
its stale-refresh (same 4 s limit) would never refresh.

**Fix:** one upstream read with a 25 s background limit; the visitor waits at
most 4 s, otherwise gets the static file at once while the same read fills the
edge cache under `waitUntil`; the stale refresh uses the 25 s limit.

Fail first: `src/__tests__/sitemapEdge.test.ts` two new tests fail on #504's
code (cache stays empty; refresh aborted), pass after.
