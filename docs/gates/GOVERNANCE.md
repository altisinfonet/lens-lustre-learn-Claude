# GOVERNANCE CHARTER — Governance V2

**Owner of this document:** the Auditor · **Status:** ACTIVE · **Adopted:** 2026-09-18 by Owner decisions O-2, O-3 and O-6.

This charter defines how governance itself operates: which layer holds which kind of
truth, who owns which governance document, how a hold behaves, and what the
governance control machinery is allowed to do. It does **not** restate
`docs/ADDENDUM_A_EXECUTION_MASTER.md`. Where this charter and the Addendum both
touch a subject, the Addendum remains the engineering operating authority and this
charter points at it rather than copying it.

Nothing here introduces a new security, database, application or deployment rule.

---

## 1 · The four layers

Governance holds four different kinds of truth. The rule that keeps them honest is
that **a layer never restates another layer's content — it points at it.**

| Layer | Holds | Artefact |
|---|---|---|
| **L0 — bootloader** | where to look, in priority order | `CLAUDE.md` |
| **L1 — policy** | what the rules are, who owns them, how they change | `docs/ADDENDUM_A_EXECUTION_MASTER.md` and this charter |
| **L2 — mechanism** | what is actually enforced or reported, and by what | the governance workflow and `docs/gates/governance-manifest.json` |
| **L3 — live truth** | what is true right now | GitHub settings, workflow runs, the database, and generated governance reports |

### 1.1 Evidence precedence

**Live evidence outranks stale documentation.** A document records what was true when
it was written; it is not re-verified on every read. When a document and the live
system disagree, the live system is correct and the document is the finding.

Precedence, highest first: **L3 live evidence → L1 policy → L0 pointer**. L2 is the
machinery that compares L1's claims against L3 and reports the difference; it is
never itself the source of truth about the system.

This restates, and does not replace, the rule already carried in `CLAUDE.md`.

### 1.2 What the governance machinery may do

**Governance controls are report and verification mechanisms. They do not silently
change production state.**

- A governance control reads, compares and reports. It does not write to a ledger,
  does not edit a governance document, and does not alter repository settings.
- A governance control never applies SQL, never touches production, and never
  modifies application source.
- Where a control finds a discrepancy, the output is a report. Acting on that report
  is a human act by the document's owner.
- A control that has never been seen to fail is a claim, not evidence. Every
  governance control ships with a planted-defect demonstration, per rule 2 of the
  five rules in `docs/gates/GATE_REGISTER.md`.

---

## 2 · Authority and ownership

### 2.1 The two authorities

- **The Owner has final authority over project operating policy.**
- **The Auditor owns governance verification, evidence integrity, and the governance
  control machinery.**

**Auditor ownership never grants authority to override an Owner decision.** The
Auditor may report that policy and reality disagree; resolving that in favour of a
changed policy is the Owner's act.

### 2.2 Document ownership

| Document | Owner |
|---|---|
| `CLAUDE.md` | **Owner** |
| `docs/ADDENDUM_A_EXECUTION_MASTER.md` | **Owner** |
| `docs/DECISIONS.md` | **Shared — Owner + Auditor** |
| `docs/gates/GOVERNANCE.md` | **Auditor** |
| `docs/gates/governance-manifest.json` | **Auditor** |

This table governs the five documents named in Owner decision O-3. It sits alongside
the file-ownership map in `docs/ADDENDUM_A_EXECUTION_MASTER.md` §3.1 and §3.2, which
continues to govern every other path, including `docs/PROMOTION_LEDGER.md`
(Auditor only) and the rest of `docs/gates/**` (Auditor).

**Shared ownership**, for `docs/DECISIONS.md`, means: the **Owner controls the
substantive decision** — what is withheld, why, and what ends it — and the
**Auditor controls record integrity**: status, history, supersession, and
consistency with the rest of governance. The Auditor may correct how a decision is
recorded. The Auditor may not change what was decided.

### 2.3 No inferred owners

**No additional governance owner is inferred or assigned without explicit Owner
approval.** A governance document with no named owner is an **ownership gap**: it is
reported as such and left unassigned. Silence is not an assignment, and neither
convenience nor precedent creates one.

