import { describe, expect, it } from "vitest";
import {
  buildPublishedParticipantTagMaps,
  selectLatestPublishedTagAssignments,
  type PublishedTagAssignment,
  type PublishedTagInfo,
} from "@/lib/judging/publishedTagVisibility";

const assignment = (
  tag_id: string,
  created_at: string,
  entry_id = "entry-any",
  photo_index = 0,
): PublishedTagAssignment => ({ entry_id, tag_id, photo_index, created_at });

describe("published participant tag visibility", () => {
  it("selects the latest tag only after filtering out undeclared later rounds", () => {
    const tagRounds = new Map<string, number[]>([
      ["r2", [2]],
      ["r3", [3]],
      ["r4", [4]],
    ]);

    const selected = selectLatestPublishedTagAssignments(
      [
        assignment("r2", "2026-01-01T00:00:00Z"),
        assignment("r3", "2026-01-02T00:00:00Z"),
        assignment("r4", "2026-01-03T00:00:00Z"),
      ],
      tagRounds,
      new Set([1, 2]),
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].tag_id).toBe("r2");
  });

  it("does not derive an R3/R4 participant label before admin declaration", () => {
    const tagInfo = new Map<string, PublishedTagInfo>([
      ["r2", { label: "Qualified for Round 3", color: "#00f" }],
      ["r3", { label: "Shortlist for Final Round", color: "#80f" }],
      ["r4", { label: "Winner", color: "#fc0" }],
    ]);
    const tagRounds = new Map<string, number[]>([
      ["r2", [2]],
      ["r3", [3]],
      ["r4", [4]],
    ]);

    const maps = buildPublishedParticipantTagMaps(
      [
        assignment("r2", "2026-01-01T00:00:00Z"),
        assignment("r3", "2026-01-02T00:00:00Z"),
        assignment("r4", "2026-01-03T00:00:00Z"),
      ],
      tagInfo,
      tagRounds,
      new Set([1, 2]),
    );

    expect(maps.entryTagsByPhotoMap["entry-any"][0][0].label).toBe("Qualified for Round 3");
    expect(maps.tagDerivedStatusByEntryPhoto["entry-any"][0]).toBe("round2_qualified");
    expect(maps.entryTagMap["entry-any"].map((tag) => tag.label)).toEqual(["Qualified for Round 3"]);
  });

  it("switches to the declared later tag only after that round is declared", () => {
    const tagInfo = new Map<string, PublishedTagInfo>([
      ["r2", { label: "Qualified for Round 3", color: "#00f" }],
      ["r3", { label: "Shortlist for Final Round", color: "#80f" }],
    ]);
    const tagRounds = new Map<string, number[]>([
      ["r2", [2]],
      ["r3", [3]],
    ]);

    const maps = buildPublishedParticipantTagMaps(
      [assignment("r2", "2026-01-01T00:00:00Z"), assignment("r3", "2026-01-02T00:00:00Z")],
      tagInfo,
      tagRounds,
      new Set([1, 2, 3]),
    );

    expect(maps.entryTagsByPhotoMap["entry-any"][0][0].label).toBe("Shortlist for Final Round");
    expect(maps.tagDerivedStatusByEntryPhoto["entry-any"][0]).toBe("finalist");
  });
});