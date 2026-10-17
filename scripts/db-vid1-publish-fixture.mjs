#!/usr/bin/env node
/**
 * VID-1 · 20261013_0004 — the production-shaped fixture.
 *
 * PROVES, on a throwaway PostgreSQL, the thing a read-only probe on staging
 * cannot: that video_publish_post() publishes for a member who holds NO
 * privilege on post_media (production's ACL) once 20261013_0004 is applied —
 * and that, before it, the same member's replay fails with 42501.
 *
 * It runs the REAL files, verbatim — 20261011_0003, 20261013_0004, its PROBE
 * and its ROLLBACK, and 20261011_0002's detect_duplicate_post() body — over
 * the schema slice in supabase/tests/vid1-publish-post-media/, twice:
 *   production shape  post_media: nothing for anon/authenticated
 *   staging shape     the same + authenticated SELECT (20261013_0001's keep)
 * and requires every refusal to fire too (no lane, wrong lane, re-run,
 * PROBE before the apply and after the rollback, rollback twice).
 *
 * FAIL-FIRST is a step, not a claim: the AFTER assertions (40_after.sql) run
 * against the UNFIXED body first, in a rolled-back transaction, and the run is
 * red unless they fail there (production shape: 42501 at A1; staging shape:
 * A7 — the keep).
 *
 * CONNECTS ONLY TO A LOCAL THROWAWAY DATABASE. Two executors:
 *   default   psql against PGHOST/PGPORT/PGUSER/PGPASSWORD — refused unless
 *             PGHOST is localhost / 127.0.0.1 / ::1 / a socket directory
 *             (CI: a postgres:17 service container, d1-vid1-publish-fixture.yml)
 *   --pglite <dir>  in-process PGlite (PostgreSQL 17 in WASM) imported from
 *             <dir>/node_modules — for a developer machine; not a dependency
 *             of this repository.
 * It creates and drops databases named fx_production / fx_staging only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const T = (f) => join(ROOT, "supabase/tests/vid1-publish-post-media", f);
const M = (f) => join(ROOT, "supabase/migrations", f);
const R = (f) => join(ROOT, "supabase/rollback", f);

const MIG = M("20261013_0004_vid1_publish_post_media_definer.sql");
const PROBE = M("PROBE_20261013_0004_vid1_publish_post_media_definer.sql");
const RB = R("20261013_0004_vid1_publish_post_media_definer_ROLLBACK.sql");
const M0003 = M("20261011_0003_vid1_publish_post_atomic.sql");
const PROBE0003 = M("PROBE_vid1_publish_post_atomic.sql");
const M0002 = M("20261011_0002_vid1_duplicate_post_media_only.sql");

const read = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

/** detect_duplicate_post() exactly as 20261011_0002 defines it. */
function dup0002() {
  const lines = read(M0002).split("\n");
  const start = lines.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public.detect_duplicate_post()"));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("$function$;"));
  if (start < 0 || end < 0) throw new Error("could not find detect_duplicate_post() in 20261011_0002");
  const sql = lines.slice(start, end + 1).join("\n");
  if (!sql.includes("VID-1 (20261011_0002)")) throw new Error("20261011_0002's detect_duplicate_post() is not the expected body");
  return sql;
}

function steps(shape) {
  const other = shape === "production" ? "staging" : "production";
  return [
    ["ok", "cluster roles", { file: T("00_cluster_roles.sql") }],
    ["ok", "production-shaped schema", { file: T("10_production_shape.sql") }],
    ...(shape === "staging" ? [["ok", "staging keep: authenticated SELECT on post_media", { file: T("11_staging_keep.sql") }]] : []),
    ["ok", "detect_duplicate_post() — 20261011_0002 body, verbatim", { sql: dup0002() }],
    ["ok", "trg_detect_duplicate_post", { file: T("12_duplicate_trigger.sql") }],
    ["ok", "20261011_0003 (verbatim)", { file: M0003, lane: shape }],
    ["ok", "seed", { file: T("20_seed.sql") }],
    ["ok", "BEFORE: the 20261011_0003 body as a member", { file: T("30_before.sql"), shape }],
    // FAIL-FIRST. The AFTER assertions (40_after.sql), run against the UNFIXED
    // body, must go red: production shape — the member's replay raises 42501
    // at A1; staging shape — the keep still lets a member read post_media
    // (A7). Run inside a transaction that is always rolled back, so nothing it
    // writes survives into the steps below.
    ["fail", "FAIL-FIRST: the AFTER assertions are red on the unfixed body", { file: T("40_after.sql"), shape, tx: true },
      shape === "production" ? "permission denied for table post_media" : "FIXTURE FAIL A7 "],
    ["fail", "20261013_0004 refuses with no lane", { file: MIG }, "APPLY REFUSED"],
    ["fail", `20261013_0004 refuses on the wrong lane (${other})`, { file: MIG, lane: other }, "VID-PM-PRE-003"],
    ["fail", "PROBE fails before the apply", { file: PROBE, lane: shape }, "PROBE FAIL VID-PM"],
    ["ok", "20261013_0004 (verbatim)", { file: MIG, lane: shape }],
    ["ok", "AFTER: publishing as a member with no post_media privilege", { file: T("40_after.sql"), shape }],
    ["ok", "PROBE_20261013_0004 passes", { file: PROBE, lane: shape }],
    ["ok", "PROBE_vid1_publish_post_atomic (20261011_0003's own) still passes", { file: PROBE0003 }],
    ["fail", "20261013_0004 refuses a re-run", { file: MIG, lane: shape }, "VID-PM-PRE-001"],
    ["ok", "ROLLBACK (verbatim)", { file: RB, lane: shape }],
    ["ok", "AFTER ROLLBACK: each shape is back in its pre-state", { file: T("50_after_rollback.sql"), shape }],
    ["fail", "PROBE fails after the rollback", { file: PROBE, lane: shape }, "PROBE FAIL VID-PM"],
    ["fail", "ROLLBACK refuses a second run", { file: RB, lane: shape }, "VID-PM-RB-PRE-001"],
    ["ok", "20261013_0004 re-applies after the rollback", { file: MIG, lane: shape }],
    ["ok", "PROBE_20261013_0004 passes again", { file: PROBE, lane: shape }],
  ];
}

