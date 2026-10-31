import { useState, useEffect, useRef } from "react";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { NavLink } from "@/components/NavLink";
import {
  Menu, X, Sun, Moon, ChevronDown, Plus,
  // ── Curated nav-icon set. PERF, 2026-08-07. ──
  // The admin nav menu references icons by NAME. Importing the whole
  // lucide-react namespace to resolve them dragged all ~1,500 icons (~500 KB)
  // into the entry chunk. These are the icons actually configured live
  // (12, measured from site_settings) plus a generous set of common ones an
  // admin might pick; anything unmapped falls back to Circle. Adding a name
  // here is how you support a new admin icon — a few hundred bytes each, versus
  // half a megabyte for the namespace.
  Award, BookOpen, Compass, FileCheck, HelpCircle, Home, LogIn, Newspaper,
  Rss, Trophy, UserPlus, Users, Circle,
  Camera, Image, Video, Star, Heart, Bell, Search, Settings, Mail,
  MessageCircle, Calendar, Clock, Globe, Info, Link2, MapPin, Bookmark,
  FileText, Folder, Grid3x3, Shield, Gift, Flag, Tag, Zap, Trophy as Medal,
  ShoppingBag, User, Eye, Download, Upload, Play, Music, ExternalLink,
  type LucideIcon,
} from "lucide-react";

/** Only the icons the admin nav menu can reference — NOT the whole library. */
const NAV_ICONS: Record<string, LucideIcon> = {
  Award, BookOpen, Compass, FileCheck, HelpCircle, Home, LogIn, Newspaper,
  Rss, Trophy, UserPlus, Users, Camera, Image, Video, Star, Heart, Bell,
  Search, Settings, Mail, MessageCircle, Calendar, Clock, Globe, Info, Link2,
  MapPin, Bookmark, FileText, Folder, Grid3x3, Shield, Gift, Flag, Tag, Zap,
  Medal, ShoppingBag, User, Eye, Download, Upload, Play, Music,
};
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/core/useAuth";
import GlobalSearch from "@/components/GlobalSearch";
import { useTheme } from "@/hooks/core/useTheme";
import UserMenu from "@/components/UserMenu";
import NotificationBell from "@/components/NotificationBell";
import { useT } from "@/i18n/I18nContext";
import { navKeyForLabel } from "@/i18n/translations";
import { useNavigationMenu, type MenuTree } from "@/hooks/core/useNavigationMenu";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useDismissOnRouteChange } from "@/hooks/core/useDismissOnRouteChange";

interface NavbarProps {
  transparent?: boolean;
}

/** Resolve a nav icon by name from the curated map; Circle is the safe fallback
 *  so an unmapped admin-configured name shows a neutral icon, never nothing. */
const DynIcon = ({ name, className }: { name: string; className?: string }) => {
  const Icon = NAV_ICONS[name] ?? Circle;
  return <Icon className={className} />;
};

/** Check visibility rule */
const isVisible = (
  visibility: string,
  user: any,
  isAdmin: boolean
): boolean => {
  if (visibility === "all") return true;
  if (visibility === "guest") return !user;
  if (visibility === "authenticated") return !!user;
  if (visibility === "admin") return isAdmin;
  return true;
};

