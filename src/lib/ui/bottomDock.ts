/**
 * THE BOTTOM DOCK — one order for everything that floats over the bottom of
 * the screen, so no two layers ever overlap.
 *
 * Owner, on review of #423: no overlapping UI. On a phone the server-video
 * card sat over the home page's "Ask anything" button (and over the feed's
 * Back-to-top button, the cookie banner and the app-update prompt). Each was
 * placed on its own, with a fixed offset from the bottom bar; nothing knew
 * about anything else.
 *
 * From the bottom up, on a phone:
 *
 *   bottom bar · cookie banner · app-update prompt · server-video card · round buttons
 *                (--dock-consent)  (--dock-update)     (--dock-videos)    (Ask anything, Back to top)
 *
 * A page that has its OWN bar across the bottom (the judge screen's Prev /
 * Next actions) publishes it as --dock-bar, and the card and the round buttons
 * clear it the same way (review #423 finding 12).
 *
 * A layer that is SHOWING publishes, on <html>, how far its top edge sits
 * above the bottom of the screen. The CSS in index.css (.dock-update,
 * .dock-videos, .dock-fab) places each layer at max(its own usual offset,
 * the edge of every layer below + 0.5rem). Nothing published = 0px: with
 * nothing docked, every element sits exactly where it always has. On a
 * computer the card and the cookie banner share the bottom-left corner and
 * the round buttons keep the bottom-right one.
 *
 * The edge is the layer's RESTING position — its computed `bottom` plus its
 * layout height — never getBoundingClientRect(): the banners slide in with a
 * transform, and a mid-animation rectangle would publish the wrong edge.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

export type DockLayer = "consent" | "update" | "videos" | "bar";

/** The custom property a layer publishes. */
export const dockProperty = (layer: DockLayer) => `--dock-${layer}`;

/** A layer's top edge above the bottom of the screen, in whole px: its own `bottom` plus its height. */
export function dockEdge(el: HTMLElement): number {
  const bottom = parseFloat(getComputedStyle(el).bottom);
  return Math.ceil((Number.isFinite(bottom) ? bottom : 0) + el.offsetHeight);
}

/**
 * Publish `layer`'s edge while `showing`, and keep it true: when the layer
 * changes size (a card added, a title wrapping), when the screen changes (a
 * breakpoint), and when a layer BELOW it moves — that edge is part of this
 * layer's own `bottom`, so a change on <html> re-measures it. Removed when
 * the layer goes, so the layers above drop back to their usual places.
 *
 * `version`: anything that changes when the caller KNOWS its size changed (the
 * number of cards, open or folded). The observers already see that; where
 * there is no ResizeObserver (an old WebView) this is what re-publishes
 * (review #423 finding 10). Both runs happen before the next paint.
 */
export function useDockLayer(layer: DockLayer, ref: RefObject<HTMLElement | null>, showing: boolean, version: string | number = 0): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const prop = dockProperty(layer);
    const el = ref.current;
    if (!showing || !el) {
      root.style.removeProperty(prop);
      return;
    }
    const publish = () => {
      const next = `${dockEdge(el)}px`;
      // Unchanged → no write, so the layers re-measuring each other always settle.
      if (root.style.getPropertyValue(prop) !== next) root.style.setProperty(prop, next);
    };
    publish();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    resize?.observe(el);
    const below = typeof MutationObserver === "function" ? new MutationObserver(publish) : null;
    below?.observe(root, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", publish);
    return () => {
      resize?.disconnect();
      below?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(prop);
    };
  }, [layer, ref, showing, version]);
}

/**
 * True while any of `layers` is showing — for a layer that takes less room
 * when one below it is up (the server-video card folds to one line while the
 * cookie banner or the update prompt is on a phone's screen). Follows <html>'s
 * style, where the layers publish; state changes only when the answer does.
 */
export function useDockShowing(layers: readonly DockLayer[]): boolean {
  const key = layers.join(",");
  const read = () => key.split(",").some((l) => document.documentElement.style.getPropertyValue(`--dock-${l}`) !== "");
  const [showing, setShowing] = useState(read);
  useEffect(() => {
    const sync = () => setShowing(read());
    sync();
    if (typeof MutationObserver !== "function") return;
    const seen = new MutationObserver(sync);
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => seen.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` is rebuilt from `key` alone
  }, [key]);
  return showing;
}
