# P18 · Real-device Core Web Vitals protocol, per release

**Unit:** P18 · **Lane:** D2 (written by the D3 session; docs only. One small D2 build item is named in §2) · **Date:** 2026-10-05 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/P18/`

**Gate (GATE_REGISTER.md, verbatim):** "LCP, INP and CLS measured on real devices, reported per release beside the plan's own budgets." Register note: "Real devices." Phase 5 promotion row: "UI gate, bundle budget and Web-Vitals report all green on `staging`, on a real mid-range device".
**Rulings this takes in:**
- R-93 / R-87: the P17 decision's emulated first-paint reading was accepted, and **its real-device leg moved here**.
- R-82 rule 9: this is hands-on work, not a wait, so it is not deferred.

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box or comment `P18 approved` (merging also counts, R-88). The device list (§1) and budgets (§4) can be changed on the same line.

**What closes P18:** signing fixes the method and the budgets. **P18 is GREEN** once (a) D2's §2 overlay is merged and (b) the **first per-release results file** (§6), measured with it on the §1 mid-range Android, is committed for the release being promoted. After that, every release adds one results file.

---

## 0 · The rules this protocol is built on (copied in spirit from `docs/evidence/d2/runbook-android.md`)

1. **It must be able to come back WORSE.** The protocol is fixed before the run; the numbers are not re-run to get a better one.
2. **Real devices, real network, real build.** Never an emulator. Every record says `realDevice: true`, the model, the OS, the browser or WebView version, and the build commit (the `<meta name="build-commit">` stamped by F-AUD-1).
3. **Three cold runs per route per device.** Report the median and all three numbers.
4. **Negative control first** (§5.1). If two runs of the same build disagree beyond the noise band, no improvement or regression is claimed from that session.
5. **Every run is recorded**, including the ones that look bad. A run is discarded only for a §5.4 reason, and the reason is written next to it.

## 1 · Devices

| slot | class | required | what counts |
|---|---|---|---|
| **A** | **mid-range Android** | **yes, for every release** | Android 13+, 4–6 GB RAM, a 2022–2024 mid-range SoC (e.g. Samsung Galaxy A-series A3x/A5x or equivalent). **The same physical phone every release**; its model goes at the top of every results file |
| B | iPhone | yes, for every release that changes the app shell or the feed | iOS current or current−1 |
| C | low-end Android | recommended, monthly | ≤ 3 GB RAM, Android 11+ |

**Device A runs both** Chrome (the website) and the installed Android app (Capacitor WebView). Device B runs Safari and the iOS app.

**Device A is the gate. B and C are reported, not gating** (P-5 asks for "a real mid-range device").

## 2 · Instrument: one small D2 build item, then no laptop needed

**D2 builds a debug overlay** (one PR; it needs `web-vitals`, MIT, through the Auditor's dependency window):
- **How to open it:** add `?vitals=1` to any URL, or tap 7 times on the version label in Settings in the app. It shows live **LCP, INP, CLS, FCP and TTFB** using the `web-vitals` library's `onLCP`/`onINP`/`onCLS` (`reportAllChanges: true`), plus the build commit, the route, `navigator.connection.effectiveType` and the device UA.
- **"Copy result":** one JSON line per run, the §6 record, put on the clipboard so it can be pasted into the results file.
- **No network write:** nothing is sent to any server. That means no consent question and no new table.
- **Shipped but inert:** it is on in production builds but only renders when explicitly opened. It imports `web-vitals` only when opened (a lazy chunk, so P13's budget is not touched).
- **A metric the engine does not report** is recorded as `"unsupported"`. For example, a WebKit version without LCP or INP support. Such a run is **not** recorded as 0 or a pass.

**Backup instrument when the overlay cannot be used:**
- **Android:** Chrome DevTools via `chrome://inspect` over USB, Performance panel → Live metrics, for the same routes.
- **iOS:** Safari Web Inspector, Timelines.
- The record notes which instrument was used.

## 3 · What is measured

