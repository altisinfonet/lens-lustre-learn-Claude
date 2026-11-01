/**
 * N7b · the ONE way notification-centre rows are split into sections.
 *
 * Used by the bell's panel and by /notifications alike (notif_centre_ui on),
 * so the two can never sort the same notifications differently again. The
 * bell used to sort by category ("Reactions", "Followers" …) while the page
 * sorted by time — the Owner saw two different screens for one inbox.
 *
 * A section is about WHEN, never about what kind (the kind is the row's
 * badge): New · This week · Last 30 days · Earlier. "New" is everything still
 * unread (bucketFor's honest rule — no curated "highlights"); the rest go by
 * the age of the group's latest event.
 */
import { bucketFor, type NotificationGroup } from "@/lib/notificationText";
import { inTab, type NotificationTab } from "@/lib/notifications/tabs";
import { isNativeIOSApp } from "@/lib/native/authDeepLink";
import { isWalletNotificationType } from "@/lib/native/iosReview";

export type CentreSectionKey = "new" | "week" | "last30" | "earlier";

export const CENTRE_SECTION_ORDER: CentreSectionKey[] = ["new", "week", "last30", "earlier"];

const LABEL: Record<CentreSectionKey, string> = {
  new: "New",
  week: "This week",
  last30: "Last 30 days",
  earlier: "Earlier",
};

export interface CentreSection<G extends NotificationGroup = NotificationGroup> {
  key: CentreSectionKey;
  /** i18n key + English fallback for the heading. */
  label: { key: string; fallback: string };
  groups: G[];
}

/** App Store 3.1.1: no wallet notifications in the iOS app — the same rule on every surface. */
export function visibleCentreGroups<G extends NotificationGroup>(groups: G[]): G[] {
  const ios = isNativeIOSApp();
  return ios ? groups.filter((g) => !isWalletNotificationType(g.type)) : groups;
}

export function centreSectionFor(group: NotificationGroup, now: Date = new Date()): CentreSectionKey {
  const bucket = bucketFor(group, now);
  if (bucket !== "last30") return bucket;
  const ageDays = (now.getTime() - new Date(group.latest_at).getTime()) / 86_400_000;
  return ageDays <= 7 ? "week" : "last30";
}

/** Non-empty sections, in order, holding only the rows of the chosen tab. */
export function centreSections<G extends NotificationGroup>(
  groups: G[],
  tab: NotificationTab = "all",
  now: Date = new Date(),
): CentreSection<G>[] {
  const map = new Map<CentreSectionKey, G[]>(CENTRE_SECTION_ORDER.map((k) => [k, []]));
  for (const g of groups) if (inTab(g.type, tab)) map.get(centreSectionFor(g, now))!.push(g);
  return CENTRE_SECTION_ORDER.filter((k) => map.get(k)!.length > 0).map((k) => ({
    key: k,
    label: { key: `notifications.bucket.${k}`, fallback: LABEL[k] },
    groups: map.get(k)!,
  }));
}
