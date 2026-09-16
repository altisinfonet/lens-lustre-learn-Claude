# 2026-08-19 — The four gates, the DOB fix, the privacy chooser, and BUILD 1110

**Final commit: `2be7c4f` on `main`. Working tree clean, local byte-identical to GitHub.**
**BUILD 1110 / v1.2.15 — SUCCESS. All three jobs green in 14m 19s, 3 artifacts.**
**1,999 tests pass. Sweep: 148 scene/viewport keys, 0 problems.**

---

## Why this session happened

The owner reported that the registration date-of-birth dropdowns did not work in
the last app build, on **both** web and app, and then said the thing that set the
scope for everything below:

> "we will build one gate you will break another gate which is working.
>  This should not happen ?? What to do ?? You suggest like bullet proof plan 1st"

and

> "I need permanenet solution for this. then fix bug - not shorcut cheap soltuion
>  anymore"

So the gate was built **first**, proven, and the bugs were fixed **through** it.

---

## The DOB bug — what it actually was

**Not a missing dropdown. An intercepted one.** Both `<select>` elements rendered
at the correct size, in the DOM, plainly visible — and swallowed every tap.

`src/components/ui/calendar.tsx`'s `nav` class is `absolute inset-x-0 top-0 z-10`
— a **full-width** bar laid over the caption row where the dropdowns live, with
its two arrows at the far ends and ~250px of empty bar in between, painted on top
of both selects. Introduced by the react-day-picker v10 rewrite (`78dc2f8`).

Proved by hit test, not argued from the code: `document.elementFromPoint()` at the
centre of the month select (12 options) and the year select (69) returned the NAV
element, at all four viewports.

**Fix:** `pointer-events-none` on the nav container, `pointer-events-auto` on each
arrow. Keeps the bar's geometry (it is what centres the arrows) and stops it
intercepting. Mutation-proven **both ways** — removing the container rule reports
4 unreachable selects; removing the arrow rule reports the arrows instead, which
is the careless version of this fix trading one dead control for two.

---

## The four gates

| Gate | What it does | Proof |
|---|---|---|
| **1 — Universal reachability** | Every interactive control on every scene/viewport must be the element actually painted at its own centre | Catches DOB on all 4 viewports |
| **2 — Baseline diff** | Every control's size, reachability and option count recorded; a later run fails on any control that got **worse**, even on a screen nobody re-checked | Mutation-proven: 69→9 dropdown options, and a vanished button, both caught |
| **3 — Decision register** | `docs/DECISIONS.md` — a deliberate removal is not done until it is written down, with a **checkable** restore condition | `mutate-decision-register.mjs` 10/10 |
| **4 — Un-bypassable** | `ui-gate` job blocks `build-aab`; a second workflow runs it on every push | `mutate-ui-gate.mjs` 17/17 |

**Gate 4 was observed working on a real release attempt.** Android Build #107 went
red at the gate and `build-aab` was **skipped — 0s, no .aab, nothing reached
Play**. Build #110 then showed the other half: gate green, build ran, artifacts
produced.

### Key files

- `tools/uishot/capture.mjs` — the sweep (Gates 1 + 2)
- `tools/uishot/gate.mjs` — one command, the same one CI and a laptop run
- `tools/uishot/baseline.json` — 148 keys, 2,569 controls
- `.github/workflows/android-build.yml` — `build-aab` needs `[security-gate, ui-gate]`
- `.github/workflows/ui-gate.yml` — the same gate on every push, builds nothing
- `src/__tests__/uiGateCannotBeBypassed.test.ts` — asserts the wiring
- `src/__tests__/decisionRegister.test.ts` — asserts the register cannot go stale

**`npm run ui:gate`** runs the whole thing locally. **Never** run
`--baseline-write` from CI: a run that re-records its own baseline can only ever
agree with itself. Re-recording is a deliberate, reviewed act.

---

## The privacy chooser — D-001 superseded, D-002 active

**The owner's decision, and it was his to make.** Told plainly that a restored
"Friends" or "Only me" post keeps a publicly fetchable photo URL until the media
engine is live — and that hiding the link inside the app changes nothing, because
the file is served with no server-side check, so a URL obtained at any point keeps
working for ever — he chose to restore the chooser **with the gap disclosed**.

**The gap is unchanged and still verified in production:** `post-images` is a
public bucket whose `storage.objects` SELECT policy is `(bucket_id =
'post-images')`, with no privacy condition.

**What the three audiences actually do** — read from the live function
definitions, not from memory:

- `public` → anyone, including signed-out visitors.
- `private` → the owner only.
- `friends` → `are_friends()` requires a `friendships` row with
  **`status = 'accepted'`**, in either direction. A pending request does not
  count.
- In every case the owner always sees their own post (`_viewer_id =
  _post_user_id` short-circuits first).

