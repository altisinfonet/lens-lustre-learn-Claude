---
name: Single Mirror Trigger Lockdown
description: judge_tag_assignments has exactly ONE mirror trigger (trg_mirror_system_tag_to_decision). Adding a second is forbidden.
type: constraint
---
**Rule**: `public.judge_tag_assignments` MUST have exactly ONE mirror trigger:
`trg_mirror_system_tag_to_decision` (AFTER INSERT/UPDATE/DELETE, FOR EACH ROW, calls `mirror_system_tag_to_decision()`).

**History**: A duplicate `tr_mirror_system_tag_to_decision` (legacy non-standard `tr_` prefix) was dropped on 2026-05-04 (B2 MUST-DO #1). It was inflating `v3_mirror_log` 2× per write. Function idempotency (`ON CONFLICT DO UPDATE` on both `judge_decisions` and `judge_award_tags`) made the duplicate silently safe — but the cleanup landed.

**Why**: Two identical triggers double-fire the mirror function, doubling `v3_mirror_log` rows and wasting writes. Any future re-introduction of a second mirror trigger on this table is a regression.

**How to apply**:
- Never `CREATE TRIGGER ... mirror_system_tag_to_decision()` on `judge_tag_assignments` again.
- The sibling trigger on `judge_tag_pass` is a separate table and is fine.
- Canonical inventory: `/mnt/documents/B2-writer-inventory-v1.md`.

**Rollback** (emergency only):
```sql
CREATE TRIGGER tr_mirror_system_tag_to_decision
  AFTER INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.mirror_system_tag_to_decision();
```
