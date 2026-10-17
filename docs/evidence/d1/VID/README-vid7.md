# VID-7 · feature switches: Off / Selected members / All members (D1, T1) · `20261005_0004`

**Plan:** `docs/evidence/d2/phase5/VID-1/DECISION.md` §8 (signed, #376), amended by the Owner:
- **R-102 / R-103:** `copyright_music_check` is in the same three-mode switch;
- **R-103:** every feature can be per-member;
- **R-102:** the check cannot be turned on without the music-API key.

## What ships
| Object | Rule |
|---|---|
| `feature_access` (feature PK, mode, note, updated_by/at) | 3 rows seeded **off**: `video_posts`, `video_ads`, `copyright_music_check` |
| `feature_access_members` (feature, user_id → profiles, cascade) | **kept whatever the mode**: All members → Selected members brings the saved list back; Off does not delete it |
| `feature_access_audit` | one row per change (actor, feature, mode/add/remove, old → new, member, note); **append-only**, with a trigger that refuses UPDATE/DELETE/TRUNCATE for every role |
| `feature_allowed(feature, uid)` | the server enforcement point (the video RPCs of 0005/0006 call it). **Not callable through the API**, so no member can probe another member's access |
| `feature_allowed_me(feature)` | for the client to show or hide a button (authenticated) |
| `feature_set_mode` / `feature_add_member` / `feature_remove_member` | admin only (FEATURE-001); each writes its audit row in the same transaction; a no-op writes none |
| **`copyright_music_check` → Selected / All members** | **refused (FEATURE-003) unless vault `music_check_api_key` is present and non-empty**; nothing changes. The list can be prepared while Off |
| `feature_admin_state()` | the admin Features page: one card per feature with mode, member chips (avatar, name, @username), key state and the last 50 changes |
| `feature_member_search(q)` | admin only: by name, @username (`custom_url`) or email |

The three tables (and the audit's identity sequence) have **no grant** for the API roles; RLS is on. The fixture carries staging's default privileges (new tables: anon/authenticated ALL; new functions: authenticated EXECUTE), so every REVOKE is proved against what a new object really gets.

**Rollback:** removes the functions. It **keeps** the tables, because the lists and the audit trail are records. A re-apply resets every mode to Off and audits the reset.

## Proof — `vid7-run-tests.sh` → `vid7-transcript.txt` (ALL CASES PASS, **both lane shapes**)
| Check | Result |
|---|---|
| Fail-first | the PROBE refuses before the apply |
| Access control | members and anon cannot change a switch, read the lists, call `feature_allowed` about someone else, read the admin page or search |
| Off → Selected (Neil) → All → Selected → Off | Neil yes, Riya no → both yes → Neil yes, Riya no (**the list came back**) → nobody, with the list still saved. 5 audit rows (the no-op wrote none); each names the admin and old → new |
| Copyright check with no key | Selected and All members both FEATURE-003; still Off; no audit row. An empty key counts as missing |
| Copyright check with the key | Selected members accepted; only Neil is checked (R-103's example) |
| Audit table | UPDATE/DELETE/TRUNCATE refused, even for the owner role |
| Admin page and search | the card shows chip + key state; search works by name, @username and email; a member is refused |
| Account deletion | a deleted account leaves every list |
| PROBE mutants (each red, each undone) | list readable by members · MAINTAIN on the audit · `feature_allowed` granted · **key removed while the check is on (F2)** · append-only trigger disabled · RLS off |
| Rollback + re-apply | lane-guarded; the records are kept; the PROBE is red; the re-apply resets to Off (1 reset audited) and the lists are kept |
