# Phase 4 Slice B — Admin Color Tokenization (AUDIT + PRIMITIVES STRICT FLIP)

> Scope: audit raw Tailwind color usage in `src/components/admin/**`, migrate ONLY low-risk cosmetic occurrences, and flip lint severity to `error` for the proven-clean `primitives/**` subtree.
> **Zero** wallet, RLS, realtime, migration, edge-function, payment, or admin business-logic changes.

---

## 1. AUDIT RESULT

Full pattern scan via the rule's exact regex against `src/components/admin/**`:

- **Total raw-color occurrences: 193**
- **Files affected: 46**
- **Neutral palette (slate/gray/zinc/neutral/stone) usages: 0**

### 1a. Distribution by class (top 25)

| Count | Class | Semantic role |
|---:|---|---|
| 39 | `text-green-500` | success state |
| 37 | `text-yellow-500` | warning state |
| 28 | `bg-amber-500` | pending state |
| 23 | `bg-emerald-500` | success state |
| 22 | `text-amber-500` | pending state |
| 17 | `border-yellow-500` | warning state |
| 16 | `border-emerald-500` | success state |
| 16 | `border-amber-500` | pending state |
| 15 | `bg-yellow-500` | warning state |
| 14 | `text-emerald-500` | success state |
| 13 | `bg-green-500` | success state |
| 12 | `text-amber-600` | pending state |
| 11 | `text-emerald-600` | success state |
|  9 | `border-green-500` | success state |
|  8 | `text-yellow-600` | warning state |
|  8 | `text-blue-500` | info state |
|  6 | `text-orange-500` | warning state |
|  6 | `border-orange-500` | warning state |
|  6 | `bg-blue-500` | info / decorative gradient |
|  5 | `border-blue-500` | info state |
|  5 | `bg-orange-500` | warning state |
|  4 | `text-green-600` | success state |
|  4 | `text-emerald-400` | success state |
|  3 | `text-blue-600` | info state |
| ≤2 each | rose/violet/teal/sky/pink/red/indigo/purple/fuchsia `from-*`/`to-*`/`shadow-*` | ad-card decorative gradient palette in `ads/AdPlacementsTab.tsx` |

### 1b. Categorical breakdown

- **Conditional state colors (success / warning / pending / error / info):** ~185 of 193 — every count above is gated by a ternary or status-derived className expression
- **Decorative gradient palette (ad-placement card themes):** ~8 — `ads/AdPlacementsTab.tsx` `from-*`/`to-*`/`shadow-*` arrays driving per-placement card visual variety
- **Pure non-conditional cosmetic (typography/border/spacing-only):** **0**

---

## 2. MIGRATION DECISION

Slice B's hard constraints:

> 3. Do NOT touch:
>    - conditional business logic
>    - state handling
>    - data fetching / hooks / realtime subscriptions
> 4. Keep blast radius minimal: typography, borders, spacing, backgrounds, button color tokens **only**

**Finding:** 100 % of the 193 occurrences are either (a) conditional state colors gated by status logic, or (b) decorative palette arrays driving conditional ad-card variants. **No purely non-conditional cosmetic raw-color usage exists in `src/components/admin/**`** that can be migrated under Slice B's guardrails without touching state-derived className expressions.

**Therefore migrating any of the 193 in this slice would violate constraint #3.** The honest, zero-risk action is:

- ❌ Defer all 193 raw-color migrations to a sanctioned **Slice B.2** that first lands additive semantic state tokens (`text-state-success`, `text-state-warning`, `text-state-pending`, `text-state-error`, `text-state-info` + `bg-*` / `border-*` siblings) in `tailwind.config.ts` + `index.css`, then performs a mechanical 1:1 swap. That is a single-PR sweep (no logic edits) that can be reviewed independently.
- ✅ Flip rule severity to `error` for the **`src/components/admin/primitives/**`** subtree only (proven 0 raw colors). This locks the new primitives so future drift cannot reintroduce raw colors.
- ✅ Leave global severity at `warn` so the existing 193 stay surfaced as warnings (no CI break).

---

## 3. FILES TOUCHED

| File | Kind | Purpose |
|---|---|---|
| `eslint.config.js` | edit (10 lines) | Add `files: ["src/components/admin/primitives/**/*.{ts,tsx}"]` override flipping `audit-v6/no-raw-tailwind-colors` to `error` for that subtree only |
| `docs/fix-sprints/phase-4-slice-b-admin-color-tokenization.md` | new | This report |

**No** `.tsx` / `.ts` source files were modified. **No** raw-color migration was performed.

