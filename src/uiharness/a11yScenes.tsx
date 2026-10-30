/**
 * P23 · S10-a — the three A11Y-ONLY scenes (S10a-DECISION.md §2, Decision S2).
 *
 * Sign-up, edit profile and admin health are three of the ten primary
 * surfaces, but they fail the visual sweep's tap-target rule today and admin
 * health has no fixtures for its admin RPCs. Making them pass the sweep is
 * pixel / fixture work outside P23. So they live HERE, not in SCENES:
 *   • reachable by `?scene=<name>` (main.tsx looks here after SCENES);
 *   • NOT on the harness index (main.tsx lists SCENES only), so the visual
 *     sweep (capture.mjs reads the index links) and tools/uishot/baseline.json
 *     never see them;
 *   • addressed by name by tools/uishot/a11y-surfaces.mjs.
 * They join SCENES when their tap-target debt is cleared — a separate unit.
 */
import { lazy, type JSX } from "react";
import { screen } from "./realScreens";
import { useAuth } from "@/hooks/core/useAuth";

const Signup = lazy(() => import("@/pages/Signup"));
const EditProfile = lazy(() => import("@/pages/EditProfile"));
const AdminHealth = lazy(() => import("@/components/admin/AdminHealth"));
const AdminAppHealth = lazy(() => import("@/components/admin/AdminAppHealth"));

/** The admin panel's health tab, as AdminPanel.tsx renders it (currentRoute === "health"). */
function AdminHealthTab() {
  const { user } = useAuth();
  return (
    <div className="space-y-4">
      <AdminAppHealth />
      <AdminHealth user={user} />
    </div>
  );
}

export const A11Y_ONLY_SCENES: Record<string, () => JSX.Element> = {
  /** Signed OUT (sceneConfig.ts SIGNED_OUT_SCENES), like screen-login. */
  "screen-signup": () => screen(<Signup />, "/signup", "/signup", false),
  "screen-edit-profile": () => screen(<EditProfile />, "/edit-profile", "/edit-profile"),
  "screen-admin-health": () => screen(<AdminHealthTab />, "/admin", "/admin"),
};
