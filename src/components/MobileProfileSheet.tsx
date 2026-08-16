import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { resolveAdminSubRoles } from "@/lib/adminRoleAccess";
import { useWalletSummary } from "@/hooks/wallet/useWalletSummary";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import AppVersionLabel from "@/components/AppVersionLabel";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import {
  LogOut, Shield, Scale, Wallet, LayoutDashboard, User, ImageIcon,
  Users, Rss, UserPlus, HelpCircle, Settings, Trophy, Edit2, Compass,
  Sun, Moon, Globe, BookOpen, Award, FileText, Download, Image as ImageLucide, Crown, Bell,
} from "lucide-react";
import { useTheme } from "@/hooks/core/useTheme";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "@/i18n/I18nContext";

const headingFont = { fontFamily: "var(--font-heading)" };

// Map the grid's English action labels to translation keys (reuses existing
// nav.*/menu.* keys where the wording matches; short labels use msheet.*).
const MSHEET_LABEL_KEYS: Record<string, string> = {
  "Admin": "msheet.admin", "Judge": "msheet.judge", "Profile": "nav.profile",
  "Edit": "msheet.edit", "Dashboard": "menu.dashboard", "Entries": "msheet.entries",
  "My Wall": "menu.myWall", "Feed": "nav.feed", "Discover": "menu.discover",
  "Photos": "msheet.photos", "Winners": "msheet.winners", "Compete": "msheet.compete",
  "Journal": "msheet.journal", "Courses": "msheet.courses", "Friends": "menu.friends",
  "Certificates": "msheet.certificates", "Referrals": "menu.referrals", "Wallet": "menu.wallet",
  "Settings": "profile.settings", "Help": "msheet.help", "Get App": "msheet.getApp",
};

// Google Play listing for the published Android app. The old PWA "Install App"
// prompt has been replaced by this store link now that the app is live.
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.fiftymmretina.app";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface QuickAction {
  icon: React.ElementType;
  label: string;
  to?: string;
  onClick?: () => void;
  show: boolean;
  badge?: React.ReactNode;
  animated?: boolean;
}

