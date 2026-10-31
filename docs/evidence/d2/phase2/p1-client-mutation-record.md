# 2-D2-03 · P1 client half · C-34 mutation record

**2026-09-27 · `src/lib/presence/__tests__/onlinePresence.test.ts` · 21 assertions.**

C-34: *a test that could not have failed is not evidence.* Every behavioural
assertion in that file was run against an implementation carrying exactly its own
defect. This is the record of those runs.

The three §1 clauses being proved are all statements about **absence** —
`track()` is not called, the set is empty, no channel is opened — and absence is
the hardest thing to test honestly, because a dot that fails to appear looks the
same whether the rule worked or the component never rendered. So the assertions
read the calls made on the channel object itself, and the mutants below change
the rule rather than the rendering.

## The mutants

Each was applied to `src/lib/presence/online.ts` alone, with the test file
untouched, and reverted afterwards. `src/lib/presence/online.ts` is
byte-identical to its committed state after the run.

| | Mutant | What it breaks | Assertions that went red |
|---|---|---|---|
| **A** | `trackSelf()` drops the `!selfVisible` guard | The privacy rule, at the only place it is enforced | 3 — *never calls track() when the member's own active_status is off*; *tracks again when the member turns it back on*; *passes visible:false through …* |
| **B** | `setOwnActiveStatusVisible(false)` no longer calls `untrackSelf()` | "If the member turns it off mid-session: untrack() immediately" | 1 — *untracks immediately when the member turns it off mid-session* |
| **C** | a `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` status re-reads `presenceState()` instead of publishing the empty set | "channel error or disconnect -> isOnline returns false" | 2 — *empties the set on CHANNEL_ERROR*; *empties the set on TIMED_OUT and on CLOSED* |
| **D** | `usePresenceOnline` passes `{ visible: true }`, ignoring the preference it just read | The wiring, as opposed to the mechanism | 1 — *passes visible:false through when active_status is off, so track() never happens* |
| **E** | `track()` is called before `subscribe()` resolves to `SUBSCRIBED` | "track({ u: … }) once after SUBSCRIBED" | 1 — *announces only after SUBSCRIBED, never before* |

**Five mutants, five killed.** No mutant survived, and no mutant killed the whole
file — which is the second thing this table is for: an assertion set that goes
entirely red on any change is not localising anything.

## Why D is a separate mutant from A

A proves the mechanism refuses to announce a hidden member. D proves the one
caller in the application actually tells it that the member is hidden. A privacy
bug in production is almost always shaped like D: the rule is implemented, tested,
and then never reached. Mutant A leaves D's assertion red as well, but mutant D
leaves A's assertions **green** — the mechanism is fine and the member is still
announced. Without D that hole is untested.

## What is NOT proved here, stated rather than left

1. **That Supabase Realtime actually delivers presence for this project.** These
   tests stub the channel. The dot working end-to-end is a live reading on
   staging, and it needs D1's half (§2's `record_session_end`) before the page
   can be exercised at all — see the PR body.
2. **Cross-tab privacy.** Turning the setting off in one tab untracks that tab.
   Another tab of the same member keeps its own entry until it is reloaded or
   closed, so the member stays online while it lives. §1 does not require
   cross-tab propagation and the interface is frozen; recorded here because it is
   a real gap and not an oversight, for the Auditor to route if it matters.
3. **`activeStatusVisible` against the database's own COALESCE.** The unit test
   asserts the same default the migrations use
   (`COALESCE(ps->>'active_status','on')`), read from
   `20260719000200_drop_profile_cover_columns.sql:29`. That is a reading of the
   SQL, not a run of it.
