# FORENSIC ENGINEERING MANDATE — GLOBAL PROJECT RULES

> **Status:** Globally binding. Applies to EVERY future phase, fix, audit, migration, refactor, DB change, edge-function edit, UI change, hook modification, RLS adjustment, payment update, realtime update, and performance task.
>
> These rules OVERRIDE convenience and speed.

---

## RULE 1 — ZERO ASSUMPTION POLICY

Every claim MUST be backed by at least one of:

- SQL result
- source code
- RPC definition
- edge-function response
- RLS policy
- logs
- screenshots
- reproducible probe
- CI output
- line-numbered diff

If evidence is missing, write exactly:

**NOT VERIFIED**

Never infer hidden business logic.
Never infer workflow intent.
Never infer permissions.

---

## RULE 2 — ZERO GUESSWORK POLICY

If the answer is not directly present in:

- SOW
- codebase
- DB
- logs
- forensic docs
- API response
- edge-function code
- migrations
- RLS policies

**STOP and ask the user.**

Do NOT invent:

- flows
- roles
- UI behavior
- status meanings
- payment rules
- judging rules
- notification logic

---

## RULE 3 — EXHAUSTIVE FORENSIC CHECKLIST

No partial checking.
No "probably fine".
No "already checked".

Every subsystem audit MUST:

- run full checklist
- include dependencies
- include regression verification
- include security verification
- include realtime verification
- include cache verification
- include mobile verification if UI-related

Every fix phase MUST rerun:

- impacted subsystem audit
- regression checks
- related invariants

---

## RULE 4 — DIFF-CAPTURED ENGINEERING

Every modification MUST include:

- exact file paths
- line-level diff
- before behavior
- after behavior
- rollback plan
- risk assessment
- verification evidence
- known side effects

Silent edits are forbidden.

---

## RULE 5 — SINGLE FORENSIC AUTHORITY

All engineering decisions MUST trace back to:

- approved forensic blueprint
- approved phase plan
- verified evidence
- approved invariants

No conflicting redesign streams.
No parallel architecture assumptions.
No unapproved rewrites.

---

## GLOBAL EXECUTION RULES

1. Never rewrite whole subsystems casually.
2. Preserve verified invariants.
3. Stability > speed.
4. Production safety > refactor elegance.
5. Every phase must be reversible.
6. Every dangerous migration requires shadow mode.
7. Every finance mutation requires reconciliation proof.
8. Every RLS change requires regression proof.
9. Every realtime change requires bandwidth verification.
10. Every cache change requires invalidation verification.

---

## MANDATORY OUTPUT FORMAT

Every task response MUST contain:

1. **VERIFIED FINDINGS**
2. **NOT VERIFIED ITEMS**
3. **FILES TOUCHED**
4. **RISKS**
5. **DIFF SUMMARY**
6. **VERIFICATION PROOF**
7. **ROLLBACK PLAN**
8. **NEXT RECOMMENDED STEP**

---

## FINAL INSTRUCTION

This mandate is globally binding for all future work on this project.

Do not bypass it.
