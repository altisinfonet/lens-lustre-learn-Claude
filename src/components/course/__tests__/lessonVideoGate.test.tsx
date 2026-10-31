/**
 * S7b-6 · a course lesson's video is a YouTube embed: it cannot be saved on the
 * phone (YouTube does not allow it). With no network the lesson says so
 * plainly — never a broken player or an error screen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

const net = { online: true, slow: false, reason: null as string | null };
vi.mock("@/lib/offline/networkQuality", () => ({ getNetState: () => net, subscribeNetState: () => () => {} }));

import LessonVideoGate from "@/components/course/LessonVideoGate";

beforeEach(() => { net.online = true; });

describe("the lesson video with no network", () => {
  it("online: the player", () => {
    render(<LessonVideoGate><iframe title="lesson" /></LessonVideoGate>);
    expect(screen.getByTitle("lesson")).toBeTruthy();
  });
  it("offline: a calm message instead of the player", () => {
    net.online = false;
    render(<LessonVideoGate><iframe title="lesson" /></LessonVideoGate>);
    expect(screen.queryByTitle("lesson")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/this video needs a connection/i);
  });
  it("LessonView puts its YouTube player behind the gate", () => {
    const src = readFileSync("src/pages/LessonView.tsx", "utf8");
    expect(src).toMatch(/<LessonVideoGate>[\s\S]*<iframe[\s\S]*toYouTubeNoCookie\(lesson\.video_url\)[\s\S]*<\/LessonVideoGate>/);
  });
});
