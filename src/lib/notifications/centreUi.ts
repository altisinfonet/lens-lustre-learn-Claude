/**
 * NOTIFICATION CENTRE (N7) — the member-screen switch.
 *
 * site_settings key `notif_centre_ui`:
 *   "on"                       → the new notification rows for everyone
 *   { "users": ["<id>", …] }   → only for those members (staged rollout, N8:
 *                                the Owner first, then a few, then everyone)
 *   no row / anything else     → today's screens, unchanged
 *
 * Same shape as the server switches (public.notification_centre_live), so the
 * Owner's rollout steps read the same for every part of the centre.
 */
import { useEffect, useState } from "react";
import { readSiteSettingState } from "@/lib/siteSettingsCache";

export const NOTIF_CENTRE_UI_KEY = "notif_centre_ui";

/** The one definition of "on" for a given member. Anything unrecognised is off. */
export function isCentreUiOn(value: unknown, userId: string | null | undefined): boolean {
  if (value === "on") return true;
  if (!userId || value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const users = (value as { users?: unknown }).users;
  return Array.isArray(users) && users.every((u) => typeof u === "string") && users.includes(userId);
}

/** Read the switch (at most a minute old). Unreadable → off: today's screens. */
export async function centreUiOn(userId: string | null | undefined): Promise<boolean> {
  try {
    const st = await readSiteSettingState(NOTIF_CENTRE_UI_KEY, { maxAgeMs: 60_000 });
    return st.known && isCentreUiOn(st.value, userId);
  } catch {
    return false;
  }
}

/** React: false until the switch is read as on for this member. */
export function useCentreUi(userId: string | null | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    setOn(false); // a new member starts on today's screens until their own answer arrives
    void centreUiOn(userId).then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, [userId]);
  return on;
}
