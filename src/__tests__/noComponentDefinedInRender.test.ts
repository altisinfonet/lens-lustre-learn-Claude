/**
 * THE "sknaht" GUARD.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Owner, 2026-08-12: *"In Comment Reply : I am typing 'Thanks' its typing as
 * 'sknaht'. Text pointer atomically coming front after typing"*.
 *
 * Three files defined a component INSIDE the parent's render body and then
 * rendered it as a JSX element:
 *
 *     const CommentItem = ({ comment }) => { … }     // inside render
 *     …
 *     <CommentItem comment={c} />                    // ← the bug
 *
 * A component declared during render is a NEW FUNCTION OBJECT every render, so
 * React sees a different element TYPE each time. It cannot reconcile a changed
 * type — it unmounts the old subtree and mounts a fresh one. The reply text
 * lived in parent state, so every keystroke re-rendered the parent and threw
 * away the real DOM <input>, replacing it with a new one whose caret sits at
 * position 0. The next character therefore landed in FRONT of the previous:
 *
 *     T → T
 *     h → hT
 *     a → ahT      …  "Thanks" arrives as "sknaht"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FIX IS A FUNCTION CALL AND NOT A HOISTED COMPONENT
 *
 * `renderComment(c)` splices its output straight into the PARENT's element
 * tree. No new component type exists, so nothing remounts and the caret is
 * untouched — while every closed-over variable (user, isAdmin, editingId, the
 * handlers) keeps working. Hoisting to module scope would have meant threading
 * about twenty props through, which is a much larger change with far more room
 * to get something wrong on a live site.
 *
 * The trade is that a render-function shares the parent's hook slots, so it
 * MUST NOT call hooks. That is asserted below too.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS TEST ACTUALLY CHECKS
 *
 * It is deliberately narrow. It does not ban every nested arrow function —
 * small presentational helpers like `Row`/`Chip` defined in render and used
 * once are everywhere in this codebase and are only a performance question,
 * not a correctness one. It fires on the combination that produced the bug:
 *
 *   a Capitalised component declared inside a component body
 *   AND rendered as <Capitalised …/>
 *   in a file that also owns a controlled text input.
 *
 * That is precisely the shape that eats keystrokes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith(".tsx") && !/__tests__|\.test\.tsx$/.test(rel)) out.push(rel);
    }
  };
  walk("src");
  return out;
}

/** Source with comments stripped — this file's own prose quotes the bad pattern. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("no component is declared in render and then used as an element", () => {
  const offenders: string[] = [];

  /** Body of `const Name = (…) => { … }`, by brace matching from the arrow. */
  function bodyOf(src: string, at: number): string {
    const brace = src.indexOf("{", src.indexOf("=>", at));
    if (brace === -1) return "";
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) return src.slice(brace, i);
      }
    }
    return src.slice(brace);
  }

  const INPUT = /<(MentionInput|Textarea|Input|input|textarea)\b/;

  for (const file of tsxFiles()) {
    const src = code(read(file));

    // `  const Foo = (` indented ⇒ declared inside a function body.
    // Module-scope declarations start at column 0 and are perfectly fine.
    for (const m of src.matchAll(/^[ \t]+const ([A-Z][A-Za-z0-9]*)\s*=\s*\(/gm)) {
      const name = m[1];

      // Rendered as an ELEMENT (the remount) rather than called as a function?
      if (!new RegExp(`<${name}[\\s/>]`).test(src)) continue;

      // ⚠ AND it must actually CONTAIN a controlled text input. That is the
      // whole failure mode: the remount only costs you something when there is
      // a caret inside to lose. A nested <SortIcon /> or <PhotoThumb /> is at
      // worst a wasted render, and flagging those would make this guard noise
      // that people learn to skip past.
      const body = bodyOf(src, m.index ?? 0);
      if (!INPUT.test(body) || !/\bonChange=/.test(body)) continue;

      offenders.push(`${file}: <${name} />`);
    }
  }

  /**
   * ⚠ KNOWN, TRACKED, NOT HIDDEN.
   *
   * `CriteriaSliders` in the judge panel is the same defect — declared in
   * render, used as an element, and it owns a controlled numeric <Input>. A
   * judge typing a score fights the same caret reset.
   *
   * It is NOT fixed the same way because it calls `useState`. A render-function
   * shares the parent's hook slots, and this one is rendered CONDITIONALLY
   * (`showCriteria ? … : …`), so turning it into a call would change the
   * parent's hook order between renders — a far worse bug than the one being
   * fixed. It needs hoisting to module scope with explicit props, which is a
   * real refactor of judging code and does not belong in a release that is
   * already changing the whole posting flow.
   *
   * Listed here so it stays VISIBLE rather than quietly passing. Delete the
   * entry when it is hoisted. A NEW offender still fails this test.
   */
  const KNOWN = ["src/components/judge/MobileJudgeView.tsx: <CriteriaSliders />"];

  it("has no offender that is not already tracked", () => {
    expect(
      offenders,
      "A component declared inside render is a new type every render, so React " +
        "remounts its subtree and any text input inside it loses the caret — " +
        "typing 'Thanks' produces 'sknaht'. Render it as a function call, or " +
        "hoist it to module scope with explicit props.",
    ).toEqual(KNOWN.filter((k) => offenders.includes(k)));
  });

  it("still sees the tracked one — so the guard has not gone blind", () => {
    // If this fails because CriteriaSliders was fixed: delete it from KNOWN.
    // If it fails because the DETECTION broke, that is far more serious — the
    // whole test would be passing vacuously.
    expect(offenders).toEqual(expect.arrayContaining(KNOWN));
  });
});

describe("the render-functions that replaced them stay hook-free", () => {
  // They share the PARENT's hook slots. A hook here — especially a conditional
  // one — corrupts the parent's hook order, which React reports as the far
  // less obvious "Rendered fewer hooks than expected".
  const files = [
    "src/components/PostCommentsSection.tsx",
    "src/components/CommentsSection.tsx",
    "src/components/ads/AdComments.tsx",
  ];

  for (const file of files) {
    it(`${file} — renderComment/renderRow calls no hooks`, () => {
      const src = code(read(file));
      const start = src.search(/const render(Comment|Row)\s*=/);
      expect(start, `no render function found in ${file}`).toBeGreaterThan(-1);

      // Walk braces from the arrow body to find where the function ends.
      const bodyStart = src.indexOf("{", start);
      let depth = 0;
      let end = bodyStart;
      for (let i = bodyStart; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      const body = src.slice(bodyStart, end);
      const hooks = [...body.matchAll(/\buse[A-Z][A-Za-z0-9]*\s*\(/g)].map((m) => m[0]);
      expect(hooks, `hooks inside a render-function in ${file}`).toEqual([]);
    });
  }
});

describe("the reply inputs are still there", () => {
  // A regression that silently deleted the box would also make the guard pass.
  it("each comment surface still renders a controlled input", () => {
    for (const f of [
      "src/components/PostCommentsSection.tsx",
      "src/components/CommentsSection.tsx",
      "src/components/ads/AdComments.tsx",
    ]) {
      expect(code(read(f))).toMatch(/<(MentionInput|Textarea|Input|input|textarea)\b/);
    }
  });
});
