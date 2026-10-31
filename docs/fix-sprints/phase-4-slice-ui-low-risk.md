# Phase 4 Slice — UI Low-Risk Cleanup

> Scope: lint guardrail + token fix + additive primitives only.
> **Zero** wallet, RLS, realtime, migration, payment, or admin business-logic changes.

---

## 1. VERIFIED FINDINGS

### 1a. Body-font Inter bug — proven

`src/index.css:1` imports Inter from Google Fonts. `tailwind.config.ts:125` lists `Inter` first in the `sans` stack. **But** `src/index.css:77-79` defined:

```css
--font-display: Helvetica, Arial, sans-serif;
--font-heading: Helvetica, Arial, sans-serif;
--font-body:    Helvetica, Arial, sans-serif;
```

…and `body { font-family: var(--font-body); }` (line 203) plus `h1..h6` use `var(--font-display|--font-heading)`. So Tailwind's `font-sans` token had Inter, but every actual element resolved through the three CSS vars, which hard-pinned Helvetica. Inter loaded but was never applied.

### 1b. Raw Tailwind palette colors are not currently lint-blocked

No existing ESLint rule blocks `bg-blue-500`, `text-red-600`, etc. Phase 4 plan calls for a guardrail before any UI sweep.

### 1c. No `<AdminPage>/<AdminTable>/<AdminToolbar>` primitives exist

`src/components/admin/` contains 90+ page components that each redo headers/toolbars/tables ad-hoc. Phase 4 plan calls for additive primitives first, migration later.

---

## 2. NOT VERIFIED

- Whether every admin page will *cleanly* adopt the new primitives (deferred to Phase 4 full sweep — no migration in this slice).
- Whether `--font-body: 'Inter', …` causes any pixel diff in dense judging tables (Inter and Helvetica have similar metrics; preview render expected to be neutral). No regression baseline captured because no UI was migrated.

---

## 3. FILES TOUCHED

| File | Kind | Purpose |
|---|---|---|
| `src/index.css` | edit (3 lines) | Prepend `'Inter'` to `--font-display/--font-heading/--font-body` |
| `eslint-rules/no-raw-tailwind-colors.js` | new | Lint rule blocking `bg-{palette}-{shade}` etc. |
| `eslint.config.js` | edit (3 spots) | Register + enable rule under `audit-v6` plugin at **warn** |
| `src/components/admin/primitives/AdminPage.tsx` | new | Additive shell |
| `src/components/admin/primitives/AdminToolbar.tsx` | new | Additive toolbar |
| `src/components/admin/primitives/AdminTable.tsx` | new | Additive table wrapper around shadcn |
| `src/components/admin/primitives/index.ts` | new | Barrel export |

**No** files under `src/hooks/wallet/**`, `supabase/migrations/**`, `supabase/functions/**`, `src/integrations/supabase/**`, `src/lib/judging/**`, RLS, realtime channels, or admin business modules were touched. Verified:

```
$ git status --porcelain | grep -E '(wallet|migrations|supabase/functions|integrations/supabase|judging|realtime|RLS)' || echo NONE-TOUCHED
NONE-TOUCHED
```

---

## 4. EXACT DIFFS

### `src/index.css` (lines 77-79)

```diff
-    --font-display: Helvetica, Arial, sans-serif;
-    --font-heading: Helvetica, Arial, sans-serif;
-    --font-body: Helvetica, Arial, sans-serif;
+    --font-display: 'Inter', Helvetica, Arial, sans-serif;
+    --font-heading: 'Inter', Helvetica, Arial, sans-serif;
+    --font-body: 'Inter', Helvetica, Arial, sans-serif;
```

Helvetica/Arial retained as fallbacks → if Inter ever fails to load, render is byte-identical to today.

### `eslint.config.js`

