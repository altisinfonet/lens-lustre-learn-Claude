/**
 * THE C3 GATE — `node tools/comment-rows-gate.mjs`, run by d2-comment-rows.yml.
 *
 * An eslint exit code alone proves too little. Non-zero also means a crash or a
 * parse error, and zero also means nothing was read (review of #898). So both
 * steps here read eslint's JSON output:
 *
 *   ratchet    exit 0, more than 0 files linted, and every file in the baseline
 *              among them, so a config or glob change cannot shrink the scope.
 *   self-test  a new comment list, linted from stdin at a path inside src/, must
 *              exit 1 WITH d2/no-comment-rows' own "Comment list" message.
 *              Stdin puts no file in src/ for anything else to trip over.
 *
 * src/__tests__/commentRowsGate.test.ts runs real eslint against broken configs
 * and requires this gate to fail on each.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "eslint.comment-rows.config.js";
const RULE = "d2/no-comment-rows";
const SELF_TEST_PATH = "src/components/CommentRatchetSelfTest.tsx";
const SELF_TEST_CODE = "export const A = ({ comments }) => <div>{comments.map((c) => <p key={c.id}>{c.content}</p>)}</div>;\n";

const eslintBin = () => join(dirname(createRequire(join(ROOT, "package.json")).resolve("eslint/package.json")), "bin", "eslint.js");

/** Asynchronous on purpose: a blocking spawn freezes a vitest worker through a full lint until its RPC times out. */
function eslint(args, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [eslintBin(), ...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => { stdout += d; });
    child.stderr.setEncoding("utf8").on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ status: null, stdout, stderr: String(e) }));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

function parse(stdout) {
  try {
    const rows = JSON.parse(stdout);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

const crashed = ({ status, stderr }) => `eslint crashed (exit ${status})${stderr ? `: ${stderr.trim().split("\n")[0]}` : ""}`;

/** The verdict on one ratchet run. Exit 1 here is the ratchet itself saying no. */
export function judgeRatchet(run, baselineFiles, root = ROOT) {
  const failed = [];
  const rows = parse(run.stdout);
  if (run.status !== 0 && run.status !== 1) failed.push(crashed(run));
  else if (!rows) failed.push(`eslint gave no JSON (exit ${run.status})`);
  const read = new Set((rows ?? []).map((r) => relative(root, r.filePath).split("\\").join("/")));
  if (run.status === 1) {
    for (const r of rows ?? []) {
      for (const m of r.messages) if (m.severity === 2) failed.push(`${relative(root, r.filePath)}:${m.line ?? 0} ${m.message}`);
    }
  }
  if (rows && read.size === 0) failed.push("0 files linted: the ratchet read nothing");
  if (rows && read.size > 0) for (const f of baselineFiles) if (!read.has(f)) failed.push(`baseline file not linted: ${f}`);
  return { ok: failed.length === 0, linted: read.size, failed };
}

/** The verdict on one self-test run: rejected, and by this rule. */
export function judgeSelfTest(run) {
  const rows = parse(run.stdout);
  if (run.status !== 0 && run.status !== 1) return { ok: false, failed: [crashed(run)] };
  if (run.status === 0) return { ok: false, failed: ["a new comment list was not rejected (eslint exit 0)"] };
  const messages = (rows ?? []).flatMap((r) => r.messages);
  const own = messages.some((m) => m.ruleId === RULE && /Comment list/.test(m.message));
  return own ? { ok: true, failed: [] } : {
    ok: false,
    failed: [`rejected, but not by ${RULE}: ${messages.map((m) => m.message).join("; ") || "no message"}`],
  };
}

export async function runRatchet(config = CONFIG, extraArgs = []) {
  const baseline = JSON.parse(readFileSync(join(ROOT, "eslint-rules/no-comment-rows.baseline.json"), "utf8"));
  // No --quiet: it drops every file with no error from the JSON, so a clean run would read as 0 files.
  const run = await eslint(["-c", config, "--format", "json", ...extraArgs, "src"]);
  return { status: run.status, ...judgeRatchet(run, Object.keys(baseline.files)) };
}

export async function runSelfTest(config = CONFIG, code = SELF_TEST_CODE) {
  const run = await eslint(["-c", config, "--format", "json", "--stdin", "--stdin-filename", SELF_TEST_PATH], code);
  const verdict = judgeSelfTest(run);
  return { status: run.status, ...verdict, said: [run.stdout.slice(0, 400), run.stderr.slice(0, 400)] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const ratchet = await runRatchet();
  console.log(`Ratchet: ${ratchet.linted} files linted, ${ratchet.ok ? "PASS" : "FAIL"}`);
  for (const f of ratchet.failed) console.log(`  x ${f}`);
  const self = await runSelfTest();
  console.log(`Self-test: a new comment list ${self.ok ? "was rejected by the rule, PASS" : "FAIL"}`);
  for (const f of self.failed) console.log(`  x ${f}`);
  process.exit(ratchet.ok && self.ok ? 0 : 1);
}
