# RESUME HERE — 2026-08-13

`origin/main` = **`eb12243`**. Working tree clean. Nothing is half-done.

---

## Paste this into a new chat to continue

> I own **50mm Retina World** — React 18 + TypeScript + Vite + Tailwind + Radix,
> Supabase `jtdtehuqtinjxropkkcn`, Cloudflare Pages, Capacitor Android
> (`com.fiftymmretina.app`). It is a **LIVE site and app**.
>
> Read these project docs before doing anything:
> `claude/RESUME_HERE_2026-08-13.md`, `claude/ARCHITECTURE_AUDIT_2026-08-13.md`,
> `claude/PINNING_AND_MEMORY_FIXES_2026-08-13.md`,
> `claude/MIGRATION_APPLIED_2026-08-13.md`, `claude/PROJECT_MASTER_RECORD.md`.
>
> `origin/main` is `eb12243`. **`git push` is proxy-blocked (403)** — every file
> goes through GitHub's web Upload page and must be byte-verified afterwards.
> The **Supabase connector is connected**, so migrations can be applied directly
> with `apply_migration` — always pre-flight with `execute_sql` first.
>
> Standing rules: ❌ guesswork ❌ assumptions ❌ hidden operations ❌ auto-fix.
> **No REELS, no LIVE, anywhere.** Never handle the keystore, its passwords, or
> the Play service-account JSON. Only I upload App builds. I review SQL.
>
> Next task: **the multi-size image derivative pipeline** — see "Next up" in
> `RESUME_HERE_2026-08-13.md`.

---

## Next up: the derivative pipeline (this is a project, not a CDN tweak)

Today you have effectively **two** sizes: a 600px thumbnail and the original.
A phone slot needing ~1,070 device px skips the 600 and downloads the **2560px
original**. You need something like:

```
original upload
   ├── thumbnail  (~600px)   list/grid
   ├── feed       (~1200px)  the feed card          ← MISSING
   ├── detail     (~2000px)  full-screen viewer     ← MISSING
   └── original              zoom / download only
```

⚠ **Pick the sizes from real device measurements, not round numbers.** The
current 600→2560 gap is exactly what "arbitrary numbers" produces.

⚠ **Read `PostMedia.tsx:89-130` before touching image URLs.** On 2026-08-01 a
`/cdn-cgi/image/` rollout cut bandwidth 89% *and broke every photo for every
`www` and Android user for four days*, because the transformer only served from
the apex origin. It survived that long because every test from the apex passed.

⚠ `src/lib/cdnImage.ts` is a fully written, fully tested, **corrected** transform
layer with **zero importers**. Read it before writing a new one — it already
fixes both root causes.

Also in scope, from the audit: **scheduled posts never get thumbnails** —
`scheduled_posts` has no thumbnail column, so every scheduled post serves
full-size originals forever.

---

## Done today (all live, all byte-verified)

| | |
|---|---|
| **Migration applied** | `get_broadcast_feed` returns 15 cols — author name/avatar/thumbnails/categories travel WITH the post. Verified end-to-end as anon. |
| **Feed windowed** | cards unmount ~2 screens away; the OOM path is closed |
| **Realtime** | 9 bindings → 5; counters are now server-truth, not client deltas |
| **Capacitor pinned** | and it caught a real time bomb within one build (Node 22) |
| **14.7 MB backdrop** | gone; `maxPages: 5`; 3 dead modules deleted |
| **9 earlier bugs** | slow-network empty feed, "?" names, drafts, Create button, blue tick on tagged names, 2 in-render hoists |
| **Android build** | green, 36/36 steps |

Gates on every commit: typecheck clean · **1,335 tests** · production build
clean · security gate PASS (0 critical, 0 high).

---

## Still open (nothing urgent, nothing broken)

1. **Derivative pipeline** — above. Biggest remaining user-visible win.
2. **Upload reliability** — single unchunked PUT, no retry, 5-min presign,
   multi-photo failures orphan bytes in R2. ~1-2 weeks.
3. **Feed RPC at scale** — `count(DISTINCT)` LATERAL over every visible post,
   non-sargable `can_view_post`, unbounded exclude-id array. **Measure first**
   (`EXPLAIN ANALYZE` at today's row counts, then seeded to 100k) before
   choosing `is_public` denormalisation vs fan-out. Don't build fan-out on
   theory.
4. **Two SECURITY DEFINER findings** — `get_post_view_counts` (no privacy
   predicate, `authenticated`) and `get_contributor_scores` (granted to `anon`,
   full-table aggregate per call).
5. **Instagram-style in-app photo picker** — owner confirmed he wants it; needs
   `@capacitor-community/media` + `READ_MEDIA_IMAGES` + a Play data-safety
   justification.
6. **Stage B2** (1–5 category minimum) — migration written, not applied, owner
   must authorise.
7. **`ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` secrets** hold wrong values —
   harmless since `1fcd745`; fix at leisure.
8. **Verify on device** after the next Play rollout.

---

## Things that will bite a fresh session if it doesn't know them

- **`git push` is blocked.** Browser upload + byte verification. The per-chunk
  rolling hash has caught **seven** real corruptions across sessions — never
  skip it. GitHub also swallows the first click/keypress after a navigation.
- **Deletions can't go through the upload page** — use `/delete/main/<path>`,
  which needs two clicks (button, then the dialog's confirm).
- **Adding any npm dependency regenerates the lockfile** and pulls 414 packages,
  removes 122, changes 193. Pin in the workflow instead, or budget a separate
  reviewed change.
- **`CREATE OR REPLACE FUNCTION` cannot change returned columns.** Adding one
  needs `DROP` inside `BEGIN…COMMIT`. The obvious rollback — re-running the
  previous migration — fails the same way. Use `supabase/rollback/`.
- **`has_table_privilege` on a bare role name lied** about what `anon` can read.
  For "can this role read this", test the request the client actually makes.
