/**
 * N7b · the ONE way notification-centre rows are split into sections.
 *
 * Used by the bell's panel and by /notifications alike (notif_centre_ui on),
 * so the two can never sort the same notifications differently again. The
 * bell used to sort by category ("Reactions", "Followers" …) while the page
 * sorted by time — the Owner saw two different screens for one inbox.
 *
 * A section is about WHEN, never about what kind: the kind is on the row.
 */
import { bucketFor, BUCKET_LABEL, type BucketKey, type NotificationGroup } from "@/lib/notificationText";
import { inTab, type NotificationTab } from "@/lib/notifications/tabs";
import { isNativeIOSApp } from "@/lib/native/authDeepLink";
import { isWalletNotificationType } from "@/lib/native/iosReview";

export type CentreSectionKey = BucketKey;

export const CENTRE_SECTION_ORDER: CentreSectionKey[] = ["new", "last30", "earlier"];

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

/** Non-empty sections, in order, holding only the rows of the chosen tab. */
export function centreSections<G extends NotificationGroup>(
  groups: G[],
  tab: NotificationTab = "all",
  now: Date = new Date(),
): CentreSection<G>[] {
  const map = new Map<CentreSectionKey, G[]>(CENTRE_SECTION_ORDER.map((k) => [k, []]));
  for (const g of groups) if (inTab(g.type, tab)) map.get(bucketFor(g, now))!.push(g);
  return CENTRE_SECTION_ORDER.filter((k) => map.get(k)!.length > 0).map((k) => ({
    key: k,
    label: { key: `notifications.bucket.${k}`, fallback: BUCKET_LABEL[k] },
    groups: map.get(k)!,
  }));
}
