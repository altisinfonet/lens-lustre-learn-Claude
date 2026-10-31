# OFF-6 — CI harness: the app starts offline and shows the stored feed

**Unit (MASTER R-90):** "CI harness. App starts offline → cached feed shown. A like made offline → delivered once online,
exactly once."

## Leg 1 — enforced in CI (`.github/workflows/d2-offline-harness.yml`)
`tools/uishot/offline-harness.mjs` drives a real Chromium against the Vite dev server:
1. `offlineharness.html?phase=seed` — the REAL Feed screen in the REAL provider stack (`AppShell`) with the harness fake
   backend and the OFF-1 bridge, exactly as `App.tsx` mounts it → the fixture post "Morning fog on the river…" renders and
   OFF-1 writes the feed to IndexedDB (checked by reading `retina-offline/kv`).
2. The pre-OFF-1 localStorage page (`feed_cache_v1`) is deleted, so it cannot be what answers.
3. `?phase=offline` — the app starts with no data network (every Supabase call fails like a dead link, React Query offline,
   `navigator.onLine` false) → the post must be on screen.
4. Control `?phase=offline&nobridge=1` — the same start without OFF-1 must NOT show it; if it does, the harness fails.

| run | seed shown | feed stored | offline shown | control shown | verdict | UTC |
|---|---|---|---|---|---|---|
| this branch | true | true | **true** | false | PASS (leg 1) | 2026-10-04 15:47:52 |
| mutant: OFF-1 hydration removed | — | — | **false** | false | **FAIL**, exit 1 | 15:48:18 |

Raw output: `harness-run-20261004T154752Z.json`.

## Leg 2 — BLOCKED on OFF-2
"A like made offline → delivered once online, exactly once" needs the outbox and D1's server-side idempotency keys (OFF-2,
D1 queue item 1). The harness prints it as BLOCKED; it is never counted as a pass.

## Stated limit
The JS bundle still comes from the dev server: this proves the DATA path offline. Loading the web shell itself offline is the
app-shell question (the Capacitor app ships its shell on the device). `offlineharness.html` is development-only and is not
part of a build (Vite builds `index.html` only; the page throws outside dev).
