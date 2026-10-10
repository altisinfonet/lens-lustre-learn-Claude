# How this live site is kept working (agreed 2026-08-07/09)

Written after the owner asked the question that mattered more than any bug:
> *"this is a live site, even i can't find all issues too... i am upset what to
> do to maintain it and to work with you. what strategy i must follow to get
> bugfree service?"*

## The honest framing

"Bug-free" is not achievable on a live product. Two things are:

- no member-visible problem survives more than ~15 minutes
- no single mistake can take down the whole app

Before this, **both were broken**: the 2026-08-07 image bug ran for hours and
took search down with it.

## What was actually wrong with how we worked

1. **The owner was the monitoring system.** Every incident in this project's
   history — the Cloudflare image outage, the mojibake, the search freeze, the
   guessed thumbnail — was found by him, on his phone, after members were
   already affected.
2. **One mistake spread.** Nothing bounded blast radius (see
   ROOT_FIX_IMAGE_RETRY_AMPLIFIER.md).
3. **The app cannot be rescued quickly.** Web = minutes. App = a build + Play
   review. Yet risky changes were going straight into builds.

## The four rules

1. **Web first, app later.** Risky changes soak on the website with real members
   before they are allowed into an app build.
2. **A watchdog, not the owner.** See below.
3. **Measure before shipping, never assume.** The 2026-08-07 bug was a guessed
   address never checked against production data.
4. **Small, separate releases** so cause is never ambiguous.

Owner's part (~2 min per release): feed images, search, open a profile, post a
photo, notifications. Report with a screenshot + which page.

## The watchdog — TWO layers

### 1. GitHub Actions — the real one

`.github/workflows/health.yml` + `scripts/health-check.mjs`, **every 2 hours**
plus on-demand from the Actions tab. GitHub emails the owner when it goes red.

Runs with `DEEP=1`, which enables the checks that matter most:

| check | why |
|---|---|
| thumbnail contract (aligned 1:1, recent posts have one) | the shape of BOTH August image outages, visible in data first |
| Supabase-hosted thumbnails load | real bytes, not just a row |
| **the live website loads and contains its app shell** | catches a blank-page deploy |
| **real member photos load from cdn.50mmretina.com** | the exact 2026-08-07 failure |
| member activity (posts+comments in 36h) | zero of both is an outage signature |
| CI health | a red build means the app being uploaded does not exist |

Verified working: Health #3 green, and Health #1 reported
`CDN photos sampled: 30, broken: 0`.

### 2. Cowork scheduled task — the thinking second opinion

`trig_01W9XX6itmiXw7aLiMjLSEFx`, every 6 hours, push + email. It runs the same
script but **cannot reach the site** (see below), so its value is judgement:
verify a finding, explain it in plain language, say whether it needs a build.
Instructed never to change code, push, or cut a build.

## THE 403 WAS MISDIAGNOSED — corrected 2026-08-09

This file originally recorded "Cloudflare rejects datacenter IPs, so no
server-side checker can reach the site." **That was wrong**, and wrong in the
same way as the bug the watchdog exists to catch: a conclusion from one symptom,
never checked. Re-measured with full headers:

    supabase.co        →  HTTP/1.1 200 Connection Established   (proxy tunnel)
    www.50mmretina.com →  HTTP/1.1 403, Content-Length: 36, NO cf-* headers
    example.com        →  connection failure
    cloudflare.com     →  connection failure

A Cloudflare block carries `cf-ray`/`server` headers and a challenge body. This
has neither, refuses the CONNECT itself, and blocks example.com too — so it is
**the Cowork sandbox's own egress allowlist**. Confirmed from the owner's
Cloudflare dashboard the same day: of **3,560 requests in 24h, 11 were
mitigated**. Cloudflare is not blocking monitoring at all.

**Consequence:** the full live check IS possible from any runner with open
internet — which is why the real watchdog now lives in GitHub Actions, and why
the live checks are gated on `DEEP=1` rather than abandoned. Unreached is never
reported as down.

## Three self-inflicted faults the watchdog caught in its first hour

Worth recording, because each is a lesson and each was caught by the tool itself
rather than by the owner:

1. **False alarm on avatars.** It flagged a recent post with no thumbnail. The
   post was an *"updated their profile picture"* post, whose image is an avatar
   — avatars never get thumbnails. Left unfixed it would have cried wolf on
   every profile-photo change. **A watchdog that is routinely wrong gets
   ignored, which is worse than none.** (Same case explains the broken "Sudip
   Roy updated their profile picture" card in the owner's screenshots: the old
   code derived `avatar-thumb.webp`, which never existed.)
2. **A leaked-looking key.** The script pasted the public Supabase anon key
   inline; the repo's gitleaks gate failed the build. The gate was RIGHT — a JWT
   literal is exactly what it should catch, and it cannot know which JWTs are
   harmless. Fixed by reading the key at runtime (env var, else the repo `.env`),
   never by weakening the gate.
3. **A self-perpetuating alarm.** The CI check flagged *any* failure in the last
   12 runs, so (a) it reported failures already fixed by a later green run, and
   (b) it counted **itself** — one red Health run guaranteed the next Health run
   would fail, forever. Fixed: only the LATEST run of each workflow counts, and
   Health is excluded from its own input.

## Still deliberately deferred

**React Query cache persistence** (instant load on reopen). Deferred twice on
purpose: it adds two dependencies, stores data on the device, and needs a
security review so one account cannot see another's cached data on a shared
phone. Requirements in BUILD_1057_RELEASE.md.