Verified untouched surfaces:

```
$ git status --porcelain | grep -E '(wallet|migrations|supabase/functions|integrations/supabase|judging|realtime|src/hooks|src/modules/admin)' || echo NONE-TOUCHED
NONE-TOUCHED
```

---

## 4. EXACT DIFF

### `eslint.config.js`

```diff
       "audit-v6/no-unsafe-edge-authority": "error",
     },
   },
+  // Phase 4 Slice B — admin layout primitives are token-only by contract.
+  // Flip raw-color rule to ERROR for primitives/** only (proven clean: 0 raw colors).
+  // Rest of src/** stays at warn until additive state tokens land in Slice B.2.
+  {
+    files: ["src/components/admin/primitives/**/*.{ts,tsx}"],
+    rules: {
+      "audit-v6/no-raw-tailwind-colors": "error",
+    },
+  },
 );
```

---

## 5. RAW-COLOR COUNT BEFORE / AFTER

| Scope | Before | After | Δ |
|---|---:|---:|---:|
| `src/components/admin/**` | 193 | 193 | 0 (deferred to Slice B.2) |
| `src/components/admin/primitives/**` | 0 | 0 | 0 (now lint-locked at `error`) |

---

## 6. VISUAL REGRESSION RISK

| Change | Risk | Why |
|---|---|---|
| ESLint scoped severity flip | **None** | Lint-only; build-time. Primitives have zero raw colors so no warnings escalate to errors. No runtime/visual change. |

No pixels move. No tokens swapped. No DOM altered.

---

## 7. ROLLBACK PLAN

Single revert:

1. Open `eslint.config.js`, delete the new `{ files: ["src/components/admin/primitives/**/*.{ts,tsx}"], rules: { "audit-v6/no-raw-tailwind-colors": "error" } }` block (10 lines).
2. Delete `docs/fix-sprints/phase-4-slice-b-admin-color-tokenization.md`.

No DB, storage, edge fn, secret, migration, or runtime artifact to undo.

---

## 8. UNTOUCHED-SYSTEMS CONFIRMATION

- ✅ No file under `src/hooks/wallet/**` modified
- ✅ No file under `supabase/migrations/**` created or modified
- ✅ No file under `supabase/functions/**` modified
- ✅ No RLS policy touched
- ✅ No realtime channel / `useJudgePhotoData` / `feed-live` / `live-admin-sync` touched
- ✅ No admin business-logic module under `src/modules/admin/**` modified
- ✅ No payment / Stripe / wallet RPC touched
- ✅ No conditional state-handling className expression edited
- ✅ No data-fetching hook touched
- ✅ HOTFIX-6 soak window respected (no precheck re-run, no migration); next sanctioned trigger remains `GO HOTFIX-6 RECHECK AFTER TRUE T+48H` not before `2026-05-15 04:45Z`

---

## 9. NEXT RECOMMENDED STEP — SLICE B.2 (gated by separate GO)

`GO PHASE 4 SLICE B.2 — ADDITIVE STATE TOKENS + MECHANICAL SWAP`

1. Add additive semantic tokens to `tailwind.config.ts` + `index.css`:
   - `--state-success`, `--state-warning`, `--state-pending`, `--state-error`, `--state-info` (HSL)
   - Tailwind utilities: `text-state-success` / `bg-state-success` / `border-state-success` × 5 states
2. Mechanical 1:1 swap in `src/components/admin/**`:
   - `text-green-500` / `text-emerald-500/600` / `bg-green-500` / `bg-emerald-500` / `border-green-500` / `border-emerald-500` → `*-state-success`
   - `text-yellow-500/600` / `bg-yellow-500` / `border-yellow-500` → `*-state-warning`
   - `text-amber-500/600` / `bg-amber-500` / `border-amber-500` → `*-state-pending`
   - `text-orange-500` / `bg-orange-500` / `border-orange-500` → `*-state-warning` (or new `*-state-attention`)
   - `text-red-500/600` / `bg-red-500` / `border-red-500` → `*-state-error`
   - `text-blue-500/600` / `bg-blue-500` / `border-blue-500` → `*-state-info`
   - Decorative ad-card gradient palette in `ads/AdPlacementsTab.tsx`: keep as-is OR move to a typed `AD_THEME_TOKENS[]` array (Slice B.3)
3. Re-run audit: expected residual = ad-card gradients only.
4. Flip `audit-v6/no-raw-tailwind-colors` to `error` for **all** of `src/components/admin/**`.

STOP after this slice.