| # | route / interaction | signed in | LCP | INP interaction | CLS |
|---|---|---|---|---|---|
| 1 | `/` | no | ✓ | tap "Join" | ✓ |
| 2 | `/journal/art-of-golden-hour-photography` (P17's article) | no | ✓ | scroll + tap the first link | ✓ |
| 3 | `/competitions` | no | ✓ | open the first competition | ✓ |
| 4 | `/feed` | **yes** (the dedicated test account, the same one as M11 §4.3) | ✓ | **like** the first post | ✓ (scroll 3 screens) |
| 5 | `/post/:id` (the first post of the M11 corpus) | yes | ✓ | open comments | ✓ |
| 6 | composer (`/feed?compose=1`) | yes | — | type 20 characters + pick a photo | ✓ |
| 7 | `/notifications` | yes | ✓ | mark one read | ✓ |
| 8 | own profile `/profile` | yes | ✓ | switch tab Posts ↔ About | ✓ |
| 9 | P17 **time to real content** for rows 1–3 | no | the time the page's real heading is visible, from the overlay's mark | — | — |

**Conditions** (written on the results file and kept identical every release):
- **cold run:** clear site data (web) or clear app cache (app) before each run;
- **charger out**, battery 30–95 %, battery saver off, brightness manual 50 %, other apps closed;
- **network:** **(i) home Wi-Fi** and **(ii) mobile data 4G, Wi-Fi off**. Record the operator and a `fast.com` download figure taken just before the session.

## 4 · Budgets (the "plan's own budgets"; the plan had none written, so these are set here)

| metric | budget on device A, median of 3, mobile data | source |
|---|---|---|
| **LCP** | **≤ 2.5 s** | Core Web Vitals "good" threshold |
| **INP** | **≤ 200 ms** | Core Web Vitals "good" threshold |
| **CLS** | **≤ 0.1** | Core Web Vitals "good" threshold |
| time to real content, rows 1–3 | **≤ 3.0 s** | P17 decision D7 |
| feed first-screen image bytes | **M11** (≤ 350 KB) | P11 `M11.md` (by DevTools, when connected) |

**Known reading to compare against (emulated, not real):** P17 measured on 2026-10-04, android-mid-2026 profile, a loader "LCP" of 2.3–3.5 s and real content at 5.5–10.1 s. The first real-device run is expected to fail rows 1–3's content budget until D2's P17 edge-prerender unit lands. That is a correct result, not a defect in the protocol.

**What a failure means:**
- **Before the P-5 promotion**, a device-A metric over budget **blocks the promotion** and opens a D2 defect with the number.
- **After P-5**, every release reports beside the budgets. A metric that gets **> 10 % worse than the previous release** is flagged to the Auditor in the same round, even when still within budget.

## 5 · Procedure (Owner or D2, about 45 min per device)

1. **Negative control:** two complete passes of rows 1 and 4 on the *current production* build, 10 min apart. **Noise band** = the larger of 15 % or 150 ms (LCP) / 40 ms (INP) / 0.02 (CLS). If the two passes disagree by more than that, write "instrument cannot resolve" and stop.
2. **Measure:** rows 1–9, 3 cold runs each, with the overlay open. Copy each record into the results file.
3. **The app:** the same rows inside the installed app (device A; device B when required). The app build must come from main ≥ the release commit (iOS: the F-P1-6 rule).
4. **Discard only for:** an incoming call or notification during a run; the device under 30 % battery; a network change mid-run; the page not finishing its first load in 60 s (that one is *recorded as a failure*, not discarded).

## 6 · Results file (one per release): `docs/evidence/d2/P18/<YYYY-MM-DD>-<release or main sha>/results.md`

```
release: <tag or main sha> · build-commit meta: <sha> · measured by: <name> · UTC: <start>–<end>
device A: <model> · Android <ver> · Chrome <ver> / WebView <ver> · RAM <GB>
network: Wi-Fi <ISP> <Mbps> · 4G <operator> <Mbps>
negative control: row1 LCP <a>/<b> · row4 INP <a>/<b> → within noise: yes/no
| row | surface | net | LCP r1/r2/r3 (med) | INP … | CLS … | content … | vs budget | vs last release |
...
one JSON line per run, as copied from the overlay:
{"realDevice":true,"device":"…","os":"…","engine":"…","build":"…","route":"/feed","net":"4g","run":1,"lcpMs":…,"inpMs":…,"cls":…,"fcpMs":…,"ttfbMs":…,"contentMs":…,"atUtc":"…"}
```

## 7 · Who does what

| step | who |
|---|---|
| the `?vitals=1` overlay + "Copy result" (one PR, dependency window for `web-vitals`) | **D2** |
| the dedicated test account (credentials only as a CI secret / on the Owner's phone; never in chat or the repo) | **Owner** (shared with M11 §4.3) |
| the measurement session, device A (B when required) | **Owner** (or D2 with the Owner's phone) |
| reading the results file against §4 and recording GREEN/RED per release | **Auditor** |

## 8 · Findings / notes

- **F-D3-21:** no member-facing vitals instrument exists today. `git grep -i 'onLCP\|onCLS\|largest-contentful\|web-vitals' -- src` on staging `b2aa236` finds only `src/components/admin/AdminHealth.tsx:189`. That code measures TTFB/FCP/LCP of the **admin health page itself**, with no INP and no CLS, so it cannot measure member routes. The only other vitals data is the emulated CI harness (`realDevice: false`). §2 is the missing instrument; D2 may reuse AdminHealth's observer code.
- The P17 decision's real-device leg is fulfilled by rows 1–3 + 9 on device A.
