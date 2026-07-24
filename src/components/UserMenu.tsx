import { Link, useNavigate } from "react-router-dom";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { resolveAdminSubRoles } from "@/lib/adminRoleAccess";
import { useState } from "react";
import { useWalletSummary } from "@/hooks/wallet/useWalletSummary";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { useT } from "@/i18n/I18nContext";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  LogOut, Shield, Scale, Wallet, LayoutDashboard, User, ImageIcon,
  Users, MessageSquare, Compass, Rss, UserPlus, HelpCircle, Settings,
  Trophy, Edit2, Award, Camera,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface UserMenuProps {
  onNavigate?: () => void;
  variant?: "desktop" | "mobile";
}

interface MenuSection {
  title: string;
  items: { icon: React.ElementType; label: string; to: string; show: boolean; tooltip?: string; extra?: React.ReactNode }[];
}

const UserMenu = ({ onNavigate, variant = "desktop" }: UserMenuProps) => {
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { roles, hasRole } = useUserRoles();
  const navigate = useNavigate();
  const { balance: walletBalance } = useWalletSummary(!isAdmin ? user?.id : undefined);
  const [open, setOpen] = useState(false);
  const { data: profileCore } = useProfileCore(user?.id);
  const avatarUrl = profileCore?.avatar_url ?? null;
  const hasAdminPanelAccess = resolveAdminSubRoles(roles).length > 0;

  if (!user) return null;

  const fullName = profileCore?.full_name || "Photographer";
  const initials = fullName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  const roleBadge = hasRole("admin") ? (
    <Badge variant="default" className="text-[9px] px-1.5 py-0">Admin</Badge>
  ) : hasRole("judge") ? (
    <Badge variant="default" className="text-[9px] px-1.5 py-0 bg-accent text-accent-foreground">Judge</Badge>
  ) : hasRole("registered_photographer") ? (
    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Photographer</Badge>
  ) : hasRole("student") ? (
    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Student</Badge>
  ) : (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0">Guest</Badge>
  );

  const handleNav = (to: string) => { setOpen(false); onNavigate?.(); navigate(to); };
  const handleLogout = async () => { setOpen(false); onNavigate?.(); await signOut(); navigate("/"); };

  const t = useT();
  const MENU_LABEL_KEYS: Record<string, string> = {
    "Admin Panel": "menu.adminPanel", "Judge Panel": "menu.judgePanel", "Profile": "nav.profile",
    "Edit Profile": "menu.editProfile", "Dashboard": "menu.dashboard", "My Submissions": "menu.mySubmissions",
    "Competitions": "nav.competitions", "Help & Support": "menu.helpSupport", "Feed": "nav.feed",
    "Discover": "menu.discover", "My Wall": "menu.myWall", "My Photos": "menu.myPhotos",
    "My Certificates": "menu.myCertificates", "Friends": "menu.friends", "Referrals": "menu.referrals",
    "Wallet": "menu.wallet", "Settings": "profile.settings",
  };
  const MENU_SECTION_KEYS: Record<string, string> = {
    "Admin": "menu.sec.admin", "Account": "menu.sec.account", "Judge": "menu.sec.judge",
    "Main": "menu.sec.main", "My Content": "menu.sec.myContent", "Social": "menu.sec.social",
  };
  const tm = (map: Record<string, string>, s: string) => { const k = map[s]; return k ? t(k) : s; };
  const sections: MenuSection[] = isAdmin ? [
    {
      title: "Admin",
      items: [
        { icon: Shield, label: "Admin Panel", to: "/admin", show: true, tooltip: "Manage the platform" },
        { icon: Scale, label: "Judge Panel", to: "/judge", show: true, tooltip: "Review entries" },
      ],
    },
    {
      title: "Account",
      items: [
        { icon: User, label: "Profile", to: "/profile", show: true, tooltip: "View your profile" },
        { icon: Edit2, label: "Edit Profile", to: "/edit-profile", show: true, tooltip: "Update your info" },
        { icon: LayoutDashboard, label: "Dashboard", to: "/dashboard?tab=overview", show: true, tooltip: "Your home base" },
        { icon: ImageIcon, label: "My Submissions", to: "/dashboard?tab=submissions", show: true, tooltip: "Competition entries" },
        { icon: Trophy, label: "Competitions", to: "/competitions", show: true, tooltip: "Browse & enter" },
        { icon: HelpCircle, label: "Help & Support", to: "/help-support", show: true, tooltip: "Get assistance" },
      ],
    },
  ] : [
    ...(hasRole("judge") ? [{
      title: "Judge",
      items: [
        { icon: Scale, label: "Judge Panel", to: "/judge", show: true, tooltip: "Review & score entries" },
      ],
    }] : []),
    {
      title: "Main",
      items: [
        { icon: LayoutDashboard, label: "Dashboard", to: "/dashboard", show: true, tooltip: "Your home base" },
        { icon: Rss, label: "Feed", to: "/feed", show: true, tooltip: "Latest updates" },
        { icon: Compass, label: "Discover", to: "/discover", show: true, tooltip: "Find photographers" },
      ],
    },
    {
      title: "My Content",
      items: [
        { icon: ImageIcon, label: "My Submissions", to: "/dashboard?tab=submissions", show: true, tooltip: "Competition entries" },
        { icon: MessageSquare, label: "My Wall", to: `/profile/${user.id}?section=wall`, show: true, tooltip: "Your posts & updates" },
        { icon: Camera, label: "My Photos", to: "/photos", show: true, tooltip: "Your photo collection" },
        { icon: Trophy, label: "Competitions", to: "/competitions", show: true, tooltip: "Browse & enter" },
        { icon: Award, label: "My Certificates", to: "/certificates", show: true, tooltip: "Your achievements" },
      ],
    },
    {
      title: "Social",
      items: [
        { icon: Users, label: "Friends", to: "/friends", show: true, tooltip: "Manage connections" },
        { icon: UserPlus, label: "Referrals", to: "/referrals", show: true, tooltip: "Invite & earn" },
      ],
    },
    {
      title: "Account",
      items: [
        { icon: User, label: "Profile", to: "/profile", show: true, tooltip: "View your profile" },
        { icon: Edit2, label: "Edit Profile", to: "/edit-profile", show: true, tooltip: "Update your info" },
        {
          icon: Wallet, label: "Wallet", to: "/wallet", show: true, tooltip: "Balance & transactions",
          extra: walletBalance !== null ? (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary rounded-full" style={{ fontFamily: "var(--font-heading)" }}>
              {formatUSDFixed(Number(walletBalance))}
            </span>
          ) : null,
        },
        { icon: Shield, label: "Admin Panel", to: "/admin", show: hasAdminPanelAccess, tooltip: "Open your assigned admin modules" },
        { icon: Settings, label: "Settings", to: "/dashboard?tab=settings", show: true, tooltip: "Account settings" },
        { icon: HelpCircle, label: "Help & Support", to: "/help-support", show: true, tooltip: "Get assistance" },
      ],
    },
  ];

  // Mobile variant: render items inline (no Popover)
  if (variant === "mobile") {
    return (
      <div className="space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={avatarUrl} alt={fullName} />
            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <UserIdentityBlock
              userId={user.id}
              name={fullName}
              nameClassName="text-xs font-semibold tracking-wide truncate [font-family:var(--font-heading)]"
            />
          </div>
        </div>

        {sections.map((section, sIdx) => (
          <div key={section.title}>
            {sIdx > 0 && <div className="my-1 border-t border-border" />}
            <div className="pt-1.5 pb-0.5">
              <span className="text-[8px] tracking-[0.25em] uppercase text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>{tm(MENU_SECTION_KEYS, section.title)}</span>
            </div>
            {section.items.filter(i => i.show).map((item) => (
              <button
                key={item.to + item.label}
                onClick={() => handleNav(item.to)}
                className="w-full flex items-center gap-2.5 py-2 text-sm hover:text-primary transition-colors text-left group"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <item.icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-[10px] tracking-[0.1em] uppercase flex-1">{tm(MENU_LABEL_KEYS, item.label)}</span>
                {item.extra}
              </button>
            ))}
          </div>
        ))}

        <div className="border-t border-border pt-1 mt-1">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 py-2 text-sm hover:text-destructive transition-colors text-left text-destructive"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="text-[10px] tracking-[0.1em] uppercase">{t("menu.logout")}</span>
          </button>
        </div>
      </div>
    );
  }

  // Desktop variant: Popover dropdown
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-full border border-border hover:border-primary transition-all duration-300 p-0.5 pr-3 cursor-pointer" aria-label="User menu">
          <Avatar className="h-8 w-8">
            <AvatarImage src={avatarUrl} alt={fullName} />
            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <span className="text-[11px] tracking-[0.12em] uppercase font-medium hidden sm:inline" style={{ fontFamily: "var(--font-heading)" }}>{initials}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0 rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-muted/40 to-transparent">
          <div className="flex items-center gap-2.5">
            <Avatar className="h-9 w-9 ring-2 ring-primary/20">
              <AvatarImage src={avatarUrl} alt={fullName} />
              <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <UserIdentityBlock
                userId={user.id}
                name={fullName}
                nameClassName="text-xs font-semibold tracking-wide truncate text-foreground [font-family:var(--font-heading)]"
              />
            </div>
          </div>
        </div>

        {/* Menu sections — themed scrollbar */}
        <TooltipProvider delayDuration={400}>
          <div
            className="max-h-[60vh] overflow-y-auto py-1"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: "hsl(var(--primary) / 0.25) transparent",
            }}
          >
              {sections.map((section, sIdx) => (
                <div key={section.title}>
                  {sIdx > 0 && <div className="my-1 mx-3 border-t border-border/30" />}
                  <div className="px-4 pt-2 pb-0.5">
                    <span className="text-[8px] tracking-[0.25em] uppercase text-muted-foreground/50" style={{ fontFamily: "var(--font-heading)" }}>{tm(MENU_SECTION_KEYS, section.title)}</span>
                  </div>
                  {section.items.filter(i => i.show).map((item) => (
                    <Tooltip key={item.to + item.label}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleNav(item.to)}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-primary/8 transition-all duration-200 text-left group rounded-sm mx-0"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          <item.icon className="h-3.5 w-3.5 text-muted-foreground/70 group-hover:text-primary transition-colors duration-200" />
                          <span className="text-[10px] tracking-[0.1em] uppercase flex-1 text-foreground/80 group-hover:text-foreground transition-colors duration-200">{tm(MENU_LABEL_KEYS, item.label)}</span>
                          {item.extra}
                        </button>
                      </TooltipTrigger>
                      {item.tooltip && (
                        <TooltipContent side="left" className="text-[10px] bg-popover border-border/50">{item.tooltip}</TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
              ))}
          </div>
        </TooltipProvider>

        {/* Logout */}
        <div className="border-t border-border/40 py-1 bg-muted/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-destructive/10 transition-all duration-200 text-left text-destructive/80 hover:text-destructive"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="text-[10px] tracking-[0.1em] uppercase">{t("menu.logout")}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default UserMenu;
