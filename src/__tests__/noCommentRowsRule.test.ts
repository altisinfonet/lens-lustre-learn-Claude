/**
 * C3: the comment-row ratchet fails first. Drives the real rule through ESLint's
 * Linter with a throwaway baseline, then checks the committed baseline against
 * the real tree.
 */
import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rule from "../../eslint-rules/no-comment-rows.js";

const BASELINE = JSON.parse(fs.readFileSync("eslint-rules/no-comment-rows.baseline.json", "utf8")) as {
  files: Record<string, number>;
  reasons: Record<string, string>;
};

function lint(code: string, file: string, baseline: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c3-"));
  const bp = path.join(dir, "b.json");
  fs.writeFileSync(bp, typeof baseline === "string" ? baseline : JSON.stringify(baseline));
  const linter = new Linter({ configType: "flat", cwd: process.cwd() });
  const config = [{
    files: ["**/*.tsx"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { d2: { rules: { "no-comment-rows": rule } } },
    rules: { "d2/no-comment-rows": ["error", { baselinePath: bp }] },
  }] as unknown as Linter.Config[];
  const msgs = linter.verify(code, config, path.join(process.cwd(), file));
  fs.rmSync(dir, { recursive: true, force: true });
  return msgs.map((m) => m.message);
}

const F = "src/components/X.tsx";
const none = { files: {} };
const body = (expr: string) => `export const A = ({ comments, replies, post }) => <div>{${expr}}</div>;`;

describe("d2/no-comment-rows: what counts as drawing a list", () => {
  const drawn: [string, string][] = [
    ["JSX in the callback", "comments.map((c) => <p key={c.id}>{c.content}</p>)"],
    ["replies", "replies.map((r) => <p key={r.id} />)"],
    ["a named list", "visibleComments.map((c) => <p key={c.id} />)"],
    ["on an object", "post.comments.map((c) => <p key={c.id} />)"],
    ["optional chaining", "comments?.map((c) => <p key={c.id} />)"],
    ["a fallback", "(comments ?? []).map((c) => <p key={c.id} />)"],
    ["a chain", "comments.filter(Boolean).map((c) => <p key={c.id} />)"],
    ["a copy, sorted", "[...comments].sort().map((c) => <p key={c.id} />)"],
    ["a fragment", "comments.map((c) => <><p /></>)"],
    ["flatMap", "comments.flatMap((c) => [<p key={c.id} />])"],
    // The exact shape ImageEngagement drew its third renderer in, with no JSX in the callback.
    ["a render helper called in the callback", "comments.map((c) => renderComment(c))"],
    ["a render helper passed directly", "comments.map(renderComment)"],
    ["a function body", "comments.map((c) => { return <p key={c.id} />; })"],
  ];
  for (const [what, expr] of drawn) {
    it(`fails: ${what}`, () => {
      expect(lint(body(expr), F, none)[0], expr).toMatch(/baseline 0/);
    });
  }

  const data: [string, string][] = [
    ["the adapter", "comments.map(toThread)"],
    ["reading ids", "comments.map((c) => c.user_id)"],
    ["a list that is not comments", "post.tags.map((t) => <p key={t} />)"],
    ["no callback drawing", "replies.map((r) => ({ ...r }))"],
  ];
  for (const [what, expr] of data) {
    it(`passes: ${what}`, () => {
      expect(lint(body(expr), F, none), expr).toEqual([]);
    });
  }
});

describe("d2/no-comment-rows: the ratchet", () => {
  const ONE = body("comments.map((c) => <p key={c.id} />)");
  const TWO = `export const A = ({ comments, replies }) => <div>{comments.map((c) => <p key={c.id} />)}{replies.map((r) => <p key={r.id} />)}</div>;`;

  it("a file at its baseline passes", () => {
    expect(lint(ONE, F, { files: { [F]: 1 } })).toEqual([]);
  });
  it("a NEW list over the baseline fails, each one reported", () => {
    const m = lint(TWO, F, { files: { [F]: 1 } });
    expect(m).toHaveLength(2);
    expect(m[0]).toMatch(/2 in this file, baseline 1/);
  });
  it("a file not in the baseline has a baseline of 0", () => {
    expect(lint(ONE, F, none)[0]).toMatch(/CommentThread/);
  });
  it("fewer than the baseline fails until it is lowered", () => {
    const m = lint(ONE, F, { files: { [F]: 2 } });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/lower its entry/);
  });
  it("a missing or broken baseline is an error, never allow-all", () => {
    expect(lint(ONE, F, "not json")[0]).toMatch(/baseline unreadable/);
    expect(lint("export const A = 1;", F, "not json")[0]).toMatch(/baseline unreadable/);
    expect(lint(ONE, F, { nofiles: true })[0]).toMatch(/baseline unreadable/);
  });
});

describe("the committed baseline", () => {
  it("names only files that exist", () => {
    for (const f of Object.keys(BASELINE.files)) expect(fs.existsSync(f), f).toBe(true);
  });
  it("gives every entry a written reason, and no reason without an entry", () => {
    expect(Object.keys(BASELINE.reasons).sort()).toEqual(Object.keys(BASELINE.files).sort());
    for (const reason of Object.values(BASELINE.reasons)) expect(reason.length).toBeGreaterThan(20);
  });
  it("allows only positive counts", () => {
    for (const n of Object.values(BASELINE.files)) expect(n).toBeGreaterThan(0);
  });
  it("allows no comment list on any member-facing surface but the one shared thread", () => {
    expect(Object.keys(BASELINE.files).sort()).toEqual([
      "src/components/JuryImageViewer.tsx",
      "src/components/admin/AdminEngagement.tsx",
      "src/components/admin/AdminSupportTickets.tsx",
      "src/components/comments/CommentThread.tsx",
      "src/components/judge/CinemaFullView.tsx",
      "src/modules/admin/CommentsModule.tsx",
      "src/pages/HelpSupport.tsx",
      "src/pages/SubmissionDetail.tsx",
    ]);
  });
});