// ── executors ────────────────────────────────────────────────────────────────
function psqlExecutor() {
  const host = process.env.PGHOST ?? "";
  if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
    console.error(`REFUSED: PGHOST must be a local throwaway server (localhost/127.0.0.1/::1/socket), read "${host}"`);
    process.exit(2);
  }
  const base = ["-X", "-q", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"];
  const run = (db, args) => {
    const r = spawnSync("psql", [...base, "-d", db, ...args], { encoding: "utf8" });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  return {
    name: "psql",
    async open(shape) {
      const db = `fx_${shape}`;
      const r = run("postgres", ["-c", `DROP DATABASE IF EXISTS ${db}`, "-c", `CREATE DATABASE ${db}`]);
      if (!r.ok) throw new Error(`could not create ${db}: ${r.out}`);
      return {
        async step({ file, sql, lane, shape: fxShape, tx }) {
          const args = [];
          if (tx) args.push("-c", "BEGIN;");
          if (lane) args.push("-c", `SET p32.lane = '${lane}';`);
          if (fxShape) args.push("-c", `SET fx.shape = '${fxShape}';`);
          if (file) args.push("-f", file);
          else args.push("-c", sql);
          // ON_ERROR_STOP ends the session at the first error, which rolls the
          // open transaction back; without an error this ROLLBACK does it.
          if (tx) args.push("-c", "ROLLBACK;");
          return run(db, args);
        },
        async close() {
          run("postgres", ["-c", `DROP DATABASE IF EXISTS ${db}`]);
        },
      };
    },
  };
}

async function pgliteExecutor(dir) {
  const mod = await import(pathToFileURL(join(resolve(dir), "node_modules/@electric-sql/pglite/dist/index.js")).href);
  return {
    name: "pglite",
    async open() {
      const db = new mod.PGlite();
      const notices = [];
      return {
        async step({ file, sql, lane, shape: fxShape, tx }) {
          try { await db.exec("ROLLBACK"); } catch { /* not in a transaction */ }
          await db.exec("RESET ROLE; RESET ALL;");
          let text = tx ? "BEGIN;\n" : "";
          if (lane) text += `SET p32.lane = '${lane}';\n`;
          if (fxShape) text += `SET fx.shape = '${fxShape}';\n`;
          text += file ? read(file) : sql;
          if (tx) text += "\nROLLBACK;";
          try {
            await db.exec(text, { onNotice: (n) => notices.push(`NOTICE:  ${n.message}`) });
            return { ok: true, out: notices.splice(0).join("\n") };
          } catch (e) {
            try { await db.exec("ROLLBACK"); } catch { /* ignore */ }
            return { ok: false, out: `${notices.splice(0).join("\n")}\nERROR:  ${e.message}` };
          }
        },
        async close() { await db.close(); },
      };
    },
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const pgliteAt = argv.indexOf("--pglite");
const ex = pgliteAt >= 0 ? await pgliteExecutor(argv[pgliteAt + 1]) : psqlExecutor();

let failures = 0;
let passes = 0;
for (const shape of ["production", "staging"]) {
  console.log(`\n══ ${shape.toUpperCase()} SHAPE (${ex.name}) ══`);
  const h = await ex.open(shape);
  for (const [expect, label, spec, token] of steps(shape)) {
    const r = await h.step(spec);
    const asserted = (r.out.match(/FIXTURE PASS [^\n]*/g) ?? []);
    let good;
    if (expect === "ok") good = r.ok && !/FIXTURE FAIL/.test(r.out);
    else good = !r.ok && r.out.includes(token);
    if (good) passes++; else failures++;
    console.log(`${good ? "PASS" : "FAIL"}  ${label}${expect === "fail" ? `  → refused with ${token}` : ""}`);
    for (const a of asserted) console.log(`        ${a.replace(/^FIXTURE PASS /, "✓ ")}`);
    const probeLine = r.out.match(/PROBE (PASS|FAIL)[^\n]*/);
    if (probeLine && expect === "ok") console.log(`        ${probeLine[0].slice(0, 240)}`);
    // An expected refusal shows the error it was refused with.
    const errLine = r.out.match(/ERROR:[^\n]*/);
    if (good && expect === "fail" && errLine) console.log(`        ✗ ${errLine[0].slice(0, 240)}`);
    if (!good) {
      console.log("        ── output ──");
      console.log(r.out.split("\n").map((l) => `        ${l}`).join("\n"));
      break; // later steps depend on this one
    }
  }
  await h.close();
}
console.log(`\n${failures === 0 ? "FIXTURE GREEN" : "FIXTURE RED"}: ${passes} step(s) passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
