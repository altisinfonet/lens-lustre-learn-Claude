# Release plan — batch the fixes, cut few builds

Owner instruction, 2026-08-10: *"Cut after effective changes, after one change
build App is not required. After solving few bugs plan when to cut again."*

`main` = `273d936` · web live on `2026-08-10-1` · **app still on 1058**.

---

## The principle this plan is built on

Not every fix costs the same to deliver:

| Where the fix lives | How it reaches members | Cost |
|---|---|---|
| **Database** (RLS, functions, data) | **instantly — even on the app already installed** | free |
| **Edge functions / storage / CDN config** | **instantly, everywhere** | free |
| **Web code** | ~3 min after push | free |
| **App code** | only in a new build → Play review → each member updates | **expensive, slow, and one-way** |

So the order of work is **not** "hardest bug first". It is **"what can reach
people without a build, first"** — then batch everything that does need a build
and spend one build on all of it.

---

## THE FULL ISSUE LIST — 19 items

### ✅ Fixed, sitting on the web, NOT yet in the app
| # | Issue | Needs |
|---|---|---|
| 1 | **Blank pages in the app** — `crypto.randomUUID` missing on old Android WebViews | **build** |
| 2 | **Search freezes the whole app** — stranded full-screen overlay | **build** |

### 🔴 Open bugs
| # | Issue | Web/App | Build needed? |
|---|---|---|---|
| 3 | **N1 · Photo quality destroyed by over-compression** (Curated Wall, Gallery, Home banner) | both | **probably** — decide after measuring |
| 4 | **N2 · Tagging dead on every post** | both | **probably NOT** — suspected database |
| 5 | **N4 · Follow notifications say "A member"** | both | **probably NOT** — suspected database |
| 6 | **N3 · Duplicate skeleton after posting** | both | yes |
| 7 | **CDN images failing** — a repeating handful of avatar/cover/post URLs in the failure log | both | **NOT** — storage/data |

### 🟡 Code work, no member-visible bug
| # | Issue | Build needed? |
|---|---|---|
| 8 | P4 · 15 production dependency vulnerabilities | yes |
| 9 | P5 · 4 ProfilePhotoPrompt tests red | no (tests) |
| 10 | P6 · `package-lock.json` out of sync | no (tests) |
| 11 | P7 · Two `App.tsx` fetch settings | yes |
| 12 | P9 · Cache persistence (instant reopen) | yes |
| 13 | P11 · Security gate blocking the Android build | rides *with* a build |
| 14 | P12 · Admin Security Audit panel | no (admin is web) |

### 🔵 Waiting on the owner
| # | Item |
|---|---|
| 15 | **P8 · Text readability** — 42% of text under 12px, 6 elements at 7px. Needs a yes/no; changes how the site looks |
| 16 | P10 · 2 judging tests — judging is flagged dangerous; will not touch without you |
| 17 | P2 · **Hand-test the app with a finger** — nobody has, for 1055–1058 |
| 18 | P3 · Post one comment on the live site — 10 seconds, and it probes the N2/N4 theory |
| 19 | P1 · **Play upload** — see the decision below |

---

## THE PLAN — three phases, two builds

### PHASE 0 — free wins, nothing to build *(next, ~1 day)*

Everything here reaches **every member instantly, including phones running the
old app**. No build, no Play review.

1. **The 2026-08-06 RLS review** → may close **N2 + N4 together**.
   One investigation, two bugs, zero builds. Highest value per hour on the list.
   The unchecked question is the mirror of the security work: deleted accounts
   were proven unable to write anywhere — *ordinary live members were never
   proven still able to*.
2. **CDN image failures** — check whether those specific files exist in storage
   at all. Storage/data fix, no build.
3. **P5 + P6** — the last red tests and the npm lockfile. CI hygiene, zero risk
   to members, and it makes every later release easier to trust.

**No build at the end of Phase 0.** Nothing here needs one.

### PHASE 1 — the fixes that do need a build *(after Phase 0)*

4. **N1 photo quality** — measure first: is the *upload* compressing too hard,
   or is the *display* asking for the small copy (my 7 Aug change)? Do not
   touch code until that is settled. **This is the most urgent bug on the list**
   because if it is upload-side, every photo posted meanwhile is permanently
   damaged.
5. **N3 duplicate skeleton.**
6. Any client-side part of N2/N4 that Phase 0 turns up.
7. **P4 dependency vulnerabilities** — `package.json` + `bun.lock` must travel
   together or the web deploy dies. Goes in its own commit, first.
8. **P7 the two `App.tsx` settings** — only if N1 measurement shows they matter.

Then let all of it run **on the web for at least 24 hours** with the watchdog
green before building.

### ▶︎ CUT BUILD 1059 — carrying six fixes at once

| In the build |
|---|
| Blank pages fixed (#1) |
| Search freeze fixed (#2) |
| Photo quality fixed (#3) |
| Duplicate skeleton fixed (#6) |
| Tagging + notifications (#4, #5) — if any client part was needed |
| Dependency vulnerabilities closed (#8) |

That is one Play review for six fixes, instead of six reviews.
**P11 (the security gate) rides along here** — editing the Android workflow
fires a build by itself, so it must go with an intentional one.

### PHASE 2 — while 1059 sits in Play review

Play review is dead time for the app but not for the web. Work that lands on
the web immediately and needs no build:

9. **P12 Admin Security Audit panel** (admin is web-only).
10. **P8 text readability** — *if* you say yes. Web first; the app picks it up
    in 1060.
11. **P9 cache persistence** — needs its own security review first (a shared
    phone must not show one account another's cached data).
12. **P10 judging tests** — only with your input.

### ▶︎ CUT BUILD 1060 — later, and only when it earns it

Cut 1060 **only when all three are true:**
- 1059 is accepted by Play *and* has been on real phones for ~3 days,
- the Client-failures panel shows **no new `platform=app` crash** on 1059,
- Phase 2 has produced at least two changes members would actually notice.

If Phase 2 produces nothing member-visible, **do not cut a build.** A build with
nothing in it costs a Play review and asks 84 people to update for no reason.

---

## The rules I will hold to

1. **Never cut a build for one change.** A build is for a *batch*.
2. **Web first, always.** Everything runs on the live site for ≥24h before it
   is frozen into an APK. The web is reversible in three minutes; a build is
   not.
3. **A build is cut on a green tree only** — tests at their known baseline,
   typecheck clean, watchdog green.
4. **Never cut mid-investigation.** A half-understood fix in an APK is stuck
   there until the next release.
5. **If it can be fixed in the database, it does not wait for a build.**
6. **One risky change per release.** If two land together, they are separated.

---

## The one decision blocking Phase 0

**1058 is still unuploaded, and 1059 supersedes it.**

1058 contains neither the blank-page fix nor the search fix — the two things
members are actually hitting. Uploading it now spends a Play review on a build
that still freezes on search and still blanks on old WebViews.

**Recommendation: skip 1058. Wait for 1059**, which will carry six fixes.

The cost of waiting is that app members keep hitting blank pages and the search
freeze for a few more days. The cost of not waiting is a Play review spent on a
build that fixes neither, and then a second review days later anyway.

**Unless** — if you want relief in members' hands *this week* and are willing to
spend the review, say so and I will cut 1059 immediately with just the two
fixes already done, and 1060 becomes the batch build. That is a legitimate
choice; it just trades a review for a few days.
