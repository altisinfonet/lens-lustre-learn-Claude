// ═══════════════════════════════════════════════════════════════════════════
// D1 · THE LANE GUARD — one implementation, imported by every db-*.mjs script.
//
// WHY THIS IS A MODULE AND NOT COPY-PASTE.
//
// The single most expensive class of mistake available in this repository is
// a script that believes it is talking to staging and is talking to production.
// The workflow .github/workflows/apply-migration.yml already implements the
// check that prevents it, in shell. Every Node script that opens a database
// connection needs the same check, and the moment there are two copies of it
// they start to differ — one gets a fix, the other does not, and the one that
// did not is the one that runs the night something goes wrong.
//
// So: one module. scripts/db-baseline.mjs and scripts/db-seed-staging.mjs both
// import it, and a change to the guard changes both.
//
// THE GUARD IS THREE INDEPENDENT CHECKS, and it is worth saying why three,
// because each one is blind to what the next one sees.
//
//   1. THE REF IN THE STRING. Parsed out of the connection string's username
//      (`postgres.<ref>`), exactly as apply-migration.yml parses it, and
//      compared with the lane the caller asked for. This runs BEFORE a socket
//      is opened. It catches a production credential pasted into the staging
//      Environment — the failure with no warning and no undo.
//
//      A direct (non-pooler) string has a bare `postgres` username, parses to
//      nothing, and is REFUSED rather than guessed at. That is the correct
//      direction to fail in: a shape this gate cannot read is a shape it must
//      not wave through.
//
//   2. THE CLUSTER'S OWN ANSWER. pg_control_system().system_identifier is a
//      permanent per-cluster value, generated at initdb and never changed by
//      anything an application does. Check 1 reads a string the caller
//      supplied; this reads what the database says about itself, and the two
//      must agree. It is the check that survives a correctly-shaped string
//      pointing somewhere unexpected.
//
//      Recorded 2026-09-02 06:38Z, by SELECT system_identifier FROM
//      pg_control_system() on each project:
//
//        production  jtdtehuqtinjxropkkcn  →  7656985631720456337
//        staging     ztzutckwdhetphwghuzj  →  7666007964130682852
//
//      ⚠ IF A FINGERPRINT EVER DISAGREES, THAT IS A FINDING TO REPORT.
//      It is not a constant to update so the run passes. A cluster's system
//      identifier changes when the cluster is restored from a base backup or
//      recreated — both of which are things somebody must know happened.
//
//   3. READ-ONLY, PROVED. For scripts that claim to read only: the session is
//      set read-only at the server, and then a write is deliberately attempted
//      and required to fail with SQLSTATE 25006. A control nobody has seen fire
//      is a claim, not a control.
//
// The credential itself is never printed, never logged, and never written to a
// file. It arrives from the Environment secret SUPABASE_DB_URL and leaves in
// the argv of a psql child process and nowhere else.
// ═══════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';

export const LANES = {
  production: {
    ref: 'jtdtehuqtinjxropkkcn',
    system_identifier: '7656985631720456337',
    site: 'www.50mmretina.com',
    branch: 'main',
  },
  staging: {
    ref: 'ztzutckwdhetphwghuzj',
    system_identifier: '7666007964130682852',
    site: 'staging.50mmretina.com',
    branch: 'staging',
  },
};

export const PRODUCTION_REF = LANES.production.ref;

// ── Two scrubbers, and the difference is not pedantry ──────────────────────
// An earlier version of this code had one aggressive scrubber applied to
// everything, and it redacted the connection-string SHAPE out of its own help
// text — so the message whose entire job is to tell the operator what a
// correct string looks like printed "postgres://«redacted»". The message is a
// control; a control that destroys its own instruction is a defect.
//
//   scrub()         — our own text. Removes the literal credential, nothing
//                     else, so placeholders and examples survive.
//   scrubExternal() — anything psql produced. Aggressive, because a database
//                     error can echo a connection string in shapes we cannot
//                     enumerate in advance.
export function scrub(text) {
  const dsn = process.env.SUPABASE_DB_URL;
  let s = String(text ?? '');
  if (dsn) s = s.split(dsn).join('«SUPABASE_DB_URL redacted»');
  return s;
}

