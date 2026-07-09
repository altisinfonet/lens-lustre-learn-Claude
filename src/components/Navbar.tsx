import { useState, useEffect, useRef } from "react";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { Link, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Menu, X, Sun, Moon, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/core/useAuth";
import GlobalSearch from "@/components/GlobalSearch";
import { useTheme } from "@/hooks/core/useTheme";
import UserMenu from "@/components/UserMenu";
import LanguagePicker from "@/components/LanguagePicker";
import NotificationBell from "@/components/NotificationBell";
import { useNavigationMenu, type MenuTree } from "@/hooks/core/useNavigationMenu";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import * as LucideIcons from "lucide-react";

interface NavbarProps {
  transparent?: boolean;
}

/** Dynamically resolve a lucide icon by name */
const DynIcon = ({ name, className }: { name: string; className?: string }) => {
  const Icon = (LucideIcons as any)[name];
  return Icon ? <Icon className={className} /> : null;
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
  const siteLogo = useSiteLogo();
  const { isAdmin } = useIsAdmin();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { menuTree, loading } = useNavigationMenu();
  const [openMegaId, setOpenMegaId] = useState<string | null>(null);
  const megaTimeout = useRef<ReturnType<typeof setTimeout>>();
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

  // Close mega menu on route change
  useEffect(() => {
    setOpenMegaId(null);
    setMobileMenuOpen(false);
  }, [location.pathname]);

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
          {item.label}
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
          {item.label}
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
                  {item.label}
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
                            <LucideIcons.ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
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
            : "sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
        }`}
        aria-label="Main navigation"
      >
        <div className="container mx-auto py-3 md:py-5 flex items-center justify-between">
          {/* Logo */}
          <Link to={logoHref} className="flex items-center gap-2 md:gap-3 shrink-0 relative z-10" aria-label="50mm Retina World Home">
            <img src={siteLogo} alt="50mm Retina World" className={`${transparent ? "h-14 w-14 md:h-20 md:w-20" : "h-8 w-8 md:h-12 md:w-12"} object-contain`} />
            {!transparent && (
              <span
                className="text-[11px] md:text-sm font-semibold tracking-[0.2em] uppercase"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                50mm Retina World
              </span>
            )}
          </Link>

          {/* Desktop links */}
          <div
            className="hidden lg:flex items-center gap-5 xl:gap-8 text-xs tracking-[0.15em] uppercase flex-shrink-0"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {loading
              ? fallbackLinks.map((l) => (
                  <NavLink key={l.to} to={l.to} className="hover:opacity-60 transition-opacity duration-500" activeClassName="text-primary">
                    {l.label}
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
            <LanguagePicker />
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
                  Login
                </Link>
                <Link
                  to="/signup"
                  className="text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-foreground/30 hover:bg-foreground hover:text-background transition-all duration-700"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Join
                </Link>
              </>
            )}
          </div>

          {/* Mobile right actions */}
          <div className="flex items-center gap-2 lg:hidden">
            <LanguagePicker compact />
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full border border-border hover:border-primary hover:text-primary transition-all duration-500"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {user && <GlobalSearch />}
          </div>
        </div>
      </nav>
    </>
  );
};

export default Navbar;
