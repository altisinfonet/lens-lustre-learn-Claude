# Android measurement results — Phase 2

**Copy this file to `docs/evidence/d2/phase2-android/RESULTS-<YYYYMMDD>.md` and fill it in.
Procedure: `docs/evidence/d2/runbook-android.md`. Do not change the procedure to fit a number.**

## Conditions

| | |
|---|---|
| Phone model (Settings → About phone → Model) | |
| Android version | |
| Chrome version (Chrome → Settings → About Chrome) | |
| Test account (username) | |
| Brightness | manual, 50% — auto-brightness OFF |
| Network | Wi-Fi only, mobile data / Bluetooth / location OFF |
| Battery saver | OFF |
| Frame-bar overlay (§5) | ON for every session on both sides |
| BEFORE commit on `staging` | |
| AFTER commit on `staging` | |
| Measured by / dates | |

**Same phone on both sides?** ☐ yes — if no, the comparison is void; say so and stop.

---

## 1 · Negative control (§3) — run before any change

| Session | Battery start % | Battery end % | **Drain (pts)** | Bars over line / total (2:00) | (5:00) | (9:00) | **Jank ratio** |
|---|---|---|---|---|---|---|---|
| `BEFORE-NC-1` | | | | / | / | / | |
| `BEFORE-NC-2` | | | | / | / | / | |

Difference between the two: battery **___ pts**, jank ratio **___ %** apart.

**Verdict** (tick one):
- ☐ battery ≤ 1 pt and jank within 20% → **instrument usable, continue**
- ☐ outside that → **STOP. Noise is as large as the effect. No improvement may be claimed from this
  runbook.** Report to the Auditor and do not run the AFTER side.

---

## 2 · BEFORE — unchanged `staging`

| Session | Battery start % | Battery end % | **Drain (pts)** | Bars/total (2:00) | (5:00) | (9:00) | **Jank ratio** | Discarded? §6 reason |
|---|---|---|---|---|---|---|---|---|
| `BEFORE-1` | | | | / | / | / | | |
| `BEFORE-2` | | | | / | / | / | | |
| `BEFORE-3` | | | | / | / | / | | |

**Median drain:** ___ pts   **All three:** ___ , ___ , ___
**Median jank ratio:** ___ %   **All three:** ___ , ___ , ___
Chrome daily battery-usage cross-check: ___

---

## 3 · AFTER — `staging` with the Phase 2 client changes deployed

| Session | Battery start % | Battery end % | **Drain (pts)** | Bars/total (2:00) | (5:00) | (9:00) | **Jank ratio** | Discarded? §6 reason |
|---|---|---|---|---|---|---|---|---|
| `AFTER-1` | | | | / | / | / | | |
| `AFTER-2` | | | | / | / | / | | |
| `AFTER-3` | | | | / | / | / | | |

**Median drain:** ___ pts   **All three:** ___ , ___ , ___
**Median jank ratio:** ___ %   **All three:** ___ , ___ , ___
Chrome daily battery-usage cross-check: ___

---

## 4 · Web Vitals — harness, not phone (§8, R-62)

**Not measured on the device. Do not put a phone number in this section.**

| | BEFORE | AFTER |
|---|---|---|
| Source | `HARNESS — Phase 0 CI harness on the same build; see CI run id` | `HARNESS — Phase 0 CI harness on the same build; see CI run id` |
| CI run id | | |

The figures themselves are read from the harness output for those runs and are VERIFIED under
2-D2-05. Nothing in this section is the Owner's to measure.

---

## 5 · How this reads — fill in before looking for an explanation

| Direction | Means |
|---|---|
| AFTER drain **lower** than BEFORE by more than the §1 noise band | improvement |
| AFTER drain **higher** than BEFORE by more than the §1 noise band | **regression — the unit does not land** |
| difference **inside** the §1 noise band | **no measurable effect** — not an improvement |

Same three rows for the jank ratio.

**The one sentence:**

> On <MODEL>, over three 10-minute feed sessions per side, the AFTER build was
> ______________ (better / worse / inside the noise band) than BEFORE: battery ___ → ___ points,
> jank ___% → ___%.

**Anything unusual that happened during the runs, including anything that made you want to re-run
a session:**

>

---

## 6 · Screenshots

Folder: `docs/evidence/d2/phase2-android/<SIDE>/` · pattern
`<SIDE>-<SESSION>-<MODEL>-<YYYYMMDD>-<SLOT>.png` · five per session, uncropped, unrenamed.

☐ every session above has its five files, discarded sessions included.
