# ✅ RESOLVED — the web deploy was failing on a frozen bun lockfile. 2026-08-06.

**Fixed in `db225de`. Production is live on `2026-08-06-11`.** Everything below
is kept because the diagnosis was got wrong twice before it was got right, and
the wrong reasoning is the useful part.

---

## THE ACTUAL CAUSE

Cloudflare Pages does **not** run npm. Its build log, read from the dashboard:

```
Installing project dependencies: bun install --frozen-lockfile
error: lockfile had changes, but lockfile is frozen
Error: Exit with error code: 1
Failed: build command exited with code: 1
```

`package.json` gained `@use-gesture/react` in commit `d751e26`. The repo's
**`bun.lock`** did not. `--frozen-lockfile` refuses to reconcile the difference
— by design, that is the whole point of the flag — so the build died before it
ever reached vite.

**Every deployment from `d751e26` onward failed.** Production sat on `ea0256a`,
the last commit before the dependency landed — which is exactly why the live
marker read `2026-08-06-8`, and why the owner's own `HelpSupport` e-mail fix
never reached members either.

**The fix:** `bun install`, which added **five lines** to `bun.lock` and touched
nothing else. `bun install --frozen-lockfile` then reported "no changes" —
the same command Pages runs. Pushed as `db225de`; the next deployment went
green in ~3 minutes.

`bun.lockb` was NOT modified. Bun 1.2+ writes the text `bun.lock`; the binary
one is legacy and is not what the build reads.

## 🔴 THE MISTAKE, AND IT WAS MINE

Two failures, both avoidable:

**1. I withheld the lockfile on a guess.** When `npm install` reconciled
`package-lock.json` as a side effect, I reverted it and shipped `package.json`
alone, reasoning that CI runs `npm ci || npm install` and would fall back. That
is true of GitHub Actions. **It was never checked against Cloudflare, which
does not use npm at all.** I then wrote in `BUILD_1055_IMPLEMENTATION.md`:
*"Cloudflare Pages must be doing the same, since 2026-08-06-8 deployed
successfully."* The word "must" is doing all the work in that sentence, and it
was wrong. WORKING_RULES §0 forbids exactly this.

**2. I called it unreachable without looking.** I reported the deploy as
"outside my reach — it needs the Cloudflare dashboard", four separate times,
while holding a browser session already signed in to that dashboard. The owner
had to point this out. The whole diagnosis took four minutes once I opened it.

**The rule this produces: when a deploy fails, open the deploy log FIRST.**
Origin-vs-edge probing, bundle hashes and marker checks are for confirming what
the log says, not a substitute for reading it.

## What ruling out the edge cache DID achieve

The `.pages.dev` origin was compared against `www.50mmretina.com` and both
served the identical stale bundle. That was correct and worth doing — it proved
this was neither the `seo-edge-injector` Worker nor an edge cache, so
`DEPLOY_CACHE_GOTCHA.md` §2's "Purge Everything" would have done nothing. It
just should have come after reading the log, not instead of it.

## Verified live after the fix

| Check | Result |
|---|---|
| Pages production deployment | `main db225de` — **green** |
| `window.__APP_BUILD` | **`2026-08-06-11`** |
| Entry bundle | `/assets/index-CHX_jf5t.js` — **byte-identical hash to a local build of `b057f9a`** |
| `app-zoom-locked` in deployed CSS **and** JS | ✅ |
| UI-8007 · UI-8008 · UI-8009 in the deployed entry | ✅ all three |
| `LIGHTBOX_GESTURE_THREW` · `LIGHTBOX_IMAGE_LOAD_FAILED` | ✅ both |
| Owner's e-mail fix, in the **route chunk** | ✅ `HelpSupport-BIfOTPis.js` contains `mail@50mmretina.com` |

**A false alarm worth recording:** a first pass searched only the *route* chunks
for UI-8007/UI-8008 and found them in none of 95, which looked like the zoom
feature was missing from the deploy. It was the probe that was wrong — the zoom
code sits in the **entry** bundle, because `zoomPolicy` is imported by
`main.tsx`. A local build of the same commit produced the same entry filename,
`index-CHX_jf5t.js`, which settled it. Check where code actually lands before
concluding it is absent.

## Still true, unchanged by this

`package-lock.json` remains out of sync with `package.json` (13 packages,
pre-existing, unrelated to 1055). `npm ci` still fails and both GitHub
workflows still silently fall through to `npm install`. **Cloudflare no longer
cares** — it uses `bun.lock`, which is now correct. Repairing the npm lockfile
is still worth doing and still needs its own GO.
