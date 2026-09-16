# Real-device runbook — mid-range Android

**Path when committed:** `docs/evidence/d2/runbook-android.md` · **Author:** D2 · **Executor:** the Owner · **Recorder:** the Auditor, as **OWNER-ATTESTED**
**Written:** 2026-09-02 · **Plan reference:** 2-D2-01 (written ahead, in Phase 0, so the *before* reading for P10 can be taken the day Phase 2 opens)

## Why this document exists

Sessions cannot hold a phone. Every real-device number in Addendum A — P10 battery and jank, P11 feed bytes, P17 first paint, P18 Web Vitals, P21 font paint — is taken by a person following this document. The Auditor records what comes back as **OWNER-ATTESTED**. The automated harness (`web-vitals-report.mjs`, emulated profile) produces **VERIFIED** instrument readings. **The two classes are never mixed, never averaged, and never substituted for each other.** A device number is filed beside a harness number, not instead of it.

The Auditor's review test for this runbook (2-AU-03) is: *could following it produce a worse reading than before?* If a procedure can only ever show improvement, it is not an instrument. Every step below is written so that a regression would show.

## 0 · Before the first run — fix the device and the conditions, then never change them

Write these into `docs/evidence/d2/device.md` **once**, and repeat them verbatim at the top of every reading file. A before/after comparison on two different phones, or on Wi-Fi then 4G, measures the difference between the phones, not the app.

| Record | Example | Why it must be fixed |
|---|---|---|
| Phone make, model, Android version, Chrome version | *Settings → About phone*; *Chrome → ⋮ → Settings → About Chrome* | Chrome updates change LCP by themselves |
| Which account signs in | one test member, the same every time | feed contents differ per member |
| Network | **mobile data, 4G, in the same room** — not Wi-Fi | Wi-Fi hides the 3G-class cost the plan budgets for |
| Battery state at start | between 60 % and 80 %, **not charging**, screen brightness fixed at 50 % | Android throttles differently near full and near empty; a charging phone shows no drain |
| Other apps | swipe all away; airplane mode off; Bluetooth off | background apps burn the battery you are trying to attribute |
| Time of day | same ±1 hour | staging and mobile networks both have a daily shape |
| Build under test | the `staging.50mmretina.com` deploy, and its commit from the Cloudflare Pages deployment page | a reading without a commit is not comparable to anything |

**A reading whose device.md differs from the previous reading's is a new baseline, not an "after."**

## 1 · Web Vitals on the device (P18, P17 first paint, P21 font paint) — ~15 minutes

This uses Chrome's own remote-debugging, no app installed on the phone, and **the same observer definition the harness uses**, so device and harness measure the same thing and differ only by being real.

1. On the phone: *Settings → About phone → tap "Build number" seven times* → *Developer options → USB debugging ON*.
2. Connect the phone to a laptop by USB. Tap **Allow** on the phone.
3. On the laptop, in desktop Chrome, open `chrome://inspect/#devices`. The phone appears. Tick **Discover USB devices** if it does not.
4. On the phone, in Chrome: close every tab, open a new tab, **do not navigate yet**.
5. On the laptop under the phone's entry, click **inspect** on that blank tab. A DevTools window opens for the phone's tab.
6. In DevTools → **Console**, paste this and press Enter **before** navigating (an observer installed after the page loads misses the very entries it exists to catch and reports a confident zero — that is a defect, not a result):

```js
window.__v={lcp:null,cls:0,inp:null,fcp:null};
new PerformanceObserver(l=>{for(const e of l.getEntries())window.__v.lcp=Math.round(e.renderTime||e.startTime)}).observe({type:"largest-contentful-paint",buffered:true});
new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__v.cls+=e.value}).observe({type:"layout-shift",buffered:true});
new PerformanceObserver(l=>{for(const e of l.getEntries()){const d=e.duration;if(window.__v.inp===null||d>window.__v.inp)window.__v.inp=Math.round(d)}}).observe({type:"event",buffered:true,durationThreshold:16});
new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.name==="first-contentful-paint")window.__v.fcp=Math.round(e.startTime)}).observe({type:"paint",buffered:true});
"observers installed";
```

