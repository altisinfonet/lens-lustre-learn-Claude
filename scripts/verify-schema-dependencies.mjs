#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEMA-DEPENDENCY GUARD  —  does every RPC this application calls actually
 * exist on the database we are about to promote to, with parameters it can be
 * called with?
 *
 * WHY THIS EXISTS
 *   PostgREST resolves an RPC by its **argument names**, taken from the JSON
 *   body. A function with the right name and different parameter names is a
 *   runtime 404, and it passes any check that only compares names. So a check
 *   that degrades to name-only is not a weaker version of this guard — it is
 *   the very thing this guard replaces.
 *
 * WHY IT REPORTS ITS OWN COVERAGE
 *   Revision 1 of this guard silently degraded two call sites to name-only and
 *   said nothing. It printed a clean FAIL for the one name it cared about and
 *   would have printed a clean PASS afterwards, having never checked the
 *   arguments of the exact call the whole gate was about. A checker that cannot
 *   state its coverage cannot be trusted when it says PASS. Hence §4: every run
 *   prints how many call sites it checked at argument level, how many it could
 *   not, and where those are — and an unreadable call site FAILS the run.
 *
 * EXIT CODES
 *   0  every referenced RPC exists on the target and every call site was
 *      checked at argument level
 *   1  missing / incompatible RPC, unreadable or unresolvable call site,
 *      absent or untrustworthy catalog, or a broken parse
 *
 * USAGE
 *   SUPABASE_DB_URL=... node scripts/verify-schema-dependencies.mjs [sourceDir]
 *
 *   Out-of-band catalog (authoritative; for runners with no database egress):
 *     SCHEMA_GUARD_CATALOG_TSV=<file> SCHEMA_GUARD_CATALOG_MD5=<md5 computed BY
 *     THE DATABASE over the same bytes> SCHEMA_GUARD_CATALOG_REF=<project ref>
 *   The guard recomputes the digest over the file and refuses on mismatch, so a
 *   catalog that was retyped, truncated or edited in transit cannot be used.
 *
 *   SCHEMA_GUARD_CATALOG_FILE=<json>  TEST ONLY. Announces itself, marks its own
 *   result non-authoritative, and must never appear in a promotion log.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const SOURCE_DIR = process.argv[2] || "src";
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * KEEP THIS LIST SHORT AND JUSTIFIED. Every entry is a hole. These are strings
 * that appear in first-argument position after `.rpc` in this codebase without
 * being an RPC name.
 */
const NOT_RPC_NAMES = new Set(["error", "name", "message", "data"]);

/**
 * ALLOW-LIST FOR UNREADABLE CALL SITES — deliberately empty.
 *
 * An entry here says: "this call site passes arguments the parser cannot read,
 * and we accept a name-only check for it." That is a hole in the guard, so an
 * entry must name the exact file:line and carry a reason. It is not a way to
 * get to GREEN; it is a way to record a known, argued exception.
 *
 * Format: "relative/or/absolute/path.ts:LINE" -> "reason"
 * Enabled only when SCHEMA_GUARD_ALLOW_NAME_ONLY=1, so an accidental entry
 * cannot quietly take effect.
 */
const NAME_ONLY_ALLOWLIST = new Map([]);

/**
 * The allow-list may also be supplied out of tree, so the harness can prove the
 * mechanism works and so a repository can carry its exceptions in review-able
 * data rather than in code:
 *
 *     SCHEMA_GUARD_ALLOW_NAME_ONLY=exceptions.json
 *     { "src/x.ts:42": "argument object is built by a factory; see ADR-7" }
 *
 * It is OFF unless the variable names a real file, so an exception can never
 * take effect by accident. THE LIST IS EMPTY IN THIS REPOSITORY AND SHOULD STAY
 * THAT WAY: every entry is a call site this guard does not really check.
 */
function loadAllowList() {
  const p = process.env.SCHEMA_GUARD_ALLOW_NAME_ONLY;
  if (!p || p === "0") return NAME_ONLY_ALLOWLIST;
  if (!existsSync(p)) fail("S7", `SCHEMA_GUARD_ALLOW_NAME_ONLY="${p}" does not exist.`);
  const merged = new Map(NAME_ONLY_ALLOWLIST);
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(p, "utf8")))) merged.set(k, String(v));
  return merged;
}

