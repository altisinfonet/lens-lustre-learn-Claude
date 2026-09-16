# 2026-08-15 — 3-column grid shipped, Back fixed, plan document updated

`origin/main` = **`541bebb`**. Working tree clean, 0 unpushed. Suite **1,656 passing**, 1 skipped.

The reconciler reports one DRIFT and it is benign: `base_commit` records `f6645ba`, one commit behind,
because the commit that reconciles it necessarily moves origin past the value it just wrote. Nothing
substantive is out of step.

---

## What shipped today (repo + website; NOT in any Android build)

| | |
|---|---|
| **3-column profile grid** | `src/components/profile/ProfilePostGrid.tsx` + `WallViewToggle.tsx`, wired into `WallPosts.tsx`. Grid is the DEFAULT; feed is one tap away. |
| **Back button AND back gesture** | `src/hooks/core/useAndroidBackButton.ts` rebuilt. 12 tests in `src/hooks/core/__tests__/androidBackButton.test.ts`, 6/6 mutations caught. |
| **Harness scenes for the grid** | `src/uiharness/scenes.tsx` — many / one / partial row / no photograph / missing thumbnail / runaway caption. |
| **Plan document** | `50mm_FINAL_PLAN.docx` updated and delivered to the owner: statuses re-derived, 11 new checklist items, counts taken FROM the table rather than asserted. |

## The back-button fix, in one paragraph

Android's back gesture and the hardware button raise the **same** Capacitor `backButton` event, so the
owner's two reports are one defect. An orphaned Radix layer (the failure `unfreezeStuckOverlay.ts`
documents) keeps `data-state="open"` forever; the old handler saw it, pressed Escape at nobody, and
returned — Back was dead until restart. The fix does **not** try to identify orphans. It makes the press
unable to do nothing by accident: Escape is dispatched as a cancellable event, a live layer that
deliberately refuses (`OnboardingModal` while mandatory) calls `preventDefault()` and is respected;
anything still standing after its own 300 ms close animation was never listening, so the owed navigation
happens and the node is remembered in a `WeakSet`. The node is never removed. Separately, the WebView
history-length test is gone — it only grows, which made `exitApp()` unreachable — replaced by a count of
the router's own PUSH/POP (REPLACE counts for nothing).

## Two things worth carrying forward

1. **A positive control is not optional.** The grid's screenshot sweep reported zero problems. That is
   indistinguishable from a blind checker until you prove the checker still fires — so an invalid image
   was planted, the sweep reported it, and the scene was removed.
2. **A measured limitation of the harness:** `curl` proved the Vite dev server answers *any* unmatched
   path with `200 text/html`. A missing asset can therefore never appear as a 404 in the harness; only
   the broken-image check catches it. Written into `docs/ui-checking-policy.md`.

## A mistake, recorded

The first pass at the plan document replaced table-cell runs instead of reusing them, silently
destroying the font size and colour of every row it touched. Nothing failed; it was found by rendering
the document to PDF and looking at page 8. Rebuilt with the first run reused.

---

## Next, without needing the owner

1. **Session-loss instrumentation** — nothing records WHY a session ends. Must ship before any sign-out fix.
2. **`activity_logs` flood** — 5,697 rows where ~90 would be right; median gap between one member's
   login rows is 2 seconds.
3. **Exempt `/auth/v1/token` from the 25 s abort** in `src/integrations/supabase/client.ts` (uploads are
   already exempt; auth is not).
4. **The Instagram upload composer** — preview, crop overlay, reorder. No plugin, no permission, no Play risk.

## Owner-blocked

- **Upload a build.** Phones are on 1073 / v1.2.2. 1088 / v1.2.5 is green but predates today's work.
- Attach the repo with PUSH access (transport is still the #1 risk; 8 files went up through the web page today).
- Razorpay sandbox credentials for W1.
- Two rulings: the 13 dead realtime subscriptions (publish or delete), and the 41 tables that survive an
  account deletion (delete, anonymise or keep).