```diff
 import noUnsafeEdgeAuthority from "./eslint-rules/no-unsafe-edge-authority.js";
+import noRawTailwindColors  from "./eslint-rules/no-raw-tailwind-colors.js";
...
           "no-unsafe-edge-authority": noUnsafeEdgeAuthority,
+          "no-raw-tailwind-colors":   noRawTailwindColors,
...
       "audit-v6/no-unfiltered-realtime-sensitive": "error",
+      // Phase 4 slice — baseline as warn until existing src/** raw-color usage is migrated.
+      "audit-v6/no-raw-tailwind-colors": "warn",
```

### `eslint-rules/no-raw-tailwind-colors.js` (new, 78 lines)

Pattern: `\b(bg|text|border|ring|from|via|to|fill|stroke|divide|outline|placeholder|caret|accent|decoration|shadow)-(slate|gray|zinc|…|rose)-(50|100|…|950)\b`. Allowlist: `eslint-rules/`, `src/test/`, `__tests__`, `tailwind.config`, `src/index.css`, `*.test.ts`, `*.spec.ts`. Severity **warn** (baseline mode) — flips to **error** in a future Phase 4 sweep PR after the `src/**` warning count hits zero.

### Admin primitives (new, ~150 lines total)

Token-only (`bg-card`, `border-border`, `text-muted-foreground`, `bg-muted/30`, `text-foreground`). No raw palette colors. No data fetching. No router. No state. Pure presentational.

---

## 5. VISUAL RISK

| Change | Risk | Why |
|---|---|---|
| Font swap Helvetica → Inter | **Low** | Inter is already preloaded; metrics within ~2% of Helvetica; fallback chain unchanged |
| ESLint rule | **None** (visual) | Build-time only; severity = warn; no behavior change |
| Admin primitives | **None** | Not imported anywhere yet; tree-shaken out of bundle |

---

## 6. ROLLBACK PLAN

Each item independently revertable:

1. **Font:** revert lines 77-79 of `src/index.css` to `Helvetica, Arial, sans-serif`.
2. **Lint rule:** delete `eslint-rules/no-raw-tailwind-colors.js`; remove the 3 lines added to `eslint.config.js` (import, plugin entry, rule enable).
3. **Primitives:** `rm -rf src/components/admin/primitives/`. Nothing imports them yet.

No DB, no storage, no edge fn, no secret, no migration to undo.

---

## 7. LINT RESULT

```
$ npx eslint src/components/admin/primitives/ eslint-rules/no-raw-tailwind-colors.js
0 errors, 0 raw-color warnings on the new files.

# Smoke probe: rule fires correctly on raw palette classes
$ echo 'export const x = "bg-blue-500 text-red-600";' > src/_probe/probe.ts
$ npx eslint src/_probe/probe.ts
  1:18  warning  Raw Tailwind color class "bg-blue-500" is forbidden …
                 audit-v6/no-raw-tailwind-colors
✖ 1 problem (0 errors, 1 warning)
```

Rule enforces the contract; existing `src/**` raw-color usage surfaces only as **warnings** (no CI break).

---

## 8. CONFIRMATION — UNTOUCHED SURFACES

- ✅ No file under `src/hooks/wallet/**` modified
- ✅ No file under `supabase/migrations/**` created or modified
- ✅ No file under `supabase/functions/**` modified
- ✅ No RLS policy touched (no migration written)
- ✅ No realtime channel / `useJudgePhotoData` / `feed-live` / `live-admin-sync` touched
- ✅ No admin business-logic module under `src/modules/admin/**` modified
- ✅ No payment / Stripe / wallet RPC touched
- ✅ HOTFIX-6 soak window respected (no precheck re-run, no migration)

---

## 9. NEXT RECOMMENDED STEP

Hold. Resume only on explicit user trigger. Possible next slices (each gated by separate approval):

- **Phase 4 slice B:** Migrate raw-color warnings in `src/components/admin/**` to tokens, then flip rule to `error`.
- **Phase 4 slice C:** Pilot `<AdminPage>/<AdminToolbar>/<AdminTable>` on **one** low-traffic admin page (e.g. `AdminBanners`) to validate ergonomics before a 90-page sweep.

No further action this turn.
