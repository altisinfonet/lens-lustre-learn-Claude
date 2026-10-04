# P22 · Web offline decision

**Unit:** P22 · **Lane:** D2 (written by the D3 session, docs only) · **Date:** 2026-10-04 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/P22/` (MASTER R-82 rule 2 restricts D3 to `phase5/**`. GATE_REGISTER names `docs/evidence/d2/P22/`; the Auditor reconciles the two)

**Gate (GATE_REGISTER.md, verbatim):** "either a service worker delivering the O-workstream's read cache on the web, or a written, dated decision that web offline is out of scope."

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box and fill in the line in GitHub's editor, or comment `P22 approved` on this PR.

---

## 1 · The decision (dated 2026-10-04)

| # | Decision |
|---|---|
| D1 | **Web offline is OUT OF SCOPE** for the Addendum A programme. The website does not promise to show a feed, a post, a profile or any other page without a network connection. |
| D2 | **The existing image service worker stays as it is**, as a performance cache and not an offline feature. That is `public/sw-image-cache.js`: an LRU of 200 thumbnails, registered only on production hosts by `src/main.tsx:108-155`. This decision neither expands nor removes it. |
| D3 | **No app-shell service worker** (no Workbox, no precache of `index.html` and `/assets/*`). The app already actively *unregisters* any `/sw.js` or `workbox` worker and deletes `workbox-*` / `precache` / `runtime` caches on every production load (`src/main.tsx:128-146`). This decision writes down why that code exists: with several deploys a day and hashed chunks, a cached shell serves stale HTML that points at chunks that no longer exist. That is the blank-page class `src/lib/staleChunkReload.ts` and the chunk-healing block in `src/App.tsx:~70-100` already fight. |
| D4 | **When offline reading is wanted, it is a native-app workstream with its own gate**, not a web service worker. The phones are where members open the app on bad connections. The design notes already exist in `docs/phase2-evidence/PHASE3_OFFLINE_RESILIENCE_AUDIT.md` §6 (persistent feed store in IndexedDB, stale-over-blank fallback, network-state awareness). |
| D5 | **When to reopen:** reopen when either of these happens. (a) A defined "O-workstream" with written requirements is approved; today none exists (F-D3-5). (b) The Owner decides offline is a product requirement for the web. Until then this decision stands, and P22 is closed. |

## 2 · Why "out of scope" is the honest branch today (read from the running repo, staging `26977a8` (re-checked after #322 merged), 2026-10-04 07:55 UTC)

- **The gate names a workstream that does not exist.** `git grep -n -i "O-workstream"` over every `*.md` returns exactly one hit: the P22 row of `GATE_REGISTER.md` itself. Nothing defines the "O-workstream's read cache" that the service-worker branch would have to deliver. Building a service worker against an undefined requirement is guesswork, which the role skills forbid.
- **No offline read path exists for a service worker to serve.** `PHASE3_OFFLINE_RESILIENCE_AUDIT.md` (2026-08-21) states: "offline-first read resilience is ABSENT from Phase 3 and from every phase." A service worker can only cache what the app knows how to show offline.
- **The app-shell route was already tried and removed** (the D3 code above). Re-adding it would bring back a known failure.

## 3 · Findings (for the Auditor; no code is changed by this PR)

- **F-D3-5 · "O-workstream" is undefined.** GATE_REGISTER P22 points at it, and no document defines it. Ask: correct the gate sentence, or define the workstream.
- **F-D3-6 · The image service worker keeps `post-images` responses after sign-out (INFERRED from code, not measured in a browser).** `sw-image-cache.js` caches up to 200 images from `portfolio-images`, `competition-photos`, **`post-images`** and `site-assets`. `git grep "caches.delete"` in `src/` shows deletion only in `cacheBuster.ts` (global purge), `main.tsx` (stale workbox caches) and `App.tsx` (`/assets/` entries). There is **no purge on sign-out**. On a shared device, the next person to use that browser can read the cached image of a Friends-only post from Cache Storage. This sits on top of D-002 (the public bucket), and `PrivacyGapNotice` stays shipped. Proposed owner: D2. The fix is a `caches.delete("gallery-images-v3")` on sign-out, in its own PR with a test.
- **F-D3-7 · The service worker's host list has no `cdn.` host** (`grep -c "cdn.50mmretina" public/sw-image-cache.js` → 0). It matches only Supabase Storage and `*.r2.dev`. I did not measure in this session whether production images are served from the CDN host. If they are, the cache rarely hits. This is information for P14/P11, not an offline item.

## 4 · After signature

Auditor: close P22 on this dated decision. F-D3-6 → D2 queue (privacy-adjacent, small). F-D3-5 → the Auditor's own gate-text correction.
