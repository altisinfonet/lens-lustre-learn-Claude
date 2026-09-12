/**
 * F-89 — HOW A PAGE ASKS FOR THE BARE SHELL, WITHOUT THE LAYOUT KNOWING ITS PATH.
 *
 * `Layout.tsx` decides the two-column feed shell by PATH MATCHING against
 * `hideSidebarRoutes`. That works for pages with a fixed address and cannot
 * work for the 404, which occurs at an ARBITRARY path and so can never appear
 * on any list.
 *
 * It is worse than that, and this is the part a route-list fix would have
 * silently failed: since F-85/F-86 the 404 is reachable TWO ways —
 *
 *   1. the catch-all `<Route path="*" element={<NotFound />} />` in App.tsx, and
 *   2. rendered IN PLACE by CustomUrlProfile when a vanity URL resolves to
 *      nothing, at the member's own typed path.
 *
 * Both land inside the same `<Outlet />`. Nothing about the URL distinguishes
 * case 2 from a real member profile, so ONLY THE COMPONENT ITSELF knows which
 * is rendering. Hence a flag the page raises, rather than a list the layout
 * consults.
 *
 * ⚠ useLayoutEffect, NOT useEffect. A layout effect runs after render and
 * BEFORE PAINT, so the shell is already gone on the first frame the visitor
 * sees. With useEffect the sidebars would be painted once and then removed —
 * a visible flash of exactly the clutter this unit exists to delete.
 */
import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

interface BareLayoutValue {
  /** True while a mounted page has asked for the bare shell. */
  bare: boolean;
  setBare: (b: boolean) => void;
}

const BareLayoutContext = createContext<BareLayoutValue>({ bare: false, setBare: () => {} });

export const BareLayoutProvider = ({ children }: { children: ReactNode }) => {
  const [bare, setBare] = useState(false);
  const value = useMemo(() => ({ bare, setBare }), [bare]);
  return <BareLayoutContext.Provider value={value}>{children}</BareLayoutContext.Provider>;
};

/**
 * Called by a page that wants the header and footer only. The cleanup matters:
 * without it the next page rendered into the same Outlet would inherit the bare
 * shell and quietly lose its sidebars.
 */
export const useBareShell = () => {
  const { setBare } = useContext(BareLayoutContext);
  useLayoutEffect(() => {
    setBare(true);
    return () => setBare(false);
  }, [setBare]);
};

/** Read by Layout only. */
export const useIsBareShell = () => useContext(BareLayoutContext).bare;
