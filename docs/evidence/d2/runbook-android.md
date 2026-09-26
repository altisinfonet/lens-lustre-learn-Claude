# Android measurement runbook — Phase 2 (2-D2-01)

**For the Owner, run alone, no session needed. D2, 2026-09-27. Cut from `staging` `7ebdbf4`.**

This is the missing leg the Phase 0 harness names in its own output:

> `realDevice: false` — *"Emulated Chromium on CI. The standard of practice requires a real
> mid-range Android for before/after performance claims; that leg is **BLOCKED in CI and must be
> measured by hand**."*

This runbook is that hand measurement. It exists so the Phase 2 client changes — removing the
5-minute `last_active_at` write (`src/hooks/core/useLastActive.ts:42`) and the 200 ms ad timer
(`src/components/ads/AdZone.tsx:258`), among others — are judged by a number from a real phone and
not by "should be faster".

---

## 0 · The rule this runbook is built around

**It must be able to come back WORSE.**

A procedure that can only show improvement is not an instrument. So, before anything else:

1. **The AFTER protocol is fixed before the AFTER run.** Everything below — device, account,
   screen, scroll pattern, brightness, duration — is written down first and not adjusted once a
   number is in.
2. **Every session is recorded, including the ones you dislike.** A session is only discarded for a
   reason on the **§6 invalidation list**, and a discarded session still goes in the results file
   with the reason written next to it.
3. **Three sessions per side, not one.** You report the median and all three. The spread is part of
   the result.
4. **§3 is a negative control and it runs first.** Two BEFORE sessions on the same unchanged build.
   If those two disagree by more than the noise band, this instrument cannot resolve the change,
   and **no improvement may be claimed from it.** That is a valid outcome of this runbook.
5. **If AFTER is worse than BEFORE, that is the result.** It is written up as-is and the unit does
   not land. Nothing here is re-run "to get a better one".

---

## 1 · What you need

1. One real Android phone. **Not an emulator.** Mid-range is the target; whatever you actually use
   is fine, as long as it is **the same phone for every session in the comparison**.
2. Wi-Fi. Mobile data off for the whole exercise.
3. Chrome on the phone.
4. A second device or a notepad to write times down — do not use the phone under test for that.

**Write the phone's model down now**, before you measure anything: *Settings → About phone →
Model*. It goes at the top of the results file and into every screenshot filename. If the model
differs between BEFORE and AFTER, the comparison is void.

---

## 2 · Fix the conditions — do this identically every single session

Do all nine, in order, every time. They are the whole reason two sessions are comparable.

1. **Charger unplugged.** Do not charge during a session and do not start above 95% or below 30%.
2. **Battery saver OFF**, and **adaptive battery** left exactly as it is.
3. **Brightness: manual, slider at 50%.** Auto-brightness **OFF**. (Auto-brightness alone can
   swamp the entire effect you are trying to measure.)
4. **Screen timeout: 30 minutes**, so the screen never sleeps mid-session.
5. **Wi-Fi ON, mobile data OFF, Bluetooth OFF, location OFF.**
6. **Close every other app.** Recents → Clear all.
7. **Chrome: close all tabs.** Then open exactly one.
8. **Sign in as the same account every time.** Use one dedicated test account and write its
   username in the results file. A different account means a different feed, and a different feed
   is a different measurement.
9. **Wait 2 minutes after step 8 with the screen on and the phone idle**, so the battery reading
   settles before you take it.

---

## 3 · The negative control — run this FIRST, before any change

This proves the instrument can tell two things apart before you ask it to.

1. Run **§4 twice** on the **current, unchanged** site, back to back, with a 10-minute idle gap
   between them (screen off, charger still out).
2. Record both in the results file as `BEFORE-NC-1` and `BEFORE-NC-2`.
3. Compare them:

| If the two negative-control sessions differ by | Then |
|---|---|
| battery **≤ 1 percentage point** and jank bars **≤ 20%** of each other | the instrument is usable. Continue. |
| battery **> 1 point** or jank bars **> 20%** apart | **STOP.** The noise is as large as the effect. Report that to the Auditor and do not claim any improvement from this runbook. |

**That second row is a real outcome and reporting it is a success, not a failure.**

---

## 4 · The session — 10 minutes, same every time

Set a timer for **10:00** and start it at step 4.

1. Open Chrome. One tab. Go to **`https://staging.50mmretina.com/feed`**.
2. Sign in if asked. Wait until the feed has posts on screen.
3. **Take the BEFORE battery reading now**: *Settings → Battery* → write down the **exact
   percentage**. Also write the **clock time**.
4. Return to the feed tab. **Start the 10:00 timer.** From here, do only what steps 5–7 say.
5. **Scroll pattern — repeat this loop for the full 10 minutes:**
   - scroll **slowly down** for 5 seconds (about one post per second),
   - **stop and hold still** for 5 seconds,
   - repeat.
   Do not open a post. Do not like, comment, or navigate away. Do not let the screen sleep.
6. At **2:00, 5:00 and 9:00** on the timer, take the jank screenshot described in §5.
7. At **10:00**, stop scrolling. Immediately take the **AFTER battery reading**: *Settings →
   Battery* → exact percentage and clock time.
8. Also record, from *Settings → Battery → Battery usage*, the figure listed against **Chrome** for
   today. Note that this is cumulative for the day — it is a cross-check, not the primary number.

**Primary battery number = BEFORE % − AFTER %.** Over 10 minutes this is usually 1–4 points; it is
coarse, which is exactly why §3 exists and why you run three sessions.

---

## 5 · Jank — frame bars, counted from a photograph

