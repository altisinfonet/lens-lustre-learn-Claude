# G10 — Schema-dependency guard, revision 3: defect fixed, coverage now reported (2026-08-25)

Status vocabulary: VERIFIED / OWNER-ATTESTED / BLOCKED / NOT APPLICABLE.
RC-2 was NOT started. The application was NOT modified. No allow-list entry was added.

---

## 1. Root cause of the guard defect — it was not a syntax problem

Revision 1 read a **fixed 600-character window** after each `.rpc` token and gave up on
anything that did not fit. Both reported sites were window truncation, not unsupported
syntax:

| Site | Why the arguments were dropped |
|---|---|
| `src/components/admin/AdminUsers.tsx:264` | a multi-line cast **plus** a long explanatory comment sit between `.rpc` and the object; comments are blanked to spaces but still occupy offsets, so the object began past character 600 |
| `src/lib/logger.ts:275` | the argument object is 16 properties long and ran off the end of the window |

In both cases the **name** was inside the window and the **arguments** were not — so the
guard reported the name and silently dropped the argument check. A larger window is the
same defect with a different threshold. The parser now walks the real call expression to
its matching close paren, however long, and **fails** if it cannot. — VERIFIED.

### 1.1 Two further holes found while fixing that one

**D3 — a call site that was not degraded but INVISIBLE.** `src/hooks/feed/usePostDrafts.ts`
binds the client method to a module-local name (for a documented reason: assigning the bare
method detaches `this` and broke publishing in production on 2026-08-17):

```ts
const rpc: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);
...
await rpc("publish_post_draft", { _draft_id: draftId });   // line 281
```

Revision 1 matched only `.rpc`, so **`publish_post_draft` was never seen at all** — it was
absent from the inventory, not merely name-only. The guard now detects module-local
forwarders and scans their call sites. — VERIFIED.

**D4 — "name-only" was silently conflated with "no arguments".** 19 call sites pass no
arguments at all. Those are not unknowable: a zero-argument call is compatible only if the
target can be called with nothing supplied. The catalog now carries each overload's
**required-parameter count**, so zero-argument calls are checked at argument level too,
and `name-only` is reserved for its real meaning — *the guard could not read this*.

---

## 2. What the parser now handles, and what it refuses

| Required property | Implementation | Proof |
|---|---|---|
| 1. `.rpc("name", {...})` | direct match | H1 |
| 2. `(supabase.rpc as <cast>)("name", {...})` | cast skipped by paren/brace depth; `<`/`>` deliberately not counted, because `=>` and `A \| B` make angle-counting unreliable | H3, H3b |
| 3. multiline | no line anchoring anywhere | H2, R1 |
| 4. casts between name and arguments | `"name" as any` read and the cast discarded; `{...} as T` likewise | R7 |
| 5. comments ignored | offset-preserving blanking; `"https://x"` is not a comment | H8 |
| 6. test/spec excluded | `__tests__`, `__mocks__`, `*.test.*`, `*.spec.*` | H10 |
| 7. no-arg call must not steal a later object literal | argument position is parsed, never "the next `{`" | H9 |
| 8. actual argument names extracted | two-state object reader (key position vs value position); array and nested-object **values** are values, not computed keys | R8 |
| 9. compared to the target's real input arguments | `pg_proc` input args + required count; app args ⊆ target args **and** target's required args ⊆ app args | H5, H6, H6c |
| — spread `{ ...extra }` | **refused** — unknown keys cannot be checked | R9 |
| — computed key `{ [k]: v }` | **refused** | (same path as R9) |
| — dynamic name `.rpc(which, …)` | **refused**, reported as UNRESOLVED NAME | R6 |
| — argument object built one line above | resolved **only** for a `const` declared exactly once, never reassigned, whose initializer is an object literal or a conditional between resolvable shapes; **every** branch must be compatible, because a call is only as safe as its weakest shape | R4, R4b |
| — trailing comma `("name",)` | one-argument call, not an unreadable second argument | R3 |

---

## 3. Mandatory self-coverage

Every run — PASS **and** FAIL — prints:

```
COVERAGE
  distinct RPC names: N
  call sites: M
  argument-compatible checks: X
  name-only checks: Y
```

`Y > 0` lists every such call with file and line **and fails the run** (`UNREADABLE
ARGUMENTS`). There is no path on which a name-only check produces a green line.

**`NAME_ONLY_ALLOWLIST` is empty and stays empty.** The mechanism exists, is documented,
and is tested (H15a/b/c), and it is **not used**: the real tree needs no exception. An
allow-list entry must name `file:line` and carry a reason, and only takes effect when
`SCHEMA_GUARD_ALLOW_NAME_ONLY` points at a real file — so one cannot take effect by
accident.

---

## 4. Harness — 41/41 cases pass

All 15 mandated cases, plus 26 more including a regression for every defect this guard has
ever shipped with.

| Mandated case | Case id | Result |
|---|---|---|
| normal RPC → PASS | H1 | PASS |
| multiline RPC → PASS | H2 | PASS |
| cast-form RPC → PASS **with arguments** | H3 (+ H3b: same shape FAILs on a renamed parameter — proof the arguments were read, not the name) | PASS |
| missing RPC → FAIL | H4 | PASS |
| wrong argument names → FAIL | H5 | PASS |
| overload / signature mismatch → FAIL | H6, H6b, H6c | PASS |
| multiple references → all reported | H7 | PASS |
| RPC inside comments → ignored | H8 | PASS |
| no-argument RPC → does not steal a later object literal | H9 | PASS |
| test/spec references → excluded | H10 | PASS |
| planted missing RPC → FAIL | H11a→H11b→H11c (green → plant → FAIL → unplant → green) | PASS |
| planted wrong arguments → FAIL | H12 | PASS |
| missing credentials → FAIL | H13 (and never prints a connection string) | PASS |
| empty source / parser finds nothing → FAIL | H14, H14b (empty catalog) | PASS |
| unexpected name-only → FAIL unless allow-listed | H15a / H15b / H15c | PASS |

