# Three owner-reported bugs — investigation and plan (2026-08-15)

> 1. back option not working
> 2. dont know sometimes logged off home screen opening automatically
> 3. during commenting logging off
>
> "point 2 and 3 happening not all the time but randomly"
> "we solve all of this as per plan and close it permanently"
>
> Added later the same day: **"gesture back is not also working."**

Status after the first investigation pass, measured against production. **One root cause found with strong evidence. Two not yet found — and this document says so rather than offering a plausible story.**

---

## Bug 1 — Back does nothing, by button OR by gesture. ROOT CAUSE IDENTIFIED, FIX APPLIED.

**The gesture report is not a second bug.** Android's predictive-back gesture and the hardware / 3-button Back both raise the **same** Capacitor `backButton` event — there is no separate gesture event to handle, and `src/hooks/core/useAndroidBackButton.ts` is the only place either one is answered. So "gesture back is not also working" is the same defect reaching us through a second door, and it *strengthens* the diagnosis below rather than changing it: a fault in the shared handler is exactly what makes both fail together, while a fault in gesture configuration would have left the button working.


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

### The fix, APPLIED 2026-08-15 in `src/hooks/core/useAndroidBackButton.ts`

The tempting fix — "work out which layers are orphans" — was rejected. Any rule for spotting an orphan is a guess, and a wrong guess either resurrects the bug or rips a live dialog off the screen. Instead the press was made **incapable of doing nothing by accident**:

1. **Escape is dispatched as a cancellable event, and the answer is read.** A layer that is alive and *deliberately* refusing to close calls `preventDefault()` — `OnboardingModal` does exactly this while onboarding is still mandatory — and `dispatchEvent` returns `false`. That is a refusal, it is the app's own decision, and Back correctly stops. Nothing prevented it? Then either it closed or **nobody was listening**.
2. **Look again after the close animation** (300 ms — the same number and the same reasoning as `unfreezeStuckOverlay`'s `GRACE_MS`). Still there → nobody was listening → it is an orphan → do the navigation this press was owed, and **remember the node** so the next press is instant instead of paying the wait again. The memory is a `WeakSet`, so a remembered node is still garbage-collected the moment the DOM lets go.
3. **The node is never removed.** That restraint is deliberate and is the same rule `unfreezeStuckOverlay` follows: tearing a live layer out mid-close turns a stuck back button into a white screen.
4. **The history-length test is gone.** In a WebView that number only ever grows, so after a member's first navigation it was permanently `> 1` and `exitApp()` could never run. Replaced by a count of the **router's own** pushes: `+1` on `PUSH`, `−1` on `POP`, and `REPLACE` — every redirect, every query-string rewrite — deliberately counting for nothing.

**Alarms:** `src/hooks/core/__tests__/androidBackButton.test.ts`, 12 assertions built from **real DOM nodes**, not a mocked overlay check — a mock would have passed against the broken code too. Six mutations, all caught:

| Mutation | Caught by |
|---|---|
| Restore the old swallow (no fall-through) | 3 orphan tests |
| Ignore the refusal signal | "respects a refusal" — the mandatory-onboarding guard |
| Drop the re-check for a layer that opened during the grace | "a real layer opening during the grace still wins" |
| Go back to the WebView history length | source-pin |
| Stop remembering the orphan | 3 tests (the second press defers again) |
| Let the grace period drift from `unfreezeStuckOverlay` | the 300 ms alignment test |

**Still DEVICE-open:** that Back and the gesture work on the owner's phone after the app has been used for a while. Proven here only that the handler can no longer be silenced by a dead layer.

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
| 2 | ~~**Back button fix**~~ — **DONE 2026-08-15**, covers gesture back too | 12 tests, 6/6 mutations caught; device confirmation still owed |
| 3 | **Stop the `activity_logs` flood** — one row per real sign-in | nothing |
| 4 | **Exempt token refresh from the 25s abort** | worth doing regardless of whether it is the cause; the reasoning that exempts uploads applies more strongly to auth |
| 5 | **Root-cause 2 & 3 from the instrumentation data** | needs (1) shipped in a build, then real occurrences |

Items 1–4 ship together. Item 5 closes it permanently, and only after the data says which cause it was.

---

## How each of these gets checked

The screenshot harness cannot answer any of them — these are behavioural, not visual. So:

| | How it is verified |
|---|---|
| **Back button and gesture** | Done differently, and better, than planned: the decision was extracted into a pure function, so the test builds a **real orphaned Radix node in jsdom** and asserts a Back press still navigates — no harness scene, no React, no Capacitor bridge needed, and it runs in the ordinary suite on every change. Device check by the owner still required |
| **Session loss** | Cannot be proven from here at all. Verified by production evidence after instrumentation ships — occurrences with a recorded cause |
| **`activity_logs` flood** | Countable directly: logins per member per day should fall to roughly one per real sign-in |
| **Timeout exemption** | Source-pinned test that `/auth/v1/token` is excluded, mirroring the existing upload exemption |

**What only the owner's phone can confirm:** that Back now works after the app has been used for a while, and that sign-outs have stopped. Both stay open until reported from a real device — never closed by reasoning here.