Set this up **once**, before the first session, and leave it on for every session on both sides.

1. *Settings → About phone* → tap **Build number** seven times to enable **Developer options**.
2. *Settings → System → Developer options* → **Profile HWUI rendering** → **On screen as bars**.
3. A bar chart now draws over the screen. Each bar is one frame. **The green horizontal line is the
   16 ms budget.** Bars above the green line are frames that missed it — that is jank.

During each session, at **2:00, 5:00 and 9:00**, take a screenshot (power + volume-down) **while
still scrolling**, and:

4. Count **how many bars cross the green line** in that screenshot. Write the count down.
5. Count **the total number of bars** visible. Write that down too — the ratio is what compares,
   not the raw count.

**Jank number for the session = (bars over the line) ÷ (total bars), averaged over the three
screenshots.**

Leave Developer options and the bar overlay **on** for the AFTER sessions. Turning the overlay off
between runs changes what the GPU is doing and voids the comparison.

---

## 6 · What voids a session — decided in advance

Discard a session **only** for one of these, and write the reason in the results file next to the
discarded run:

1. A phone call, alarm, or notification that took over the screen.
2. The screen slept, or you left the feed tab.
3. The charger was connected at any point.
4. Battery saver switched itself on (it does this automatically at low battery — hence "do not
   start below 30%").
5. The Wi-Fi dropped, or the feed failed to load and showed an error.
6. You started above 95% or below 30%.
7. Android showed a system update or a Play Store install running.

**"The number looked wrong" is not on this list and is not a reason.**

---

## 7 · Screenshots — what to take and how to name them

Take exactly five per session:

| # | When | What |
|---|---|---|
| 1 | before the timer starts | *Settings → Battery*, showing the starting % |
| 2 | at 2:00 | the feed with the frame bars visible |
| 3 | at 5:00 | the feed with the frame bars visible |
| 4 | at 9:00 | the feed with the frame bars visible |
| 5 | immediately at 10:00 | *Settings → Battery*, showing the ending % |

**Filename pattern — use it exactly:**

```
<SIDE>-<SESSION>-<MODEL>-<YYYYMMDD>-<SLOT>.png
```

* `<SIDE>` — `BEFORE` or `AFTER` (or `BEFORE-NC` for the §3 negative control)
* `<SESSION>` — `1`, `2` or `3`
* `<MODEL>` — the phone model, lowercase, spaces → hyphens (e.g. `sm-a536b`)
* `<SLOT>` — `battery-start`, `bars-0200`, `bars-0500`, `bars-0900`, `battery-end`

Examples:

```
BEFORE-NC-1-sm-a536b-20260927-battery-start.png
BEFORE-2-sm-a536b-20260927-bars-0500.png
AFTER-3-sm-a536b-20260929-battery-end.png
```

Put every file in `docs/evidence/d2/phase2-android/<SIDE>/`. Do not rename or crop them.

---

## 8 · Web Vitals — and the one thing this runbook cannot do alone

LCP, INP and CLS on a **real** phone cannot be read from the phone by itself. Chrome for Android
has no on-device performance panel. There are two honest ways, and **the Auditor should pick one
before the first measurement**:

**Option A — USB cable, 5 minutes of setup, no code.**
1. On the phone: *Developer options* → **USB debugging ON**.
2. Plug the phone into a computer with Chrome.
3. On the computer, open `chrome://inspect/#devices`, allow the phone's prompt, find the
   `staging.50mmretina.com` tab, click **inspect**.
4. In the panel that opens: **Lighthouse** tab → device **Mobile** → **Analyze page load**.
5. Save the report as JSON. Name it `<SIDE>-<SESSION>-<MODEL>-<YYYYMMDD>-lighthouse.json`.

**Option B — an in-page overlay, which does not exist yet.** The vitals reporter this project
already has (`scripts/web-vitals-report.mjs`) runs in CI against `dist/` on localhost. Surfacing the
same numbers on the deployed site behind something like `?vitals=1` would make this leg phone-only
— but that is **code D2 has not been asked to write**, and I am not writing it inside a runbook
unit.

**Until the Auditor picks one, §4's battery and §5's jank are the numbers this runbook produces,
and the Web Vitals row in the results file reads `NOT MEASURED — awaiting A or B`.** It does not
read "unchanged", and it does not read a figure copied from the CI harness: those are emulated, on
localhost, with no CDN and no real network path, and they are not a real-device reading.

---

## 9 · Which build is BEFORE and which is AFTER

Both sides are measured **in Chrome on `staging.50mmretina.com`**, never one side in the app and
the other in the browser. Mixing the two surfaces measures the surface, not the change.

* **BEFORE** — current `staging`, **before** the Phase 2 client branches land. Record the commit
  the Auditor gives you.
* **AFTER** — `staging` again, **after** they land and the deploy has finished. Record that commit.

The installed Play Store app is a **separate** measurement with its own build cycle. If the Auditor
wants it, it is its own before/after pair and its own results file — not a half of this one.

---

## 10 · What you hand back

One file, `docs/evidence/d2/phase2-android/RESULTS-<YYYYMMDD>.md`, started from the template beside
this runbook, plus the screenshot folders. It must contain:

1. phone model, Android version, Chrome version, test account;
2. both commits (BEFORE and AFTER);
3. the §3 negative-control pair and its verdict;
4. all three sessions per side — **including any discarded, with the §6 reason**;
5. medians, and the full spread;
6. the Web Vitals row, measured or `NOT MEASURED`;
7. one sentence saying whether the AFTER is better, worse, or inside the noise band.

**If it is worse, or inside the noise, say so in that sentence.** That is what the runbook is for.