Regressions: R1, R1b (600-char window), R2, R2b (forwarder), R3 (trailing comma), R4, R4b
(const ternary), R5 (zero-arg vs required parameter), R6 (dynamic name), R7 (cast on the
name), R8 (array/nested values), R9 (spread), R10a/b/c (catalog integrity), R11 (fake
catalog announces itself), R12a/b (coverage printed on both outcomes).

**Result: 41/41 cases passed, 0 failed.** — VERIFIED.

---

## 5. Real-lane verification — both live catalogs

Promotion tree `/home/claude/repo/work`, tree `3515b9a62e72ee5cdc56cac4cf2f3987930960f7`,
unmodified throughout (`git status --porcelain` empty; tree SHA re-read after the run).

No hand-built catalog was used. Each lane's `pg_proc` produced the catalog **and its own
md5 over the same bytes**; the guard recomputes the digest and refuses on mismatch, so a
catalog that was retyped, truncated or edited cannot be used as evidence.

| | Production `jtdtehuqtinjxropkkcn` | Staging `ztzutckwdhetphwghuzj` |
|---|---|---|
| Verdict | **PASS** (exit 0) | **PASS** (exit 0) |
| Catalog digest, computed by the database | `361bf226a3946479a930e74a65c6b9dc` | `361bf226a3946479a930e74a65c6b9dc` |
| Overload rows / names found | 107 / 103 | 107 / 103 |
| distinct RPC names | 103 | 103 |
| call sites | 120 | 120 |
| argument-compatible checks | **120** | **120** |
| name-only checks | **0** | **0** |
| of which zero-argument calls, verified callable with none | 19 | 19 |
| missing RPCs | **0** | **0** |
| incompatible argument sets | **0** | **0** |

The two digests were returned independently by the two databases and are equal: over the
103 referenced function names, **the lanes are byte-identical in name, input-argument order
and required-argument count.** — VERIFIED.

Coverage grew against revision 1 (102 names / 119 sites → 103 / 120): `publish_post_draft`
was previously invisible.

### 5.1 Controls run on the live catalogs

- **Tampered catalog** — one byte changed in production's catalog, correct digest supplied:
  `SCHEMA-GUARD FAIL [S8] … the catalog is not a faithful copy`, exit 1. — VERIFIED.
- **Planted defects against the live production catalog** (on a copy; the promotion tree was
  not touched): `admin_search_users_v3` → `MISSING … __plant__.ts:2`; `_qeury` typo →
  `INCOMPATIBLE admin_search_users_v2`, showing `application sends: _by, _qeury` against
  `target has: _query, _by, _role, _badge, _limit, _offset`. Exit 1. Plant removed → PASS,
  exit 0. — VERIFIED.

### 5.2 Deviation from the requested procedure, stated plainly

The guard's authoritative CI path is unchanged: `SUPABASE_DB_URL` → `psql` → live `pg_proc`.
**This session has no database egress and no credential**, so the two real-lane runs above
used the out-of-band catalog path with the database-computed digest. That path is
authoritative by construction — it refuses any catalog whose bytes do not hash to what the
target database said — but it is not the same as the guard opening its own connection. The
CI workflow still uses the direct path and is the one that will run at promotion.

---

## 6. Files (not yet committed)

- `scripts/verify-schema-dependencies.mjs` — revision 3
- `scripts/test-schema-dependencies.mjs` — 41-case harness
- `.github/workflows/verify-schema-dependencies.yml` — promotion gate; runs the harness
  before it trusts the guard, and asserts the credential's project ref matches the chosen
  target, exactly as `apply-migration.yml` does

---

## 7. Status

| Item | State |
|---|---|
| RC-1 | **GREEN** |
| Production schema (`admin_search_users_v2` + index) | **GREEN** |
| Schema guard | **GREEN** — 41/41 harness, both lanes PASS, 0 name-only, 0 allow-list entries |
| RC-2 | **NOT STARTED** |
| G10 | **BLOCKED** |

### Remaining blockers for G10
1. **RC-2** — application promotion. Not started. Production still runs v1, so the admin
   member list still hides 3 members including the sole admin.
2. **§5.3 secret-isolation re-test** — never executed; needs a push and an Actions run.
3. **`main` branch protection** — OWNER-ATTESTED, not yet attested.
4. **§11 approval** naming tree `3515b9a62e72ee5cdc56cac4cf2f3987930960f7`.
5. **Repository secret `SUPABASE_DB_URL`** — absent. `apply-migration.yml` on `main` has
   never had it, and the new guard workflow reads the same secret from the target
   Environment. Owner-only. Session pooler port **5432**, not 6543.
6. Guard files are **not committed** — they must land in the repo before they can gate
   anything.

### Post-G10, unchanged
svgo; Node 20 EOL in the production builder; bun/npm lockfile split; 6 branch-alias preview
URLs; stale `Main` branch rule; rotate `sbp_417b…`.
