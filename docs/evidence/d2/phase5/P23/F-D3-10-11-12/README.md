# F-D3-10 / F-D3-11 / F-D3-12 · accessibility fixes (P23 DECISION.md §5) — evidence

**Lane:** D2 · **Date:** 2026-10-05 (UTC) · **Stacked on** P23 clause 2 (the axe ratchet + `tools/uishot/axe.baseline.json`).

## Result in the UI gate (harness, iphone-390, axe-core 4.13.0, WCAG 2.2 AA tags)
**37 nodes in 11 scenes → 15 nodes in 6 scenes. All 21 critical nodes fixed (C4).** `axe.baseline.json` lowered in this PR with `axe-ratchet.mjs --lower` (it can only lower).

| finding | rule (impact) | nodes | fix |
|---|---|---:|---|
| F-D3-10 | button-name (critical) | 15 → 0 | post menu `PostCard.tsx` "Post options" ×7; like button `ReactionPicker.tsx` (aria-label = what a tap does, + aria-pressed) ×4; album arrows `PostMedia.tsx` "Previous/Next photo" (same names as the lightbox) ×4 — across screen-feed 7, journey-create-from-feed 7, screen-post-detail 1 |
| F-D3-10 | label (critical) | 4 → 0 | caption boxes named "Caption": `PostCard.tsx`, `EditScheduledPostDialog.tsx`, `WallPosts.tsx` ×2 (a placeholder vanishes on the first keystroke); the 4 hashtag harness scenes now mirror that name |
| F-D3-10 | aria-required-children (critical) | 2 → 0 | `CategoryStrip.tsx`: `role="tablist"` → labelled `role="group"`. The chips are aria-pressed toggle filters with their own Tab stops, not tabs (no tabpanel, no arrow keys) |
| F-D3-11 | color-contrast (serious), harness | 1 → 0 | `AvatarCompletionRing.tsx` % badge: white text 2.30 / 1.53 / 2.14 : 1 → near-black 8.61 / 12.94 / 9.24 / 4.81 : 1 on every colour the badge takes |
| F-D3-11 | color-contrast, `/` (production: 8) | 8 → 0 | `Index.tsx` activity timestamps `text-muted-foreground/40` (3.6:1 at 9 px) → `text-muted-foreground` |
| F-D3-12 | label (critical), `/verify` | 1 → 0 | `VerifyCertificate.tsx`: the three visible labels now `htmlFor` their inputs (the date input had no name at all); certificate-ID box named |

Gate logs: `local-1-fixed-baseline-not-lowered-RED.txt` / `local-2-all-fixed-baseline-not-lowered-RED.txt` (the ratchet refusing to pass until the baseline is lowered — rule 5 working on a real change), then the green run in the PR checks. `axe-after.json` = per-scene counts + selectors after the fix.

## Public routes, measured locally (`tools/uishot/axe-routes.mjs`, new, read-only)
The D2 container cannot reach www/staging (proxy: ERR_TUNNEL_CONNECTION_FAILED). Measured against a local dev server instead, with the shared chrome fed staging's public `site_settings` (`managed_pages`, `navigation_menu`; read-only SELECT 2026-10-05, `site-settings-fixture.json`):
`local-routes-before.json` → `/` color-contrast 8 (same 8 as production), `/verify` label 1 (same as production) · `local-routes-after.json` → **0 on all six routes** (/, /verify, /winners, /courses, /competitions, /help-support).

## NOT fixed, stated plainly
- **F-D3-11 target-size (production 39 nodes, 4 per route): not reproduced, so not fixed.** With production-shaped header/footer data a local server shows 0 target-size nodes; footer links are 15–17 px tall but pass axe's 24 px spacing exception locally. Changing chrome without knowing which 4 elements production flags would be a guess. `d2-a11y-routes.yml` (new, report-only per DECISION C7) runs the same probe from a GitHub runner against www and staging and prints every failing node with its selector — its run on this PR is the input for the follow-up fix.
- Course-page contrast (production 6) needs course data the local server does not have; not measured here.
- Serious harness debt still in the baseline (ratchets down later): link-name 11 (avatar links), link-in-text-block 2 (`/login`), nested-interactive 2 (notifications).
