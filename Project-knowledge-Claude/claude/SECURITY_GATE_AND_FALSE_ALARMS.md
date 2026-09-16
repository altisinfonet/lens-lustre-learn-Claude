# The security gate, and the things that LOOK like bugs but are not. 2026-08-06.

`main` at `677e10e`. Companion to `SECURITY_P0_DELETED_USER_ACCESS.md`.

---

## 🛑 DO NOT "FIX" `judge_decisions_owner_safe`

An automated scan flags it as *"SECURITY DEFINER view — bypasses RLS"*. **It is
supposed to.** Its WHERE clause is:

```sql
WHERE EXISTS (SELECT 1 FROM competition_round_publish crp JOIN comp…)
```

It deliberately steps around row-level security on `judge_decisions` and
replaces it with a stricter, more specific rule: **only for rounds that have
actually been published.** That is *Locking ≠ Declaring* enforced in the
database — the rule that results are locked but hidden from participants until
an admin declares them.

**Setting `security_invoker = on` would break results for every participant.**
RLS on `judge_decisions` restricts to judges and admins, so entry owners would
see nothing at all on `SubmissionDetail`. This was checked before touching it
and deliberately left alone.

The lesson for the scanner: *a definer view that carries its own filter is a
security barrier, not a leak.* Judge it by its WHERE clause, never by the flag.

## Other things that looked alarming and are not

| Flagged | Verdict |
|---|---|
| `.env` committed | **Fine.** Holds only the project URL and the anon key — both public by design and already in the client bundle. Role claim reads `anon`. No service key, no provider secret. |
| 7 edge functions "open with service key" | **Fine.** Supabase requires a JWT unless `config.toml` opts out. Only 2 are actually opted out. |
| `create-payment-session` unauthenticated | **Fine.** Verifies with `auth.getClaims()` and returns 401. The scanner only knew `getUser()`. |
| `handle-email-unsubscribe` unauthenticated | **Fine.** Opaque token in `email_unsubscribe_tokens` — the correct RFC 8058 pattern. |
| 5 `SECURITY DEFINER` functions without `search_path` | **Fine.** Historical migrations, all superseded. The live database reports **0**. |
| `sitemap` public + service key | **Fine.** Filters to `status='published'`, active artists, public competition statuses. |
| `chart.tsx` `dangerouslySetInnerHTML` | **Fine.** Builds a CSS string from developer-defined theme config; `id` comes from `useId()`. |
| 80 dependency vulnerabilities | **Misleading.** Production-only is the real number; the rest is vite/vitest/eslint that never reaches a phone. |

**The first scanner run reported 14 blocking findings. After validating each by
hand, the real number was 3.** Every rule that misfired was corrected rather
than the finding waved away. This matters: a gate that cries wolf is ignored
within a week, and then it is worse than having none.

## What the gate is

`.github/workflows/security.yml` (`677e10e`), on every push and PR to main:

1. **This project's own rules** — `scripts/security-audit.mjs`. Uses only Node
   built-ins, so a broken dependency cannot stop it running, which is exactly
   when a security gate matters most. Fails on CRITICAL or HIGH.
2. **Secret scan over the full history** — a key committed and later deleted is
   still leaked.
3. **Dependencies, production only** — reports everything, fails on high and
   above in what actually ships.

## ⚠️ IT DOES NOT YET BLOCK THE ANDROID BUILD, AND HERE IS WHY

Making the build depend on the gate means editing `android-build.yml` — and
that file is **inside the Android build's own trigger paths**:

```yaml
paths:
  - ".github/workflows/android-build.yml"
  - "ANDROID_BUILD_TRIGGER"
```

So editing it to add the gate **immediately fires a build** — run #57,
versionCode 1057 — whether or not one is wanted. **That change must be bundled
with the next intentional build**, not made on its own.

## Expect the first runs to be RED

Outstanding at the time of writing:

- **CRITICAL ×2** — `seo-route-metadata` and `sitemap` (both public + service
  key). `sitemap` was validated as safe; `seo-route-metadata` has one genuine
  hole: competitions are fetched by slug with **no status filter**, so a draft
  competition's title, description and dates are readable by guessing its slug.
  Journal articles on the same endpoint *are* filtered correctly.
- **HIGH ×1** — `chart.tsx`, validated as benign.
- **Dependencies** — 15 high remain in production code.

**A permanently red gate is a gate nobody reads.** Getting it green means:
fix the `seo-route-metadata` status filter (real), refine the two rules that
misfire (`sitemap`, `chart.tsx`), and set the dependency threshold to something
achievable now and ratchet it down. That is the next piece of work.
