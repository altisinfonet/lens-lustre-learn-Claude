/**
 * F-AUD-1 · which commit a built site was made from — stamped into index.html.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. The P15 push job measured "whatever Cloudflare serves" seconds after a
 * push, while Pages was still building that push — so on main #12 it measured
 * the PREVIOUS build, or a half-switched one, and went red for a reason that
 * had nothing to do with compression (Auditor, R-94, run 37206638044). A
 * measurement must know which build it is reading. So every build now carries
 *     <meta name="build-commit" content="<40-hex sha>">
 * and the job waits until the served page names the pushed commit (or a newer
 * one that contains it) before measuring. See scripts/web-wait-for-deploy.mjs.
 *
 * SOURCE, in order: CF_PAGES_COMMIT_SHA (Cloudflare Pages sets it for every
 * build), GITHUB_SHA (CI), `git rev-parse HEAD`, else "unknown". "unknown" is
 * stamped rather than failing the build: a missing stamp only means the waiter
 * cannot match and fails ITS job loudly — it must never break a deploy.
 *
 * The sha is not a secret: it names a commit, and the repository is the source
 * of every byte the page already serves.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execSync } from "node:child_process";

export const META_NAME = "build-commit";
const SHA = /^[0-9a-f]{40}$/;

export function resolveBuildCommit(env = process.env, git = () => execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) {
  for (const v of [env.CF_PAGES_COMMIT_SHA, env.GITHUB_SHA]) {
    if (typeof v === "string" && SHA.test(v.trim())) return v.trim();
  }
  try {
    const g = git();
    if (SHA.test(g)) return g;
  } catch { /* not a git checkout */ }
  return "unknown";
}

/** Insert (or replace) the meta tag just before </head>. Pure. */
export function stampHtml(html, sha) {
  const tag = `<meta name="${META_NAME}" content="${sha}" />`;
  const existing = new RegExp(`<meta name="${META_NAME}" content="[^"]*"\\s*/?>`);
  if (existing.test(html)) return html.replace(existing, tag);
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

/** Read the stamp back out of served HTML. null when absent. */
export function readStamp(html) {
  const m = new RegExp(`<meta name="${META_NAME}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
}

/** Vite plugin: build only (the dev server and the UI-gate harness are untouched). */
export function buildCommitPlugin() {
  const sha = resolveBuildCommit();
  return {
    name: "build-commit-stamp",
    apply: "build",
    transformIndexHtml: { order: "post", handler: (html) => stampHtml(html, sha) },
  };
}
