#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR D-002 — THE CHOOSER AND ITS DISCLOSURE SHIP TOGETHER.
 *
 * D-001 withheld the audience chooser because the platform could not keep the
 * promise it makes. D-002 offers it again and states the limit in the UI
 * instead. The whole safety of that swap rests on ONE property: you cannot end
 * up with the control and no disclosure.
 *
 * Every mutation below produces exactly that state, and each looks like a
 * tidy-up in a diff — deleting a "redundant" notice, dropping one of two
 * duplicated blocks, simplifying a conditional. If any of them leaves the suite
 * green, D-002 is not enforced and the register is describing a rule that is
 * not actually held.
 *
 * Applied to a copy, restored afterwards, and the run ends by re-asserting
 * every file matches the snapshot this run took.
 * Usage: `node tools/mutate-privacy-disclosure.mjs`
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const WALL = "src/components/WallPosts.tsx";
const CHOOSER = "src/components/post/PostAudienceChooser.tsx";
const NOTICE = "src/components/post/PrivacyGapNotice.tsx";
const REG = "docs/DECISIONS.md";
const SUITE = "src/components/__tests__/PrivacyGapDisclosed.test.ts";
/** The register's own test must also notice if D-002 loses its pin. */
const REG_SUITE = "src/__tests__/decisionRegister.test.ts";

const MUTATIONS = [
  {
    control: "1. the notice component is deleted",
    file: NOTICE,
    delete: true,
  },
  {
    control: "2. the notice is separated from the control it belongs to",
    file: CHOOSER,
    from: "      <PrivacyGapNotice privacy={value} />",
    to: "",
  },
  {
    control: "3. the APP composer's chooser is quietly not restored (website only)",
    file: WALL,
    from: 'variant="row"',
    to: 'variant="inline"',
  },
  {
    control: "4. the notice starts showing for PUBLIC too, so it means nothing",
    file: NOTICE,
    from: "  if (!privacyHasFileGap(privacy)) return null;",
    to: "  // (guard removed)",
  },
  {
    control: "5. the one fact a member needs is edited out of the wording",
    file: NOTICE,
    from: "still be opened by anyone who has its direct link",
    to: "be kept private",
  },
  {
    control: "6. one composer loses its chooser entirely",
    file: WALL,
    transform: (s) => {
      const i = s.indexOf("<PostAudienceChooser");
      const j = s.indexOf("<PostAudienceChooser", i + 1);
      return s.slice(0, j) + "<div" + s.slice(j + "<PostAudienceChooser".length);
    },
  },
  {
    control: "7. \"Friends\" is dropped from the offered audiences",
    file: CHOOSER,
    from: '  { value: "friends", label: "Friends", hint: "Your friends", icon: <Users className="h-3.5 w-3.5" /> },\n',
    to: "",
  },
  {
    control: "8. the composer stops defaulting to public",
    file: WALL,
    from: 'const [newPrivacy, setNewPrivacy] = useState<Privacy>("public");',
    to: 'const [newPrivacy, setNewPrivacy] = useState<Privacy>("private");',
  },
  {
    control: "9. D-002 loses its @decision marker (register drifts from the test)",
    file: SUITE,
    from: " * @decision D-002",
    to: " * (marker removed)",
    suite: REG_SUITE,
  },
  {
    control: "10. D-002 is quietly marked CLOSED while the gap is still open",
    file: REG,
    from: "## D-002 — The audience chooser ships with its limit stated in the UI\n\n- **Status:** ACTIVE",
    to: "## D-002 — The audience chooser ships with its limit stated in the UI\n\n- **Status:** CLOSED",
    // Closing it releases the pinning requirement; the register test is what
    // must notice, because the UI test alone would stay green.
    suite: REG_SUITE,
  },
];

const read = (f) => readFileSync(f, "utf8");
const TOUCHED = [...new Set(MUTATIONS.map((m) => m.file))];
const originals = new Map();
for (const f of TOUCHED) originals.set(f, read(f));

function suiteResult(which) {
  try {
    execSync(`npx vitest run ${which} --reporter=basic`, { stdio: "pipe" });
    return "GREEN";
  } catch {
    return "RED";
  }
}

console.log("baseline (no mutation):", suiteResult(`${SUITE} ${REG_SUITE}`), "\n");
let failures = 0;

for (const m of MUTATIONS) {
  const src = originals.get(m.file);
  if (m.from && !src.includes(m.from)) {
    console.log(`⚠ SKIPPED  ${m.control} — anchor not found in ${m.file}`);
    failures++;
    continue;
  }
  try {
    if (m.delete) unlinkSync(m.file);
    else if (m.transform) writeFileSync(m.file, m.transform(src));
    else writeFileSync(m.file, src.replace(m.from, m.to));

    const r = suiteResult(m.suite ?? SUITE);
    const ok = r === "RED";
    if (!ok) failures++;
    console.log(`${ok ? "✓ DETECTED" : "✗ UNDETECTED"}  ${m.control}  → suite ${r}`);
  } finally {
    writeFileSync(m.file, src);
  }
}

for (const [f, s] of originals) writeFileSync(f, s);
const leftover = [...originals.entries()].filter(([f, s]) => !existsSync(f) || read(f) !== s).map(([f]) => f);
const dirty = leftover.join("\n");
console.log("\nfiles differing from the pre-run snapshot:", dirty === "" ? "NONE (fully restored)" : `LEFTOVER:\n${dirty}`);
console.log(failures === 0
  ? "\nALL CONTROLS DETECTED. The chooser cannot ship without its disclosure."
  : `\n${failures} CONTROL(S) NOT DETECTED — D-002 is described but not enforced.`);
process.exit(failures === 0 && dirty === "" ? 0 : 1);