Enforced in `can_view_post()` at the database, so it holds on web, app and any
other reader.

- `PostAudienceChooser` is **one component used by both composers** — the web's
  screen 1 and screen 2, the only one an Android member reaches. It renders
  `PrivacyGapNotice` **itself**, so there is no arrangement of `WallPosts.tsx`
  that offers the choice silently.
- `PrivacyGapDisclosed.test.ts` pins it. `mutate-privacy-disclosure.mjs` 10/10.
- **D-002 ends when** authorized media delivery is live and the Media-URL cell is
  green. At that point: delete `PrivacyGapNotice.tsx`, delete the pinning test,
  close the entry — all in the same commit.

---

## What the gate found that nobody was looking for

1. **Category strip** (feed + create-from-feed, 390px): the "All categories"
   arrow sat over the visible centre of the peeking chip, so tapping
   "Architecture" opened the wrong thing. *My first fix was wrong and the gate
   rejected it* — `pr-11` is padding **inside** the scrolling content, so chips
   still slid under the button; it needed `mr-9`, which stops the scroll
   viewport where the button starts.
2. **The audience chooser had never been photographed** — not once, in the whole
   life of the harness. The `composer-*` scenes mount the photo strip only.
   Within seconds of a scene existing, two real defects surfaced in code
   restored verbatim from history: the web pill was **89x22** (10px under the
   32px floor, broken since before the withholding), and the app row showed a
   **globe** — the symbol for "anyone can see this" — beside the words "Only
   Me". The second was found by *looking at the screenshot*, not by any
   assertion.
3. **132 pre-existing NO FIXTURE errors** on the wall screens, red long enough
   that the sweep's red had stopped meaning anything. 8 fixtures added.

---

## Mistakes made in this session, kept on the record

- **An opacity guard would have blinded both gates to every dialog's Close
  button.** Skipping controls under `opacity: 0.9` fixed a flaky baseline and
  silently dropped 143 real controls, because Radix's close button is
  `opacity-70` *by design*. Caught by checking what the baseline lost, not by a
  test. Fixed at the cause: the sweep now waits for the Web Animations API.
- **A test failed on its own comment.** Both workflows say "there is deliberately
  no `|| true` fallback" — and that sentence contains `|| true`. Whole-line
  comments are now stripped before the check.
- **Two holes in the register, both found by mutation:** a CLOSED decision could
  keep its pinning test (so the register could claim a gap was fixed while the
  product still had it), and a SUPERSEDED one could name a file that does not
  exist.
- **`main` was briefly broken.** A web upload's Commit click silently did not
  register, so `WallPosts.tsx` imported two files that were not there. Caught by
  **diffing the remote tree against the tested one** rather than trusting the
  uploads.
- **A retry that could not retry.** Builds 1107 and 1109 both hung 30 minutes on
  `npx playwright install --with-deps chromium` — apt could not reach Ubuntu's
  mirror. The retry added after 1107 was useless because **apt does not fail
  fast**: attempt one outlived the job budget, so attempt two never ran. Fixed at
  the cause by dropping `--with-deps` entirely; the browser comes from
  Playwright's CDN and no package manager is touched. It still fails honestly if
  Chromium cannot launch.

---

## BUILD 1110 / v1.2.15 — shipped to Play as a DRAFT

Run #110, commit `2be7c4f`. Security gate 10s · **UI gate 7m 57s GREEN** ·
build-aab 6m 15s · 3 artifacts. Uploaded to the Play production track with
`status: draft` — **not rolled out**. The owner reviews and rolls out.

Carries: the DOB fix, the category-strip fix, the restored audience chooser with
its disclosure, and the gate itself.

⚠ **Version naming.** `versionCode` is `1000 + run_number`, `versionName` is set
in the workflow. 1107 and 1109 produced **no artifact**, so 1.2.15 was correctly
reused — the same rule 1105/1106 followed. **Bump `versionName` before the next
cut.**

---

## Open, and what to do next

1. **D-002 stays ACTIVE** until authorized media delivery is live. The engine is
   built and migration-ready (`migrate-post-media`, not deployed; `media_objects`
   and `post_media` are empty). Deploying it is a separate, hash-bound decision,
   and it is what finally makes "Only Me" true at the file level.
2. **Ledger version drift, still unresolved** — artifact filename
   `20260817170000` vs the ledger-recorded version `20260818011014`. Untouched
   this session.
3. **`git push` does not work from the Cowork sandbox** — the proxy refuses this
   repo, so everything went up through GitHub's web upload, folder by folder.
   That is what caused the broken-`main` incident above. Getting a real push
   working is worth doing before the next session of this size.
4. **Roll out 1110 from the Play Console** when ready — it is sitting as a draft.
