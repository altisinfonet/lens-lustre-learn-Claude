/**
 * audit-v6/no-unsafe-edge-authority — Sprint 0 Phase 0B-5.
 *
 * GUARDRAIL ONLY. Detects NEW unsafe edge-function authority patterns in
 * sensitive domains (payments / wallet / notifications / judging / admin /
 * roles / moderation / certificates / email / finance).
 *
 * Patterns flagged:
 *   1) ANON_KEY_IN_PRIVILEGED   — `SUPABASE_ANON_KEY` referenced inside a
 *                                  sensitive edge function index.ts.
 *   2) BROAD_CORS_WILDCARD       — literal `"Access-Control-Allow-Origin": "*"`
 *                                  inside a sensitive edge function (broad
 *                                  CORS / auth relaxation).
 *   3) MISSING_AUTH_VALIDATION   — `SUPABASE_SERVICE_ROLE_KEY` referenced
 *                                  with NO recognized auth-validation token
 *                                  anywhere in the same file (heuristic).
 *
 * Existing Sprint 0A sites are allow-listed via
 *   scripts/audits/baselines/edge-authority-baseline.json
 * keyed on { file, line, issue }. Cleanup of baselined sites is intentionally
 * deferred. This phase ONLY blocks new violations.
 *
 * Scope: only files matching `supabase/functions/<sensitive-fn>/index.ts`.
 * Tests / *_test.ts / *.test.ts and the `_shared/` dir are EXEMPT.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts/audits/baselines/edge-authority-baseline.json",
);

// Sensitive edge-function directory names. Phase 0B-5 scope.
const SENSITIVE_FNS = new Set([
  // payments
  "create-payment-session", "paypal-capture-order", "razorpay-verify-payment",
  "submit-deposit", "get-payment-gateways-public",
  // wallet / finance
  "get-wallet-summary", "get-wallet-transactions", "send-gift-credit",
  "expire-gift-credits", "admin-process-withdrawal",
  // notifications / email
  "send-transactional-email", "process-email-queue", "manage-notifications",
  "preview-transactional-email", "auth-email-hook", "diagnose-brevo-key",
  "handle-email-suppression", "handle-email-unsubscribe",
  "verify-email-provider", "test-smtp",
  // judging
  "cast-photo-vote", "complete-round", "evaluate-round2",
  "judge-session-resume", "judging-invariants-nightly", "publish-round",
  "submit-judge-decision", "submit-judge-score",
  // admin / roles / moderation
  "admin-export-db", "admin-secure-settings", "hard-delete-competition",
  "delete-user", "detect-orphan-files", "purge-s3-orphans",
  "moderate-comment", "detect-ai-image", "analyze-gallery-image",
]);

const AUTH_TOKENS = [
  "getClaims", "getUser", "has_role", "is_admin", "hmac", "signature",
  "webhookSecret", "x-webhook-secret", "crypto.subtle.verify", "verifyJwt",
  "verify_jwt", "Authorization", "WEBHOOK_SECRET", "service_role_check",
];

function loadBaseline() {
  try {
    const raw = fs.readFileSync(BASELINE_PATH, "utf8");
    const json = JSON.parse(raw);
    const set = new Set();
    for (const e of json.entries || []) set.add(`${e.file}:${e.line}:${e.issue}`);
    return set;
  } catch {
    return new Set();
  }
}
const BASELINE = loadBaseline();

function toRepoRelativePosix(filename) {
  if (!filename) return null;
  const norm = filename.replace(/\\/g, "/");
  const idx = norm.indexOf("/dev-server/");
  let rel = norm;
  if (idx !== -1) rel = norm.slice(idx + "/dev-server/".length);
  rel = rel.replace(/^\.\//, "");
  const rootMarker = REPO_ROOT.replace(/\\/g, "/") + "/";
  if (rel.startsWith(rootMarker)) rel = rel.slice(rootMarker.length);
  return rel;
}

/** Returns sensitive function name if `rel` is supabase/functions/<fn>/index.ts
 *  AND <fn> is in SENSITIVE_FNS, else null. */
function sensitiveFnOf(rel) {
  if (!rel) return null;
  const m = rel.match(/^supabase\/functions\/([^/]+)\/index\.ts$/);
  if (!m) return null;
  if (!SENSITIVE_FNS.has(m[1])) return null;
  return m[1];
}

const RE_ANON = /SUPABASE_ANON_KEY/;
const RE_SR   = /SUPABASE_SERVICE_ROLE_KEY/;
const RE_CORS_WILD = /["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/;

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid NEW unsafe edge-function authority patterns (anon key in " +
        "privileged fn, missing auth validation around service role, broad " +
        "CORS wildcard) in sensitive domains. Existing sites are baselined.",
    },
    schema: [],
    messages: {
      anonKey:
        "Sprint 0 Phase 0B-5: NEW use of SUPABASE_ANON_KEY in privileged " +
        "edge function `{{fn}}` is forbidden " +
        "(audit-v6/no-unsafe-edge-authority/ANON_KEY_IN_PRIVILEGED). Use " +
        "service-role + explicit auth validation, or re-baseline in a follow-up.",
      cors:
        "Sprint 0 Phase 0B-5: NEW broad CORS wildcard in sensitive edge " +
        "function `{{fn}}` is forbidden " +
        "(audit-v6/no-unsafe-edge-authority/BROAD_CORS_WILDCARD). Use " +
        "_shared/secureHeaders.ts allow-list.",
      missingAuth:
        "Sprint 0 Phase 0B-5: SUPABASE_SERVICE_ROLE_KEY in `{{fn}}` without " +
        "any recognized auth-validation token (getClaims/getUser/has_role/" +
        "hmac/signature/webhookSecret/...) is forbidden " +
        "(audit-v6/no-unsafe-edge-authority/MISSING_AUTH_VALIDATION).",
    },
  },
  create(context) {
    const filename = context.getFilename();
    const rel = toRepoRelativePosix(filename);
    const fn = sensitiveFnOf(rel);
    if (!fn) return {};

    const sourceText = context.getSourceCode().getText();

    // Whole-file MISSING_AUTH check (computed once per file).
    const hasServiceRole = RE_SR.test(sourceText);
    const hasAuthToken = AUTH_TOKENS.some((t) => sourceText.includes(t));

    let firstSrLine = -1;

    return {
      Program(node) {
        const lines = sourceText.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const ln = i + 1;
          // ANON key
          if (RE_ANON.test(lines[i])) {
            const key = `${rel}:${ln}:ANON_KEY_IN_PRIVILEGED`;
            if (!BASELINE.has(key)) {
              context.report({ node, loc: { line: ln, column: 0 }, messageId: "anonKey", data: { fn } });
            }
          }
          // CORS wildcard
          if (RE_CORS_WILD.test(lines[i])) {
            const key = `${rel}:${ln}:BROAD_CORS_WILDCARD`;
            if (!BASELINE.has(key)) {
              context.report({ node, loc: { line: ln, column: 0 }, messageId: "cors", data: { fn } });
            }
          }
          // record first SR line
          if (firstSrLine === -1 && RE_SR.test(lines[i])) firstSrLine = ln;
        }

        // Missing auth validation: report once on first SR line.
        if (hasServiceRole && !hasAuthToken && firstSrLine > 0) {
          const key = `${rel}:${firstSrLine}:MISSING_AUTH_VALIDATION`;
          if (!BASELINE.has(key)) {
            context.report({
              node,
              loc: { line: firstSrLine, column: 0 },
              messageId: "missingAuth",
              data: { fn },
            });
          }
        }
      },
    };
  },
};

export default rule;
