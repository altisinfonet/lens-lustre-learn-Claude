# EXCELLENCE & TESTIMONIALS — WHY NOTHING SHOWS

**Date:** 2026-08-25 · **Screen:** Admin → Excellence (`src/components/admin/AdminExcellence.tsx`, 428 lines)
**Status:** analysis only. Nothing changed on either database or in any branch.
**Method:** every claim below is either a code reference or a query run against the production database.

---

## THE HEADLINE

The feature is **half-built, not broken**. The admin screen writes correctly to real tables.
There is **no consumer anywhere** — no page, no component, no route, no edge function reads any
of it back. The owner's words, "no where is showing", are literally accurate.

Production, measured:

| | |
|---|---|
| `certificate_testimonials` rows | **0** |
| certificates flagged `is_featured` | **0** |
| certificates with a `featured_quote` | **0** |
| `certificate_tiers` site setting | **never saved** |

Nobody has used it, which is consistent with there being nothing to look at afterwards.

---

## 1. NO CONSUMER — the "nowhere is showing" complaint

Searched the whole of `src/` for every field this screen writes:

```
is_featured / featured_quote / featured_order   → only AdminExcellence.tsx
certificate_testimonials                        → only AdminExcellence.tsx
certificate_tiers                               → only AdminExcellence.tsx
```

⚠ The other `is_featured` matches in the codebase (`useCourses.ts`, `Courses.tsx`) are the
**courses** table — a different feature with a coincidentally identical column name. Easy to
mistake for a consumer; it is not one.

There is no `/excellence`, `/testimonials` or `/wall` route in `App.tsx`. `Winners.tsx` does not
mention testimonials or featured certificates. The `dashboard-init` edge function — which
pre-seeds most public caches — was read in full: it never mentions certificates or testimonials.

**So the admin screen writes into a void.** That is one missing piece of work, not a bug to fix.

---

## 2. A PUBLIC WALL IS BLOCKED AT THE DATABASE — but only partly

Tested by becoming `anon` (a logged-out visitor) against production:

| Read as a logged-out visitor | Result | |
|---|---|---|
| `profiles_public_data` | **103 rows** | ✅ names and avatars available |
| a **visible** testimonial | **visible** | ✅ |
| a **hidden** testimonial | **not visible** | ✅ `is_visible = true` policy works |
| `certificates` | **0 of 23** | ❌ **blocked** |

The visible/hidden probe was done by inserting two testimonials inside a transaction and rolling
it back — production ended with 0 testimonials and 23 certificates, unchanged.

**What this means concretely:**

- A public **testimonial wall is buildable today** — quote, member name, avatar and photo are all
  readable by a logged-out visitor.
- The **certificate title** shown beside a testimonial is **not** readable.
- A public **featured-certificates wall cannot work at all** as designed. `certificates` is
  readable only by an admin or by the owner of that certificate.

⚠ **Do not fix this by opening a public SELECT policy on `certificates`.** That table carries
every member's full certificate history. The pattern already used here is a `SECURITY DEFINER`
function exposing only the intended columns — `verify_certificate` does exactly that today.

**Worth noting rather than acting on:** `has_table_privilege('anon', 'profiles_public_data',
'SELECT')` returns false, yet anon reads 103 rows. The privilege function and the real behaviour
disagree. The behaviour is what matters and it was tested directly — but it is a reminder that
grant introspection is not proof.

---

## 3. THE RECIPIENT LOOKUP — the "typing name / smart feature" complaint

```ts
// AdminExcellence.tsx:145
const { data } = await supabase.from("certificates")
  .select("id, title, user_id")
  .ilike("title", `%${q}%`)
  .limit(1);
```

Four separate problems in one line:

1. **It searches the certificate TITLE, not the member's name.** Typing a person's name finds
   nothing at all, because names are in `profiles`, not in `certificates.title`. This alone
   explains "typing name came and smart feature not there".
2. **`.limit(1)`** — of every matching certificate it takes one, silently. Identical to the
   defect fixed in the certificate recipient search on 2026-08-25.
