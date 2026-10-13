/**
 * THE BOTTOM DOCK (src/lib/ui/bottomDock.ts) — review of #423, Owner: no
 * overlapping UI. The server-video card sat over the home page's "Ask
 * anything" button. Pinned here:
 *   • a showing layer publishes its top edge (its own bottom + its height) on
 *     <html>, keeps it true when it changes size or a layer below it moves,
 *     and removes it when it goes — so the layers above drop back;
 *   • every element that floats over the bottom of the screen takes its place
 *     from the dock, in one order: cookie banner → update prompt → server-video
 *     card → round buttons. No fixed `bottom-20` left on a floating button.
 * The geometry itself is photographed by the UI harness
 * (screen-home-server-card, …-consent at 360 / 390 / app-360), where the
 * sweep's reachability check fails if any floating control is covered.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { useRef } from "react";
import { render, act } from "@testing-library/react";
import { dockEdge, useDockLayer, type DockLayer } from "../bottomDock";

const root = () => document.documentElement;
const prop = (layer: DockLayer) => root().style.getPropertyValue(`--dock-${layer}`);

function Layer({ layer, showing, bottom, height }: { layer: DockLayer; showing: boolean; bottom: string; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useDockLayer(layer, ref, showing);
  return showing ? (
    <div
      ref={(el) => {
        (ref as { current: HTMLDivElement | null }).current = el;
        if (el) Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => height });
      }}
      data-testid={layer}
      style={{ position: "fixed", bottom }}
    />
  ) : null;
}

afterEach(() => { root().removeAttribute("style"); });

describe("useDockLayer", () => {
  it("publishes the layer's top edge: its own bottom plus its height, in whole px", () => {
    render(<Layer layer="videos" showing bottom="60px" height={190} />);
    expect(prop("videos")).toBe("250px");
  });

  it("hidden → nothing published, so the layers above sit exactly where they always did", () => {
    const { rerender, unmount } = render(<Layer layer="videos" showing bottom="60px" height={190} />);
    expect(prop("videos")).toBe("250px");
    rerender(<Layer layer="videos" showing={false} bottom="60px" height={190} />);
    expect(prop("videos")).toBe("");
    rerender(<Layer layer="videos" showing bottom="60px" height={190} />);
    unmount();
    expect(prop("videos")).toBe("");
  });

  it("re-measures when a layer BELOW it moves (its own bottom depends on that edge)", async () => {
    const { getByTestId } = render(<Layer layer="videos" showing bottom="60px" height={190} />);
    expect(prop("videos")).toBe("250px");
    // The cookie banner appears: the card's bottom (dock-videos in CSS) rises to clear it.
    getByTestId("videos").style.bottom = "441px";
    await act(async () => { root().style.setProperty("--dock-consent", "433px"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(prop("videos")).toBe("631px");
  });

  it("layers settle: an unchanged edge is never written again (no observer loop)", async () => {
    render(<><Layer layer="consent" showing bottom="48px" height={320} /><Layer layer="videos" showing bottom="376px" height={190} /></>);
    const before = root().getAttribute("style");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(root().getAttribute("style")).toBe(before);
    expect(prop("consent")).toBe("368px");
    expect(prop("videos")).toBe("566px");
  });

  it("dockEdge reads the resting position, not a mid-animation rectangle", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.bottom = "80px";
    el.style.transform = "translateY(120px)"; // sliding in
    Object.defineProperty(el, "offsetHeight", { get: () => 44 });
    document.body.appendChild(el);
    expect(dockEdge(el)).toBe(124);
    el.remove();
  });
});

describe("every floating layer takes its place from the dock", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const css = read("src/index.css");

  it("one order in CSS: banner → update prompt → card → round buttons; nothing published = the old offsets", () => {
    expect(css).toMatch(/\.dock-update\s*\{\s*bottom:\s*max\(5rem,\s*calc\(var\(--dock-consent, 0px\) \+ 0\.5rem\)\);/);
    const videos = /\.dock-videos\s*\{([^}]*)\}/.exec(css)![1];
    expect(videos).toMatch(/calc\(3\.75rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(videos).toMatch(/var\(--dock-consent, 0px\)/);
    expect(videos).toMatch(/var\(--dock-update, 0px\)/);
    const fab = /\.dock-fab\s*\{([^}]*)\}/.exec(css)![1];
    for (const v of ["5rem", "--dock-consent", "--dock-update", "--dock-videos"]) expect(fab).toContain(v);
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{[^@]*\.dock-fab\s*\{\s*bottom:\s*1\.5rem;/);
  });

  it("the round buttons: Ask anything and Back to top sit above the dock, no fixed bottom-20 left", () => {
    const ask = read("src/components/AskAnything.tsx");
    expect(ask).toMatch(/className="fixed dock-fab right-4 lg:right-6/);
    expect(ask).not.toMatch(/className="fixed bottom-20/);
    const feed = read("src/pages/Feed.tsx");
    expect(feed).toMatch(/className="fixed dock-fab left-4/);
    expect(feed).not.toMatch(/className="fixed bottom-20/);
  });

  it("the layers publish: cookie banner (consent), update prompt (update), server-video card (videos)", () => {
    expect(read("src/components/CookieConsentBanner.tsx")).toMatch(/useDockLayer\("consent", dock, showBanner\)/);
    const update = read("src/components/AppUpdatePrompt.tsx");
    expect(update).toMatch(/useDockLayer\("update", dock, visible\)/);
    expect(update).toMatch(/className="fixed inset-x-3 dock-update /);
    const card = read("src/components/video/ServerVideoJobs.tsx");
    expect(card).toMatch(/useDockLayer\("videos", dock, jobs\.length > 0\)/);
    expect(card).toMatch(/className="dock-videos pointer-events-none fixed/);
  });
});
