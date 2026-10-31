# P24 · Supported languages, translation source of truth, fallback rule

**Unit:** P24 · **Lane:** D2 (written by the D3 session, docs only) · **Date:** 2026-10-04 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/P24/` (MASTER R-82 rule 2 restricts D3 to `phase5/**`. GATE_REGISTER names `docs/evidence/d2/P24/`; the Auditor reconciles the two)

**Gate (GATE_REGISTER.md, verbatim):** "the supported-language list, the translation source of truth and the fallback rule written into the plan."

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box and fill in the line in GitHub's editor, or comment `P24 approved` on this PR. To change the language list, write the change on the sign-off line ("approved, add `kn`").

Everything below describes what the code **does today** (staging `26977a8`) and fixes it as **policy**. Nothing in the app changes with this PR.

---

## 1 · Supported languages: exactly seven

| code | label (as shown in the picker) | status |
|---|---|---|
| `en` | English | **reference language**: every key exists here |
| `hi` | हिंदी | supported |
| `bn` | বাংলা | supported |
| `mr` | मराठी | supported |
| `gu` | ગુજરાતી | supported |
| `ta` | தமிழ் | supported |
| `te` | తెలుగు | supported |

Source: `LANGS` in `src/i18n/translations.ts:13-21`. **Adding or removing a language needs an amendment to this decision, signed by the Owner.** Adding a dictionary in code is not enough.

## 2 · Source of truth

| what | where | rule |
|---|---|---|
| UI strings, master key list | `src/i18n/translations.ts`, the `en` dictionary | A new string is born here, as a key + English text. A key that does not exist in `en` does not exist. |
| Landing-page strings | `src/i18n/home.ts` (eager, all 7 languages) | Its key set does not overlap `translations.ts`. |
| The six non-English dictionaries | `src/i18n/translations.rest.ts` (lazy chunk) | Human-checked translations, kept in git, reviewed in PRs. |
| The member's language choice | `localStorage.app_lang` on the device · `profiles.preferred_language` for a signed-in account | The account value wins after sign-in (`LanguageAccountSync.tsx`). |

**Not a source of truth for UI strings:** the database, a translation SaaS, or runtime machine translation. The "See translation" button on posts (`TranslateBar.tsx` → edge function `translate-text`) translates **member content**, not the UI, so it is outside P24.

## 3 · Fallback rule

**Choosing the language (in order):** 1) the member's explicit saved choice (`localStorage.app_lang`) → 2) after sign-in, the account's `preferred_language` if it is one of the 7 codes (it overrides 1) → 3) the device/browser language, matched on its base code (`hi-IN` → `hi`) → 4) `en`. (`I18nContext.tsx` `detectInitialLang`, `LanguageAccountSync.tsx`.)

**Showing a string:** chosen language → **English** → the caller's inline fallback → the key itself. So a missing translation shows English text and never a blank. While the non-English chunk is still loading, the member sees English for a moment, then the chosen language. `<html lang>` follows the chosen language.

**Coverage rule:** a PR may add an English key without its six translations (the fallback covers it). But coverage below 100 % is a reported number, not hidden: it is re-measured with the command in §4 at every Phase 5 promotion.

## 4 · Coverage, measured 2026-10-04 07:55:34 UTC (staging `26977a8`, after #322 removed `auth.continueApple`)

Instrument: Node 22.22 `--experimental-strip-types`. The script imports `translations.ts`, `translations.rest.ts` and `home.ts`. For each language it counts the `en` keys that are present, the keys that are missing, and orphans (keys not in `en`).

| language | main dictionary | missing | orphans | landing (`home.ts`) |
|---|---:|---:|---:|---:|
| hi · bn · mr · gu · ta · te (each) | **1110 / 1117** | 7 | 0 | **82 / 82** |

The same 7 keys are missing in all six languages (checked: one identical set): `notif.sec.push`, `notif.sec.pushSub`, `notif.pushAll`, `notif.pushAllDesc`, `nf.signUpFree`, `nf.logIn`, `nf.discover`. Those strings show in English today, which is the fallback working as designed.

**Not measured:** strings hard-coded in components instead of going through `t()`. That needs its own scan (a later D2 item); this figure does not cover it.

## 5 · Findings

- **F-D3-8 · `profiles.preferred_language` is free text, and its default is `'English'`**, a label rather than one of the 7 codes (`supabase/migrations/20260226154352_…sql:1`, read-only). The client ignores any value that is not a code, so nothing breaks. But the column cannot be trusted as data. **D1 backlog:** a CHECK constraint on the 7 codes (or NULL), and default NULL. Expand–contract, staging first.
- **F-D3-9 · All six languages ship in one lazy chunk** (`translations.rest.ts`). The Phase 0 baseline measured 498 682 B of dictionaries in one file. That is P12's target, and this decision gives P12 its policy: **one chunk per code in §1.**
- The 7 missing keys → D2, a translation PR when convenient (it does not block anything).

## 6 · "Written into the plan"

The gate asks for this to be written into the plan. The plan (`docs/ADDENDUM_A_EXECUTION_MASTER.md`) belongs to the Auditor, so this PR does not edit it. **Ask of the Auditor:** after signature, add one line under Phase 5 / P24 that points to this file.
