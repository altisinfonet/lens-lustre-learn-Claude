#!/usr/bin/env node
/**
 * MUTATION HARNESS FOR THE SCHEDULED-POST DUPLICATE (RED-2).
 *
 * Every failure this guards is SILENT AND DELAYED. The duplicate is created
 * now, looks right in the list, and is published by cron hours later with the
 * wrong privacy, no categories and no media references. There is no error, no
 * log line, and nobody watching at the moment it happens.
 *
 * That is why a green suite proves nothing on its own: the original defect
 * shipped through review with a green suite and a satisfied type-checker. Each
 * control below is removed, and each removal must turn the suite RED.
 *
 * ⚠ D3 IS THE ONE THAT MATTERS. The others cost data. That one discloses a
 * member's private photograph.
 *
 * Usage: node tools/mutate-scheduled-duplicate.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const HOOK = "src/hooks/feed/useScheduledPosts.ts";
const LIST = "src/components/post/ScheduledPostsList.tsx";
const COMPOSER = "src/components/WallPosts.tsx";
const PIN = "src/__tests__/scheduledPostDuplicate.test.ts";
const THUMBS = "src/__tests__/scheduledPostThumbnails.test.ts";

const SUITE = `${PIN} ${THUMBS}`;

const FILES = [HOOK, LIST, COMPOSER, PIN, THUMBS];
const originals = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, "utf8")]));

const mutations = [
  // ── the four fields RED-2 actually dropped ────────────────────────────────
  {
    file: HOOK, name: "D1. media_ids dropped from the duplicate — every copy is legacy-only and the delta grows",
    apply: (s) => s.replace("    media_ids: source.media_ids ?? null,\n", "    media_ids: null,\n"),
  },
  {
    file: HOOK, name: "D2. categories dropped — the copy fails POST-CAT-002 and shifts until max_shifts_exceeded",
    apply: (s) => s.replace("    categories: source.categories ?? [],\n", "    categories: [],\n"),
  },
  {
    file: HOOK, name: "D3. ⚠ privacy dropped — a PRIVATE member's photograph is published PUBLICLY",
    apply: (s) => s.replace("    privacy: source.privacy,\n", '    privacy: "public",\n'),
  },
  {
    file: HOOK, name: "D4. indexing_disabled dropped — a member's SEO opt-out is silently reversed",
    apply: (s) => s.replace("    indexing_disabled: source.indexing_disabled,\n", "    indexing_disabled: false,\n"),
  },

  // ── the rest of the payload ───────────────────────────────────────────────
  {
    file: HOOK, name: "D5. thumbnail_urls dropped — the copy serves full-size originals in the grid",
    apply: (s) => s.replace("    thumbnail_urls: source.thumbnail_urls ?? [],\n", "    thumbnail_urls: [],\n"),
  },
  {
    file: HOOK, name: "D6. tagged_user_ids dropped — the people in the photograph lose their tag",
    apply: (s) => s.replace("    tagged_user_ids: source.tagged_user_ids ?? [],\n", "    tagged_user_ids: [],\n"),
  },
  {
    file: HOOK, name: "D7. content dropped — the caption is lost",
    apply: (s) => s.replace('    content: source.content ?? "",\n', '    content: "",\n'),
  },
  {
    file: HOOK, name: "D8. image_urls dropped — the copy has no photographs at all",
    apply: (s) => s.replace("    image_urls: source.image_urls ?? [],\n", "    image_urls: [],\n"),
  },
  {
    file: HOOK, name: "D9. image_url dropped — the legacy single-image reader shows nothing",
    apply: (s) => s.replace("    image_url: source.image_url,\n", "    image_url: null,\n"),
  },
  {
    file: HOOK, name: "D10. the copy inherits the ORIGINAL's time instead of the new one",
    apply: (s) => s.replace("    scheduled_for: scheduledFor,\n", "    scheduled_for: source.scheduled_for,\n"),
  },
  {
    file: HOOK, name: "D11. the copy inherits the original's publishing history — it starts near max_shifts_exceeded",
    apply: (s) => s.replace(
      "    content: source.content ?? \"\",\n",
      "    content: source.content ?? \"\",\n    ...({ attempt_count: source.attempt_count, status: source.status } as never),\n",
    ),
  },

  // ── the layers that make the omission visible ─────────────────────────────
  {
    file: HOOK, name: "D12. privacy re-defaulted at the INSERT — the same bug one layer down",
    apply: (s) => s.replace("          privacy: input.privacy,\n", '          privacy: input.privacy ?? "public",\n'),
  },
  {
    file: HOOK, name: "D13. indexing_disabled re-defaulted at the INSERT",
    apply: (s) => s.replace("          indexing_disabled: input.indexing_disabled,\n", "          indexing_disabled: input.indexing_disabled ?? false,\n"),
  },
  {
    file: HOOK, name: "D14. categories re-defaulted at the INSERT",
    apply: (s) => s.replace("          categories: input.categories,\n", "          categories: input.categories ?? [],\n"),
  },
  {
    file: HOOK, name: "D15. privacy made OPTIONAL again — omission stops being a compile error",
    apply: (s) => s.replace(
      "  /** BUG-024: carry the composer's privacy choice. Required — see the note above. */\n  privacy: string;",
      "  privacy?: string;",
    ),
  },
  {
    file: HOOK, name: "D16. media_ids made OPTIONAL again",
    apply: (s) => s.replace("  media_ids: string[] | null;\n  image_urls: string[];", "  media_ids?: string[] | null;\n  image_urls: string[];"),
  },
  {
    file: HOOK, name: "D17. categories made OPTIONAL again",
    apply: (s) => s.replace("  categories: string[];\n}", "  categories?: string[];\n}"),
  },
  {
    file: HOOK, name: "D18. the runtime refusal removed — an untyped caller can still let the table decide",
    apply: (s) => s.replace("      assertCarriesMemberChoices(input);\n", ""),
  },
  {
    file: HOOK, name: "D19. the runtime refusal stops checking privacy specifically",
    apply: (s) => s.replace(
      '  if (typeof input.privacy !== "string" || input.privacy.length === 0) missing.push("privacy");\n',
      "",
    ),
  },
  {
    file: HOOK, name: "D20. the refusal counts problems but never throws",
    apply: (s) => s.replace("  if (missing.length > 0) {", "  if (false) {"),
  },
  {
    file: HOOK, name: "D21. ⚠ THE ROOT CAUSE — privacy removed from the READ type, so a copy cannot reference it",
    apply: (s) => s.replace(
      "  /** 'public' | 'friends' | 'private'. NOT NULL DEFAULT 'public' on the table. */\n  privacy: string;",
      "",
    ),
  },
  {
    file: LIST, name: "D22. ⚠ THE ORIGINAL DEFECT, RESTORED — handleDuplicate builds the literal inline again",
    apply: (s) => s.replace(
      "      await duplicate.mutateAsync(duplicateScheduledPostInput(p, next.toISOString()));",
      `      await duplicate.mutateAsync({
        content: p.content ?? "",
        image_urls: p.image_urls ?? [],
        thumbnail_urls: p.thumbnail_urls ?? [],
        image_url: p.image_url,
        tagged_user_ids: p.tagged_user_ids ?? [],
        scheduled_for: next.toISOString(),
      } as never);`,
    ),
  },
  {
    file: COMPOSER, name: "D23. the composer stops carrying privacy — new scheduled posts publish public",
    apply: (s) => s.replace("            privacy: newPrivacy,\n            indexing_disabled: excludeFromSearch,", "            indexing_disabled: excludeFromSearch,"),
  },
  {
    file: COMPOSER, name: "D24. the composer stops registering media for scheduled posts",
    apply: (s) => s.replace(/            media_ids: await registerAllOrNone\([\s\S]*?\n            \),\n/, "            media_ids: null,\n"),
  },
];

