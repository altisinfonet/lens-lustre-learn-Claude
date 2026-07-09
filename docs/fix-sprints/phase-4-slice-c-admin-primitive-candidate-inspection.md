# Phase 4 — Slice C: Admin Primitive Pilot Candidate Inspection (READ-ONLY)

**Status:** ✅ AUDIT ONLY — zero edits, zero migrations, zero deployments.
**Date:** 2026-05-14
**Mandate:** `docs/forensic-engineering-mandate.md` Rules 1–5
**Primitives in scope:** `<AdminPage>`, `<AdminToolbar>`, `<AdminTable>` (additive, shipped in Slice A; locked under `audit-v6/no-raw-tailwind-colors: error` in Slice B).

---

## 1. VERIFIED FINDINGS — Per-candidate inspection

### Candidate A — `AdminRedirects`

| Field | Value |
|---|---|
| File path | `src/components/admin/AdminRedirects.tsx` |
| Line count | **222** |
| Current layout shape | `<div>` → editorial header (8 px primary bar + SEO eyebrow + `font-display` h2 + inline "Add Redirect" button) → 3-column stat cards → list of redirect cards (each card holds inline `<select>`, checkbox, hit count, From/To inputs, trash) → bottom Save button. |
| Clear page header? | ⚠️ **Partial.** Has a custom editorial header (`<h2 className="text-2xl font-light tracking-tight" style={displayFont}>` + eyebrow + inline action). Does **not** match `<AdminPage title="…" actions={…}>`'s neutral chrome — the eyebrow + display-italic styling would be lost. |
| Clear toolbar? | ❌ **No.** The "Add Redirect" button lives inside the page header. There is no filter/search row. |
| Simple table/list? | ❌ **No.** It is **not** a `<Table>`. Each row is a self-contained editor card with two inputs, a `<select>`, a checkbox, and a trash button. Modeling this as `AdminTableColumn<Redirect>[]` would require pushing 4 inputs into `cell:` render functions — a presentational refactor, not a shell swap. |
| Forms / modals | Inline edit-in-place per row. No modals. |
| Data fetching / mutations risk | `fetchRedirects` (single read of `site_settings`) + `saveRedirects` (loop/self-redirect validation, then upsert + 2× `qc.invalidateQueries`). **Mutation is bulk-save, not per-row** — any restructuring of row identity is dangerous. |
| Visual regression risk | **HIGH.** Display font, italic accent, primary 8 px bar, dashed empty state, `border border-border p-4` cards. AdminPage's neutral `text-lg font-semibold` header would visibly downgrade the brand chrome. |
| Pilot suitability | **RISKY** |

---

### Candidate B — `AdminKeywordBlocklist`

| Field | Value |
|---|---|
| File path | `src/components/admin/AdminKeywordBlocklist.tsx` |
| Line count | **393** |
| Current layout shape | `<div>` → 6-cell stat grid → "Add Keyword" form card (single/bulk toggle, category/severity selects, input + Add button) → search input row → conditional bulk-action bar → flat `divide-y` list of keyword rows (checkbox, active toggle, mono keyword, category badge, severity badge, date, delete). |
| Clear page header? | ❌ **No header at all** in the visible portion (lines 200–393). Page mounts directly into `AdminPanel`'s outer chrome. **Adding `<AdminPage title>` would inject a NEW header where none exists today** → visible regression. |
| Clear toolbar? | ⚠️ **Partial.** The search row (line 287–295) is a single full-width input — a 1:1 fit for `<AdminToolbar left={<SearchInput/>}>`. The conditional "N selected / Delete Selected / Clear" bar (line 321–341) is a second toolbar that only appears with selection. |
| Simple table/list? | ⚠️ **List, not table.** `<div className="border border-border rounded-sm divide-y divide-border">` with hand-rolled rows. Migrating to `<AdminTable>` would convert visual rhythm from `divide-y` to `<TableRow>` + remove the `bg-primary/5` selected-row tint and the inline category/severity badge layout. |
| Forms / modals | Add-keyword form (inline, not modal) + `ConfirmDialog` for bulk delete. |
| Data fetching / mutations risk | `fetchKeywords` (single select, limit 50) + `addKeyword` / `addBulkKeywords` (loop insert) + `toggleActive` + `deleteKeyword` + `deleteBulk`. **5 mutation paths**, all touching `blocked_keywords` table. **Out of scope per Slice C strict rules** — must not be touched. |
| Visual regression risk | **MEDIUM.** Stat grid + form card + custom badges are bespoke; only the search row and the list container would map cleanly. |
| Pilot suitability | **RISKY** (mutation surface too wide; no existing header to replace) |

---

### Candidate C — `AdminEmailTemplates`