3. **No typeahead.** It only runs when a button is pressed; there is no debounce, no list of
   candidates, no email to tell two same-named members apart.
4. **No disambiguation on save.** `saveTestimonial` reads `user_id` off whichever certificate was
   resolved, so a wrong match attaches the testimonial to the wrong member with no warning.

**This is already solved elsewhere.** `admin_search_certificate_recipients(_query, _limit)` was
built for the certificate screen: it returns every match with the email attached and a true total,
and the UI has the debounce and out-of-order guard. The work here is to reuse it, not invent it.

---

## 4. FOUR WRITES THAT NEVER CHECK WHETHER THEY WORKED

| Function | Line | What it does wrong |
|---|---|---|
| `updateQuote` | 138 | No error check at all. A failed quote save is completely silent. |
| `deleteTestimonial` | 174 | No `.select()`, no error check, then an unconditional "Deleted" toast. |
| `toggleTestimonialVisibility` | 182 | No error check **and** it updates local state optimistically — so a failed toggle looks like it worked until the page is reloaded. |
| `toggleFeatured` | 129 | ✅ checks its error. |
| `saveTestimonial` | 159 | ✅ checks its error. |

`toggleTestimonialVisibility` is the worst of the three: the other two fail silently, this one
actively shows the admin a false success.

The confirm dialog **is** correctly mounted on this screen (verified — one `useConfirmAction`,
one `<ConfirmDialog>`), so this is not a repeat of the certificate delete bug.

---

## 5. THE LIST GOES STALE WHEN YOU DELETE THE LAST ITEM

```ts
if (testData && testData.length > 0) { … setTestimonials(…) }
```

When the last testimonial is deleted, `testData` comes back empty, the branch is skipped, and
`setTestimonials` is **never called** — so the deleted row stays on screen until a reload. The
same pattern guards `certsData`. Delete the only featured certificate and it appears to survive.

---

## 6. UNBOUNDED FETCH AND A CLIENT-SIDE LEADERBOARD

`fetchAll` selects **every certificate** with no bound, then counts per user in JavaScript to
build the leaderboard and slices the top 20.

Same defect family as the admin member list and the certificate list: it relies on PostgREST's
default row ceiling, so past that point the leaderboard is computed from a truncated set and is
simply wrong, with nothing on screen saying so. At 23 certificates today it is invisible.

---

## 7. TWO ORDERING FIELDS THAT ARE NEVER WRITTEN

- **`featured_order`** — the query orders by it; **nothing in the codebase ever writes it.**
  There is no reorder control. Every featured certificate holds the column default, so the
  ordering of the wall is arbitrary.
- **`sort_order`** on testimonials — set once at insert to `testimonials.length`, never
  rewritten. After any delete the values collide, so a later insert can share a position with
  an existing row.

---

## 8. A WASTED ROUND TRIP

`toggleFeatured` calls `qc.invalidateQueries({ queryKey: ["dashboard-init"] })`. The
`dashboard-init` edge function was read in full and contains nothing about certificates or
testimonials — so every toggle refetches the entire dashboard payload for no reason.

---

## WHAT I RECOMMEND, IN ORDER

**The decision that matters first: where should this appear?** Nothing else is worth building
until that is settled, because it determines whether a `SECURITY DEFINER` reader is needed at all.

1. **Decide the destination** — a public `/excellence` page, a section on the home page, or the
   member dashboard. A logged-in-only destination avoids the `certificates` RLS problem entirely.
2. **Fix the recipient lookup** — reuse `admin_search_certificate_recipients`; search by member,
   not by certificate title. Small, self-contained, and fixes the complaint directly.
3. **Fix the four silent writes and the stale-list guard.** Small, mechanical, low risk.
4. **Build the public surface** — with a `SECURITY DEFINER` reader if the destination is public,
   modelled on `verify_certificate`.
5. **Bound the fetch and move the leaderboard into SQL** — the same treatment the member list and
   certificate list already had.
6. **Add a reorder control**, or drop `featured_order` and order by `issued_at` so the code and
   the schema stop disagreeing.

Items 2, 3 and 6 are worth doing regardless of the answer to item 1.
