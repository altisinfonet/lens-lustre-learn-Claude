# Unbounded Query Ceilings — the member-facing read path (Phase C)

**Question:** on the screens a member actually opens, which queries have no upper limit on how much they return — and what is the ceiling when there is one?

**Answer:** of 39 unbounded row-returning queries in the hot path, 18 are bounded by the page they belong to, and 21 are not. Of those 21, **most are bounded by their own nature** — a config table of six rows, one member's devices, 24 hours of one member's stories. **Three are not bounded by anything**, and one of those has a ceiling the schema itself sets at ten thousand.

Measured 2026-08-15 against production `jtdtehuqtinjxropkkcn` and the repository at `f781c1d`. Nothing was changed.

**Today none of this hurts.** The heaviest member follows 66 people and has 27 friends; the most-reacted photograph has 14 reactions; the largest album holds 5 photos. This is a record of ceilings, not of symptoms.

---

## The three with no ceiling

### C1 — `friendships`, read **twice** on every feed load, against a schema limit of 10 000

`src/hooks/feed/useFeedQuery.ts:31` and `:204`. Two separate unbounded reads of the same table per feed load:

- **:31** (`fetchRelevantUsers`) pulls every accepted friendship the member has, in order to label posts `is_suggested` — a single boolean per post.
- **:204** pulls every friendship of *any* status, so the "Add friend" button is not offered to someone a row already exists with.

`check_friend_limit()` raises at **10 000 friends** — the platform's own stated maximum. So the designed worst case is up to 10 000 rows fetched twice, on every feed load, to compute one flag per post and one button state.

Measured today: the busiest member has **27** friends. Three orders of magnitude of headroom, and nothing in the code that notices when it closes.

**Why this is not fixed here.** The obvious repair — add `.limit(...)` — is the wrong one: a member past the limit would have posts silently mislabelled and the Add-friend button silently wrong. That is precisely the silent truncation this project forbids. The right repair moves the labelling into the feed RPC, where the comparison happens next to the data instead of being shipped to a phone. That is a design change with its own GO, not an audit edit.

### C2 — `follows`, read on every feed load, with no limit anywhere

`src/hooks/feed/useFeedQuery.ts:29`. Every row where the member is the follower, unbounded. Unlike friendships there is **no cap in the schema at all** — no trigger, no constraint. A member who follows 50 000 accounts fetches 50 000 rows before the feed renders.

Measured today: heaviest is **66**.

### C3 — `post_reactions` on a photograph's own page, unbounded

`src/pages/PostDetail.tsx:87` selects `reaction_type, user_id` for every reaction on the post — then uses them to compute two things: how many of each reaction there are, and whether *this* member reacted. Both are single values. On a photograph with 50 000 reactions, 50 000 rows cross the network to produce a count and a boolean.

Measured today: the most-reacted photograph has **14** reactions; the average is 4.8.

This is the one that scales with *success*. It costs nothing until a photograph does well, and then it costs most on exactly the page people are sharing.

---

## The eighteen that are already bounded, and why

Each is filtered with `.in(...)` against a list that is itself a page — the ten post ids the feed just returned, the comment ids on screen. They cannot exceed the page that produced them, so they need no limit of their own. Recorded because the reason lives in the calling function, not in the query, and that is exactly the knowledge that gets lost.

## The eighteen with no limit that do not need one

| Query | What bounds it |
|---|---|
| `stories` ×4 (feed bar, profile) | `expires_at > now()` — at most 24 hours of one member's stories. Live today: **2** in total |
| `highlights`, `featured_photos`, `photo_albums`, `album_photos` | one member's own curation. Largest album today: **5** photos; most albums: **3** |
| `user_devices`, `user_roles`, `scheduled_posts` | one member's own rows. **1** scheduled post exists platform-wide |
| `badge_definitions` (6 rows), `role_display_config` (7), `hero_banners` | admin-curated config tables that do not grow with membership |
| `post_tags` on a post card | one post's tags. Most tags on any post today: **1** |

---

## One latent trap, not currently reachable

`src/components/CommentsSection.tsx:107` builds its query and then applies the filter **conditionally**:

```ts
const query = supabase.from("comments").select(...).order(...);
if (articleId) query.eq("article_id", articleId);
if (entryId)   query.eq("entry_id", entryId);
const { data } = await query;
```

Rendered with neither prop, it reads **every comment on the platform**. Both call sites pass one (`JournalArticle.tsx:506` passes `articleId`, `EntryDetail.tsx:394` passes `entryId`), so the path is unreachable today — verified, not assumed. It is recorded because the component takes both props as optional and the third caller is the one that will not.

---

## Recorded against myself: this scan was wrong four times before it was right

The first pass reported 154 unbounded queries. That number was wrong, in the alarming direction each time:

1. **`count: "exact", head: true` counted as unbounded.** Twenty queries that return a *number and no rows at all* were flagged as pulling whole tables — including two on the home page. A count query is the opposite of an unbounded read.
2. **`.limit()` applied to a reassigned variable was invisible.** `TagPeopleModal` builds `let filtered = supabase.from(...)`, adds a search filter, then awaits `filtered.order(...).limit(30)`. The limit is there; it is just not in the same expression. Reported as "reads the whole member directory to tag someone" — it does not.
3. **Filtered-by-owner treated as unbounded.** A query filtered to one member's own rows has a ceiling; it is just not written as a number. Lumping those with genuine whole-table reads made 154 look like a catastrophe.
4. **Pagination in a wrapper missed.** `useUserPostsQuery` paginates properly at `PAGE_SIZE = 10` with a cursor; its `.in("id", sharedIds)` is bounded by that page.

The scanner now excludes `head: true`, follows a builder assigned to a variable, and separates *page-bounded* from *no ceiling*. **Every number in this document comes from the corrected scan.** The earlier one is written down because the corrected scanner is the deliverable, and a scanner that has never been wrong is a scanner nobody has checked.

---

## Recommendation

1. **C3 first**, because it is the cheapest and scales with success: replace the reaction fetch on a photograph's page with a count plus a single "did I react" lookup. Nothing about the page changes; the payload stops tracking popularity.
2. **C1 and C2 together, as a design cycle**, moving network labelling into the feed RPC. Not a `.limit()` — see above.
3. **Neither is urgent at 94 members**, and this document should not be read as saying otherwise. It exists so the day they matter is a day somebody chose, rather than one that arrives as "the app got slow."

**Nothing was changed by this audit.** A source scan and eight counting queries.