function fail(rule, msg) {
  console.error(`SCHEMA-GUARD FAIL [${rule}]: ${msg}`);
  process.exit(1);
}

/* ── 1. FILE INVENTORY ───────────────────────────────────────────────────── */

/**
 * SCOPE. Application source only. Test and spec files are excluded because they
 * deliberately reference functions that do not exist, to prove error paths; a
 * guard that read them would block every promotion forever.
 */
function isExcluded(p) {
  return p.includes("__tests__") ||
         p.includes("__mocks__") ||
         /\.(test|spec)\.[jt]sx?$/.test(p);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, out); continue; }
    if (!SCAN_EXT.has(extname(p))) continue;
    if (isExcluded(p)) continue;
    out.push(p);
  }
  return out;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/* ── 2. COMMENTS ARE NOT CODE, AND STRINGS ARE NOT COMMENTS ──────────────── */

/**
 * The first version of this parser reported a missing RPC called `rest`, from a
 * COMMENT quoting supabase-js internals:
 *
 *     //     rpc(fn, args, options) { return this.rest.rpc(fn, args, options) }
 *
 * A guard that invents blockers is worse than no guard: people learn to skip
 * it. Comments are blanked character-for-character so every reported line
 * number still points at the real line. A naive regex cannot do this, because
 * `"https://x"` contains `//` and is not a comment.
 */
function stripCommentsPreservingOffsets(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    i++;
  }
  return out.join("");
}

/* ── 3. CALL-SITE PARSING ────────────────────────────────────────────────── */

/**
 * NO FIXED WINDOW. THIS IS THE BUG THAT WAS FOUND.
 *
 * Revision 1 read a 600-character window after `.rpc` and gave up if the call
 * did not fit. Two real calls did not fit:
 *
 *   src/components/admin/AdminUsers.tsx:264  — a multi-line cast plus a long
 *       explanatory comment sat between `.rpc` and the argument object; the
 *       object began past character 600, so it was never read.
 *   src/lib/logger.ts:275                    — the argument object itself is
 *       sixteen properties long and ran off the end of the window.
 *
 * In both cases the name was inside the window and the arguments were not, so
 * the guard reported the name and silently dropped the argument check. The fix
 * is not a bigger window — any constant is the same bug with a different
 * threshold. The parser now walks the actual call expression to its matching
 * close paren, however long that is, and FAILS if it cannot.
 */

const WS = /\s/;

function skipWs(src, i) {
  while (i < src.length && WS.test(src[i])) i++;
  return i;
}

/**
 * Scan from the index of an opening `(` to its matching `)`, honouring nested
 * brackets and string/template literals, and split the top-level arguments.
 * Returns null when the call is unterminated — which is a parse failure, not a
 * call with no arguments.
 */
function splitCallArguments(src, openIdx) {
  if (src[openIdx] !== "(") return null;
  const parts = [];
  let depth = 1, i = openIdx + 1, start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        parts.push(src.slice(start, i));
        // A trailing comma is formatting, not an argument:
        //     supabase.rpc(
        //       "backfill_tag_decision_drift_admin" as any,
        //     );
        // is a call with ONE argument. Revision 2 read the empty slot as an
        // unreadable second argument and degraded the site to name-only.
        while (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop();
        return { parts, end: i };
      }
      i++; continue;
    }
    if (c === "," && depth === 1) { parts.push(src.slice(start, i)); i++; start = i; continue; }
    i++;
  }
  return null;
}

/**
 * From the index just past `.rpc` (or past an alias identifier), find the `(`
 * that opens the actual call.
 *
 *   supabase.rpc("x", {...})                     -> the next `(`
 *   (supabase.rpc as any)("x", {...})            -> skip ` as any`, then `)`,
 *                                                   then the next `(`
 *   (supabase.rpc as unknown as (
 *      fn: string, args: Record<string, unknown>
 *   ) => Promise<{...}>)("x", {...})             -> same, across lines
 *
 * `<` and `>` are deliberately NOT counted as brackets: `=>` and `A | B` make
 * angle-counting unreliable, while paren/bracket/brace depth is exact for every
 * cast shape TypeScript can produce here.
 */