| Field | Value |
|---|---|
| File path | `src/components/admin/AdminEmailTemplates.tsx` |
| Line count | **449** |
| Current layout shape | Two distinct modes: **(a) List mode** — toolbar (category filter + count + "New Template" button) + flat list of template cards with name, category badge, key, subject, variable pills, and 3 action buttons. **(b) Edit mode** — full-page inline editor with name/key/category grid, subject input, variable insert pills, Visual/HTML/Preview tab bar, contentEditable + DOMPurify, plain-text textarea, active toggle, Save/Cancel. |
| Clear page header? | ❌ **No top-level page header** — list mode jumps straight to toolbar (line 378). Edit mode replaces the entire body. |
| Clear toolbar? | ✅ **Yes** — list mode has a clean toolbar (category select + count on left, "New Template" on right) at line 378–391. **1:1 fit for `<AdminToolbar left={…} right={…}>`.** |
| Simple table/list? | ⚠️ Card list (lines 394–443), not a `<Table>`. Each card carries multi-line content (name + 2 badge rows + variable-pill row + 3 actions) — not column-shaped. |
| Forms / modals | Massive inline editor with `contentEditable`, DOMPurify, rich-text toolbar, live preview, category dropdowns, variable insertion. |
| Data fetching / mutations risk | `fetchTemplates` + `saveTemplate` (XSS-sanitizing INSERT/UPDATE on `email_templates`) + `deleteTemplate` + `toggleActive` + `duplicateTemplate` + `insertVariable`. **6 mutation paths plus DOMPurify-gated XSS surface.** Highest risk of all three candidates. |
| Visual regression risk | **HIGH.** Editor mode swap, contentEditable, custom badges (`categoryColor` map at line 38–44), variable pills. |
| Pilot suitability | **NOT SUITABLE** |

---

## 2. NOT VERIFIED ITEMS

- Live render parity — none of the three pages were screenshotted (read-only mandate).
- Whether `AdminPanel` shell adds its own page-level header above each module (would compound regression risk if AdminPage adds another one).

---

## 3. FILES TOUCHED

**One** — this report only:
- `docs/fix-sprints/phase-4-slice-c-admin-primitive-candidate-inspection.md` (new)

Source files inspected (read-only):
- `src/components/admin/AdminRedirects.tsx`
- `src/components/admin/AdminKeywordBlocklist.tsx`
- `src/components/admin/AdminEmailTemplates.tsx`

---

## 4. RISKS

None — read-only inspection.

---

## 5. DIFF SUMMARY

No source diffs.

---

## 6. VERIFICATION PROOF

- `wc -l` confirmed line counts (222 / 393 / 449).
- Layout shape verified by reading lines 1–222 of AdminRedirects, lines 1–120 + 200–393 of AdminKeywordBlocklist, lines 1–120 + 250–449 of AdminEmailTemplates.
- Mutation surface counted directly from `supabase.from(...).insert/update/delete/upsert` call sites in each file.

---

## 7. ROLLBACK PLAN

`rm docs/fix-sprints/phase-4-slice-c-admin-primitive-candidate-inspection.md` — that's it.

---

## 8. FINAL VERDICT — Safest pilot page

> **None of the three is a clean 1:1 fit for all three primitives simultaneously.**

| | AdminPage fit | AdminToolbar fit | AdminTable fit | Mutation risk |
|---|---|---|---|---|
| AdminRedirects | ⚠️ would downgrade brand header | ❌ none | ❌ rows are editor cards | Medium (1 bulk upsert) |
| AdminKeywordBlocklist | ❌ no header to replace (would inject one) | ⚠️ partial (search only) | ❌ list with badges, not columns | High (5 mutation paths) |
| AdminEmailTemplates | ❌ no header; editor mode swap | ✅ clean fit | ❌ multi-line cards | Highest (6 paths + XSS surface) |

### Recommendation: **AdminEmailTemplates list-mode toolbar ONLY** as the safest *minimum-viable* pilot.

Rationale:
1. The list-mode toolbar at lines 378–391 is the **single cleanest 1:1 swap** in the entire candidate set (`<select> + count` left, `<button>` right → `<AdminToolbar left={…} right={…}>`).
2. It is **scoped to one block of JSX**, leaves the editor mode untouched, and changes **zero mutation paths**.
3. `<AdminPage>` and `<AdminTable>` would **NOT** be wired in this pilot — only `<AdminToolbar>`. This honors Slice C's "preserve exact UI behavior" rule.

If the user wants all three primitives exercised on one page, **none of these candidates qualifies** — the AI recommends a **`GO PHASE 4 SLICE C — INSPECT TIER-2 CANDIDATES`** pass over `AdminFlags`, `AdminFeatureFlags`, `AdminAnnouncements`, or `AdminGiftCodes` (any read-mostly, table-shaped surface) before committing.

---

## NEXT RECOMMENDED STEP

Pick one (each requires explicit GO):

- **`GO PHASE 4 SLICE C — TOOLBAR-ONLY PILOT ON ADMIN_EMAIL_TEMPLATES`** — swap lines 378–391 for `<AdminToolbar>`, no other changes. ~10-line diff.
- **`GO PHASE 4 SLICE C — INSPECT TIER-2 CANDIDATES`** — read-only audit of 4 more admin pages to find a true 3-primitive fit.
- **`GO PHASE 4 SLICE B.2`** — semantic state tokens + 193-occurrence color migration.
- **`GO HOTFIX-6 RECHECK AFTER TRUE T+48H`** — read-only, on/after `2026-05-15 04:45Z`.

**No edits taken this turn.** Holding.
