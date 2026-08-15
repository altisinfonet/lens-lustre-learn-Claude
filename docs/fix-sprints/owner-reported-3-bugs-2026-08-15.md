# Three owner-reported bugs — investigation and plan (2026-08-15)

> 1. back option not working
> 2. dont know sometimes logged off home screen opening automatically
> 3. during commenting logging off
>
> "point 2 and 3 happening not all the time but randomly"
> "we solve all of this as per plan and close it permanently"

Status after the first investigation pass, measured against production. **One root cause found with strong evidence. Two not yet found — and this document says so rather than offering a plausible story.**

---

## Bug 1 — Back button does nothing. ROOT CAUSE IDENTIFIED.

`src/hooks/core/useAndroidBackButton.ts` handles the Android Back press in three steps:

```
1. if (hasOpenOverlay()) { dismissTopOverlay(); return; }   ← swallows the press
2. if (window.history.length > 1) { navigate(-1); return; }
3. plugin.exitApp()
```

`hasOpenOverlay()` decides by looking for Radix layers in the DOM:
`[data-state="open"]`, `[data-radix-popper-content-wrapper]`, and friends.

**Now read `src/lib/unfreezeStuckOverlay.ts`, which exists because of an owner report on 2026-08-05:**

> *"after just a touch report content entire screen got freezed. until app restarted nothing working."*

Its own header states the mechanism: a Radix menu, dialog or popover that unmounts or re-renders **midway through closing** never finishes its cleanup, and is left orphaned in the DOM. That is a documented, recurring failure on this app — the file says so, and says it is "not one component's bug", because "any menu, dialog, popover, sheet or select in the app can lose the same race".

**So an orphaned layer still carries `data-state="open"`.** From then on, every Back press matches step 1, dispatches an Escape that nothing is listening for, and returns. **Back is dead until the app is restarted** — exactly the reported symptom, and exactly as intermittent, because it depends on losing that race.

**Why the existing fix did not fix this.** `unfreezeStuckOverlay` removes the `pointer-events: none` lock from `document.body`. That un-freezes tapping — which is why the screen no longer appears frozen — but it **deliberately never removes the orphaned node**. So the visible symptom went away and Back stayed broken, which is why this outlived the August repair.

**Proposed fix (not yet applied):**
- Step 1 must require an overlay that is *genuinely* interactive, not merely present — the same standard `unfreezeStuckOverlay` already applies before it acts.
- Back must never be able to do *nothing*: if dismissing produced no change, fall through to navigation rather than returning. A press that has no effect is indistinguishable from a broken button.
- `window.history.length > 1` is also wrong on its own terms — in a WebView it never decreases, so step 3 (`exitApp`) becomes unreachable once a member has navigated at all. Back should test the router's own stack.

---

## Bugs 2 & 3 — Random sign-out. ROOT CAUSE NOT YET FOUND.

Both reports are almost certainly one fault: the session disappears, the app returns to the signed-out home screen. Commenting is the likeliest moment simply because that is when the app is talking to the server.

### What was RULED OUT, with evidence

**The deleted-account guard is not doing this.** `checkRestricted()` in `useAuth.tsx` signs a member out when their profile row is missing. Every `AUTH-1005` event in `client_errors` was checked against `auth.users`:

| Event | Rows | Members | Still in `auth.users`? |
|---|---|---|---|
| `ACCOUNT_NO_LONGER_EXISTS` | 3 | 2 | **No — genuinely deleted** |
| `ACCOUNT_DELETED_WHILE_SIGNED_IN` | 3 | 3 | **No — genuinely deleted** |
| `DB-3001 RESTRICTION_CHECK_LOOKUP_FAILED` | 4 | 3 | **Yes — and all three stayed signed in, correctly** |

The guard behaved correctly in all ten cases. This was my first hypothesis and the data disproved it.

**The login count is not evidence of re-logins.** `activity_logs` holds **5,697 logins against 66 logouts** for 90 members — 63 logins each, which looks damning. It is not: the median gap between one member's consecutive login rows is **2 seconds**, and 3,136 of 5,607 gaps are under ten seconds. Nobody signs in twice in two seconds. `logAuthEvent(…, "login")` fires on the client's `SIGNED_IN` event, which is emitted far more often than a person actually signs in.

*I was one step from reporting a 63-logins-per-member crisis that does not exist.*

### What that DID reveal — a real, separate defect

**The audit trail is unusable and the app is writing ~60× more rows than it should.** 5,697 rows where roughly 90 would be right. Two consequences: a real sign-in cannot be distinguished from noise, so this table cannot be used to investigate bugs 2 and 3 at all; and every member's phone is making a database write per event for nothing.

### Remaining candidates, none yet confirmed

1. **The 25-second request timeout is applied to token refresh.** `src/integrations/supabase/client.ts` wraps every request in a 25s abort. It carefully exempts uploads — *"a slow photo post must not become a failed post"* — but **not** `/auth/v1/token`. On a poor connection a stalled refresh is aborted, and a failed refresh can end the session. This fits "random", and fits "worse while doing something".
2. **`src/lib/s3Upload.ts:77` signs the member out** after a persistent auth failure during upload. Correct in intent, but it is a sign-out triggered by a network condition.
3. **WebView storage loss.** The session lives in `localStorage`. Android reclaiming the WebView, or clearing app storage, drops it.

### Why I am not guessing between them

Nothing currently records **why** a session ended. `SIGNED_OUT` is handled but its cause is never captured, so every one of these looks identical afterwards: the member is simply logged out.

**The next step is instrumentation, not a fix.** Record, on every session loss: the event, whether a refresh had just failed, the last request status, platform, and whether the app had been backgrounded. Ship it, wait for real occurrences, and let the data name the cause — the same method that has just ruled out two wrong answers here.

Fixing a random bug by guessing produces a build that seems better for a week.

---

## Plan, in order

| # | Item | Blocked on |
|---|---|---|
| 1 | **Session-loss instrumentation** — records the cause of every sign-out | nothing; build now |
| 2 | **Back button fix** — overlay test must not swallow a press; never a no-op press | nothing; build now, verify in the harness |
| 3 | **Stop the `activity_logs` flood** — one row per real sign-in | nothing |
| 4 | **Exempt token refresh from the 25s abort** | worth doing regardless of whether it is the cause; the reasoning that exempts uploads applies more strongly to auth |
| 5 | **Root-cause 2 & 3 from the instrumentation data** | needs (1) shipped in a build, then real occurrences |

Items 1–4 ship together. Item 5 closes it permanently, and only after the data says which cause it was.

---

## How each of these gets checked

The screenshot harness cannot answer any of them — these are behavioural, not visual. So:

| | How it is verified |
|---|---|
| **Back button** | The overlay-detection logic is pure DOM: a harness scene builds a real orphaned Radix node and asserts a Back press still navigates. Plus a device check by the owner |
| **Session loss** | Cannot be proven from here at all. Verified by production evidence after instrumentation ships — occurrences with a recorded cause |
| **`activity_logs` flood** | Countable directly: logins per member per day should fall to roughly one per real sign-in |
| **Timeout exemption** | Source-pinned test that `/auth/v1/token` is excluded, mirroring the existing upload exemption |

**What only the owner's phone can confirm:** that Back now works after the app has been used for a while, and that sign-outs have stopped. Both stay open until reported from a real device — never closed by reasoning here.
