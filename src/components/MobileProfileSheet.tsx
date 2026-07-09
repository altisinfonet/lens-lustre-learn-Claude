import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { resolveAdminSubRoles } from "@/lib/adminRoleAccess";
import { useWalletSummary } from "@/hooks/wallet/useWalletSummary";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { usePwaInstall } from "@/hooks/core/usePwaInstall";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import NotificationBell from "@/components/NotificationBell";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import {
  LogOut, Shield, Scale, Wallet, LayoutDashboard, User, ImageIcon,
  Users, Rss, UserPlus, HelpCircle, Settings, Trophy, Edit2, Compass,
  Sun, Moon, Globe, BookOpen, Award, FileText, Download, Share, Image as ImageLucide, Crown,
} from "lucide-react";
import { useTheme } from "@/hooks/core/useTheme";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

const headingFont = { fontFamily: "var(--font-heading)" };

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
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { roles, hasRole } = useUserRoles();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { balance: walletBalance } = useWalletSummary(!isAdmin ? user?.id : undefined);
  const { data: profileCore } = useProfileCore(user?.id);
  const { canInstall, isIos, isInstalled, promptInstall } = usePwaInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);
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

  const handleInstall = async () => {
    if (canInstall) {
      await promptInstall();
    } else {
      // Show manual install guide for the user's browser
      setShowIosGuide(true);
    }
  };

  const isAndroid = /android/i.test(navigator.userAgent);

  // MobileProfileSheet is only rendered on mobile viewports, so always show install action
  const showInstallAction = !isInstalled;

  // Build quick-action grid
  const quickActions: QuickAction[] = isAdmin
    ? [
        { icon: Shield, label: "Admin", to: "/admin", show: true },
        { icon: Scale, label: "Judge", to: "/judge", show: true },
        { icon: User, label: "Profile", to: "/profile", show: true },
        { icon: Edit2, label: "Edit", to: "/edit-profile", show: true },
        { icon: LayoutDashboard, label: "Dashboard", to: "/dashboard", show: true },
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

  // Add install action if available
  if (showInstallAction) {
    quickActions.push({
      icon: isIos ? Share : Download,
      label: "Install App",
      onClick: handleInstall,
      show: true,
      animated: true,
    });
  }

  const visibleActions = quickActions.filter((a) => a.show);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh] bg-card backdrop-blur-2xl border-border">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="sr-only">Profile Menu</DrawerTitle>

          {/* Avatar + Name */}
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14 ring-2 ring-primary/20">
              <AvatarImage src={avatarUrl} alt={fullName} />
              <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 text-left">
              <UserIdentityBlock
                userId={user.id}
                name={fullName}
                nameClassName="text-sm font-bold tracking-wide truncate [font-family:var(--font-heading)]"
              />
              <span className="text-[9px] text-muted-foreground truncate block mt-0.5">{user.email}</span>
            </div>
            <div className="relative">
              <span className="absolute inset-0 rounded-full ring-2 ring-primary animate-ping opacity-30" />
              <NotificationBell />
            </div>
          </div>
        </DrawerHeader>

        {/* Quick Actions Grid — staggered entry */}
        <div className="px-4 pb-2">
          <div className="grid grid-cols-4 gap-2">
            <AnimatePresence>
              {visibleActions.map((action, i) => (
                <motion.button
                  key={(action.to || action.label) + action.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25, ease: "easeOut" }}
                  onClick={() => action.onClick ? action.onClick() : action.to && go(action.to)}
                  className="group relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl hover:bg-primary/10 active:bg-primary/20 transition-all duration-300"
                >
                  <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ease-out
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
                    className={`text-[9px] tracking-[0.05em] uppercase leading-tight text-center transition-colors duration-300
                      ${action.animated
                        ? "text-primary font-semibold"
                        : "text-foreground/60 dark:text-muted-foreground group-hover:text-primary"
                      }`}
                    style={headingFont}
                  >
                    {action.label}
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Install guide toast */}
        <AnimatePresence>
          {showIosGuide && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="mx-4 mb-2 p-3 rounded-xl bg-primary/10 border border-primary/20"
            >
              <p className="text-[10px] text-foreground/80 leading-relaxed" style={headingFont}>
                {isIos ? (
                  <>
                    Tap <Share className="inline h-3 w-3 text-primary mx-0.5" /> in Safari, then select{" "}
                    <strong className="text-primary">"Add to Home Screen"</strong>
                  </>
                ) : isAndroid ? (
                  <>
                    Tap the <strong className="text-primary">⋮ menu</strong> in Chrome, then select{" "}
                    <strong className="text-primary">"Install app"</strong> or{" "}
                    <strong className="text-primary">"Add to Home Screen"</strong>
                  </>
                ) : (
                  <>
                    Open your browser menu and select{" "}
                    <strong className="text-primary">"Install"</strong> or{" "}
                    <strong className="text-primary">"Add to Home Screen"</strong>
                  </>
                )}
              </p>
              <button
                onClick={() => setShowIosGuide(false)}
                className="mt-1.5 text-[8px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                style={headingFont}
              >
                Got it
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom row: Theme + Logout */}
        <div className="px-4 pb-6 pt-2 flex items-center gap-2 border-t border-border/40">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent dark:bg-muted/40 hover:bg-accent/80 dark:hover:bg-muted/70 transition-colors flex-1"
          >
            {theme === "dark" ? <Sun className="h-4 w-4 text-primary" /> : <Moon className="h-4 w-4 text-primary" />}
            <span className="text-[9px] tracking-[0.1em] uppercase text-foreground/60 dark:text-muted-foreground" style={headingFont}>
              {theme === "dark" ? "Light" : "Dark"}
            </span>
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive hover:bg-destructive/90 transition-colors flex-1"
          >
            <LogOut className="h-4 w-4 text-destructive-foreground" />
            <span className="text-[9px] tracking-[0.1em] uppercase text-destructive-foreground font-semibold" style={headingFont}>
              Logout
            </span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default MobileProfileSheet;
