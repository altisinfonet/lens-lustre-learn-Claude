# The batch the owner asked to be finished before any build — 2026-08-13

> Owner, 2026-08-12 night: *"sorry, i will upload the build - unless complete it - even some
> pending task is still pending since starting of the chat that is i am not calculating here…"*
>
> So: **no build was cut.** Everything below is on `main` at `962570d`, byte-verified.
> One item is deliberately NOT in it — see "What is still open".

---

## Landed — `962570d`, 17 files, all byte-identical to the gated local tree

Verification method: each file's blob hash compared against `origin/main` after the upload.
All 17 `OK`. `git diff HEAD origin/main` was empty.

| # | Owner's words | Root cause | Fix |
|---|---|---|---|
| 1 | *"a bit slow network … 50mm retina posts not showing"* | `fetchBroadcastPage` swallowed a double failure (RPC **and** fallback) into `return fallback || []` — an empty SUCCESS. React Query had nothing to retry. | The fallback now **throws** when it errors. `useFeedQuery` retries 3× with 2/4/8s backoff. `Feed.tsx` gained a real error branch. |
| 2/9 | *"every names are showing as ? then coming to names automatically"* | A failed profile batch resolved to placeholder rows; the name fell back to "Photographer" and the avatar to `"?"` — two different fallbacks for one unknown. Stuck for the 30s negative TTL. | The **names** query in `profileMapCache` retries (250/500ms); badges/roles/presence deliberately do not. New `src/lib/displayName.ts` derives the avatar letter from the display name, so an unresolved author is a **"P"**, never a `"?"`. |
| 5 | *"i want create post … no facebook style (only in app) what's in your mind will show"* | — | `+ Create` in the app top bar → `/feed?compose=1`; `WallPosts` consumes the flag once and opens the composer. The Facebook-style row is gone **in the app only**; the website keeps it. |
| 8 | drafts silently vanish | `if (error || !Array.isArray(data)) return []` — same defect class as the categories bug. | Throws on real failure, retries 3×. An **absent table** still returns `[]`, because "no `post_drafts` table" genuinely means "no drafts" until the Stage C migration is applied. |
| P1 | *"my rule was always badge will show with name everywhere"* | The tagged name in "X **with Y**" was the one name rendered without `AutoBadge`. | Verified tick on the tagged name in the header **and** in the "and 19 others" list. Costs no extra request — `enrichPosts` already caches those profiles. |
| P2b | `CriteriaSliders`, `AdminPerformance`'s `Toggle` | Declared inside render → new element type every render → remount. `CriteriaSliders` owns a controlled `<Input>`, so a judge's ten in-progress scores were reset by any unrelated parent render. | Both hoisted to module scope with explicit props. `CriteriaSliders` is now keyed by photo so switching photos still resets. |

### The guard test had a blind spot, and that is the finding worth keeping

`noComponentDefinedInRender.test.ts` located a component's body by jumping to the first `{`
after the arrow. That works for `=> { … }` and **silently fails** for `=> ( … )` — it landed on
the first JSX expression container (`value={v}`) and returned two characters, so the
"does it contain a text input?" test never saw the body.

Roughly half this codebase is written in the concise form, `AdminPerformance`'s `Toggle`
included. The guard had never once looked inside those files while reading as though it
covered all of them.

Fixed: the delimiter is now whatever follows the arrow, matched against its own pairs.
Widening it surfaced **no new offenders**, which is the good outcome — but it was found by
writing a fixture for the guard, not by reading it.

The allowlist is now **empty**. The old entry doubled as proof the detector still worked; with
it gone, two fixtures (one that IS the bug, one that is the accepted fix) prove it instead.
A guard that passes vacuously is worse than no guard.

---

## Gates, all before the upload

- `tsc --noEmit` clean.
- **1,306 tests pass**, 1 skipped, 106 files.
- `vite build` ✓ (4,709 modules).
- Security gate **PASS** — 0 critical, 0 high, 2 medium, 2 low (all pre-existing, unchanged).

---

## What is still open

**The Instagram-style in-app photo grid picker** — deliberately NOT in this batch.
It is not a bug fix: it needs `@capacitor-community/media`, the `READ_MEDIA_IMAGES`
permission and a Play data-safety justification, i.e. a new native dependency and a store
review surface. It is the one thing standing between this batch and "complete", and it is a
decision, not an oversight. Owner's call whether it goes in this build or the next.

Unchanged and still owner-gated:

- **Stage B2** (`POST-CAT-002`, 1–5 category minimum) — migration written, not applied.
- **R8 full mode** — owner deferred to a later release.
- **`ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`** hold wrong values; harmless since
  `1fcd745` because CI resolves both from the keystore itself.
- **Scheduled-post publisher** (edge fn v21) has still never executed in production.
- **Verify on the device** after the Play rollout.

---

## Transport note, for whoever does this next

`git push` is still proxy-blocked (403). Full-file gzip+base64 upload of these 17 files
would have been ~154 KB of hand-relayed text. Instead the browser **fetched the old files
from GitHub itself** and applied a line-level diff computed here — 20 KB of base64 total,
each rebuilt file SHA-256-verified against the local tree before it was staged.

The per-group rolling hash caught **one corrupted character** again (`…TnmkXKEPV` for
`…TnmkXKENV`, group 1). Right length, wrong contents. That is now four times. Never skip it.
