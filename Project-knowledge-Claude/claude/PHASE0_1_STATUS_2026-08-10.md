# Status — done / pending, one by one

`main` = `6bf47eb`. Typecheck ✅ Security ✅. Suite: **980 passed, 6 failed** —
the known pre-existing set (4 ProfilePhotoPrompt, 2 judging). Zero new.

---

## ✅ DONE

| # | Item | Evidence |
|---|---|---|
| — | **App blank pages** — `crypto.randomUUID` missing on old Android WebViews | Found in the live Error Log: 7× *Blank page / crash*, 13× *route crashed*, all `platform=app`, all on **/login**. Fixed with `safeRandomUUID()` + a repo-wide gate |
| — | **Search freezes the whole app** | `<AnimatePresence>` removed from the full-screen panel; 7 tests |
| **N2** | **Tagging did not work on web or app** | Measured live: dialog **1020px** tall in a **710px** viewport, picker **45px below the screen edge**, scrolling switched off. Fixed; re-measured after deploy at **494px, fits** |
| — | **Picker now opens at the pin, small** | 230px popover, edge-clamped, flips up when the pin is low. Verified live |
| — | **Anyone may tag anyone** | UI *and* database. Trigger gate removed and verified in production: friend gate **false**, decline guard **true**, 20-cap **true**, deleted-account lock intact, all 4 SELECT policies untouched |
| **CDN images** | Checked | **50/50 thumbnails and 10/10 originals load.** Current content is healthy. The failures in the log are a small **legacy** set of old `-thumb` files, not a live problem. The Site Health → *Thumbnail Backfill* tool exists for exactly this |
| **N1** | **Photo quality** — cause found, fixed, pushed | See below |

### N1 — measured, and it was my change

Live feed, before the fix:

| | |
|---|---|
| slot | **588 CSS px × DPR 1.125 = 662 device px needed** |
| delivered | **600 × 400** (480 × 600 for portraits) |
| `srcset` | **none** |

On a phone at DPR 3 the same slot needs ~**1,760** device pixels and still got
600 — three times too few. That is the softness.

**The upload was never the problem.** Stored originals measure 1920×1280,
1080×1350, 2560×1165. Nothing is lost coming in. The wrong copy was displayed.

**Why:** `isTransformable()` only matches `/storage/v1/object/public/…`, but
every stored address is on the custom domain `cdn.50mmretina.com`. So
`transformable` was always false, `buildSrcSet()` always returned undefined, and
the sharp layer fell through to `thumb ?? src` — **my change of 2026-08-07**.

**Fix:** the original is the sharp image again; the thumbnail keeps painting the
instant backdrop **and** is offered beside the original with true width
descriptors, so the browser chooses by slot size *and* device pixel ratio — the
one input we cannot read at render time. A small grid cell on a 1× screen still
downloads only 600px.

Portrait widths are computed, not assumed (a 1080×1350 thumbnail is 480 wide,
not 600 — declaring 600 would make the browser skip the original exactly where
it is needed).

**Two existing tests asserted the old behaviour** — *"shows the STORED
thumbnail"* as the sharp image, and *"no srcset"*. Those encoded the bug. They
were **rewritten to the corrected rule, not deleted**, with the reason recorded
in place. 11 new tests + 3 rewritten, mutation-checked.

---

## ⚠️ NOT YET OBSERVED LIVE — the honest caveat on N1

The code is on `main`, CI is green, and Cloudflare shows the production
deployment `main 6bf47eb` **green, 4 minutes old**. But re-measuring
`www.50mmretina.com` still shows `srcset: false` and the 600px thumbnail.

I checked why rather than assuming:

* the regex was run against **real stored URLs** from the database — it matches
  every one, so the logic is not the problem;
* the JavaScript the site actually served (`WallPosts-CrOAWncO.js`) was fetched
  and **does not contain the new code**;
* clearing Cache Storage and unregistering the service worker did not change it.

So the site is still being handed the **previous bundle**. This is
`DEPLOY_CACHE_GOTCHA.md` territory, not a code fault. The lever for it is
**Admin → Site Health → Cache-Buster → "Bump version now"**, which forces every
currently-online member to refresh — that affects all 84 people, so it is the
owner's call, not mine to pull unilaterally.

**Until that resolves, N1 is "fixed and shipped" but not "seen working".** I am
not claiming the second.

---

## ⏳ PENDING

| # | Item | Needs a build? |
|---|---|---|
| **P5** | 4 red ProfilePhotoPrompt tests | no |
| **P6** | `package-lock.json` out of sync (13 packages) | no |
| **N4** | Follow notifications say "A member" | probably not |
| **N3** | Duplicate skeleton after posting | yes |
| **P4** | 15 production dependency vulnerabilities | yes |
| **P8** | Text readability — **you approved this** | yes (web first) |
| **P7** | Two `App.tsx` fetch settings | yes |
| **P9** | Cache persistence | needs a security review first |
| **P10** | 2 judging tests | needs your input |
| **P11** | Security gate blocking the Android build | rides with the build |
| **P12** | Admin Security Audit panel | no |
| **P2** | **Hand-test the app with a finger** | yours |
| **P3** | Post one comment on the live site | yours |

### Still open from earlier, unchanged
* **A missing `/assets/*` file returns the homepage instead of 404**, and
  `immutable, max-age=31536000` then caches that for a year. One member hit it
  today. The fix is a hosting setting and has been waiting on your decision
  since 5 August.
* **`SYS-9008` × 20** — the app cannot ask Play whether an update exists
  (`ERROR_APP_NOT_OWNED`, `Failed to bind to the service`). If members are never
  prompted to update, fixes do not reach them. Worth watching after 1059.

---

## Build cadence — unchanged

No build yet. **1059** now carries: blank pages · search freeze · tagging
· anyone-can-tag · photo quality. Cut it after N3 and P4, once everything has
run on the web for 24 hours.