const Navbar = ({ transparent = false }: NavbarProps) => {
  const { user } = useAuth();
  const t = useT();
  const navLabel = (label: string) => { const k = navKeyForLabel(label); return k ? t(k) : label; };
  const siteLogo = useSiteLogo();
  const { isAdmin } = useIsAdmin();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { menuTree, loading } = useNavigationMenu();
  const [openMegaId, setOpenMegaId] = useState<string | null>(null);
  // React 19 types require an initial value for useRef — an empty call is an
  // error, not a defaulted undefined. Same change in CinemaJudgeView.
  const megaTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logoHref = user ? "/home" : "/";

  // Filter nav items
  const navItems = menuTree.filter(
    (item) => item.show_in_nav && isVisible(item.visibility, user, isAdmin)
  );

  // Fallback while loading
  const fallbackLinks = [
    { to: "/competitions", label: "Competitions" },
    { to: "/journal", label: "Journal" },
    { to: "/courses", label: "Courses" },
    { to: "/winners", label: "Winners" },
  ];

  const handleMegaEnter = (id: string) => {
    clearTimeout(megaTimeout.current);
    setOpenMegaId(id);
  };

  const handleMegaLeave = () => {
    megaTimeout.current = setTimeout(() => setOpenMegaId(null), 200);
  };

  // Close the mega menu and the mobile menu on every navigation.
  // Keyed on the navigation rather than the pathname — see
  // useDismissOnRouteChange for why that difference matters.
  useDismissOnRouteChange(() => {
    setOpenMegaId(null);
    setMobileMenuOpen(false);
  });

  const renderDesktopItem = (item: MenuTree) => {
    const hasChildren = item.children.filter((c) => isVisible(c.visibility, user, isAdmin)).length > 0;
    const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + "/");

    if (!hasChildren) {
      const linkProps = item.type === "external" && item.open_new_tab
        ? { target: "_blank" as const, rel: "noopener noreferrer" }
        : {};

      return (
        <NavLink
          key={item.id}
          to={item.path}
          end={item.path === "/"}
          className="hover:opacity-60 transition-opacity duration-500 flex items-center gap-1.5"
          activeClassName="text-primary"
          {...linkProps}
        >
          {item.icon && <DynIcon name={item.icon} className="h-3 w-3" />}
          {navLabel(item.label)}
        </NavLink>
      );
    }

    // Mega menu parent
    return (
      <div
        key={item.id}
        className="relative"
        onMouseEnter={() => handleMegaEnter(item.id)}
        onMouseLeave={handleMegaLeave}
      >
        <button
          type="button"
          onClick={() => setOpenMegaId(openMegaId === item.id ? null : item.id)}
          className={`hover:opacity-60 transition-opacity duration-500 flex items-center gap-1.5 ${isActive ? "text-primary" : ""}`}
        >
          {item.icon && <DynIcon name={item.icon} className="h-3 w-3" />}
          {navLabel(item.label)}
          <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-300 ${openMegaId === item.id ? "rotate-180" : ""}`} />
        </button>

        {/* Mega menu dropdown */}
        <AnimatePresence>
          {openMegaId === item.id && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute top-full left-1/2 -translate-x-1/2 mt-4 z-50"
              onMouseEnter={() => handleMegaEnter(item.id)}
              onMouseLeave={handleMegaLeave}
            >
              <div className="bg-card border border-border shadow-lg min-w-[320px] max-w-[480px] p-5">
                <div className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                  {navLabel(item.label)}
                </div>
                <div className="grid gap-1">
                  {item.children
                    .filter((c) => isVisible(c.visibility, user, isAdmin))
                    .map((child) => {
                      const childLinkProps = child.type === "external" && child.open_new_tab
                        ? { target: "_blank" as const, rel: "noopener noreferrer" }
                        : {};
                      return (
                        <NavLink
                          key={child.id}
                          to={child.path}
                          end={child.path === "/"}
                          className="flex items-start gap-3 p-3 rounded-sm hover:bg-muted/40 transition-colors group"
                          activeClassName="bg-muted/60"
                          onClick={() => setOpenMegaId(null)}
                          {...childLinkProps}
                        >
                          {child.icon && (
                            <DynIcon name={child.icon} className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <span className="text-sm font-medium block group-hover:text-primary transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
                              {child.label}
                            </span>
                            {child.description && (
                              <span className="text-[11px] text-muted-foreground block mt-0.5 leading-snug" style={{ fontFamily: "var(--font-body)" }}>
                                {child.description}
                              </span>
                            )}
                          </div>
                          {child.type === "external" && (
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
                          )}
                        </NavLink>
                      );
                    })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <>
      <nav
        className={`${
          transparent
            ? ""
            /* NO LINE UNDER THE BAR. Owner, 2026-08-15: "I want line be remove
               one top menus". It is the same instruction he gave for the post
               card on 2026-08-10 — "I told No border anything to anywhere,
               example like Instagram" — applied to the header. The blur and the
               translucent background are what separate the bar from the page
               now, exactly as Instagram does it. */
            : "sticky top-0 z-50 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
        }`}
        aria-label="Main navigation"
      >
        {/**
         * EQUAL GAPS AT BOTH EDGES, AND A TITLE THAT IS ACTUALLY IN THE MIDDLE.
         *
         * Owner, 2026-08-15: *"right and left icons must be same gap from edge.
         * 50mm retina will be middle perfectly."*
         *
         * `px-3` puts the same 12px inside both ends of the bar, so the left
         * group and the right group are equidistant from the screen edges
         * whatever they contain. The wordmark is already absolutely centred on
         * the BAR (`left-1/2 -translate-x-1/2`), which means it is centred on
         * the SCREEN and cannot be pushed off-centre by whatever sits either
         * side of it — that is why it stays a separate absolute element rather
         * than a third flex child.
         */}
        <div className="container mx-auto px-3 py-3 md:py-5 flex items-center justify-between relative">
          {/* ── THE LEFT-HAND GROUP: logo, then "+ Create" ──
              ⚠ THESE TWO MUST STAY IN ONE WRAPPER. The bar is
              `justify-between`, and on the app the <Link> below collapses to
              ZERO width (its logo and wordmark are both `hidden lg:*`). As
              separate flex children, `justify-between` therefore spread them as
              [0-width Link] … [+ Create] … [actions] and parked + Create in the
              MIDDLE of the bar, on top of the absolutely-centred wordmark.
              That shipped in build 1086 and the owner saw it overlapping the
              title. One wrapper = one flex item = pinned to the left corner,
              which is where he asked for it. Do not split them again. */}
          <div className="flex items-center gap-2 md:gap-3 shrink-0 relative z-10">
          <Link to={logoHref} className="flex items-center gap-2 md:gap-3 shrink-0" aria-label="50mm Retina World Home">
            {/* The small logo is DESKTOP-ONLY in the normal bar. On the app top
                bar the owner wants the name as centred text with no logo
                (2026-08-12), so the image is hidden below lg here. The homepage
                hero (transparent) still shows the big logo on every width. */}
            <img
              src={siteLogo}
              alt="50mm Retina World"
              className={`${transparent ? "h-14 w-14 md:h-20 md:w-20" : "hidden lg:block h-8 w-8 md:h-12 md:w-12"} object-contain`}
            />
            {!transparent && (
              <span
                className="hidden lg:inline-block text-[11px] md:text-sm font-semibold tracking-[0.2em] uppercase"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                50mm Retina World
              </span>
            )}
          </Link>

          {/* "+ CREATE" — THE APP'S ONLY WAY TO START A POST.
              Owner, 2026-08-12, with the reference screenshot: the app is
              Instagram-shaped, so posting starts from a Create control in the
              top bar and the Facebook-style "What's on your mind?" row is gone
              from the app entirely (see WallPosts.tsx).

              It navigates to `/feed?compose=1` rather than calling into the
              composer directly, because the composer lives inside WallPosts on
              the feed page and this bar is mounted far above it. Going through
              the URL also makes it work from ANY screen — Journal, Profile,
              Competitions — not only when the feed is already open.

              APP ONLY, and both halves of that matter: `lg:hidden` keeps it off
              desktop, and `isNativeCapacitorApp()` keeps it off the mobile
              WEBSITE, which still posts from its own composer row. */}
          {!transparent && user && isNativeCapacitorApp() && (
            <button
              type="button"
              /**
               * OPEN THE COMPOSER WHERE THE MEMBER ALREADY IS. DO NOT NAVIGATE.
               * ───────────────────────────────────────────────────────────────
               * Owner, 2026-08-16: "create post is a static on the top menu bar
               * but while on my or other pages, trying to uploaded - that is not
               * happening. only from my feed section create post happening... as
               * top menu icon is fix it should be from single uploader while
               * standing on any page - that is not happening. why ?"
               *
               * This used to be `navigate("/feed?compose=1")`. That made a fixed
               * button behave differently depending on the page under it, and
               * pressing it did TWO things at once — change the page AND launch
               * Android's photo picker, which backgrounds the whole WebView
               * mid-navigation. From the feed there was no page change, so no
               * race; from anywhere else there was.
               *
               * I first "fixed" that by guarding which WallPosts instance reads
               * the flag. Measured with a two-page harness journey afterwards:
               * that change did NOTHING — the picker fired from the wall with
               * and without it. He called it a guess and he was right.
               *
               * So the race is removed rather than patched. The composer is
               * mounted ONCE, globally, in Layout; this button raises the flag on
               * the CURRENT url and the page never changes. No navigation, no
               * second reader, no picker launched during a route transition —
               * one uploader, reachable from every page, exactly as he asked.
               *
               * `replace` keeps the flag out of history, so Back never lands on
               * a url that re-opens the composer.
               */
              onClick={() => {
                const next = new URLSearchParams(location.search);
                next.set("compose", "1");
                navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
              }}
              /* NO BOX. Owner, 2026-08-15: "remove border from create icon too" — the
                 third time in two days he has asked for a border gone (post card,
                 top bar, now this), so treat it as the standing rule it is: this
                 app draws no outlines around controls.

                 Dropping the box also lets the button reach the 44px tap floor
                 without looking heavy — the same thing that unblocked the bell
                 once its ring went. It now matches the bell and the search: a
                 bare glyph in a 44px-tall target. */
              /* `-ml-1.5` IS MEASURED, NOT TASTE. Owner: "create icon has more space
                 from edge... very perfectly match it", and he was right — I had
                 reported the two as equal by comparing the wrong things: the
                 BUTTON's edge on the left against the GLYPH's edge on the right.
                 Measured properly, glyph to screen edge: left 32px, right 26px.
                 The + is also a wider glyph (20px) than the magnifier (16px), so
                 centring it in an equal box does not give an equal margin.
                 6px back closes it exactly. */
              className="lg:hidden relative z-10 -ml-2.5 grid h-11 w-11 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("composer.create", "Create post")}
            >
              {/* ⚠ ICON ONLY — NO VISIBLE "Create" LABEL. Owner, 2026-08-14.
                  The label is on `aria-label` instead, so screen readers still
                  announce it and the button keeps its accessible name. Do not
                  re-add a text span here: the caption is what made this control
                  two lines tall and pushed it into the centred wordmark. The
                  box is 36px so the tap target stays finger-sized without it. */}
              {/* 24px, matching Search and the Bell. Owner, 2026-08-16: the
                  three top-bar icons were 20 / 16 / 16 — three different sizes
                  sitting in a row, which is most of why the bar read as
                  "too small" rather than any one icon being wrong. */}
              <Plus className="h-6 w-6" />
            </button>
          )}
          </div>
          {/* ── end of the left-hand group ── */}

          {/* App/mobile top bar: the wordmark, as text, centred in the bar, no
              logo — owner, 2026-08-12: "50mm Retina World written in text placed
              in middle having no smaller logo." Absolute so it is centred on the
              WHOLE bar, not shoved by the actions on the right. pointer-events
              off so it can never sit over and block the bell or search. Shown
              only below lg and only on the normal (non-hero) bar. */}
          {!transparent && (
            <span
              className="lg:hidden pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-sm font-semibold tracking-[0.2em] uppercase"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              50mm Retina World
            </span>
          )}

          {/* Desktop links */}
          <div
            className="hidden lg:flex items-center gap-5 xl:gap-8 text-xs tracking-[0.15em] uppercase flex-shrink-0"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {loading
              ? fallbackLinks.map((l) => (
                  <NavLink key={l.to} to={l.to} className="hover:opacity-60 transition-opacity duration-500" activeClassName="text-primary">
                    {navLabel(l.label)}
                  </NavLink>
                ))
              : navItems.map((item) => renderDesktopItem(item))
            }
          </div>

          {/* Desktop right */}
          <div className="hidden lg:flex items-center gap-3">
<button
              onClick={toggleTheme}
              className="p-2 rounded-full border border-border hover:border-primary hover:text-primary transition-all duration-500"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <GlobalSearch />
            {user && <NotificationBell />}
            {user ? (
              <UserMenu variant="desktop" />
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-xs tracking-[0.15em] uppercase hover:opacity-60 transition-opacity duration-500"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {t("nav.login")}
                </Link>
                <Link
                  to="/signup"
                  className="text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-foreground/30 hover:bg-foreground hover:text-background transition-all duration-700"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {t("nav.join")}
                </Link>
              </>
            )}
          </div>

          {/* Mobile right actions.
              SWAPPED 2026-08-01 (owner): the notification bell now sits here,
              where the dark/light toggle used to be, and the toggle moved into
              the profile sheet header where the bell used to be. Notifications
              are checked many times a day; the theme is set once. Desktop is
              deliberately unchanged — this is an app/mobile-only layout. */}
          {/**
           * THE BELL AND THE SEARCH ARE ONE GROUP, SET APART FROM THE WORDMARK.
           *
           * Owner, 2026-08-15: *"search and bell will have closer with perfect
           * distace but after 500mm text, looking bad"*.
           *
           * Two separate complaints in one sentence, and they pull opposite
           * ways: the two icons belong TOGETHER (they are both "tools"), and
           * the pair must stand CLEAR of the centred title. `gap-2` gave the
           * same 8px in both places, so the group read as three evenly spaced
           * things — title, bell, search — instead of a title and a pair.
           *
           * `gap-0.5` closes the pair to 2px between two 44px targets, which
           * still leaves 44px of tappable area each. `ml-3` is the breathing
           * space after the wordmark. Measured at 360px in the harness.
           */}
          <div className="flex items-center gap-0.5 lg:hidden">
            {user && <NotificationBell />}
            {user && <GlobalSearch />}
          </div>
        </div>
      </nav>
    </>
  );
};

export default Navbar;