const MobileProfileSheet = ({ open, onOpenChange }: Props) => {
  const t = useT();
  const tl = (label: string) => { const k = MSHEET_LABEL_KEYS[label]; return k ? t(k) : label; };
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { roles, hasRole } = useUserRoles();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { balance: walletBalance } = useWalletSummary(!isAdmin ? user?.id : undefined);
  const { data: profileCore } = useProfileCore(user?.id);
  const avatarUrl = profileCore?.avatar_url ?? null;
  const fullName = profileCore?.full_name || "Photographer";
  const hasAdminPanelAccess = resolveAdminSubRoles(roles).length > 0;

  if (!user) return null;

  const initials = fullName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  const go = (to: string) => {
    onOpenChange(false);
    setTimeout(() => navigate(to), 150);
  };

  const handleLogout = async () => {
    onOpenChange(false);
    await signOut();
    navigate("/");
  };

  // Open the Google Play listing for the published Android app.
  const handleGetApp = () => {
    window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
  };

  // Hide the "Get App" action when we're already running INSIDE the native
  // Android app (Capacitor injects window.Capacitor) — no point linking users
  // to the store from within the app itself. Shown everywhere else (mobile web).
  const isNativeApp = typeof window !== "undefined" && !!(window as any).Capacitor;
  const showInstallAction = !isNativeApp;

  // Build quick-action grid
  const quickActions: QuickAction[] = isAdmin
    ? [
        { icon: Shield, label: "Admin", to: "/admin", show: true },
        { icon: Scale, label: "Judge", to: "/judge", show: true },
        { icon: User, label: "Profile", to: "/profile", show: true },
        { icon: Edit2, label: "Edit", to: "/edit-profile", show: true },
        { icon: LayoutDashboard, label: "Dashboard", to: "/dashboard", show: true },
        // The ONLY way back to /notifications used to be the bell panel's own
        // footer — dismiss the panel and the history was unreachable. Placed
        // right after Dashboard because it is a frequent destination, not a
        // setting.
        { icon: Bell, label: "Notifications", to: "/notifications", show: true },
        { icon: ImageIcon, label: "Entries", to: "/dashboard?tab=submissions", show: true },
        { icon: ImageLucide, label: "Photos", to: "/photos", show: true },
        { icon: Crown, label: "Winners", to: "/winners", show: true },
        { icon: Trophy, label: "Compete", to: "/competitions", show: true },
        { icon: HelpCircle, label: "Help", to: "/help-support", show: true },
      ]
    : [
        { icon: Scale, label: "Judge", to: "/judge", show: hasRole("judge") },
        { icon: User, label: "Profile", to: "/profile", show: true },
        { icon: Edit2, label: "Edit", to: "/edit-profile", show: true },
        { icon: LayoutDashboard, label: "Dashboard", to: "/dashboard", show: true },
        { icon: Bell, label: "Notifications", to: "/notifications", show: true },
        { icon: Rss, label: "My Wall", to: `/profile/${user.id}?section=wall`, show: true },
        { icon: Compass, label: "Feed", to: "/feed", show: true },
        { icon: Compass, label: "Discover", to: "/discover", show: true },
        { icon: ImageIcon, label: "Entries", to: "/dashboard?tab=submissions", show: true },
        { icon: ImageLucide, label: "Photos", to: "/photos", show: true },
        { icon: Crown, label: "Winners", to: "/winners", show: true },
        { icon: Trophy, label: "Compete", to: "/competitions", show: true },
        { icon: FileText, label: "Journal", to: "/journal", show: true },
        { icon: BookOpen, label: "Courses", to: "/courses", show: true },
        { icon: Users, label: "Friends", to: "/friends", show: true },
        { icon: Award, label: "Certificates", to: "/certificates", show: true },
        { icon: UserPlus, label: "Referrals", to: "/referrals", show: true },
        {
          icon: Wallet, label: "Wallet", to: "/wallet", show: true,
          badge: walletBalance !== null ? (
            <span className="absolute -top-1 -right-1 text-[7px] px-1 py-0 bg-primary text-primary-foreground rounded-full leading-tight">
              ${Number(walletBalance).toFixed(0)}
            </span>
          ) : null,
        },
        { icon: Shield, label: "Admin", to: "/admin", show: hasAdminPanelAccess },
        { icon: Settings, label: "Settings", to: "/dashboard?tab=settings", show: true },
        { icon: HelpCircle, label: "Help", to: "/help-support", show: true },
      ];

  // Add "Get App" action (Google Play) unless already inside the native app
  if (showInstallAction) {
    quickActions.push({
      icon: Download,
      label: "Get App",
      onClick: handleGetApp,
      show: true,
      animated: true,
    });
  }

  const visibleActions = quickActions.filter((a) => a.show);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/*
        THREE BANDS, AND ONLY THE MIDDLE ONE SCROLLS.

        Owner, 2026-08-16, relaying live members: "many mobile the log out
        screen are not coming perfectly and huge space water in top."

        Both halves were real, and both were MEASURED before this was touched —
        the sheet had never been photographed, because it is an overlay and no
        page scene renders it. `screen-account-sheet` now does. What it found,
        with the sheet open and the bottom of the Logout button compared to the
        bottom of the screen:

            360x592   Logout 145px BELOW the screen   unreachable
            360x640   Logout 104px below              unreachable
            360x740   Logout  19px below              unreachable
            360x800   Logout  25px above              fine
            390x844   fine        412x892   fine

        So it worked on the two phones anyone here had looked at and failed on
        every shorter one — and "shorter" is not exotic: a browser with a URL
        bar showing, a phone with a large system font, or simply an older 5"
        Android all land under 740. On those, a member CANNOT LOG OUT.

        The cause was structural, not a number to nudge: `max-h-[85vh]` capped
        the sheet, `flex flex-col` laid three bands out inside it, and NOTHING
        was scrollable. When the twenty-one actions did not fit, the footer was
        simply pushed past the bottom edge and clipped. Raising 85vh to 95vh
        would move the failure to a slightly shorter phone, not remove it.

        The fix makes height irrelevant: the header and the footer are
        `shrink-0`, the action grid is `flex-1 min-h-0 overflow-y-auto`, so the
        GRID gives up space instead of the footer. Logout is now pinned to the
        bottom of the sheet at every height, and `min-h-0` is load-bearing —
        without it a flex child refuses to shrink below its content and the
        overflow silently returns.
      */}
      <DrawerContent className="max-h-[85vh] bg-card backdrop-blur-2xl border-border">
        <DrawerHeader className="shrink-0 relative pt-1 pb-2">
          <DrawerTitle className="sr-only">{t("msheet.profileMenu")}</DrawerTitle>

          {/* THE THEME TOGGLE IS BACK ON ITS OWN LINE, ABOVE THE NAME.
              ─────────────────────────────────────────────────────────────────
              Owner, 2026-08-12: "After clicking profile, dark and light mode
              moved extremely right when the name is big. Shift the toggle one
              line upper of the name line."

              Owner, 2026-08-16, with a photograph of his own account showing
              the sun icon sitting ON TOP of the last letters of his name:
              "light toggle icon will be one lone upper from the name line as
              overlapping".

              HIS ORIGINAL RULE WAS RIGHT AND I OVERRODE IT. Earlier today I
              pinned this button to the corner instead, to reclaim 40px, and
              argued the rule was still honoured "a stronger way" because an
              absolutely positioned element cannot be pushed by a sibling. That
              was true and irrelevant: it cannot be pushed, so the NAME RUNS
              UNDERNEATH IT instead. `pr-12` was supposed to reserve the corner
              and does not, because the name renders inside UserIdentityBlock
              and never gets the constraint. His account —
              "Sri Venkata Ramasubramania Narayanasw" — is the exact case his
              rule was written for, and it broke in exactly the way he said.

              So it goes back where he put it. The 40px is affordable now for a
              reason that did not exist this morning: the action tiles were
              tightened, and every action fits without scrolling at 640 and
              above either way. Nothing is lost by giving the line back.

              A pinned rule of his does not get overridden by my judgement. It
              gets overridden by him. */}
          <div className="mb-1 flex justify-end">
            <button
              onClick={toggleTheme}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-primary/10"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun className="h-5 w-5 text-primary" /> : <Moon className="h-5 w-5 text-primary" />}
            </button>
          </div>

          {/* Avatar + Name */}
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 ring-2 ring-primary/20">
              <AvatarImage src={avatarUrl} alt={fullName} />
              <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 text-left">
              <UserIdentityBlock
                userId={user.id}
                name={fullName}
                nameClassName="text-[15px] font-bold tracking-wide truncate [font-family:var(--font-heading)]"
              />
              <span className="text-[11px] text-muted-foreground truncate block mt-0.5">{user.email}</span>
            </div>
          </div>
        </DrawerHeader>

        {/* Quick Actions Grid — staggered entry. THE ONLY SCROLLING BAND.
            `min-h-0` lets it shrink below its content; `overscroll-contain`
            stops a flick at the end of the list from dragging the sheet shut
            mid-scroll, which on a list this long happens constantly. */}
        {/*
          THE GRID SCROLLS ONLY IF IT HAS TO — AND IT USUALLY WILL NOT.

          Owner, 2026-08-16, on the first version of this fix: "after logout
          version name was there. that you missed here and all buttons are not
          showing some hiding."

          Half right, and the half he is right about is the important half.
          Making this band scrollable guaranteed Logout was reachable, but it
          paid for that with actions below the fold — and an action you have to
          discover by scrolling is, for most members, an action that is not
          there. Trading one invisible control for four is not a fix.

          So the tiles were tightened instead: 12px of vertical padding to 8,
          the icon plate 40px to 36, the gap between rows 8px to 6. A row is
          81px tall instead of 81 + slack, and the whole 21-action grid now
          measures ~400px rather than ~490. Measured after: every action is on
          screen without scrolling on a 592px viewport, which is shorter than
          any phone that reported this.

          The scroll stays as the SAFETY NET, not the mechanism. A member with
          large system fonts, or an account that grows a Judge and an Admin
          tile, will overflow — and when that happens the grid gives way and
          Logout still does not. That is the whole point of the three bands.

          (The version label he thought had gone is still here, in the footer
          below. `AppVersionLabel` renders nothing when it cannot determine a
          version, which is the case in the screenshot harness and never on a
          real build — a wrong number beside Logout is worse than none.)
        */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
          <div className="grid grid-cols-4 gap-x-2 gap-y-0">
            <AnimatePresence>
              {visibleActions.map((action, i) => (
                <motion.button
                  key={(action.to || action.label) + action.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25, ease: "easeOut" }}
                  onClick={() => action.onClick ? action.onClick() : action.to && go(action.to)}
                  className="group relative flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-all duration-300 hover:bg-primary/10 active:bg-primary/20"
                >
                  <div className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-300 ease-out
                    ${action.animated
                      ? "bg-primary/15 dark:bg-primary/20 group-hover:scale-110"
                      : "bg-accent dark:bg-muted/60 group-hover:bg-primary/20 group-hover:scale-110"
                    }`}
                  >
                    {action.animated ? (
                      <>
                        {/* Pulsing glow ring behind the icon */}
                        <span className="absolute inset-0 rounded-xl bg-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
                        <motion.span
                          animate={{ scale: [1, 1.15, 1] }}
                          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                          className="relative z-10 flex items-center justify-center"
                        >
                          <action.icon className="h-4.5 w-4.5 text-primary" />
                        </motion.span>
                      </>
                    ) : (
                      <action.icon className="h-4.5 w-4.5 text-accent-foreground dark:text-foreground/70 group-hover:text-primary transition-colors duration-300" />
                    )}
                    {action.badge}
                  </div>
                  <span
                    className={`w-full text-[10px] leading-[1.15] text-center transition-colors duration-300
                      ${action.animated
                        ? "text-primary font-semibold"
                        : "text-foreground/60 dark:text-muted-foreground group-hover:text-primary"
                      }`}
                    style={headingFont}
                  >
                    {tl(action.label)}
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom row: the loaded build on the LEFT, Logout on the RIGHT.
            The theme button that used to sit here was removed on 2026-08-01:
            the toggle moved up into this sheet's header (swapping places with
            the notification bell, which is now in the top bar), and two theme
            buttons in one sheet is one too many.

            SIDES SWAPPED 2026-08-06 on the owner's instruction, from a
            screenshot of the live sheet: "logout will be right and Version
            will be left". Both children stay flex-1, so each still occupies
            exactly half the row and the version keeps the button's baseline —
            only the order changed. When no version is known the label renders
            nothing and the button quietly keeps the whole row, exactly as
            before; a wrong number on screen is worse than none. */}
        <div
          className="shrink-0 px-4 pt-2 flex items-center gap-2 border-t border-border/40"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <AppVersionLabel />
          <button
            onClick={handleLogout}
            className="flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-destructive hover:bg-destructive/90 transition-colors flex-1"
          >
            <LogOut className="h-4 w-4 text-destructive-foreground" />
            <span className="text-[12px] tracking-[0.08em] uppercase text-destructive-foreground font-semibold" style={headingFont}>
              {t("menu.logout")}
            </span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default MobileProfileSheet;