export function scrubExternal(text) {
  return scrub(text).replace(/postgres(ql)?:\/\/[^\s"']*/gi, 'postgres://«redacted»');
}

// Redact anything token-shaped from data we are about to write to a file.
export function redactSecrets(value) {
  if (typeof value === 'string') {
    return value
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '«jwt redacted»')
      .replace(/(bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1«redacted»')
      .replace(/sb[ps]_[A-Za-z0-9_-]{8,}/g, '«supabase key redacted»')
      .replace(/postgres(ql)?:\/\/[^\s"']*/gi, 'postgres://«redacted»');
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSecrets(v)]));
  }
  return value;
}

// ── Check 1 · the ref in the string, before a socket is opened ─────────────
export function refParsedFromDsn(dsn) {
  const m = /^postgres(?:ql)?:\/\/([^:@/]+)[:@]/.exec(String(dsn ?? ''));
  if (!m) return null;
  const user = decodeURIComponent(m[1]);
  const dot = user.indexOf('.');
  if (dot < 0) return null;
  const ref = user.slice(dot + 1);
  return ref.length > 0 ? ref : null;
}

export function assertLane(target, dsn) {
  const lane = LANES[target];
  if (!lane) {
    throw new Error(`Unknown target '${target}'. Expected one of: ${Object.keys(LANES).join(', ')}.`);
  }
  const ref = refParsedFromDsn(dsn);
  if (!ref) {
    throw new Error(
      'Could not parse a project ref from SUPABASE_DB_URL. Expected a session-pooler string of the '
      + 'shape postgresql://postgres.<ref>:<password>@...:5432/postgres. A direct string has a bare '
      + '`postgres` username, parses to nothing, and is refused rather than guessed at.',
    );
  }
  if (ref !== lane.ref) {
    throw new Error(`Credential points at '${ref}', target is '${target}' (${lane.ref}) — refusing.`);
  }
  return ref;
}

// For a script that must NEVER touch production, whatever it was asked to do.
// This is not the same as assertLane('staging', …) with a different message:
// it names production explicitly, so the refusal is unambiguous in a log.
export function refuseProduction(dsn) {
  const ref = refParsedFromDsn(dsn);
  if (ref === PRODUCTION_REF) {
    throw new Error(
      `REFUSING: the credential points at the PRODUCTION project ${PRODUCTION_REF}. This script `
      + 'writes, and it is staging-only by construction. Nothing was run.',
    );
  }
  return ref;
}

// Keep the END of a large stderr — that is where psql puts the error. A head
// slice would keep 40 warnings and throw away the diagnosis.
function lastLinesOf(text, n) {
  const lines = String(text).split('\n');
  if (lines.length <= n) return text;
  const dropped = lines.length - n;
  return `[${dropped} earlier stderr line(s) omitted — the error is at the end]\n${lines.slice(-n).join('\n')}`;
}

// ── F-84 · THE SAME DEFECT AS F-78, IN THE SAME LINE, LEFT BEHIND BY ITS FIX ─
//
// F-78 proved PGOPTIONS does not survive the Supabase session pooler and moved
// `default_transaction_read_only` into the query stream. It did NOT move the
// other three settings in that same PGOPTIONS string, and the comment it left
// called PGOPTIONS "belt and braces" — true of read-only, which gained a second
// mechanism, and false of these three, which had none at all:
//
//   statement_timeout                     believed 600000 ms on a seed batch
//   lock_timeout                          believed 5000 ms
//   idle_in_transaction_session_timeout   believed 120000 ms
//
// MEASURED CONSEQUENCE, staging 2026-09-04, run 33892294982: the 100k seed died
// at 80,200 rows. Postgres's own log at 16:06:07.461Z:
//
//     canceling statement due to statement timeout
//
// The pooler connection ran 16:04:07.32 → 16:06:07.46 — 120.14 s — because the
// server's own 120 s default applied, not the 600 s the seeder had asked for and
// believed it had. Batch time grows with the table (nine triggers a row, a
// fan-out lookup a row, growing indexes), so the run walked into a limit it had
// explicitly set out of the way, and could not see it coming.
//
// ⚠ PGOPTIONS BELOW IS THE BELT. IT IS NOT THE BRACES. Nothing here relies on
// it; it is kept only because it still works on a direct connection. Every
// setting that matters travels as SQL, where no pooler can strip it.
//
// ⚠ SET LOCAL, NOT SET, AND INSIDE THE BATCH'S OWN TRANSACTION — the Auditor's
// ruling, and it is the stronger form. A session-level SET would leak to
// whatever else reused that pooled backend; SET LOCAL is scoped to this
// transaction and reverts at COMMIT (measured on the fixture: after COMMIT the
// setting reads 300ms again), so a limit this file sets can never become a limit
// somebody else inherits.
//
// ⚠ WHY THE EXPLICIT BEGIN ON THE WRITE PATH, STATED CORRECTLY. My first version
// of this comment said the explicit transaction was needed because SET LOCAL
// outside one is a no-op. The fixture contradicted that and the comment is
// rewritten rather than left standing. What was actually measured, 2026-09-04:
//
//   SET LOCAL alone in its own invocation
//     -> WARNING: SET LOCAL can only be used in transaction blocks, and the
//        setting does not persist. So the no-op is real, but only when it is
//        the only statement.
//   psql -c "SELECT txid_current(); SELECT txid_current();"
//     -> 741, 741 — psql already wraps a multi-statement -c in ONE implicit
//        transaction.
//   the payload WITHOUT an explicit BEGIN
//     -> the long statement completed, exit 0.
//
// So the explicit BEGIN is NOT required for SET LOCAL to bite here. It is kept
// for a different and better reason: without it the guarantee rests on a psql
// CLIENT behaviour rather than on what we send. Swap psql for a driver, or let
// that behaviour change, and SET LOCAL silently degrades to a warning nobody
// reads — which is exactly the F-78 and F-84 failure mode, a control that
// depends on how the transport happens to behave instead of on the bytes in the
// query stream. Making the transaction explicit puts the guarantee back in the
// SQL, where this file can be held to it.
//
// ⚠ ORDER, AND IT IS THE OPPOSITE OF WHAT I FIRST WROTE. The SET LOCALs go
// AFTER BEGIN. My first attempt put them before it, reasoning that a setting
// must precede the transaction it bounds; with SET LOCAL that is exactly wrong —
// before BEGIN they would be a no-op outside any transaction. The test now pins
// the correct order rather than the order I assumed.
//
// The read path keeps BEGIN READ ONLY as its enforcement (F-78); read-only is a
// property of the transaction, so `SET LOCAL default_transaction_read_only`
// would be a no-op there and is deliberately not used as if it were a control.
//
// This is a pure function so it can be tested on the string it builds rather
// than by a regex over this file. A guard tested by its shape is not tested.
export function psqlPayload(sql, { readOnly = true, timeoutMs = 180000 } = {}) {
  const local = [
    `SET LOCAL statement_timeout = ${Number(timeoutMs)};`,
    'SET LOCAL lock_timeout = 5000;',
    'SET LOCAL idle_in_transaction_session_timeout = 120000;',
  ].join(' ');

  return readOnly
    ? `BEGIN READ ONLY; ${local} ${sql}; COMMIT;`
    : `BEGIN; ${local} ${sql}; COMMIT;`;
}

// ── psql, one statement per invocation ─────────────────────────────────────
export function psql(dsn, sql, { readOnly = true, expectError = false, timeoutMs = 180000 } = {}) {
  const opts = [
    readOnly ? '-c default_transaction_read_only=on' : '',
    `-c statement_timeout=${timeoutMs}`,
    '-c idle_in_transaction_session_timeout=120000',
    '-c lock_timeout=5000',
  ].filter(Boolean).join(' ');

  const env = {
    ...process.env,
    PGOPTIONS: opts,
    PGCONNECT_TIMEOUT: '20',
    PGAPPNAME: process.env.PGAPPNAME || 'd1-script',
  };

  // ⚠ F-78. PGOPTIONS ALONE DOES NOT SURVIVE THE SESSION POOLER, AND THE
  // NEGATIVE CONTROL PROVED IT ON ITS FIRST END-TO-END RUN.
  //
  // The PGOPTIONS above is a STARTUP-PACKET parameter. Supabase's session
  // pooler does not forward it to the backend, so `default_transaction_read_only`
  // never reaches the server and the session is READ-WRITE while this file
  // believed it was read-only. Measured 2026-09-04, same code, two transports:
  //
  //   direct (scratch PG 16 fixture)  current_setting -> 'on'
  //                                   CREATE TABLE    -> ERROR 25006 ✓
  //   Supabase session pooler (CI)    run 33877831292, job 101038963294:
  //                                   CREATE TABLE    -> SUCCEEDED ✗
  //                                   and left public.__d1_readonly_negative_control__
  //                                   behind on staging, which had to be dropped by hand
  //
  // So the enforcement is moved INTO THE QUERY STREAM, where no pooler can
  // strip it: an explicit `BEGIN READ ONLY` travels as ordinary SQL. PGOPTIONS
  // is KEPT as well — belt and braces, and it still works on a direct
  // connection — but it is no longer the thing being relied on.
  //
  // Proven on the fixture before this line was written (C-34):
  //   without the wrapper, no PGOPTIONS  -> CREATE TABLE SUCCEEDS, setting 'off'
  //   with the wrapper,    no PGOPTIONS  -> ERROR: cannot execute CREATE TABLE
  //                                          in a read-only transaction
  //   with the wrapper, a real SELECT    -> returns its rows normally
  //
  // Only the read-only path is wrapped. Every seeder call passes
  // { readOnly: false } and is deliberately untouched, or the seeder could not
  // write at all.
  //
  // `-q` keeps the BEGIN/COMMIT status lines off stdout, so callers that
  // JSON.parse the output are unaffected — verified byte-exact on the fixture.
  const payload = psqlPayload(sql, { readOnly, timeoutMs });

  try {
    const stdout = execFileSync(
      'psql',
      [dsn, '--no-psqlrc', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', payload],
      { env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const stderr = scrubExternal(err.stderr || err.message || '');
    if (expectError) return { ok: false, stdout: scrubExternal(err.stdout || ''), stderr };
    // ⚠ THE REAL ERROR IS AT THE END, AND IT GETS BURIED. enqueue_post_job()
    // catches its own failure and RAISE WARNINGs once PER ROW, so one failed
    // 5000-row batch carries ~5000 warnings ahead of the one line that says what
    // actually went wrong. On run 33892294982 that line — "canceling statement
    // due to statement timeout" — was pushed past the log's line-truncation
    // limit and could not be read from CI at all; the cause had to be recovered
    // from the database's own logs instead. A failure you cannot read is a
    // failure you cannot fix, so the tail is kept and the head is summarised.
    throw new Error(`psql failed: ${lastLinesOf(stderr, 40)}`);
  }
}

// ── Check 2 · the cluster names itself ─────────────────────────────────────
export function proveFingerprint(dsn, target, { readOnly = true } = {}) {
  const res = psql(dsn, 'SELECT system_identifier::text FROM pg_control_system()', { readOnly });
  const observed = res.stdout.trim();
  const expected = LANES[target].system_identifier;
  if (observed !== expected) {
    throw new Error(
      `Cluster fingerprint disagrees with the lane. target='${target}' expects system_identifier `
      + `${expected}; the database answered ${observed}. Refusing. This is a finding to report — `
      + 'do not edit the constant to make the run pass.',
    );
  }
  return { control: 'cluster_fingerprint', expected, observed, fired: true };
}

// ── Check 3 · the read-only claim is proved, not asserted ──────────────────
export const READ_ONLY_NEGATIVE_CONTROL = 'CREATE TABLE public.__d1_readonly_negative_control__ (x int)';

export function proveReadOnly(dsn) {
  const res = psql(dsn, READ_ONLY_NEGATIVE_CONTROL, { readOnly: true, expectError: true });
  if (res.ok) {
    throw new Error(
      'THE READ-ONLY NEGATIVE CONTROL SUCCEEDED IN CREATING A TABLE. The session is NOT read-only. '
      + 'Aborting before any probe. Drop public.__d1_readonly_negative_control__ by hand and report this.',
    );
  }
  if (!/25006|read-only transaction/i.test(res.stderr)) {
    throw new Error(
      "The read-only negative control failed, but NOT with SQLSTATE 25006. The session's read-only "
      + `state is therefore unproven and nothing will be written. psql said: ${res.stderr}`,
    );
  }
  return {
    control: 'read_only_session',
    statement: READ_ONLY_NEGATIVE_CONTROL,
    expected: 'SQLSTATE 25006 — cannot execute CREATE TABLE in a read-only transaction',
    observed: res.stderr.trim().split('\n')[0],
    fired: true,
  };
}

export function requireDsn() {
  const dsn = process.env.SUPABASE_DB_URL;
  if (!dsn) {
    throw new Error(
      'SUPABASE_DB_URL is not set. It is an Environment secret, one per lane; see the header of '
      + '.github/workflows/apply-migration.yml for the one-time setup. Its value is never printed.',
    );
  }
  return dsn;
}
