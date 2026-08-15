# Privacy Transition Matrix (B5 deliverable)

**Question this answers:** when a member changes a post from **public** to **friends** or **private**, what stops showing it — and *when*?

**Status:** 8 of 9 surfaces close immediately. **1 does not close at all.**
**Measured 2026-08-15** against production `jtdtehuqtinjxropkkcn`. Nothing below is inferred from design documents; each row names how it was established.

---

## The one that does not close

**A photograph's CDN URL keeps working for everyone, forever, no matter what the post's privacy says.**

Measured, not assumed: from `https://example.com` — an unrelated origin, no login, no cookies, `credentials: 'omit'` — a production post photograph loaded in full at **1440×960**. The same URL is what the app puts in `posts.image_urls`.

**Why it is harmless today:** all 210 posts are `public` (verified: `SELECT privacy, count(*) FROM posts` → `public: 210`). There is no photograph on the platform whose post says it should be restricted, so there is nothing currently being leaked.

**Why it must be closed before B5 finishes:** the day a member sets one post to *friends*, the database will correctly hide the post everywhere — and the photograph will still be fetchable by anyone who has, or can guess, the link. The member will believe they have restricted it.

**Partial mitigation already present:** URLs carry a random segment (`1786632866821-bt7qmx55oii`), so they are not enumerable. That is obscurity, not authorisation — a shared or leaked link works forever.

**Also measured:** a cross-origin `fetch()` of the same URL from `example.com` **fails** (no CORS headers for foreign origins), while `<img>` loading **succeeds**. So scripts on other sites cannot read the bytes, but any person or page can still *display* the photograph. For a privacy guarantee, displaying is the thing that matters.

---

## The mechanism that makes the other eight immediate

Three facts, each read from the live catalog:

1. **`posts.is_public` is a GENERATED column** — `(privacy = 'public')`. It cannot drift from `privacy`, because it is not stored independently; it is recomputed on every write.
2. **Row-level security on `posts` is `can_view_post(auth.uid(), user_id, privacy)`** — evaluated per query, against the row's *current* privacy. There is no cached copy to invalidate.
3. **The four read RPCs are `SECURITY DEFINER`**, so RLS does *not* apply inside them and they carry their own predicate. All four were read and all four filter on the current value:

| Function | Its own privacy predicate | Agrees with `can_view_post`? |
|---|---|---|
| `feed_candidates` | `p.is_public` for the open pool; a separate `p.privacy = 'friends'` branch | Yes |
| `get_feed_candidates` (legacy) | `p.privacy = 'public' OR p.user_id = auth.uid()` | Yes, more conservative |
| `global_search` | `p.privacy = 'public'` | Yes, more conservative |
| `global_search_hashtags` | filters on privacy | Yes |

⚠ **Recorded as a maintenance risk, not a defect:** the same rule is now written in five places (one function + four predicates). They agree today — verified line by line. Nothing forces them to keep agreeing. A future cycle should make the RPCs call `can_view_post` so there is one implementation, and the divergence becomes impossible rather than merely absent.

---

## The matrix

Flip direction: **public → friends** or **public → private**. "Immediate" means the next query returns the new answer; there is no cache to wait for.

| # | Surface | Closes? | When | How this was established |
|---|---|---|---|---|
| 1 | Feed | Yes | Immediate | `feed_candidates` filters `is_public` (generated) + a friends branch |
| 2 | Profile | Yes | Immediate | Plain PostgREST read of `posts` → RLS `can_view_post` |
| 3 | Wall | Yes | Immediate | Plain PostgREST read → RLS |
| 4 | Search | Yes | Immediate | `global_search` requires `privacy = 'public'` |
| 5 | Trending | Yes | Immediate | Plain PostgREST read → RLS |
| 6 | Direct post URL | Yes | Immediate | Plain PostgREST read → RLS; a non-viewer gets zero rows |
| 7 | Notifications | Yes | Immediate | Notification rows carry ids, not photographs; opening one re-reads the post through RLS |
| 8 | Competition | Yes | Immediate | Competition entries are a separate table with their own policies; post privacy is not involved |
| 9 | **Media URL (CDN)** | **NO** | **Never** | **Measured: loads from an unrelated origin with no credentials** |

---

## What closing row 9 requires

This is the part that cannot be done quietly, and it is why it is written down rather than attempted.

**The change:** photographs stop being world-readable and are served only to viewers the database would allow — short-lived signed URLs minted per viewer, per photograph.

**Why it is a coordinated change, not a patch.** Three things must move together, and any one of them alone breaks the site:

1. an edge function that checks `can_view_post` and mints a short-lived signed URL;
2. the app asking for signed URLs instead of using stored public ones;
3. the R2/CDN configuration refusing unsigned requests.

Do (3) first and **every photograph on the live site goes blank**. Do (1) and (2) without (3) and nothing is actually protected. The third lives in the Cloudflare zone — **outside this repository, where no test here can see it change**. That is trap #1 of this program: the zone rules have moved once before without any code changing.

**Cache invalidation on a privacy flip.** Even after signing, anything already cached at the edge under a public URL stays servable until it expires. So the flip must also purge that photograph's cached copies, or signed URLs must be short enough that the stale window is acceptable. This is a decision, not a detail: it sets how long "I made it private" can remain untrue.

**Cost note recorded, not decided:** signed delivery removes the edge's ability to serve one cached copy to everyone, which changes CDN economics. The plan already flags CDN economics as an open item in Phase C.

**Recommendation:** treat this as its own cycle with an explicit owner GO, sequenced *after* the client switch (B5-4), so that steps 1–3 can ship in one coordinated release with the old public path still available as an instant fallback. Attempting it before the switch means changing two delivery paths at once.

**Interim honesty:** until that cycle ships, the platform should not describe *friends* or *private* as hiding the photograph itself — only the post. Today no member is affected, because no member has set a post to anything but public.
