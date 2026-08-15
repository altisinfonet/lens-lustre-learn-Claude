# UI Checking Policy — what gets verified, where, and by whom

**Why this exists, in the owner's words, 2026-08-15:**
> "multiple times App building with 3000 bugs visually, that must not happen"
> "find out a way to check the app by you before uploading blindly"

Both are fair. Until today client UI was written, checked for *logic* by 1,644 vitest assertions, and shipped — with nobody's eyes ever on the pixels, because the app only rendered on the owner's device. A test that proves a function returns `"Shiv Sankar Das"` has nothing to say about a button 8px too short to hit.

This is the policy that replaces "it should be fine".

---

## The rule

**No client UI is pushed until it has been rendered, photographed at three widths in app mode, swept for defects with zero findings, and the screenshots shown to the owner.**

Not "usually". If a screen cannot be put in the harness, that is a reason to restructure the screen, not a reason to skip the check.

---

## Tier 1 — Verified here, before you ever build (every change, automated)

`npm run ui:harness` then `npm run ui:shot`. Real Chromium, real components, real stylesheet.

| Width | Why this one |
|---|---|
| **360 × 800** | The common Android width, and **narrower than the iPhone size designs get eyeballed at** — so it is where layout breaks first |
| **390 × 844** | iPhone |
| **1280 × 900** | Desktop web |

Each is captured twice where it matters: as the **website**, and with `?native=1` which installs a stub `window.Capacitor` so the app's native-only branches render — the app-only screens, not their web fallback.

Every run reports, and any finding fails the run:

1. **Console errors and warnings**, with only two filtered and both named in the source with a reason.
2. **Failed network responses**, with the URL. A bare "404" that names nothing is a mystery that gets shrugged at.
3. **Horizontal overflow** — measured from the page. Anything wider than the screen is the sideways wobble that makes an app feel unfinished.
4. **Tap targets under 44 px.** Apple's minimum; Material's 48dp rounds to the same place. Below it, thumbs miss.
5. **Clipped content** — text cut off by its own container, excluding deliberate ellipsis.
6. **Off-screen controls** — buttons present in the DOM but pushed past the edge, unreachable.
7. **Images that did not render.** On a photography platform this is the worst possible visual bug.

`?safearea=1` paints the notch and home-indicator zones, because a desktop browser reports both as zero and a bar tucked under the status bar is otherwise invisible here.

**It found two defects on its first run, both mine:** a 36px-tall button, and a 404 the harness itself was causing. Neither was fixed by filtering.

---

## Tier 2 — Verified by the build (CI, on the owner's build)

- TypeScript compiles, the suite passes, the production bundle builds.
- The harness cannot reach a release: **verified by running a real build** — `dist/` contains exactly one HTML file and zero occurrences of "harness" — and locked by `uiHarnessCannotShip.test.ts`, whose three guards were each deliberately broken to confirm the test catches them.

---

## Tier 3 — ONLY a real device can answer this. I must not claim otherwise.

The harness renders the same web code the APK wraps, so **layout** carries over. These do not, and no screenshot from this container is evidence about them:

| What | Why the harness cannot answer it |
|---|---|
| The real photo picker | `?native=1` is a **stub**. It proves the screen that follows a selection; it proves nothing about the plugin on a real phone |
| Push notifications arriving | Needs FCM, a real token, a real device |
| The on-screen keyboard | Android resizes or pans the viewport when the keyboard opens. A desktop browser has no keyboard |
| The actual notch | `?safearea=1` paints a plausible inset. Your phone's is its own number |
| Scroll smoothness, memory, battery | A headless desktop browser at 2× is not a mid-range Android |
| Android WebView quirks | Same engine family as Chromium, not the same build |
| Anything about the APK itself | Install, update, permissions, Play policy |

**So the honest split is: I can prove a screen is not visually broken. I cannot prove the app works.** Tier 3 items get marked DEVICE and stay open until the owner reports back from a real phone — never closed by reasoning.

---

## What this does not fix

The screenshots are of **components in isolation with invented data**. Two real faults live outside that boundary and must be named rather than implied away:

- **A screen that is fine alone and wrong in place** — the wrong spacing against the real header, a z-index fight with the real bottom bar. Mitigated by also capturing whole pages, not only components.
- **A state nobody thought to add as a scene.** The sweep only ever examines what it was given. Every new scene must cover empty, one item, many items, a long caption and a missing image, because those are the states that break — not the pretty one.

---

## The workflow, concretely

1. Write the component.
2. Add a scene covering its real states.
3. `npm run ui:shot` — fix until zero findings at all three widths.
4. **Look at the screenshots.** The sweep catches the measurable; only looking catches ugly.
5. Send them to the owner **before** pushing, so "that's wrong" costs a minute rather than a build.
6. Push. Anything Tier 3 goes to the owner as an explicit list of what to check on the phone.
