# F-98c — named exceptions to "every visible member name is a link"

The rule this register qualifies is the Auditor's acceptance criterion, stated
2026-09-05 and unchanged since:

> Not how many links a page has, but **is every visible member name a link**,
> enumerated by name, on the rendered page, against the real member list.

Everything below is a name that is deliberately **not** a link. Each one is
written down for one reason: an unrecorded exception is rediscovered as a new
P0. F-98 was filed three times before anyone noticed the sidebar was the same
defect as the feed.

An exception is only an exception if a machine can see it. Every case below
either carries `data-unlinked="deliberate"` in the DOM or is listed here by
route and RPC. `deliberate` means somebody answered the question; `missing`
means nobody did, and `missing` is always a defect.

---

## 1. A member's own name, on their own page

| Site | Marker |
|---|---|
| `src/pages/PublicProfile.tsx:650` | `handle={null}` → `data-unlinked="deliberate"` |
| `src/pages/PublicProfile.tsx:795` | `handle={null}` → `data-unlinked="deliberate"` |
| `src/pages/Dashboard.tsx:255` | `data-unlinked="deliberate"` on the `<h1>` |

Linking a member to the profile they are already looking at is not a
destination. **This affects the Auditor's own measurement**: a scan that asks
only "is this name inside an anchor" will count these as dead on `/dashboard`
and on every member profile, for ever. The measurement must exempt
`data-unlinked="deliberate"`, exactly as
`docs/evidence/d2/F-98b/deadnames.prepared.mjs` does, or the table can never go
clean. This is the sixth dead name the Auditor counted on `/dashboard` and on
`/owen.blake`.

## 2. Admin-only screens

Auditor's recommendation, 2026-09-05, adopted here verbatim: out of scope for
the member-facing rule, and **recorded rather than merely omitted**.

These five functions return member names with no `custom_url`, and the screens
that render them are behind an admin role:

- `admin_search_users`
- `admin_search_users_v2`
- `admin_search_certificate_recipients`
- `search_profiles_admin`
- `get_profile_admin`

`src/components/admin/AdminUsers.tsx` and
`src/components/admin/AdminCommentReports.tsx` therefore still use the
`useMemberHandles` batched bridge. That bridge was **withdrawn from every
member-facing surface** in F-98c because the handle now travels with the name;
it survives here only because these five signatures were not in scope of the
Auditor's cross-lane grant.

If an admin screen is ever opened to non-admins, this exception dies with it.

## 3. Awaiting the Owner's ruling — not an exception yet

**The story-ring name.** `src/components/feed/FeedStoriesBar.tsx:384` renders a
member's name in a bare `<span>` inside a `<button>` that opens the story. A
story ring arguably *should* open the story rather than the profile. Neither D2
nor the Auditor is calling this red without the Owner's word.

The ruling now has a price attached, and he should decide with it in front of
him: `get_feed_stories_bar` is declared

```
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, is_official boolean,
              latest_story_at timestamptz, story_count integer, has_unseen boolean)
```

so if he wants the name to link, **the RPC signature changes** — a drop and
recreate like `get_todays_birthdays` in
`supabase/migrations/20260910_0013_f98c_birthdays_carry_handle.sql` — not just
the markup. This is source SEVEN of F-98c and it is unfixed by design.

## 4. Structurally incapable of carrying the defect — verified, leave alone

`get_top_contributors_v1`, `_v2`, `_v3` and `get_contributor_scores` return ids
and scores and no name at all. `SidebarTopContributors.tsx` joins the name on
the client and wraps it in `ProfileLink handle={c.custom_url}` (43-45) and
`UserIdentityBlock handle={c.custom_url}` (59-62). Verified green by the Auditor
in the same catalogue pass.

---

## Correction on the record — the Auditor's, in his words

> "I previously recorded seven RPCs as CARRYING custom_url via the _v2 pattern
> and named these among them. I was wrong about ALL SEVEN. Not one carries it.
> `admin_search_users_v2` does exist and the _v2 added total_count, not a
> handle. I inferred a pattern from a suffix instead of reading the signatures."

Recorded here under his name at his instruction. It matters beyond bookkeeping:
`src/hooks/profile/useMemberHandles.ts` carried a header listing those seven as
"RPCs that will return custom_url once D1 widens them". That header was written
on the same wrong premise and would have had the next person waiting for a
change that was never coming.

---

## 5. Closed green — traced on the rendered page, NOT a defect

**"50mm Retina World links in some places and not others on /feed."**

This sat on the open list all day and it comes off it. Traced by the Auditor on
the rendered page at `5d7bde9`, not in source: four occurrences of that exact
string on `/feed`, carrying **three different meanings**.

| # | Element | State | What it is |
|---|---|---|---|
| 1 | `SPAN` inside `A href="/home"` in `NAV.sticky` | visible, 133×20 | the site brand — correctly goes home |
| 2 | `SPAN.lg:hidden.pointer-events-none`, same nav | `display:none` at this width | a phone-width duplicate of the brand; not rendered, so it cannot be a dead name |
| 3 | `A.text-sm.font-semibold.hover:text-primary href="/50mm.world"` | visible | the official **account** as a post author — correct |
| 4 | `SPAN.text-sm.font-semibold`, no link | visible | the **ad header** from `AdZone.tsx`; the sibling text beneath it reads "Sponsored" |

Three of the four are *supposed* to behave differently from one another. An
advertiser's label is not a member link.

It is written down here rather than merely deleted from the list, because
"the same name links here and not there" is the exact shape of the real defect
this whole day was spent chasing. Left unrecorded, the next person spends an
hour on it — or, worse, "fixes" it by making an advertiser's label link to
somebody's profile.