### 2.4 Amendment and supersession

Governance documents follow the conventions already proven in this repository rather
than new ones:

- **A superseded conclusion is not edited.** The original stands and the correction
  is filed beside it — rule 5 of the five rules in `docs/gates/GATE_REGISTER.md`.
- A superseding record **names what it supersedes**, and the superseded record names
  its successor — the `SUPERSEDED` convention in `docs/DECISIONS.md`.
- A historical document that no longer describes the repository carries a
  supersession banner at its top and its body is left unchanged.
- An amendment to a document is made by, or with the authority of, that document's
  owner in §2.2 or in Addendum §3.1/§3.2.

---

## 3 · The hold model

A **governance hold** records something that blocks work and names what would release
it. This model is Owner decision O-6.

### 3.1 Required fields

A hold carries exactly these:

| Field | Meaning |
|---|---|
| **owner** | the named actor who can release it |
| **release condition** | a condition somebody can check, not a feeling |
| **current state** | `OPEN` / `BLOCKED` while unresolved; `RESOLVED` once the condition is met and evidenced |
| **evidence** | what was observed, and when — a run id, a commit, a query result, a settings read, or an Owner attestation |
| **resolution record** | written when the hold resolves: what satisfied the condition, and the evidence for it |

### 3.2 How a hold moves

- **When evidence shows the release condition is satisfied, the Auditor reconciles
  the hold immediately.** There is no waiting period before reconciliation.
- **If the condition remains unresolved and requires Owner action, the hold remains
  explicitly `OPEN`/`BLOCKED`** and is surfaced by governance health reporting until
  it is resolved.
- **Escalation is evidence and action based, never calendar based.** A hold is raised
  because its condition changed or because it blocks named work — never because time
  passed.

### 3.3 What this model does not contain

There is deliberately **no** aged state, **no** escalated state, **no** review-by
date, **no** opened-date requirement, **no** SLA, and **no** timer of any kind. A
hold's age is not a governance signal and is not to be treated as one. Any future
proposal to add a time-based lifecycle is a change to this charter and requires an
Owner decision.

### 3.4 The signal that matters

The condition this model exists to catch is **a hold whose release condition is
satisfied while the hold is still recorded as open** — the record and reality having
drifted apart. That is a reconciliation failure, and it is detectable by checking the
condition against live evidence. It is not detectable by measuring elapsed time.

Applying this model to the standing-holds table in `docs/gates/GATE_REGISTER.md` is a
separate Auditor act and is not performed by this charter.

---

## 4 · The operating sequence

Engineering work follows **INSPECT → PLAN → IMPLEMENT → VERIFY → AUDIT**. The
Addendum names what evidence closes each step; this charter does not restate it.

Governance work follows the same sequence, with one addition at the front: an
inspection re-derives the state it depends on from the live system rather than from a
prior report, including a prior report written by the same session.

---

## 5 · The four states of a change

These four are distinct and are never used interchangeably. This restates the
distinction already carried in `CLAUDE.md` because governance reporting depends on it.

| State | Means |
|---|---|
| **code merged** | the PR landed on `staging` |
| **staging applied** | the SQL ran against the staging database |
| **production applied** | the SQL ran against the production database |
| **VERIFIED** | live evidence was re-checked after the fact, by the Auditor's own instrument run |

A unit that is code-merged is not staging-applied. A unit that is production-applied
is not `VERIFIED`. Per rule 1 of the five rules in `docs/gates/GATE_REGISTER.md`, a
row reaches `VERIFIED` only on the Auditor's own instrument run; evidence filed by
someone else is `EVIDENCE FILED`, never `VERIFIED`.

**A green CI run is not a verification of anything except what the check actually
asserted.**

---

## 6 · Scope of this charter

This charter governs governance. It does not govern the database, the application,
the deployment pipeline or the security programme, and it introduces no rule about
them. Those remain with `docs/ADDENDUM_A_EXECUTION_MASTER.md` and the documents it
names.

Open Owner decisions affecting governance are tracked outside this file and are not
pre-empted by it. Where this charter is silent on a governance question, the answer
is that it is undecided — not that it may be inferred.
