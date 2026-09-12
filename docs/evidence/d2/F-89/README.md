# F-89 · The 404 renders bare, and carries its own way back in

Instrument: real Chromium **141.0.7390.37** via Playwright, against the app's own dev server and
against the UI harness. `f89check.prepared.mjs` is the probe, committed so it can be re-run and
re-planted.

## The mechanism, and why it is not a route list

`Layout.tsx` decides the two-column feed shell by matching `pathname` against `hideSidebarRoutes`.
A 404 happens at an **arbitrary** path, so it can never be on that list.

Worse — and this is the part a route-list fix would have failed **silently** — since F-85/F-86 the
404 is reachable **two** ways: the catch-all `<Route path="*">` in `App.tsx`, and rendered **in
place** by `CustomUrlProfile` when a vanity URL resolves to nothing, at the member's own typed
path. Both land inside the same `<Outlet />`, and nothing about the URL distinguishes the second
from a real profile. **Only the component knows which is rendering.**

So the page raises a flag and the layout reads it: `BareLayoutContext`, with `useBareShell()` called
from `NotFound`. **`useLayoutEffect`, not `useEffect`** — a layout effect runs after render and
*before paint*, so the shell is already gone on the first frame; with `useEffect` the sidebars would
paint once and then vanish, a visible flash of exactly the clutter being deleted.

## C-34 — the probe, planted red then green

Same probe, same command, real dev server, catch-all path.

**BEFORE** (`Layout.tsx`, `NotFound.tsx` et al byte-identical to `origin/staging`):

```
FAIL desktop-1280 dark  signed-out asides=2 overflow=0 signup=false login=false home=true
       -> 2 sidebar(s) visible; no signup+login in the page's own content
       -> own links: ["/","/competitions","/discover","/journal","/cookie-policy"]
FAIL desktop-1280 light signed-out asides=2 ... (same)
FAIL android-360  dark  signed-out asides=0 overflow=0 signup=false login=false home=true
       -> no signup+login in the page's own content
FAIL android-360  light signed-out asides=0 ... (same)

F-89 CHECK: FAIL — 6 problem(s).
```

**Both of the Auditor's findings reproduce independently in that output:**

* **The sidebar defect is desktop-only** — `asides=2` at 1280, `asides=0` at 360. Responsive CSS
  already hides them on a phone. Fixing only what the Owner's screenshot showed would have left
  half of this standing.
* **No way back in at either width** — `signup=false login=false` in the page's own content at
  **both** 1280 and 360. On desktop those links existed only because the sidebar happened to carry
  them, which is chrome, not a 404 affordance; the moment the shell goes, desktop loses them too.

**AFTER**:

```
ok desktop-1280 dark  signed-out asides=0 overflow=0 signup=true login=true home=true
ok desktop-1280 light signed-out asides=0 overflow=0 signup=true login=true home=true
ok android-360  dark  signed-out asides=0 overflow=0 signup=true login=true home=true
ok android-360  light signed-out asides=0 overflow=0 signup=true login=true home=true

F-89 CHECK: PASS
```

### Scene mode — 8 of 8, including the signed-IN half

Two harness scenes were added (`screen-not-found`, `screen-not-found-signed-out`), because the 404
had never been photographed once — which is how it shipped inside the feed shell. Both auth states
are scenes deliberately: one scene would certify half of it, the same lesson `screen-wall-visitor`
taught when every wall scene had been the owner's own profile.

```
ok desktop-1280 dark/light  signed-out  asides=0 signup=true  login=true  home=true
ok desktop-1280 dark/light  signed-in   asides=0 signup=false login=false home=true
ok android-360  dark/light  signed-out  asides=0 signup=true  login=true  home=true
ok android-360  dark/light  signed-in   asides=0 signup=false login=false home=true

F-89 CHECK: PASS   (8 of 8)
```

A signed-in member is never shown a signup button, and a stranger is never sent to a members-only
path. Both are asserted, not just described.

## The four false greens, defended against by construction

The Auditor reported four ways an earlier instrument passed on a page that was broken. Each is
answered in this probe rather than trusted to care:

| their false green | what this probe does |
|---|---|
| v1 passed on a page still showing "Loading…" | **gates on the 404's own headline**, never on a timer |
| v2 counted the SITE HEADER's Login/Join | counts only links **not** inside `header, footer, nav, aside` |
| v3 measured before the sidebars landed | waits for the document to **settle** — body text stable across three samples |
| v4 counted `display:none` anchors in a hidden sidebar | visibility measured from the **box**, not from presence |

## The measured structure, before and after

```
UNFIXED   asides: [ w=256 x=64 ]  [ w=288 x=928 ]     middle column: w=544 x=352
FIXED     asides: []                                   middle column: none
```

**A limitation of my own before-screenshot, stated rather than glossed:** those two asides measure
`innerText: ""` here, because the sidebar content comes from `useDashboardContext` and this
container's proxy cannot reach Supabase. The *structure* — a 544px column squeezed between a 256px
and a 288px rail — is exactly the defect and is measured; the *populated* clutter the Owner
photographed ("Welcome / Sign Up Free / Popular Categories") does not load here. My before-shot
therefore understates how bad it looks, and the Owner's own screenshot remains the better picture
of the severity.

## What was kept, and what was cut

**Kept**: the aperture motif and "This frame is empty" — photography-native, ours, and better than a
generic exclamation circle. The `UI-8006` log line, unchanged.

**Cut**: the three tiles (Competitions / Discover / Journal) — three choices is a menu, not a
decision — and the echoed path in a monospace chip. The path is **still recorded**, in `UI-8006`'s
`detail.path`, where it is useful to us and invisible to a stranger who already knows what they
typed. That is the "keep it only if genuinely quiet" option resolved in favour of cutting it from
the page and keeping it in the log.

**Actions, auth-aware**: signed out → `Sign Up Free` (primary), `Log in`, then a quiet `Back to
Home`. Signed in → `Back to Home` (primary) and exactly one onward link, `Discover`. While auth is
still resolving the signed-OUT set is shown, because a member who briefly sees a signup button has
lost nothing, whereas a stranger shown a members-only link has been sent nowhere useful.

**Accessibility and tokens**: `<h1>` for the headline, real `<Link>` elements throughout, a visible
`focus-visible` ring on every action, `max-w-md` (28rem), no new colours — `bg-primary`,
`text-muted-foreground`, `text-foreground` only, so light and dark come from the existing tokens.
Zero horizontal overflow at 360px, measured in all four cases.

## The one path this browser instrument cannot reach

The Owner's exact case is a **single-segment** dead URL, which goes through `CustomUrlProfile`.
In this container `resolve_custom_url` never settles — measured at **146s and still spinning**,
because the egress proxy resets POSTs to `supabase.co` and the client does not give up — so the 404
is never reached there and the page sits on the sidebar's "Welcome / Join our community" forever.
That is this container, not the product.

Rather than claim a reading I did not take, that composition is covered by
`src/components/__tests__/notFoundBareShell.test.tsx`, in jsdom, where the RPC is a mock and
settles. It asserts the flag is raised on **both** routes, and it too was planted red:

```
useBareShell() removed from NotFound -> 2 failed | 2 passed
restored                             -> 4 passed
```

The two GUARD tests pass in both runs on purpose — a resolved vanity URL must **not** raise the
flag, or every profile would lose its sidebars.
