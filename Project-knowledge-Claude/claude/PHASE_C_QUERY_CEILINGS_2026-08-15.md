# Phase C — Unbounded Query Ceilings (2026-08-15)

**Commits:** `81cc443` audit · `737e339` gate (8 mutations) · `3dcd44d` evidence. Byte-identical on origin, 0 unpushed.
Suite **1,605 passed | 1 skipped**, tsc clean, security-audit PASS.

Covers the plan's "/profile unbounded queries" item, widened to the whole member-facing read path.

## Result
Of **39** unbounded row-returning queries on screens a member opens: 18 are bounded by the page that produced their id list, most of the rest are bounded by their own nature — and **3 are bounded by nothing**.

| | Query | Ceiling | Today |
|---|---|---|---|
| **C1** | `friendships` — `useFeedQuery.ts:31` **and** `:204`, read **twice per feed load** | `check_friend_limit()` permits **10 000**; both reads pull them all — one to set a boolean per post, one for the Add-friend button | heaviest member: **27** friends |
| **C2** | `follows` — `useFeedQuery.ts:29`, every feed load | **no cap anywhere in the schema** | heaviest: **66** |
| **C3** | `post_reactions` — `PostDetail.tsx:87` | every reaction on a photograph, fetched to compute a count and one boolean. **Scales with success** — costs most on the page people share | most-reacted photo: **14**, avg 4.8 |

**Not fixed here, deliberately.** `.limit()` on C1 would silently mislabel posts for a member past the limit and silently break the Add-friend button — the exact silent truncation the standing rule forbids. The repair moves the labelling into the feed RPC: a design change with its own GO. C3 is the cheap one and is recommended first (count + a single "did I react" lookup).

**Latent trap, verified unreachable:** `CommentsSection.tsx:107` applies its article/entry filter *conditionally*, so with neither prop it reads every comment on the platform. Both call sites pass one (`JournalArticle` → `articleId`, `EntryDetail` → `entryId`) — read, not assumed. Recorded because both props are optional.

## SELF-CAUGHT: the scan was wrong four times before it was right
First pass reported **154** unbounded queries. Every error ran in the alarming direction:

1. `count: "exact", head: true` counted as unbounded — **20** queries returning a number and *zero rows*, two on the home page.
2. `.limit()` on a **reassigned builder** was invisible. `TagPeopleModal` does `let filtered = supabase.from(...)` then awaits `filtered.order(...).limit(30)`. I had written down "reads the whole member directory to tag someone." It does not.
3. Filtered-by-owner lumped in with genuine whole-table reads.
4. Pagination in a wrapper missed (`useUserPostsQuery`, PAGE_SIZE 10 + cursor).

Corrected scan: **21** with no ceiling, of which 3 are real. Every number in the doc comes from the corrected scan, and all four errors are written into the gate's header — the corrected scanner *is* the deliverable, and a scanner that has never been wrong is one nobody has checked.

Also recorded: my first M7 mutation removed one directory rather than all scope, so the vacuity guard correctly did not fire and ledger-staleness caught it instead. Re-ran as M7b with all scope emptied; the guard fired as designed. A mutation log that overstates which assertion fired can't be trusted later.

## Shipped
`docs/unbounded-query-ceilings.md` · `src/__tests__/queryCeilings.test.ts` — every unbounded member-facing query must be bounded, page-bounded by `.in()`, or named in `CEILING_LEDGER` with what bounds it. *"One member's own rows"* is an acceptable answer; *"nothing bounds it"* is a finding. Carries a **positive control** on three queries bounded three different ways, because a scanner broken toward "all clear" reads exactly like a healthy codebase.

**8 mutations**, all behaved: new unbounded query CAUGHT · same with `.limit()` PASSES · ledger entry deleted CAUGHT · `head:true` exclusion removed CAUGHT (reproduced error 1) · reassigned-builder exclusion removed CAUGHT by the positive control (error 2) · doc deleted CAUGHT · one directory dropped CAUGHT by staleness · all scope emptied CAUGHT by the vacuity guard.

## Next unblocked Phase C
realtime firehose decision · CDN economics · backup/RESTORE proof (needs a branch — cost approval).
