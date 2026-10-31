# Item 5 — the person in a people list is a link again — D2, 2026-09-07

**Branch:** `d2/preview-a11y-four-20260907`, second commit, on top of the four-item commit `857b601`.
**Reported by:** the Auditor, from live Chromium checks on the deployed preview at **both** `75f14f80` and `0e30d46e`: in "People You May Know" the name and avatar are not links; walking up from the name text to the row container finds **zero anchor tags**; only Add Friend/Add and Remove are interactive; clicking the name leaves `location.href` unchanged. **Predates the four-item work — not a regression.**
**Classification:** VERIFIED (real Chromium, the repository's own harness, real screens). The Auditor re-verifies against the deployed preview.

---

## 1. The rows were never missing a wrapper

This is the part worth getting right before reading anything else, because "wrap the name and avatar in a real link" describes a fix that is already in the source.

`DiscoverCard` has always wrapped the avatar in `ProfileLink` and the name in `UserIdentityBlock`. `FeedRightSidebar` does the same. Neither can emit an `<a>` without a **handle**:

```
ProfileLink.tsx:45   const href = memberPath(handle);
ProfileLink.tsx:46   if (!href) → renders a <span data-unlinked="…"> instead
urlHelpers.ts:26     memberPath(h) → h ? `/${h}` : null
```

and that is deliberate: F-95 forbids the app from generating `/profile/<id>`, and `src/__tests__/noProfileIdLinks.test.ts` enforces it across the whole of `src`. So an id-based fallback is not available and was never the fix.

**The handle is what never arrives.** `ProfileLink` already distinguishes the two cases in the DOM — `data-unlinked="deliberate"` for a caller that stated `null`, `data-unlinked="missing"` for nobody having supplied one — and every unlinked name on both surfaces is marked **`missing`**. That marker is what turns "no link" into a cause.

Two different sources fail to deliver it, for two different reasons.

---

## 2. `/discover` — the page never asked for the column

```
Discover.tsx:80   .select("id, full_name, avatar_url, bio, photography_interests, created_at")
```

No `custom_url`. `profiles_public_data` carries it (`types.ts:4097`), `DiscoverCard` accepts it and passes it to both link sites — the page simply never requested it, so every card received `undefined`.

It stayed legal because the card's own type said it was optional:

```
custom_url?: string | null;      ← a whole page of dead names, and it typechecks
```

**Fix:** the column is selected, and the field is now **required** (`custom_url: string | null`). A caller that cannot supply a handle has to write `null` — which `ProfileLink` records as a decision rather than an omission, and which someone has to type on purpose.

---

## 3. The sidebars — the server does not send it, and three comments say it does

`FeedRightSidebar`, `FeedFriendSuggestions` and `FeedLeftSidebar`'s milestones read `sidebarData`, which is the `dashboard-init` payload. In **this tree, on this branch**:

| what | where | carries `custom_url`? |
|---|---|---|
| Q11, the suggestion/milestone pool | `dashboard-init/index.ts:187` — `.select("id, full_name, avatar_url, created_at, date_of_birth")` | **no** |
| the suggestions literal | `index.ts:452` — `{ id, full_name, avatar_url, mutual_count }` | **no** |
| `custom_url` anywhere in that file | lines **483** and **503** only — the `profiles` map, keyed by `uniqueUserIds` | viewer + winners only |
| are suggestion ids in `uniqueUserIds`? | `index.ts:466-474` adds the viewer and the winners, nothing else | **no** |
| birthdays | `get_todays_birthdays`, recreated with `custom_url` by `20260910_0020_f98c_birthdays_carry_handle_and_close.sql`, in this tree | **yes** |

### The Standing Rule 21 finding

Three comments in files this lane owns assert, as fact, a server change that is not in the tree they sit in:

- `src/hooks/profile/useMemberHandles.ts` — "suggestions, milestones — dashboard-init/index.ts — Q11 select + both object literals now carry custom_url"
- `src/components/feed/FeedFriendSuggestions.tsx:86-96` — "The server now carries custom_url in the row (dashboard-init/index.ts suggestions literal), so the bridge is withdrawn"
- `src/uiharness/fixtures.ts` — "the server was fixed at the source: the Q11 select now asks for custom_url and both literals carry it. A fixture's only job is to be the shape production sends, so it changed with production."

That change exists on **staging**. It is not on the promotion branch. So on 2026-09-05 the `useMemberHandles` bridge was withdrawn from four member-facing lists on the strength of a fix that has not arrived here, and the fixture was widened to match a server this branch does not ship. An instructing comment is a control; a comment that disagrees with the code beside it is a finding. The three comments are corrected in place, each stating what was checked and where.

**`supabase/functions/**` is not this lane's and has not been touched.** The remedy there is two words — `custom_url` in the Q11 select and in the suggestions literal — and it belongs to D1. When it lands, the client fix below goes quiet on its own; nothing has to be removed.

### The client fix, and why it is not the "two mechanisms" the Auditor ruled out

His objection to the bridge was **drift**: two independent sources for one handle eventually disagree. `useRowHandles` (new, beside the existing hook) asks only about rows whose own source sent **nothing**:

```ts
const missing = rows.filter((r) => r.custom_url === undefined).map((r) => r.id);
const bridged = useMemberHandles(missing);
return (row) => row.custom_url !== undefined ? row.custom_url
              : bridged.has(row.id) ? bridged.get(row.id)
              : undefined;
```

There is nothing to drift from: where the server carries the handle, the row is passed through untouched, the id set is empty, `useMemberHandles` issues no request, and the whole thing costs one comparison per row. It is a fallback that disappears the moment the designed path works. `undefined` is preserved while the lookup is in flight, so a row reads "nobody has decided yet" rather than "decided: no link" for those frames.

Applied to `FeedRightSidebar` (the surface in the order), `FeedFriendSuggestions` (the app's own copy of the same widget — it returns `null` on web, which is why Chromium could not reach it, but it reads the same rows) and `FeedLeftSidebar`'s milestones (**not in the order**, measured dead by the same probe on the way past, same payload, same Q11 select; stated here rather than slipped in). **Birthdays are deliberately left alone** — their source really does carry the handle, and bridging them would be the second mechanism for no gain.

---

## 4. Two instruments were lying, and both are fixed

Neither surface could have been caught here, and that is its own finding.

**a. The fixture was more generous than the server.** `fixtures.ts` gave `suggestions` and `milestones` a `custom_url` the edge function does not send, so `screen-feed` rendered **seven working links** in a widget the deployed build renders with **none**. A fixture that is more generous than production is not a safe fixture; it is a blindfold. Corrected to the literal at `index.ts:452`, with the check below to stop it drifting again.

**b. The harness ignored `select` entirely.**

```
fixtureRoutes.ts:262 (before)
  function narrow(rows, params) { return limit === 1 ? rows.slice(0,1) : rows; }
```

Every table read handed back the whole fixture row whatever the page had asked for — so `/discover`, which forgets `custom_url`, rendered two working links per row here while the live page rendered zero. The instrument could not have failed on the fault it exists to catch: a C-34 failure of the instrument itself. `project()` now applies the select, conservatively — a select containing `*` or an embedded resource (`posts(id,title)`) is left alone rather than approximated, on the same principle `applyFilters` already states, and `alias:column` is projected under the alias.

That change alone re-exposed item 5a. The whole suite is unaffected: 2549 tests pass.

---

## 5. The checks, and both runs

**`tools/uishot/profile-links-in-people-lists.mjs`** — real Chromium, both surfaces, plus a page-wide sweep for any name still rendering unlinked. Non-zero exit if a people row renders a name that cannot be clicked.

| | before | after |
|---|---|---|
| `/discover` row | **0 anchors**, 12 spans marked `missing` | **2 anchors** per row (`/ranjana`, `/liwei`, …), 0 unlinked |
| People You May Know row | **0 anchors**, 9 spans marked `missing` | **2 anchors** per row, 0 unlinked |
| every unlinked name anywhere on `/feed` | **10** | **0** |
| checks failing | **4** | **0** |

Both transcripts: `2026-09-07-item5-before.txt`, `2026-09-07-item5-after.txt`. Only the six product files changed between the two runs; the two harness corrections were present in both, or neither surface could have failed here at all.

Every href is the handle form `/<handle>`; the probe asserts none is `/profile/<id>`, so F-95 is checked in the same breath rather than assumed.

**`src/components/__tests__/PeopleListsAreLinked.test.ts`** — 8 assertions, **6 red on the unfixed sources**, 8 green after. The one worth naming is the fixture-agreement check: it reads `dashboard-init/index.ts` (reading is not touching) and asserts the fixture carries a handle **if and only if** the server does — so whichever way the server goes, the fixture has to follow, and the next person is told rather than left to find it live. It failed before in the direction "this fixture is more generous than production, which is what hid item 5".

**Regression:** the four-item probe re-run after these changes — **ALL FOUR CLEAR**, including item 2's F-109 rect check, which still finds 7 links in the widget and 0 overlaps.

**Whole suite:** 185 files passed, 1 skipped, **2549 passed, 0 failed**. **`tsc -b tsconfig.json`:** exit 0. **ESLint on every touched file:** 32 problems before, 32 after — none added; both new files clean.

---

## 6. Paths touched

```
src/pages/Discover.tsx                          5a — select custom_url, and type it
src/components/discover/DiscoverCard.tsx        5a — the handle is no longer optional
src/hooks/profile/useMemberHandles.ts           useRowHandles + the corrected header
src/components/FeedRightSidebar.tsx             5b — the widget in the order
src/components/feed/FeedFriendSuggestions.tsx   5b — the app's own copy of it
src/components/FeedLeftSidebar.tsx              milestones, measured dead in passing
src/uiharness/fixtures.ts                       the fixture matches the server again
src/uiharness/fixtureRoutes.ts                  the harness honours `select`
src/components/__tests__/PeopleListsAreLinked.test.ts    new
tools/uishot/profile-links-in-people-lists.mjs           new
docs/evidence/d2/preview-a11y/2026-09-07-item5-*         new
```

Nothing under `supabase/**` (read only, never written), `scripts/db-*.mjs`, `scripts/lane-config.*`, `docs/gates/**`, the ledger, or `package*.json`.

## 7. Reported, not fixed

- **D1 — two words in `supabase/functions/dashboard-init/index.ts`:** add `custom_url` to the Q11 select (`:187`) and to the suggestions literal (`:452`). Until then the client fallback above carries it, at one batched lookup per feed load; after it, that lookup asks for nothing.
- **Thirteen other `.select(...)` calls ask for `full_name` without `custom_url`** — `TagPeopleModal`, `useSearch`, `useCaptionMentions`, `MentionInput`, `ProfileActivityFeed`, `useJudgeClassicData`, `useMultiJudgeProgress`, `Referrals`, and five admin/lookup callers. Not all of them render a link, so a blanket rule is a judgement call per call-site, not a sweep to bolt on here. **There is no tree-wide check for this today** — `noProfileIdLinks.test.ts` catches the wrong *address*, nothing catches the *absent* one. That check is the real cause-level fix and it deserves its own unit and its own ruling on scope.
- **`FeedStoriesBar.tsx:384`** — the story-ring name is still a bare span inside a button, awaiting the Owner's call on whether a story ring goes to the story or the profile. Unchanged, and already on the register.
- **Push authority:** none on this side. Delivered as a patch, no push attempted.