function findCallParen(src, after) {
  let i = skipWs(src, after);
  if (src[i] === "(") return i;
  if (!(src.startsWith("as", i) && WS.test(src[i + 2] || ""))) return -1;
  let depth = 0;
  i += 2;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
    if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        if (c !== ")") return -1;          // the cast was not parenthesised
        i = skipWs(src, i + 1);
        return src[i] === "(" ? i : -1;
      }
      depth--; i++; continue;
    }
    if (c === "," && depth === 0) return -1;
    i++;
  }
  return -1;
}

/**
 * A LEADING string literal, plus whatever follows it.
 *
 * The name argument is not always a bare literal. This codebase writes
 * `.rpc("mutual_friends_count" as any, {...})` in several places, because the
 * generated client types do not know about the newer functions. A cast after
 * the literal changes nothing about which function is called, so it is read and
 * discarded — but only a cast. Anything else means we are not looking at a
 * plain name and must not guess.
 */
function leadingStringLiteral(text) {
  const t = text.trim();
  if (t.length < 2) return null;
  const q = t[0];
  if (q !== '"' && q !== "'") return null;
  let i = 1, out = "";
  while (i < t.length) {
    if (t[i] === "\\") { out += t[i + 1]; i += 2; continue; }
    if (t[i] === q) { i++; break; }
    out += t[i]; i++;
  }
  return { value: out, rest: t.slice(i).trim() };
}

/** Trailing `as <type>` and nothing else. */
const ONLY_A_CAST = /^as\s+[\s\S]+$/;

function stringLiteralValue(text) {
  const lit = leadingStringLiteral(text);
  if (!lit) return null;
  if (lit.rest === "") return lit.value;
  return ONLY_A_CAST.test(lit.rest) ? lit.value : null;
}

/**
 * Read the property names of an object literal.
 *
 * Returns a Set for a literal we fully understand, or null when we do not — a
 * spread, a computed key, or anything that is not an object literal at all.
 * NULL MEANS "I COULD NOT CHECK THIS", and §5 turns that into a failure. It has
 * never meant "no arguments"; a call with no arguments has no second argument
 * at all, which is a different and fully checkable thing.
 *
 * This is a two-state machine — EXPECTING A KEY, or CONSUMING A VALUE — because
 * the same character means different things in the two positions. Revision 2
 * treated a top-level `[` as a computed key wherever it appeared, and so
 * refused to read `{ _image_urls: [imageUrl] }`, whose bracket is a value.
 */
function objectKeys(text) {
  let t = text.trim();
  if (t === "" || t === "undefined" || t === "null") return new Set();
  if (t[0] !== "{") return null;
  // `{...} as SomeType` — find the matching brace and allow a trailing cast.
  {
    let depth = 0, end = -1;
    for (let k = 0; k < t.length; k++) {
      const c = t[k];
      if (c === '"' || c === "'" || c === "`") {
        const q = c; k++;
        while (k < t.length) { if (t[k] === "\\") { k += 2; continue; } if (t[k] === q) break; k++; }
        continue;
      }
      if (c === "{" || c === "[" || c === "(") depth++;
      else if (c === "}" || c === "]" || c === ")") { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end === -1) return null;
    const tail = t.slice(end + 1).trim();
    if (tail !== "" && !ONLY_A_CAST.test(tail)) return null;
    t = t.slice(0, end + 1);
  }

  const body = t.slice(1, -1);
  const keys = new Set();
  let i = 0;
  let expectKey = true;

  while (i < body.length) {
    const c = body[i];
    if (WS.test(c)) { i++; continue; }

    if (expectKey) {
      if (c === ",") { i++; continue; }
      if (body.startsWith("...", i)) return null;            // spread: unknown keys
      if (c === "[") return null;                            // computed key
      if (c === '"' || c === "'") {
        const lit = leadingStringLiteral(body.slice(i));
        if (!lit) return null;
        const consumed = body.slice(i).length - lit.rest.length;
        keys.add(lit.value);
        i = skipWs(body, i + consumed);
        if (body[i] === ":") { i++; expectKey = false; continue; }
        return null;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < body.length && /[\w$]/.test(body[j])) j++;
        const ident = body.slice(i, j);
        const k = skipWs(body, j);
        keys.add(ident);
        if (body[k] === ":") { i = k + 1; expectKey = false; continue; }
        if (body[k] === "," || k >= body.length) { i = k + 1; continue; }  // shorthand
        return null;                                          // `a as B` etc. in key slot
      }
      return null;                                            // not a key we understand
    }

    // CONSUMING A VALUE: run to the comma that ends it, at brace depth zero.
    let depth = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        const q = ch; i++;
        while (i < body.length) { if (body[i] === "\\") { i += 2; continue; } if (body[i] === q) { i++; break; } i++; }
        continue;
      }
      if (ch === "{" || ch === "[" || ch === "(") { depth++; i++; continue; }
      if (ch === "}" || ch === "]" || ch === ")") { depth--; i++; continue; }
      if (ch === "," && depth === 0) { i++; break; }
      i++;
    }
    expectKey = true;
  }
  return keys;
}

