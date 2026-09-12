# F-98c — C-34 plant register

> C-90: no green from you or me counts as evidence until someone has
> deliberately broken the instrument and watched it fail.

Run 2026-09-05 by `plants.sh`, against the committed tree. Each plant
reintroduces exactly one of the six sources and is restored immediately.

| Plant | What it reintroduces | Instrument | Result |
|---|---|---|---|
| CONTROL | — | server rule / tree-wide / notifications | 7 / 11 / 12 pass |
| **1** | `custom_url` removed from the Q11 select | server rule | **1 failed** |
| **2** | milestones literal drops `custom_url` | server rule | **1 failed** |
| **3** | `get_todays_birthdays` loses `custom_url` | server rule | **1 failed** |
| **4** | photographer select narrowed to `id, full_name` | server rule | **1 failed** |
| **5** | winners literal drops `user_custom_url` | server rule | **1 failed** |
| **6** | `/notifications` name back to a bare span | tree-wide rule | **11 PASSED — did not see it** |
| **6** | same plant | notifications page test | **2 failed** |
| RESTORED | — | all three | 7 / 11 / 12 pass |

## Plant 5 is the one that matters most

Nothing was queried wrongly in the winners row. The handle was already in the
variable — two properties were read off `profiles[e.user_id]` and the third was
not. **A select-only rule passes this plant.** It is caught only because rule B
walks object literals that put a name on the wire, brace-matched, including the
shape where the key is `user_name` and the name is *read off* another object.

That rule was itself vacuous when first written: its pattern walked dotted
paths only, so `profiles[e.user_id]?.full_name` — a bracket index — was
invisible to it. It passed on the real file while structurally unable to see
source 5. Found by the self-test written beside it, not by reading it.

## Plant 6 is the answer to "what is the source-side rule's exact failure mode"

**It cannot see `/notifications`. Demonstrated above: 11 passed with the defect
planted.** Two independent reasons, either alone sufficient:

1. `nameAlwaysLinksToHandle.test.tsx:83` — `SURFACES` is a **hand-written list
   of eight files**. `Notifications.tsx` is not among them, and a page not on
   the list cannot fail the rule. This is the same fault that missed the
   sidebar in F-98b, one file over: C-87.
2. Even adding it would not work. The rule never reads a page's markup. It reads
   the page's `.select("…full_name…")` string and renders `UserIdentityBlock`
   from the projected row. `Notifications.tsx` has **no select at all** — it is
   fed by `get_my_notifications_grouped` — so `selectedColumns()` would throw
   `no profile select found`. The rule is structurally incapable of covering an
   RPC-fed page.

The page-specific test catches it (2 failed). That is the distinction worth
recording: **the class-wide rule missed it and an instance-specific test caught
it**, which is precisely backwards from what a guard is for.

## Earlier plants, same feature, kept for continuity

| Plant | Effect | Result |
|---|---|---|
| AE | `FeedRightSidebar` handle stripped | probe: 9 live, **3 dead**, named |
| AF | `ActorPhrase` href forced null | both notification tests RED |
| AG | `/profile/${id}` fallback restored | id assertion RED at 1 |

## Instruments found broken this session, published rather than hidden

1. **The local harness had been booting crippled all session.** The client reads
   `VITE_SUPABASE_PUBLISHABLE_KEY`; I was setting `VITE_SUPABASE_ANON_KEY`. It
   threw `supabaseKey is required` and the scene index rendered a subset — 13
   scenes instead of 42. Every probe number reported earlier in the session was
   measured against a broken harness. This is F-90, explained.
2. **The probe printed nothing for a scene that rendered nobody**, so a scene
   dropping out of coverage looked identical to a scene passing. Two runs
   against the same commit read 82 live and then 47; only diffing them by eye
   caught it. Scenes now report `EMPTY` and `UNMEASURED`.
3. **Rule A read my own comment as code** — `// F-98c — was .select("id, full_name").`
   A scanner that reads the explanation of a fix as the fault it describes will
   cry wolf for ever. Comments are blanked position-preserving now. The Auditor
   withdrew his own v1 id-link scanner for this same fault the same day.
4. **Rule C read the quoted old signature** out of the new migration's header.
5. **Rule B was vacuous on source 5** — see above.
6. **A static per-page import-closure scan was discarded, not reported.** It
   could not tell `file.name` from a person's name and put `logger.ts` and
   `imageUpload.ts` at the top of its findings.
7. **The sweep is intermittent and its numbers are not published.** The run of
   2026-09-05 17:0x read `15 live, 0 dead across 47` with `screen-wall`,
   `screen-wall-about`, `screen-wall-visitor` and all five new screens
   `UNMEASURED` — scenes that read 7 live an hour earlier. An intermittent
   instrument is not an instrument. The settle condition has been rebuilt to
   settle on the PAIR (member names, live links), because a name renders as
   text first and becomes a link when its handle arrives: the name count never
   changes across that transition, so a scene could be sampled with every name
   correct and dead. Not yet re-run to a clean result; **no number from it is
   claimed.**
