import { Link, useLocation } from "react-router-dom";
import { Home, Trophy, Rss, LogIn, User, Newspaper, BookOpen, FileText } from "lucide-react";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { useAuth } from "@/hooks/core/useAuth";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import MobileProfileSheet from "@/components/MobileProfileSheet";
import { profilesPublic } from "@/lib/profilesPublic";
import { useT } from "@/i18n/I18nContext";

type Tab = {
  path: string;
  icon: any;
  label: string;
  labelKey?: string;
  auth?: boolean;
  guest?: boolean;
  isSheet?: boolean;
  isCenter?: boolean;
};

const MobileBottomNav = () => {
  const { user } = useAuth();
  const t = useT();
  const { pathname } = useLocation();
  const siteLogo = useSiteLogo();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [profileData, setProfileData] = useState<{ avatar_url: string | null; full_name: string | null } | null>(null);

  // Build tabs — Wall route depends on user.id, Home is the elevated center
  const tabs: Tab[] = [
    { path: "/feed", icon: Newspaper, label: "Feed", labelKey: "nav.feed", auth: true },
    { path: user ? `/profile/${user.id}?section=wall` : "/login", icon: Rss, label: "Wall", labelKey: "nav.wall", auth: true },
    { path: "/courses", icon: BookOpen, label: "Courses", labelKey: "nav.courses", guest: true },
    { path: "/journal", icon: FileText, label: "Journal", labelKey: "nav.journal", guest: true },
    { path: user ? "/home" : "/", icon: Home, label: "Home", labelKey: "nav.home", isCenter: true },
    { path: "/competitions", icon: Trophy, label: "Compete", labelKey: "nav.compete" },
    { path: "/login", icon: LogIn, label: "Join", labelKey: "nav.join", guest: true },
    { path: "/profile", icon: User, label: "Profile", labelKey: "nav.profile", auth: true, isSheet: true },
  ];

  useEffect(() => {
    if (!user) { setProfileData(null); return; }
    profilesPublic()
      .select("avatar_url, full_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfileData(data as any);
      });
  }, [user]);

  const initials = profileData?.full_name
    ? profileData.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : null;

  const visibleTabs = tabs.filter((t) => {
    if (t.guest) return !user;
    if (t.auth) return !!user;
    return true;
  });

  const hideRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"];
  if (hideRoutes.some((r) => pathname.startsWith(r))) return null;

  const isActive = (path: string, isCenter?: boolean) => {
    const cleanPath = path.split("?")[0];
    if (cleanPath === "/") return pathname === "/";
    if (isCenter) return pathname === "/";
    return pathname === cleanPath || pathname.startsWith(cleanPath + "/");
  };

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-card/60 backdrop-blur-2xl backdrop-saturate-150 border-t border-border/40 lg:hidden safe-area-bottom"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <div className="flex items-end justify-around h-14 px-1 relative">
          {visibleTabs.map((tab) => {
            const active = isActive(tab.path, tab.isCenter);

            // ── Centered, elevated Home button ──
            if (tab.isCenter) {
              return (
                <Link
                  key="home-center"
                  to={tab.path}
                  className="flex flex-col items-center justify-end flex-1 relative -mt-4 group"
                  aria-label="Home — 50mm Retina World"
                >
                  <div className="relative h-14 w-14 flex items-center justify-center">
                    {/* Soft glow halo — breathes in sync */}
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-primary/30 blur-md pointer-events-none"
                      animate={{ scale: [1, 1.18, 1], opacity: [0.35, 0.7, 0.35] }}
                      transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
                    />
                    {/* Logo button — gentle continuous breathe */}
                    <motion.div
                      animate={{ scale: [1, 1.08, 1] }}
                      transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
                      className={`relative h-12 w-12 rounded-full flex items-center justify-center shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.6)] ring-4 ring-background overflow-hidden ${
                        active
                          ? "bg-gradient-to-br from-primary to-primary/60"
                          : "bg-gradient-to-br from-primary/90 to-primary/55"
                      }`}
                    >
                      {siteLogo ? (
                        <img
                          src={siteLogo}
                          alt="50mm Retina World"
                          width={44}
                          height={44}
                          loading="eager"
                          decoding="async"
                          className="h-11 w-11 object-contain rounded-full [image-rendering:auto]"
                        />
                      ) : (
                        <Home className="h-5 w-5 text-primary-foreground stroke-[2.25]" />
                      )}
                    </motion.div>
                  </div>
                </Link>
              );
            }

            // ── Profile sheet button ──
            if (tab.isSheet) {
              return (
                <button
                  key="profile-sheet"
                  onClick={() => setSheetOpen(true)}
                  className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors duration-200 relative ${
                    sheetOpen || active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="bottomNavIndicator"
                      className="absolute -top-px left-1/4 right-1/4 h-0.5 bg-primary rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                  {profileData?.avatar_url ? (
                    <img loading="lazy" decoding="async"
                      src={profileData.avatar_url}
                      alt=""
                      className={`h-6 w-6 rounded-full object-cover ${active || sheetOpen ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "ring-1 ring-border"}`}
                    />
                  ) : initials ? (
                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold ${active || sheetOpen ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {initials}
                    </div>
                  ) : (
                    <User className={`h-5 w-5 ${active ? "stroke-[2.5]" : "stroke-[1.5]"}`} />
                  )}
                  <span className={`text-[9px] tracking-[0.1em] uppercase ${active ? "font-semibold" : "font-normal"}`}>
                    {t("nav.profile")}
                  </span>
                </button>
              );
            }

            // ── Standard tab ──
            return (
              <Link
                key={tab.label}
                to={tab.path}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors duration-200 relative ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="bottomNavIndicator"
                    className="absolute -top-px left-1/4 right-1/4 h-0.5 bg-primary rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
                <tab.icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : "stroke-[1.5]"}`} />
                <span className={`text-[9px] tracking-[0.1em] uppercase ${active ? "font-semibold" : "font-normal"}`}>
                  {tab.labelKey ? t(tab.labelKey) : tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      <MobileProfileSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
};

export default MobileBottomNav;