/**
 * ONE VARIABLE HOP, AND ONLY A SAFE ONE.
 *
 * AwardsIntegrityAudit.tsx builds the argument object a line above the call:
 *
 *     const arg = competitionId ? { _competition_id: competitionId } : {};
 *     supabase.rpc("get_placement_drift_admin" as any, arg),
 *
 * The argument names are not fixed at the call site — there are two possible
 * shapes. Taking the union would be a guess that hides the empty branch;
 * refusing to read it would be a name-only check on a call that is perfectly
 * knowable. So both branches are enumerated and BOTH must be compatible with
 * the target. A call is only as safe as its weakest shape.
 *
 * The hop is deliberately narrow: a `const` declared exactly once in the file,
 * whose initializer is an object literal, or a conditional between shapes that
 * are themselves resolvable. Anything else stays unreadable and fails §5.
 */
function splitTopLevelTernary(t) {
  let depth = 0, q = null, qi = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"' || c === "'" || c === "`") {
      const qq = c; i++;
      while (i < t.length) { if (t[i] === "\\") { i += 2; continue; } if (t[i] === qq) break; i++; }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; continue; }
    if (depth !== 0) continue;
    if (c === "?" && t[i + 1] !== "." && t[i + 1] !== "?") { if (q === null) { q = i; } continue; }
    if (c === ":" && q !== null && qi === -1) { qi = i; }
  }
  if (q === null || qi === -1) return null;
  return [t.slice(q + 1, qi), t.slice(qi + 1)];
}

function objectCandidates(text, resolveIdent, seen = new Set()) {
  let t = text.trim();
  if (t === "") return null;
  while (t.startsWith("(") ) {
    let depth = 0, end = -1;
    for (let k = 0; k < t.length; k++) {
      if (t[k] === "(") depth++;
      else if (t[k] === ")") { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end !== t.length - 1) break;
    t = t.slice(1, end).trim();
  }
  if (t[0] === "{") {
    const keys = objectKeys(t);
    return keys === null ? null : [keys];
  }
  const tern = splitTopLevelTernary(t);
  if (tern) {
    const a = objectCandidates(tern[0], resolveIdent, seen);
    const b = objectCandidates(tern[1], resolveIdent, seen);
    return a && b ? [...a, ...b] : null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(t) && resolveIdent) {
    if (seen.has(t)) return null;
    seen.add(t);
    const init = resolveIdent(t);
    return init === null ? null : objectCandidates(init, resolveIdent, seen);
  }
  return null;
}

function makeConstResolver(src) {
  return (ident) => {
    const re = new RegExp(`(?:^|[^\\w$])const\\s+${ident}\\s*(?::[^=;]*)?=`, "g");
    const hits = [...src.matchAll(re)];
    if (hits.length !== 1) return null;                 // absent, or declared more than once
    let i = hits[0].index + hits[0][0].length;
    let depth = 0;
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        const q = c; i++;
        while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
        continue;
      }
      if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
      if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; i++; continue; }
      if (c === ";" && depth === 0) break;
      if (c === "\n" && depth === 0) {
        const rest = src.slice(i).replace(/^\s+/, "");
        if (!/^[?:.]|^&&|^\|\|/.test(rest)) break;
      }
      i++;
    }
    const init = src.slice(start, i).trim();
    // A reassignment anywhere in the file makes the initializer untrustworthy.
    if (new RegExp(`(?:^|[^\\w$.])${ident}\\s*=[^=]`, "g").test(src.replace(hits[0][0], " ".repeat(hits[0][0].length)))) return null;
    return init === "" ? null : init;
  };
}