7. In DevTools → **Console**, type `location.href="https://staging.50mmretina.com/"` and press Enter. Wait until the feed has fully drawn and **stopped moving** (count 10 seconds after the last image appears).
8. Scroll the feed down two screens and back, then tap one post. Wait 5 seconds. (This gives INP an interaction; without one INP is `null`, and **null is the correct reading, not zero**.)
9. In Console type `JSON.stringify(window.__v)` and press Enter. **Screenshot the console** showing the result. Copy the text too.
10. Repeat steps 4–9 **three times**. Use the **median** of each metric; keep all three.

Record: `device-vitals-<YYYY-MM-DD>-<before|after>.md` — device.md header, the three JSON lines, the medians, the screenshot filenames, the staging commit. **INP `null` is written as `null`.**

## 2 · Battery drain over a fixed feed session (P10) — 30 minutes wall clock

No tools. Android's own battery accounting.

1. Confirm §0. Note the exact battery percentage from *Settings → Battery* and **screenshot it** with the clock visible.
2. Open Chrome, sign in as the test member, open `https://staging.50mmretina.com/`.
3. **Scroll the feed continuously for 10 minutes** at a natural pace — roughly one screen every 3–4 seconds. Tap into two posts and back. Do not open other apps. Do not let the screen turn off (*Developer options → Stay awake* is acceptable, and must then be on for every reading).
4. **Leave the tab open and press the home button. Wait 10 minutes.** Do not touch the phone. (This is the half that matters for P10: a backgrounded tab with a live timer keeps the CPU awake. A backgrounded tab with the timers cleared on `visibilitychange` should cost nothing.)
5. Return to Chrome, scroll for **5 more minutes**.
6. *Settings → Battery* again. Screenshot with the clock. Then *Settings → Battery → Battery usage → Chrome* — screenshot the percentage attributed to Chrome.
7. Record start %, end %, the Chrome-attributed %, and the three screenshots.

If an `adb` laptop is available, also run before step 2 and after step 6: `adb shell dumpsys batterystats --reset` (before) and `adb shell dumpsys batterystats > batterystats-<before|after>.txt` (after). Attach both files. This is optional and is not a substitute for the screenshots.

**How a regression shows:** a larger drop between start and end, or a larger Chrome share, on the *after* run with identical §0 conditions.

## 3 · Jank — frame drops while scrolling (P10) — 5 minutes

1. *Developer options → Profile HWUI rendering (or "Profile GPU rendering") → On screen as bars*. Leave it on for every reading.
2. Open the feed as in §2 step 2. Scroll one full screen slowly, then one full screen fast.
3. **Screenshot while scrolling** — twice, once slow, once fast. The bars are the reading: every bar above the green line is a frame that missed 16 ms.
4. Also, with the phone still connected as in §1: DevTools → **Performance** → press record → scroll the feed for 10 seconds on the phone → stop. Screenshot the summary showing **dropped frames** and the long-task count. Save the trace with **Save profile** as `trace-<before|after>.json`.
5. Record the two bar screenshots, the Performance summary screenshot, the trace file.

**How a regression shows:** more bars above the green line, more dropped frames in the Performance summary, on the *after* run.

## 4 · Feed bytes on a real network (P11, P16) — 5 minutes

1. Phone connected as in §1. DevTools → **Network** → tick **Disable cache** → clear the list.
2. In the phone's Chrome, navigate to `https://staging.50mmretina.com/` and wait until the feed stops moving.
3. Do not scroll. At the bottom of the Network panel read **"N requests · X kB transferred · Y kB resources"**. Screenshot it.
4. Filter by **Img**. Screenshot the same footer again — that is the image share of a first feed screen.
5. Record both readings and both screenshots.

**How a regression shows:** more kB transferred for the same first screen.

## 5 · What to send back, and what the Auditor will do with it

One folder per run: `docs/evidence/d2/<phase>/device-<YYYY-MM-DD>-<before|after>/` containing `device.md`, the reading files above, every screenshot, and the trace. D2 files them; the Auditor records each as **OWNER-ATTESTED** with the timestamp of the reading, and files the harness's own emulated reading for the same commit beside it as **VERIFIED**. Neither is promoted into the other's column.

**If a step could not be done exactly as written** — a different phone, Wi-Fi instead of 4G, the observer pasted after the page loaded — write that down in the reading file rather than adjusting the number. A reading with a stated deviation is evidence. A clean-looking reading with a hidden deviation is the thing this whole programme exists to stop.

*D2. This document instructs; it records nothing and closes nothing.*
