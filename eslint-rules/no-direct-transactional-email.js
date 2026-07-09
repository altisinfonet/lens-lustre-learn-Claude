/**
 * no-direct-transactional-email — Forbidden Pattern #11.
 *
 * Forbids any direct invocation of the `send-transactional-email` edge
 * function via `supabase.functions.invoke('send-transactional-email', …)` or
 * `admin.functions.invoke('send-transactional-email', …)` outside the audited
 * allowlist. The single sanctioned funnel for judging lifecycle emails is the
 * `emit_notification()` DB function (see Phase 1 architecture).
 *
 * Allowlist (per-file, audited): three verification edge functions whose
 * side-effects cannot be expressed as a DB trigger, plus the queue worker.
 *
 * Canonical definition: docs/audit/forbidden-patterns.md (#11).
 */
const FILE_ALLOWLIST = [
  "/supabase/functions/decide-photo-verification/index.ts",
  "/supabase/functions/request-photo-verification/index.ts",
  "/supabase/functions/expire-photo-verifications/index.ts",
  "/supabase/functions/process-email-queue/index.ts",
];

function isAllowlisted(filename) {
  if (!filename) return true;
  const norm = filename.replace(/\\/g, "/");
  return FILE_ALLOWLIST.some((p) => norm.endsWith(p));
}

const TARGET = "send-transactional-email";

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct invocation of send-transactional-email outside the audited allowlist (Forbidden Pattern #11). Use emit_notification() DB function via triggers.",
    },
    schema: [],
    messages: {
      direct:
        "Forbidden Pattern #11: do not invoke `send-transactional-email` directly. " +
        "Judging emails MUST go through the `emit_notification()` DB function. " +
        "See docs/audit/forbidden-patterns.md#11.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowlisted(filename)) return {};

    return {
      CallExpression(node) {
        // Match `<x>.functions.invoke('send-transactional-email', …)`
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (!callee.property || callee.property.name !== "invoke") return;
        const obj = callee.object;
        if (!obj || obj.type !== "MemberExpression") return;
        if (!obj.property || obj.property.name !== "functions") return;

        const arg0 = node.arguments && node.arguments[0];
        if (!arg0) return;
        if (arg0.type !== "Literal" || arg0.value !== TARGET) return;

        context.report({ node, messageId: "direct" });
      },
    };
  },
};

export default rule;
