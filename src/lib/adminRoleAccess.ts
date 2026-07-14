/**
 * Admin Role-Based Access Control (RBAC)
 *
 * Maps admin sub-roles to the tabs they can access.
 * "super_admin" (any user with "admin" role) has full access.
 * Other roles get restricted module sets.
 */

export type AdminSubRole = "super_admin" | "moderator" | "finance" | "content_editor" | "judge";

/** Tab keys that exist in AdminPanel */
export type AdminTab =
  | "health" | "notifications_health" | "test_agent" | "analytics" | "admin_notifications" | "activity_logs"
  | "banners" | "potd" | "portfolio" | "on_page_images" | "featured_artist"
  | "journal" | "courses" | "certificates" | "excellence"
  | "competitions" | "competition_health" | "entries" | "judging_tags" | "tag_semantics" | "round_visibility" | "judge_monitoring" | "vote_audit" | "judge_activity" | "vote_rewards" | "verification_requests"
  | "users" | "applications" | "referrals" | "engagement"
  | "employee"
  | "comments" | "keyword_blocklist" | "reports" | "post_reports"
  | "wallet" | "gifts" | "transactions" | "orders"
  | "seo" | "advertisements" | "performance" | "announcements" | "newsletter_faq"
  | "page_management" | "menu_builder" | "redirects"
  | "settings" | "auth_pages" | "email_templates" | "database"
  | "support_tickets" | "user_guide";

/** Tabs accessible per sub-role */
const ROLE_TAB_ACCESS: Record<AdminSubRole, AdminTab[] | "all"> = {
  super_admin: "all",

  moderator: [
    "comments", "keyword_blocklist", "reports", "post_reports",
    "users", "applications", "engagement",
    "support_tickets", "admin_notifications", "activity_logs",
  ],

  finance: [
    "wallet", "gifts", "transactions", "orders", "referrals",
    "analytics", "admin_notifications",
  ],

  content_editor: [
    "banners", "potd", "portfolio", "on_page_images", "featured_artist",
    "journal", "courses", "certificates", "excellence",
    "seo", "advertisements", "announcements", "newsletter_faq",
    "page_management", "menu_builder", "redirects",
    "admin_notifications",
  ],

  judge: [
    "competitions", "competition_health", "entries", "judging_tags", "tag_semantics",
    "judge_monitoring", "vote_audit", "judge_activity", "vote_rewards",
    "admin_notifications",
  ],
};

/**
 * Determine which admin sub-role(s) a user has based on their user_roles.
 * "admin" role → super_admin (full access).
 * Other roles map directly.
 */
export function resolveAdminSubRoles(roles: string[]): AdminSubRole[] {
  const subRoles: AdminSubRole[] = [];
  if (roles.includes("admin")) subRoles.push("super_admin");
  if (roles.includes("content_editor")) subRoles.push("content_editor");
  if (roles.includes("judge")) subRoles.push("judge");
  if (roles.includes("moderator")) subRoles.push("moderator");
  if (roles.includes("finance")) subRoles.push("finance");
  // If no recognized sub-roles found, return empty — caller must handle no-access state
  return subRoles;
}

/**
 * Check if a user with given sub-roles can access a specific tab.
 */
export function canAccessTab(subRoles: AdminSubRole[], tab: AdminTab): boolean {
  return subRoles.some((role) => {
    const access = ROLE_TAB_ACCESS[role];
    return access === "all" || access.includes(tab);
  });
}

/**
 * Filter tab groups to only show tabs the user can access.
 */
export function filterTabGroups<T extends { items: readonly (readonly [string, ...any[]])[] }>(
  groups: T[],
  subRoles: AdminSubRole[]
): T[] {
  // Super admin sees everything
  if (subRoles.includes("super_admin")) return groups;

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(([key]) => canAccessTab(subRoles, key as AdminTab)),
    }))
    .filter((group) => group.items.length > 0) as T[];
}
