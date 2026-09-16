# Tagging — fixed end to end, and reopened to every member

Owner reports, 2026-08-09 → 2026-08-10:
1. *"Tag is not working on web and App on any post."*
2. *"dont open the search box below of it, open the search box small (now tooo
   big) but exactly where pointer marked, same for App also."*
3. *"anyone tag anyone. not block it by ONLY friends."*

All three done. `main` = `11f58a9`. Live on the web; the app gets it in **1059**.

---

## 1. Why tagging appeared dead — measured, not guessed

Reproduced on the live site: photo attached, tag panel opened, photo tapped.
**Measured in the page**, Chrome at a 710px viewport:

| | Before |
|---|---|
| viewport height | **710** |
| dialog height | **1020** |
| dialog top | **−155** (above the screen) |
| dialog bottom | **865** (below the screen) |
| "Search friends" input, top | **755** — 45px *below* the screen edge |
| computed `overflow-y` | **hidden** |
| computed `max-height` | **none** |

Tapping the photo did exactly what the code said: it dropped a pin and opened
the picker. The picker opened **where nobody could see or reach it**, in a
dialog that `overflow-hidden` forbade from scrolling. Nothing on screen moved,
so it looked dead — on every laptop and every phone, because the dialog is over
1000px tall and almost no viewport is.

**The corroborating negative:** the production Error Log holds **zero
`POST-2005` (POST_TAGS_INSERT_FAILED)** rows in 30 days. Nothing was refused.
Nobody could get far enough to save a tag.

### My earlier theory was wrong

I had written in two documents that tagging and the anonymous notifications were
one fault in the 2026-08-06 RESTRICTIVE RLS work. Three pieces of evidence say
no: zero `POST-2005` in 30 days; those migrations create `insert`/`update`/
`delete` policies only, never touching SELECT; and `profiles_public_data`
returns names and avatars to an *anonymous* caller, HTTP 200. A plausible story
built on a coincidence of dates. Both documents are corrected.

## 2. Three fixes, in order

### a. The dialog now fits (`2256e4b`)
`max-h-[92vh]`, `flex flex-col`, and a `flex-1 min-h-0 overflow-y-auto` body.
`min-h-0` is not decoration — a flex child defaults to `min-height:auto`, keeps
its content height, and pushes the picker straight back off the screen.

**`vh`, not `dvh`, deliberately.** `dvh` needs Chromium 108. The members hitting
these bugs run old Android WebViews — the same ones missing `crypto.randomUUID`
(Chromium 92). An unsupported unit is dropped silently, `max-height` reverts to
`none`, and the bug returns on exactly the devices it hurts most.

### b. The picker opens at the pin, small (`7b6f96b`)
The full-width panel that slid up from the dialog's foot is gone. A 230px
popover now opens at the pin:
* `clamp(120px, x%, calc(100% - 120px))` keeps it inside the photo however close
  to an edge you tap (`clamp()` is Chromium 79 — safely old);
* below 58% of the height it **flips upward**, so a pin low in the frame does
  not push the list out of sight;
* `stopPropagation` on the popover — without it every tap inside also reaches
  the photo's handler and moves the pin out from under you.

The photo box stays **square**: a pin is stored as a percentage of that box, so
changing its aspect would move every pin relative to the photo. `max-w-[60vh]`
bounds a square by height without changing its shape.

### c. Anyone may tag anyone (`58d7d4d`, `7b6f96b`, `cd05ffa`, `11f58a9`)
This needed **two** changes, and neither works alone:

* **The picker** now searches `profiles_public_data` (server-side `ilike`,
  capped at 30, excluding yourself) instead of resolving accepted friendships.
* **The database.** The gate was not a policy — it was a trigger.
  `validate_post_tag_insert` called `are_friends()` and raised *"You can only
  tag accepted friends"*, so every tag of a non-friend was refused whatever the
  UI offered. Changing only the picker would have produced a modal full of
  people and an error on every one of them.

**Consent did not disappear; it moved.** A new tag is `status = 'pending'`; the
RLS policy *"Anyone views approved tags"* keeps a pending tag visible only to
the tagger, the tagged member and the post owner; only the tagged member can
approve it; once they decline, the tagger can **never** re-tag them on that
post; no self-tagging; 20 per post. This widens who may **ask**, not who
appears. Nobody's name is attached to a photo without them pressing approve.

The migration is
`supabase/migrations/20260810120000_tag_anyone_not_only_friends.sql`. Migrations
do not auto-apply here, so it was run by hand in the Supabase SQL editor —
**"Success. No rows returned"** — and then verified:

| check | result |
|---|---|
| friend gate still present | **false** ✓ removed |
| permanent-decline guard kept | **true** ✓ |
| 20-per-post cap kept | **true** ✓ |
| INSERT policies | `Deleted accounts cannot insert \| Members create tags as themselves` ✓ both intact |
| SELECT policies | **4**, untouched ✓ pending tags stay private |

The deleted-account write lock from 2026-08-06 survived the change.

## 3. Verified live, after deploy

| | Before | After |
|---|---|---|
| dialog height | 1020 | **494** |
| whole dialog on screen | ✗ | **✓** (114–608 of 700) |
| picker location | off the bottom edge | **at the pin** |
| picker size | full-width panel | **230px** |
| who can be tagged | accepted friends only | **every member** |

Screenshotted: a pin on the photo with a compact picker under it listing real
members — Abhijeet Chakraborty, Amit Baran Sen, Anindya Phani, Anjandev
Biswas, Anusmit — none of whom are the owner's friends.

Copy corrected too: *"Tap photo to tag a member"*, and the composer button reads
*"Tag people in this photo"*.

## 4. Guards — `TagPeopleModalFits.test.ts`, 21 tests

Source-shape assertions, because **jsdom performs no layout**: `max-height`,
flexbox and viewport units resolve to nothing there, so a rendering test would
pass just as happily against the broken version. Each is tied to a specific way
the bug returns — the height cap, `vh` not `dvh`, the column layout, the
scrollable body, **`min-h-0`**, the photo cap, the square photo box, percentage
pin coordinates, the pin-anchored popover, the edge clamp, the upward flip,
`stopPropagation`, profiles-not-friendships, never offering yourself,
server-side filtering — plus five that read the **migration** and prove the
decline guard, the 20-cap, the self-tag rule and every SELECT policy survived
the change, and that it runs in one transaction.

**Mutation-checked nine ways.** Removing the height cap, swapping `vh` for
`dvh`, dropping `min-h-0`, removing the photo cap, restoring the friendships
query, allowing self-tagging, dropping the decline guard from the SQL, re-adding
`are_friends`, and parking the picker at the bottom each turn the suite red.

## 5. Verification summary

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Test suite | **967 passed**, 6 failed — the known pre-existing set (4 ProfilePhotoPrompt, 2 judging). Zero new |
| Lint | 0 errors on the changed files (one `as any` I introduced was removed rather than baselined) |
| Mutation check | 9/9 caught |
| CI | Typecheck ✅ Security ✅ |
| Byte-diff vs `origin/main` | identical, all files |
| Live measurement after deploy | dialog fits · picker at the pin · members listed |

Nothing was posted to the live site during any of this — the composer was
discarded each time.

## 6. Worth watching

Now that any member may be tagged, the **permanent decline** is the only
anti-harassment rule left in that path. It is tested and it is in the trigger,
but if tag abuse is ever reported, that is the mechanism to check first — and
the thing to strengthen would be a block list, not a return to friends-only.
