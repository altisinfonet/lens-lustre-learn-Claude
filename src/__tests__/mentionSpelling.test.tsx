/**
 * S11 judging · "Honorary / Honourable / Honorable Mention" is ONE award.
 * The database has written all three (20260418 checks honorable_mention,
 * 20260418/20260420 use honourable_mention, the label map uses honorary_mention),
 * and each screen knew only some of them: a placement of honorable_mention
 * got no stage timeline, no JudgePanel count, no Dashboard award badge; a
 * tag labelled "Honourable Mention" was not classified as an award at all.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePlacementKey, canonicalMention } from "@/lib/judging/participantStageLabels";
import { classifyTag } from "@/lib/judging/tagSemantics";
import { ParticipantStageTimeline } from "@/components/judge/ParticipantStageBadge";

const KEYS = ["honorary_mention", "honourable_mention", "honorable_mention"];
const LABELS = ["Honorary Mention", "Honourable Mention", "Honorable Mention"];

describe("one award, three spellings", () => {
  it.each(KEYS)("normalizePlacementKey(%s) is honorary_mention", (k) => {
    expect(normalizePlacementKey(k)).toBe("honorary_mention");
    expect(canonicalMention(k)).toBe("honorary_mention");
  });
  it("canonicalMention leaves every other status alone", () => {
    for (const s of ["winner", "finalist", "round1_qualified", "special_jury", "", "honorary"]) expect(canonicalMention(s)).toBe(s);
  });
  it.each(LABELS)("a tag labelled %s is an award", (label) => {
    expect(classifyTag({ label }).family).toBe("award");
  });
  it("the stage timeline is the same for all three spellings", () => {
    const text = KEYS.map((k) => render(<ParticipantStageTimeline status={k} tags={[]} />).container.textContent);
    const plain = render(<ParticipantStageTimeline status="approved" tags={[]} />).container.textContent;
    expect(text[0]!.length).toBeGreaterThan(plain!.length); // an award shows the later stages
    expect(new Set(text).size).toBe(1);
  });
  it("JudgePanel and the Dashboard decide 'mention' through canonicalMention, not a hand list", () => {
    const panel = readFileSync(join(process.cwd(), "src/pages/JudgePanel.tsx"), "utf8");
    expect(panel).not.toMatch(/=== "honourable_mention"/);
    expect(panel).toMatch(/canonicalMention\(/);
    const dash = readFileSync(join(process.cwd(), "src/pages/Dashboard.tsx"), "utf8");
    expect(dash).not.toMatch(/"honourable_mention",/);
    expect(dash).toMatch(/PLACEMENT_AWARDS\.has\(canonicalMention\(placement\)\)/);
  });
  it("the admin semantics audit lists all three label spellings", () => {
    const audit = readFileSync(join(process.cwd(), "src/pages/admin/AdminTagSemanticsAudit.tsx"), "utf8");
    for (const l of LABELS) expect(audit.toLowerCase()).toContain(`"${l.toLowerCase()}"`);
  });
});
