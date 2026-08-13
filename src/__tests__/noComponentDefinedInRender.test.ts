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
  /**
   * The body of `const Name = (…) => …`, whichever shape it is written in.
   *
   * ⚠ BOTH SHAPES, AND THAT IS A BUG FIX (2026-08-13).
   *
   * This used to jump to the first `{` after the arrow and brace-match from
   * there. That reads a block body correctly:
   *
   *     const Foo = (p) => { return <input onChange={f} /> }   ✔ body found
   *
   * but on a CONCISE body it lands on the first JSX expression container
   * instead of the function body:
   *
   *     const Foo = (p) => ( <input value={v} onChange={f} /> )
   *                                        ↑ matched `{v}` and stopped
   *
   * so `bodyOf` returned the two characters `{v`, the `<input` test failed, and
   * the offender was waved through. Half the components in this codebase are
   * written the concise way — including `Toggle` in AdminPerformance, which the
   * guard had never once looked inside. The guard was reporting on a subset of
   * the code while reading as if it covered all of it.
   *
   * Now the delimiter is whatever actually follows the arrow, and the matching
   * counts that delimiter's own pairs.
   */
  function bodyOf(src: string, at: number): string {
    const arrow = src.indexOf("=>", at);
    if (arrow === -1) return "";
    let i = arrow + 2;
    while (i < src.length && /\s/.test(src[i])) i++;
    const open = src[i];
    const close = open === "{" ? "}" : open === "(" ? ")" : "";
    // A concise body with no delimiter at all — `(p) => <input …/>` — has no
    // closing token to match, so take the rest of the statement.
    if (!close) return src.slice(i, src.indexOf("\n;", i) + 1 || undefined);

    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === open) depth++;
      else if (src[j] === close) {
        depth--;
        if (depth === 0) return src.slice(i, j);
      }
    }
    return src.slice(i);
  }

  const INPUT = /<(MentionInput|Textarea|Input|input|textarea)\b/;

  /** Offending component names inside one already-comment-stripped source. */
  function scan(src: string): string[] {
    const found: string[] = [];
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

      found.push(name);
    }
    return found;
  }

  const offenders: string[] = [];
  for (const file of tsxFiles()) {
    for (const name of scan(code(read(file)))) offenders.push(`${file}: <${name} />`);
  }

  /**
   * ⚠ THE ALLOWLIST IS EMPTY, AND IT IS MEANT TO STAY THAT WAY.
   *
   * It used to carry one entry: `CriteriaSliders` in the judge panel, the last
   * component in the codebase declared in render and rendered as an element
   * while owning a controlled numeric <Input>. It was tracked rather than fixed
   * because it calls `useState` — a render-function shares the parent's hook
   * slots and it is rendered conditionally, so converting it to a call would
   * have reordered the parent's hooks, which is a worse bug than the one being
   * fixed. It has since been hoisted to module scope with explicit props
   * (2026-08-13), which is the correct fix, so the entry is gone.
   *
   * Do not add to this list to make a build green. An entry here is a promise
   * to come back, and this one took a release to honour.
   */
  const KNOWN: string[] = [];

  it("has no offender that is not already tracked", () => {
    expect(
      offenders,
      "A component declared inside render is a new type every render, so React " +
        "remounts its subtree and any text input inside it loses the caret — " +
        "typing 'Thanks' produces 'sknaht'. Render it as a function call, or " +
        "hoist it to module scope with explicit props.",
    ).toEqual(KNOWN.filter((k) => offenders.includes(k)));
  });

  /**
   * ⚠ THE GUARD MUST BE PROVED, NOT ASSUMED.
   *
   * While the allowlist held a real offender, that entry doubled as proof the
   * detector still worked: if the regex ever broke, the tracked file would stop
   * being reported and the test would fail loudly. With the list empty that
   * proof is gone, and a silently broken detector would make every run above
   * pass VACUOUSLY — the most dangerous state a guard can be in, because it
   * looks exactly like success.
   *
   * So the detector is now run against a fixture that IS the bug, plus one that
   * is the accepted fix. Both directions matter: a guard that flags everything
   * is as useless as one that flags nothing.
   */
  it("still detects the pattern — so the guard has not gone blind", () => {
    const bug = [
      "const Parent = () => {",
      "  const CommentItem = ({ v, on }) => (",
      "    <div><input value={v} onChange={on} /></div>",
      "  );",
      "  return <CommentItem v={x} on={f} />;",
      "};",
    ].join("\n");
    expect(scan(bug)).toEqual(["CommentItem"]);
  });

  it("does not flag the render-function form that replaced it", () => {
    const fixed = [
      "const Parent = () => {",
      "  const renderComment = (c) => (",
      "    <div><input value={c.v} onChange={f} /></div>",
      "  );",
      "  return renderComment(x);",
      "};",
    ].join("\n");
    expect(scan(fixed)).toEqual([]);
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
