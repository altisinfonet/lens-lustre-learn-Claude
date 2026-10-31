/**
 * N7 · Notification settings as ONE table (shown when notif_centre_ui is on).
 *
 * Rows are the kinds of notification a member gets; columns are where it can
 * reach them: Bell (in the app), Phone (push), E-mail. A cell is a switch,
 * "Always on" (the member cannot opt out — safety and money messages), or "—"
 * (that kind never goes there). One master switch above the table covers EVERY
 * phone notification; while it is off, the whole Phone column is greyed.
 *
 * Every switch writes an existing notification_preferences column — the same
 * columns the old three lists wrote — so switching the new screen on or off
 * never loses a member's choices. The weekly summary e-mail is not offered
 * until it exists (N4). "New photos from people you follow" has a Phone
 * switch (push_new_posts): the push trigger reads it for new_post_from_following
 * (git 20260815064043, measured live by N0), as today's page offers it. Its bell
 * setting is the followers one (inapp_social, as in the registry) and it has
 * no e-mail. (An earlier version of this comment said the trigger never reads
 * push_new_posts; that was wrong and dropped the switch.)
 * With the master switch off nothing is pushed at all — so no Phone cell may
 * say "Always on" then; it says "Off".
 */
import type { NotificationPreferences } from "@/hooks/notifications/useNotificationPreferences";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/I18nContext";

type Col = keyof NotificationPreferences;
/** `same` names the ROW whose setting this cell shares (its key). */
type Cell = Col | "always" | "none" | { same: string };
interface Row { key: string; label: string; bell: Cell; phone: Cell; email: Cell }

const ROWS: Row[] = [
  { key: "reactions", label: "Likes on your photos", bell: "inapp_reactions", phone: "push_reactions", email: "email_reactions" },
  { key: "comments", label: "Comments and replies", bell: "inapp_comments", phone: "push_comments", email: "email_comments" },
  { key: "followers", label: "New followers", bell: "inapp_social", phone: "push_new_followers", email: "email_new_followers" },
  { key: "friends", label: "Friend requests", bell: { same: "followers" }, phone: "push_friend_requests", email: "email_friend_requests" },
  { key: "new_posts", label: "New photos from people you follow", bell: { same: "followers" }, phone: "push_new_posts", email: "none" },
  { key: "competitions", label: "Competitions", bell: "inapp_competitions", phone: "push_competition_updates", email: "email_competition_updates" },
  { key: "announcements", label: "Announcements (Journal, courses)", bell: "always", phone: "push_announcements", email: "email_course_updates" },
  { key: "gifts", label: "Gift credits", bell: "always", phone: "always", email: "email_gift_credits" },
  { key: "certificates", label: "Certificates", bell: "always", phone: "always", email: "email_certificates" },
  { key: "reminders", label: "Reminders to share your photos", bell: "none", phone: "none", email: "email_reengagement" },
  { key: "safety", label: "Account and security, support replies, results", bell: "always", phone: "always", email: "always" },
];

const COLS = [
  { key: "bell", label: "Bell" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "E-mail" },
] as const;

export default function NotificationSettingsTable({
  preferences,
  onChange,
}: {
  preferences: NotificationPreferences;
  onChange: (field: Col, value: boolean) => void;
}) {
  const t = useT();
  const pushOn = preferences.push_enabled;

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3 cursor-pointer">
        <span>
          <span className="block text-sm font-medium text-foreground">{t("notif.table.pushAll", "All phone notifications")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("notif.table.pushAllDesc", "Off means no phone notification of any kind. Bell and e-mail are not affected.")}
          </span>
        </span>
        <Switch
          checked={pushOn}
          onCheckedChange={(v) => onChange("push_enabled", v)}
          aria-label={t("notif.table.pushAll", "All phone notifications")}
        />
      </label>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={t("notif.table.caption", "Notification settings")}>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-medium">
                <span className="sr-only">{t("notif.table.kind", "Kind of notification")}</span>
              </th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className="py-2 px-2 font-medium text-center">
                  {t(`notif.table.col.${c.key}`, c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {ROWS.map((r) => {
              const label = t(`notif.table.row.${r.key}`, r.label);
              return (
                <tr key={r.key}>
                  <th scope="row" className="py-3 pr-2 text-left font-normal text-foreground">{label}</th>
                  {COLS.map((c) => {
                    const cell = r[c.key];
                    const colLabel = t(`notif.table.col.${c.key}`, c.label);
                    return (
                      <td key={c.key} className="py-3 px-2 text-center">
                        {cell === "always" ? (
                          <span className="text-xs text-muted-foreground">
                            {c.key === "phone" && !pushOn ? t("notif.table.off", "Off") : t("notif.table.always", "Always on")}
                          </span>
                        ) : cell === "none" ? (
                          <span className="text-xs text-muted-foreground">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{t("notif.table.none", "Not sent here")}</span>
                          </span>
                        ) : typeof cell === "object" ? (
                          <span className="text-xs text-muted-foreground">
                            {t("notif.table.same", "Same as")}{" "}
                            {t(`notif.table.row.${cell.same}`, ROWS.find((x) => x.key === cell.same)?.label ?? cell.same)}
                          </span>
                        ) : (
                          <Switch
                            checked={preferences[cell]}
                            disabled={c.key === "phone" && !pushOn}
                            onCheckedChange={(v) => onChange(cell, v)}
                            aria-label={`${label} — ${colLabel}`}
                            className="tap-44"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
