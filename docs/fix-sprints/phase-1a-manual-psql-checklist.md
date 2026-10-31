# Phase 1A — Manual `psql` Run Checklist (P1 / P2 / P4 / P5)

> **Mode:** DOCUMENT-ONLY. Lovable performs zero DB calls in producing this checklist.
> **Reference probe block:** `docs/fix-sprints/phase-1a-step-c-fix-4-path-a-psql-probe-block.md` §2 + §3.
> **Goal:** You run the block in real `psql`, paste the verbatim transcript back, Lovable runs C.fix-5c-final verification.

---

## A. One-time setup (do these once, in order)

- [ ] **A1.** Install `psql` (PostgreSQL client) on your machine.
  - macOS: `brew install libpq && brew link --force libpq`
  - Windows: install PostgreSQL from postgresql.org, tick only "Command Line Tools"
  - Linux: `sudo apt install postgresql-client`
- [ ] **A2.** Confirm version: `psql --version` (must be ≥ 14). Copy the line — you'll paste it back.
- [ ] **A3.** Get the **DATABASE_URL** for project `isywidnfnjhtydmdfgtk`:
  - Lovable Cloud → Connectors → Lovable Cloud → "Connection string" (URI / session pooler).
  - It looks like: `postgresql://postgres.isywidnfnjhtydmdfgtk:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres`
  - **Save it as an env var, do NOT paste it in chat:**
    ```bash
    export DATABASE_URL='postgresql://...'   # paste your real URL between the quotes
    ```
- [ ] **A4.** Pick **one operator wallet you control** with **balance ≥ 1.00**. Note its `user_id` (UUID). Call it `OP_UID`.
- [ ] **A5.** Open a fresh terminal in a quiet directory (e.g. `~/lovable-probe`). Create a log file:
  ```bash
  mkdir -p ~/lovable-probe && cd ~/lovable-probe
  ```

---

## B. Pre-flight (READ-ONLY, ~30 s)

- [ ] **B1.** Connect:
  ```bash
  psql "$DATABASE_URL"
  ```
  You should see a `postgres=>` prompt. If you do, type `\q` to exit — connection works.
- [ ] **B2.** Confirm cron isn't about to fire (`wallet_ledger_v2_diff_hourly` runs at `:07` past every hour). Wait until current minute is **between :10 and :55** UTC.
- [ ] **B3.** Record the time you start: `date -u` → copy the output, you'll paste it back.

---

## C. Run the probe block (TX-WRAPPED, auto-rollback)

- [ ] **C1.** Open `docs/fix-sprints/phase-1a-step-c-fix-4-path-a-psql-probe-block.md` in a text viewer.
- [ ] **C2.** Copy the entire SQL fenced block under **§2** (from `\set op_uid ...` through the final RESIDUE `SELECT`).
- [ ] **C3.** In that copy, replace `REPLACE_WITH_OPERATOR_USER_UUID` with your real `OP_UID`. Change **nothing else**. The line ending with `ROLLBACK;` MUST stay `ROLLBACK;` — never `COMMIT;`.
- [ ] **C4.** Save the edited block to a local file `probe-section-2.sql`.
- [ ] **C5.** Run it and capture the full transcript:
  ```bash
  psql "$DATABASE_URL" -f probe-section-2.sql 2>&1 | tee section-2-output.txt
  ```
- [ ] **C6.** If `psql` reports an error mid-block: **STOP**. Do NOT retry, do NOT edit. The `BEGIN…ROLLBACK` guarantees zero residue; paste the error verbatim into chat.

---

## D. Run the read-only verification queries (§3, post-rollback)

- [ ] **D1.** Save §3.1 (live diff report) into `probe-section-3-1.sql`. Run:
  ```bash
  psql "$DATABASE_URL" -f probe-section-3-1.sql 2>&1 | tee section-3-1-output.txt
  ```
- [ ] **D2.** Save §3.2 (function signature + body-marker check, 2 queries) into `probe-section-3-2.sql`. Run:
  ```bash
  psql "$DATABASE_URL" -f probe-section-3-2.sql 2>&1 | tee section-3-2-output.txt
  ```
- [ ] **D3.** Save §3.3 (cron + diff_log tail, 2 queries) into `probe-section-3-3.sql`. Run:
  ```bash
  psql "$DATABASE_URL" -f probe-section-3-3.sql 2>&1 | tee section-3-3-output.txt
  ```

---

## E. Paste the result back to Lovable

Compose ONE chat message with these six blocks, in order, verbatim — no edits, no truncation, no summarisation:

- [ ] **E1.** `psql --version` output
- [ ] **E2.** Your `OP_UID` (the operator UUID you substituted)
- [ ] **E3.** Start timestamp (the `date -u` from B3)
- [ ] **E4.** Contents of `section-2-output.txt` (full §2 transcript, including every NOTICE / row / RESIDUE check)
- [ ] **E5.** Contents of `section-3-1-output.txt`, `section-3-2-output.txt`, `section-3-3-output.txt` (in that order, each clearly labelled `--- §3.1 ---`, `--- §3.2 ---`, `--- §3.3 ---`)
- [ ] **E6.** End-of-paste sentinel line, exact text: `--- END OF C.fix-5c-manual TRANSCRIPT ---`

---

## F. Safety reminders

- ❌ Never change `ROLLBACK;` to `COMMIT;` in §2.
- ❌ Never re-run §2 after an error without first telling Lovable.
- ❌ Never paste the `DATABASE_URL` or password into chat.
- ✅ §3 queries are 100% read-only — safe to re-run any number of times.
- ✅ If you abort halfway (Ctrl-C), the open txn auto-rolls back when `psql` disconnects.

---

## G. What Lovable does next (no action needed from you)

On receipt of your E1–E6 paste, Lovable will mechanically validate each Pass criterion in probe-block §2 and §3, then write `docs/fix-sprints/phase-1a-step-c-fix-5c-final-verification.md` with the GREEN/HOLD verdict. Live `gift_refund` canary stays 🛑 HOLD until that verdict is all-GREEN.