/**
 * MODULE-LOCAL FORWARDERS.
 *
 * usePostDrafts.ts binds the client method to a local name, for a documented
 * reason (assigning the bare method detaches `this` and broke publishing in
 * production on 2026-08-17):
 *
 *     const rpc: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);
 *
 * Revision 1 saw only `.rpc`, so `rpc("publish_post_draft", { _draft_id })` at
 * line 281 was invisible — not degraded to name-only, NOT SEEN AT ALL. Any
 * forwarder found here is registered as a call target for that file, and the
 * forwarding `.rpc` itself is exempted from the dynamic-name rule below.
 */
const FORWARDER_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\(?\s*(supabase\s*\.\s*rpc)\b/g;

function findForwarders(src) {
  const names = new Set();
  const rpcIdx = new Set();
  for (const m of src.matchAll(FORWARDER_RE)) {
    names.add(m[1]);
    rpcIdx.add(m.index + m[0].length - m[2].length + m[2].indexOf("rpc") + 3);
  }
  return { names, rpcIdx };
}

function extractReferences(dir) {
  const refs = [];
  const parseErrors = [];
  for (const file of walk(dir)) {
    const raw = readFileSync(file, "utf8");
    const src = stripCommentsPreservingOffsets(raw);
    const { names: aliases, rpcIdx: forwarderRpc } = findForwarders(src);
    const resolveConst = makeConstResolver(src);

    const targets = [];
    for (const m of src.matchAll(/\.\s*rpc\b/g)) {
      targets.push({ at: m.index, after: m.index + m[0].length, forwarder: forwarderRpc.has(m.index + m[0].length) });
    }
    for (const alias of aliases) {
      const re = new RegExp(`(^|[^.\\w$])(${alias})\\s*\\(`, "g");
      for (const m of src.matchAll(re)) {
        const identEnd = m.index + m[1].length + alias.length;
        // Skip the declaration itself (`const rpc: T = (fn, args) => ...`).
        if (/=\s*$/.test(src.slice(Math.max(0, m.index - 3), m.index + m[1].length))) continue;
        targets.push({ at: identEnd, after: identEnd, forwarder: false, viaAlias: alias });
      }
    }

    for (const t of targets) {
      const open = findCallParen(src, t.after);
      if (open === -1) continue;                       // `.rpc` not in call position
      const call = splitCallArguments(src, open);
      if (!call) {
        parseErrors.push({ file, line: lineOf(raw, t.at) });
        continue;
      }
      const [a0, a1] = call.parts;
      const name = a0 === undefined ? null : stringLiteralValue(a0);
      if (name === null) {
        if (t.forwarder) continue;                     // the forwarder's own body
        refs.push({ kind: "dynamic", file, line: lineOf(raw, t.at), expr: (a0 || "").trim().slice(0, 80) });
        continue;
      }
      if (NOT_RPC_NAMES.has(name)) continue;
      if (call.parts.length === 1) {
        refs.push({ kind: "zeroarg", name, file, line: lineOf(raw, t.at), args: [] });
        continue;
      }
      const cands = objectCandidates(a1 === undefined ? "{}" : a1, resolveConst);
      if (cands === null) {
        refs.push({ kind: "unreadable", name, file, line: lineOf(raw, t.at), expr: a1.trim().slice(0, 80).replace(/\s+/g, " ") });
        continue;
      }
      refs.push({
        kind: "args", name, file, line: lineOf(raw, t.at),
        argSets: cands.map((c) => [...c].sort()),
        args: [...new Set(cands.flatMap((c) => [...c]))].sort(),
      });
    }
  }
  return { refs, parseErrors };
}

if (!existsSync(SOURCE_DIR)) fail("S1", `source directory "${SOURCE_DIR}" does not exist.`);

const { refs: references, parseErrors } = extractReferences(SOURCE_DIR);

if (parseErrors.length) {
  fail("S4",
    `could not parse ${parseErrors.length} .rpc call expression(s) to a matching close paren:\n` +
    parseErrors.map((p) => `    ${p.file}:${p.line}`).join("\n") +
    `\n  An unterminated call is a broken parse, not a call without arguments.`);
}

/**
 * A GUARD THAT FINDS NOTHING PASSES EVERYTHING. An empty inventory is far more
 * likely to mean the parser broke than that the app stopped calling its
 * database. Refuse, loudly, rather than print a green line.
 */
if (references.length === 0) {
  fail("S2",
    `no .rpc() calls found anywhere under "${SOURCE_DIR}". Either the parser is broken or the ` +
    `wrong directory was scanned. A guard that finds nothing cannot fail, and a check that ` +
    `cannot fail is not a check.`);
}

const dynamic = references.filter((r) => r.kind === "dynamic");
const callSites = references.filter((r) => r.kind !== "dynamic");

const inventory = new Map();
for (const r of callSites) {
  if (!inventory.has(r.name)) inventory.set(r.name, { name: r.name, sites: [] });
  inventory.get(r.name).sites.push(r);
}
for (const e of inventory.values()) {
  e.sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
const names = [...inventory.keys()].sort();

/* ── 4. TARGET CATALOG ───────────────────────────────────────────────────── */

/**
 * One line per overload:  name <TAB> comma-separated INPUT argument names in
 * declaration order <TAB> number of leading arguments with no default.
 *
 * `required_count` is what makes a no-argument call checkable at argument
 * level: `.rpc("get_feed_stories_bar")` is compatible only if the target can be
 * called with nothing supplied.
 */
const CATALOG_SQL = `
with f as (
  select p.oid, p.proname, p.pronargs, p.pronargdefaults, p.proargnames, p.proargmodes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
), a as (
  select f.oid, u.nm, u.ord,
         case when f.proargmodes is null then 'i' else (f.proargmodes)[u.ord]::text end as md
  from f left join lateral unnest(coalesce(f.proargnames, '{}'::text[]))
       with ordinality as u(nm, ord) on true
)
select f.proname || chr(9) ||
       coalesce((select string_agg(a.nm, ',' order by a.ord)
                 from a where a.oid = f.oid and a.md in ('i','b','v') and a.nm is not null), '')
       || chr(9) || greatest(f.pronargs - f.pronargdefaults, 0)::text
from f
order by 1;`;

function parseCatalogTsv(text) {
  const cat = new Map();
  let rows = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [nm, argstr, req] = line.split("\t");
    if (!nm) continue;
    const args = argstr ? argstr.split(",").filter(Boolean) : [];
    if (!cat.has(nm)) cat.set(nm, []);
    cat.get(nm).push({ args, required: Number(req) || 0 });
    rows++;
  }
  return { cat, rows };
}

let catalog, targetRef, authoritative = true, provenance;

const FAKE = process.env.SCHEMA_GUARD_CATALOG_FILE;
const TSV = process.env.SCHEMA_GUARD_CATALOG_TSV;

if (FAKE) {
  /**
   * TEST-ONLY, AND IT SAYS SO IN THE OUTPUT. The harness needs a deterministic
   * catalog; a real database would make the harness depend on whatever happens
   * to be deployed that day. This path announces itself and marks its result
   * non-authoritative, so a harness run can never be mistaken for a promotion
   * check in a log.
   */
  authoritative = false;
  provenance = `FAKE CATALOG FILE ${FAKE}`;
  const rawJson = JSON.parse(readFileSync(FAKE, "utf8"));
  targetRef = rawJson.ref || "FAKE";
  catalog = new Map();
  for (const [n, overloads] of Object.entries(rawJson.functions || {})) {
    catalog.set(n, overloads.map((o) =>
      Array.isArray(o) ? { args: o, required: 0 } : { args: o.args || [], required: o.required || 0 }));
  }
  console.log("=".repeat(72));
  console.log("SCHEMA-GUARD RUNNING ON A FAKE CATALOG - NOT AUTHORITATIVE.");
  console.log("This mode exists for the mutation harness. It must never appear in a");
  console.log("promotion log. If you are reading this during a release, STOP.");
  console.log("=".repeat(72));
} else if (TSV) {
  /**
   * OUT-OF-BAND BUT STILL AUTHORITATIVE. Some runners can reach the repository
   * and not the database. The catalog may then be carried in a file — but only
   * with a digest the DATABASE computed over the same bytes. Recomputing it here
   * is what makes a retyped, truncated or edited catalog unusable, which is the
   * failure that a hand-built catalog produced once before.
   */
  const expected = process.env.SCHEMA_GUARD_CATALOG_MD5;
  if (!expected) {
    fail("S8", "SCHEMA_GUARD_CATALOG_TSV was given without SCHEMA_GUARD_CATALOG_MD5. " +
               "An unverified catalog is not evidence.");
  }
  if (!existsSync(TSV)) fail("S8", `catalog file "${TSV}" does not exist.`);
  const bytes = readFileSync(TSV);
  const got = createHash("md5").update(bytes).digest("hex");
  if (got !== expected.trim().toLowerCase()) {
    fail("S8", `catalog integrity check failed for "${TSV}".\n` +
               `    database-computed md5: ${expected.trim().toLowerCase()}\n` +
               `    file md5             : ${got}\n` +
               `  The catalog is not a faithful copy of the target's pg_proc. Refusing.`);
  }
  targetRef = process.env.SCHEMA_GUARD_CATALOG_REF || "UNNAMED-TARGET";
  const parsed = parseCatalogTsv(bytes.toString("utf8"));
  catalog = parsed.cat;
  provenance = `out-of-band catalog, md5 ${got} verified against the digest computed by ${targetRef}`;
} else {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    fail("S3",
      "SUPABASE_DB_URL is not set. This is the same secret apply-migration.yml reads from the " +
      "target Environment. Without it there is no target to check against, and a guard with no " +
      "target must not pass.");
  }
  const refMatch = dbUrl.match(/postgres\.([a-z0-9]{20})/);
  if (!refMatch) {
    fail("S5", "could not parse a project ref from SUPABASE_DB_URL. Expected postgres.<ref>@... " +
               "(pooler). The connection string is never printed.");
  }
  targetRef = refMatch[1];
  let out;
  try {
    out = execFileSync("psql", [dbUrl, "-At", "-c", CATALOG_SQL], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    fail("S3", `could not read the function catalog from ${targetRef}. ` +
               `psql exited ${e.status}. (The connection string is never printed.)`);
  }
  const parsed = parseCatalogTsv(out);
  catalog = parsed.cat;
  provenance = `live pg_proc of ${targetRef}`;
}

/**
 * AN EMPTY CATALOG IS NOT AN EMPTY DATABASE. It is a failed query, a wrong
 * schema, or a permissions problem — and it would mark every RPC missing, which
 * looks like a catastrophe and reads like noise. Refuse instead.
 */
if (catalog.size === 0) {
  fail("S6", `the function catalog for ${targetRef} came back empty. That is a failed query, not ` +
             `a database without functions.`);
}

/* ── 5. COMPARE ──────────────────────────────────────────────────────────── */

function compatible(overload, appArgs) {
  const have = new Set(overload.args);
  for (const a of appArgs) if (!have.has(a)) return false;          // app sends an unknown name
  const required = overload.args.slice(0, overload.required);
  const sent = new Set(appArgs);
  for (const r of required) if (!sent.has(r)) return false;         // app omits a required name
  return true;
}

const missing = [], incompatible = [], unreadable = [], allowed = [];
let argChecked = 0, zeroArg = 0;

const ALLOW = loadAllowList();

for (const name of names) {
  const entry = inventory.get(name);
  const overloads = catalog.get(name);
  for (const site of entry.sites) {
    if (site.kind === "unreadable") {
      const key = `${site.file}:${site.line}`;
      const shortKey = key.split("/").slice(-3).join("/");
      const hit = ALLOW.get(key) || ALLOW.get(shortKey) ||
                  [...ALLOW].find(([k]) => key.endsWith("/" + k) || key === k)?.[1];
      if (hit) { allowed.push({ ...site, reason: hit }); continue; }
      unreadable.push(site);
      continue;
    }
    if (site.kind === "zeroarg") zeroArg++;
    argChecked++;
  }
  if (!overloads) { missing.push(entry); continue; }
  const bad = entry.sites
    .filter((s) => s.kind !== "unreadable")
    .filter((s) => (s.argSets || [s.args || []]).some(
      (set) => !overloads.some((o) => compatible(o, set))));
  if (bad.length) incompatible.push({ entry, overloads, bad });
}

/* ── 6. REPORT ───────────────────────────────────────────────────────────── */

const banner = authoritative ? "" : "  (FAKE CATALOG - NOT AUTHORITATIVE)";
const nameOnly = unreadable.length + allowed.length;

function coverage(stream) {
  stream(``);
  stream(`COVERAGE`);
  stream(`  distinct RPC names: ${names.length}`);
  stream(`  call sites: ${callSites.length}`);
  stream(`  argument-compatible checks: ${argChecked}`);
  stream(`  name-only checks: ${nameOnly}`);
  stream(`    (of the argument-compatible checks, ${zeroArg} are calls that pass no`);
  stream(`     arguments and are verified callable with none)`);
  if (nameOnly) {
    stream(``);
    stream(`  NAME-ONLY CALL SITES - the argument object could not be read:`);
    for (const s of unreadable) stream(`    ${s.file}:${s.line}  ${s.name}   <- ${s.expr}`);
    for (const s of allowed)    stream(`    ${s.file}:${s.line}  ${s.name}   ALLOW-LISTED: ${s.reason}`);
  }
}

if (dynamic.length) {
  console.error(``);
  console.error(`SCHEMA-GUARD FAIL - target ref ${targetRef}${banner}`);
  for (const d of dynamic) {
    console.error(`  UNRESOLVED NAME  ${d.file}:${d.line}   first argument: ${d.expr}`);
  }
  coverage((s) => console.error(s));
  console.error(``);
  console.error(`An RPC name the guard cannot resolve is an RPC the guard cannot check.`);
  process.exit(1);
}

if (missing.length || incompatible.length || unreadable.length) {
  console.error(``);
  console.error(`SCHEMA-GUARD FAIL - target ref ${targetRef}${banner}`);
  console.error(`Scanned ${SOURCE_DIR}/`);

  for (const m of missing) {
    console.error(`\n  MISSING  ${m.name}`);
    console.error(`    the target database has no function of this name in schema public`);
    for (const s of m.sites) {
      console.error(`    called at  ${s.file}:${s.line}` +
        (s.kind === "zeroarg" ? `   (no arguments)` :
         s.kind === "unreadable" ? `   (arguments unreadable)` :
         `   arguments used: ${s.args.join(", ") || "(none)"}`));
    }
  }
  for (const c of incompatible) {
    console.error(`\n  INCOMPATIBLE  ${c.entry.name}`);
    for (const s of c.bad) {
      console.error(`    called at  ${s.file}:${s.line}`);
      for (const set of (s.argSets || [s.args || []])) {
        console.error(`      application sends: ${set.join(", ") || "(no arguments)"}`);
      }
    }
    for (const o of c.overloads) {
      const req = o.args.slice(0, o.required);
      console.error(`      target has       : ${o.args.join(", ") || "(no parameters)"}` +
                    `   [required: ${req.join(", ") || "none"}]`);
    }
    console.error(`      PostgREST resolves an RPC by argument NAME. A name-compatible call with`);
    console.error(`      different parameter names is a runtime 404.`);
  }
  for (const u of unreadable) {
    console.error(`\n  UNREADABLE ARGUMENTS  ${u.name}`);
    console.error(`    at  ${u.file}:${u.line}`);
    console.error(`    second argument: ${u.expr}`);
    console.error(`    The guard will not downgrade this to a name-only check. PostgREST resolves`);
    console.error(`    by argument name, so a name-only check is the check this guard replaces.`);
    console.error(`    Fix the call to pass a plain object literal, extend the parser, or add an`);
    console.error(`    argued entry to NAME_ONLY_ALLOWLIST / SCHEMA_GUARD_ALLOW_NAME_ONLY.`);
  }

  coverage((s) => console.error(s));
  console.error(``);
  const n = missing.length + incompatible.length + unreadable.length;
  console.error(`${n} dependency failure(s). This is a promotion blocker: apply the schema to ` +
                `${targetRef} BEFORE promoting the code that calls it (expand, then deploy).`);
  process.exit(1);
}

console.log(``);
console.log(`SCHEMA-GUARD PASS - target ref ${targetRef}${banner}`);
console.log(`Scanned ${SOURCE_DIR}/`);
console.log(`Catalog: ${provenance}`);
console.log(`Every referenced RPC exists on the target and every call site was checked at`);
console.log(`argument level.`);
coverage((s) => console.log(s));
process.exit(0);