function suiteResult() {
  try { execSync(`npx vitest run ${SUITE} --reporter=dot`, { stdio: "pipe" }); return "GREEN"; }
  catch { return "RED"; }
}

// ⚠ A RED BASELINE INVALIDATES EVERY RESULT BELOW. If the suite is already
// failing, every mutation is "detected" for a reason that has nothing to do
// with the mutation. Refuse to run rather than print a page of green ticks that
// mean nothing.
const baseline = suiteResult();
console.log(`baseline (no mutation): ${baseline}\n`);
if (baseline !== "GREEN") {
  console.error("BASELINE IS RED — fix the suite before drawing any conclusion from a mutation run.");
  process.exit(1);
}
let undetected = 0;

for (const m of mutations) {
  const original = originals[m.file];
  const mutated = m.apply(original);
  if (mutated === original) { console.log(`✗ NOT APPLIED  ${m.name}`); undetected++; continue; }
  writeFileSync(m.file, mutated);
  const res = suiteResult();
  writeFileSync(m.file, original);
  if (res === "RED") console.log(`✓ DETECTED    ${m.name}`);
  else { console.log(`✗ UNDETECTED  ${m.name}  → suite stayed GREEN`); undetected++; }
}

for (const [f, s] of Object.entries(originals)) writeFileSync(f, s);
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
console.log(`\nworking tree vs pre-run snapshot:\n${dirty || "NONE"}`);

if (undetected > 0) {
  console.error(`\n${undetected} MUTATION(S) UNDETECTED. A duplicated scheduled post could still lose a member's privacy choice.`);
  process.exit(1);
}
console.log("\nALL CONTROLS DETECTED. Duplicating a scheduled post cannot silently widen its audience, drop its categories, or strip its media references.");
