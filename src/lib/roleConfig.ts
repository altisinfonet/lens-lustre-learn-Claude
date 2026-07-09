// Role configuration for display alongside usernames
// Maps user_roles.role values to visual styling

export const ROLE_TYPES = ["admin", "judge", "content_editor", "registered_photographer", "student", "user"] as const;

export type RoleType = (typeof ROLE_TYPES)[number];

export interface RoleConfig {
  type: RoleType;
  label: string;
  /** Tailwind classes for compact inline pill */
  pillClass: string;
  /** Emoji/icon shorthand */
  icon: string;
  /** Whether to show this role inline (admin is hidden — uses brand name instead) */
  showInline: boolean;
}

export const ROLES: Record<RoleType, RoleConfig> = {
  admin: {
    type: "admin",
    label: "Admin",
    pillClass: "bg-red-500/15 text-red-600 border-red-500/30",
    icon: "🛡",
    showInline: false, // admin identity handled via brand name
  },
  judge: {
    type: "judge",
    label: "Judge",
    pillClass: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    icon: "⚖",
    showInline: true,
  },
  content_editor: {
    type: "content_editor",
    label: "Editor",
    pillClass: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
    icon: "✎",
    showInline: true,
  },
  registered_photographer: {
    type: "registered_photographer",
    label: "Photographer",
    pillClass: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    icon: "📷",
    showInline: true,
  },
  student: {
    type: "student",
    label: "Student",
    pillClass: "bg-sky-500/15 text-sky-600 border-sky-500/30",
    icon: "🎓",
    showInline: true,
  },
  user: {
    type: "user",
    label: "User",
    pillClass: "bg-muted text-muted-foreground border-border",
    icon: "",
    showInline: false, // default role, no need to display
  },
};
