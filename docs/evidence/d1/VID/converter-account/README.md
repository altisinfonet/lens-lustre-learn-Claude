# VID-1 · converter account provisioning (D1, T1) · `20261013_0007`

CONVERTER-DESIGN.md v2 §4 [R9] / §9 step 3. Apply to a lane **after** the Owner has created the account there and **before** the worker is started.

## What must exist for the worker to sign in and claim a job
| # | Thing | SQL? | Who |
|---|---|---|---|
| 1 | Supabase Auth user `video-converter@50mmretina.com`, confirmed, with a password (`converter/src/auth.ts` signs in with `grant_type=password`) | **No** — Supabase Auth only (dashboard "Add user" or the Auth admin API). No SQL here writes `auth.users`. | Owner |
| 2 | The same e-mail + password in `/var/lib/converter/secrets/credentials.json` on the VM (`converter:converter`, `0600`) | No | Owner |
| 3 | `/etc/converter/converter.env` (site origin, Supabase URL, anon key, R2 host, bucket — nothing secret) | No | VM setup |
| 4 | One row in `public.video_converter_accounts` for that user (20261012_0002's functions accept only `video_is_converter()`) | **Yes — this unit** | apply-migration |
| 5 | Profile banned + hidden, no role, and no role can be given | **Yes — this unit** | apply-migration |
| 6 | Admin → Video Conversion = "server" on the lane (else no job is ever queued) | No | Owner, last |

The password is never in SQL, in a workflow input, in git or in a log: the migration finds the user by its e-mail and refuses when it is not there.

## What ships
| Object | Rule |
|---|---|
| row in `video_converter_accounts` | the one converter; `note` records whether a `user` role row was removed (the rollback reads it) |
| `profiles.is_banned`, `profiles.is_suspended` = true (no end date) | existing restrictive "Banned users cannot …" policies refuse its posts / comments / reactions; feeds, search, suggestions filter both flags; `guard_profile_moderation_columns` stops it clearing either |
| its `user_roles` rows deleted | the sign-up trigger's `user` row |
| `public.tg_user_roles_no_converter()` + trigger on `public.user_roles` (new) | BEFORE INSERT OR UPDATE: a converter account can be given no role by anyone (members may self-assign `registered_photographer`). DEFINER, `search_path ''`, no API role may execute it |

## Proof — `account-harness.mjs` → `transcript.txt`
PGlite 0.3.16, in memory, staging and production default-privilege shapes; the real migration files, rollback and PROBE (the harness header lists what is stubbed).

| | result |
|---|---|
| BEFORE | PROBE **RED** (`A1 converter accounts 0`); the account cannot claim (`VID-CONV-001`), can give itself a role and write a post |
| 0007 refused, nothing changed | no Auth user · unconfirmed · no lane · the e-mail holds a staff role |
| AFTER | PROBE **GREEN**; the account claims a job; member / admin / anon cannot call a converter RPC; the account cannot post, comment, take or be given a role, lift its ban or its hiding, upload, read conversion rows, other profiles, the converter list or the audit trail, or change a member's profile or roles |
| PROBE mutants | 9, each red, each undone |
| Re-apply ×2 | nothing changes |
| Rollback | refuses under a live claim; then state byte-identical to before 0007; PROBE red; second rollback refused |

## What this does not prove
- **Not run against a lane.** No database was read for this unit. PRE-003/004 refuse the apply if a lane lacks the profile guard trigger or the ban policies.
- The account is still an `authenticated` principal. This unit closes roles, moderation flags and the tables with a ban policy. Tables whose policies let **any** signed-in member read or write without an `is_banned` check were **not** enumerated and are not closed here (a banned member can do the same things today). Closing that for one account needs its own unit (e.g. a per-request guard, or restrictive policies) — NOT VERIFIED.
- The e-mail address is this unit's choice (the owner's domain, so nobody else can receive a password reset for it). If the Owner wants another, it is one constant in the migration and one in the PROBE.

## Classification
- **VERIFIED (fixture):** the table above.
- **NOT VERIFIED:** anything live — the Auth user, the VM file, staging's triggers and policies.
