/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE NOW EMITS NO REDIRECT RULES.
 *
 * It used to write one rule:
 *
 *     /sitemap.xml  https://<ref>.supabase.co/functions/v1/sitemap  200
 *
 * Cloudflare REJECTS that rule. A 200-proxy target must be a path on the same
 * site; a cross-origin absolute URL is not a valid rewrite target. The deploy
 * log for every build that carried it read:
 *
 *     Parsed 0 valid redirect rules.
 *
 * So the rule never took effect on either lane, and `dist/sitemap.xml` — the
 * file `generate-seo-assets.mjs` writes per lane — is what has always been
 * served. Carrying an invalid rule is worse than carrying none: it reads like a
 * live proxy to anyone auditing the file, it made rule R2's "expected ref is
 * present in the bundle" partly satisfied by a file Cloudflare discards, and a
 * future Cloudflare parser change could make it suddenly live and start
 * shipping a *dynamic* sitemap over the lane-aware static one.
 *
 * The dynamic sitemap function still exists and is still deployed. If it is
 * ever wanted at `/sitemap.xml`, the correct mechanism is a Pages Function or a
 * Worker route — not a `_redirects` line, which cannot express it.
 *
 * The file is still written, with a comment body only, so that anything
 * expecting `dist/_redirects` to exist keeps working and the reason travels
 * with the artifact.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { writeFileSync, existsSync } from "node:fs";

if (!existsSync("dist")) {
  console.error("generate-redirects FAIL: dist/ missing");
  process.exit(1);
}

writeFileSync(
  "dist/_redirects",
  "# No redirect rules. The previous /sitemap.xml 200-proxy rule named a\n" +
    "# cross-origin absolute URL, which Cloudflare rejects (\"Parsed 0 valid\n" +
    "# redirect rules\"), so it never took effect. dist/sitemap.xml is written\n" +
    "# per lane by scripts/generate-seo-assets.mjs and is what is served.\n",
);
console.log("generate-redirects OK: no rules emitted (the previous /sitemap.xml proxy rule was invalid and inert)");
