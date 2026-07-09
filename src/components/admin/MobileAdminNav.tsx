import { useState, useEffect, useRef } from "react";
import { Search, X, ArrowLeft, Home, Bell, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

interface TabGroup {
  label: string;
  items: readonly (readonly [string, string, LucideIcon])[];
}

interface Props {
  tab: string;
  setTab: (t: string) => void;
  tabGroups: TabGroup[];
  unresolvedTicketCount: number;
  stats: { users: number; entries: number; competitions: number; tickets: number };
  menuVisible: boolean;
  setMenuVisible: (v: boolean) => void;
}

/* ─── "Menu-First" layout (Facebook ≡ style) ──────────────────
   • Landing = full-page grid of all admin sections
   • Tap a card → loads that section, top bar shows ← back
   • No bottom bar – pure scroll & tap
   ──────────────────────────────────────────────────────────── */

const MENU_KEY = "__menu__";

export default function MobileAdminNav({ tab, setTab, tabGroups, unresolvedTicketCount, stats, menuVisible: showMenu, setMenuVisible: setShowMenu }: Props) {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const allItems = tabGroups.flatMap(g =>
    g.items.map(i => ({ key: i[0], label: i[1], Icon: i[2], group: g.label }))
  );

  const filtered = searchQuery.trim()
    ? allItems.filter(i =>
        i.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.group.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const currentItem = allItems.find(i => i.key === tab);

  const handleSelectSection = (key: string) => {
    setTab(key);
    setShowMenu(false);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const handleBackToMenu = () => {
    setShowMenu(true);
  };

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  return (
    <div className="md:hidden">
      {/* ── Top Bar ── */}
      <div className="sticky top-0 z-40 bg-card/95 backdrop-blur-xl border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Left: Back button (to menu or to site) */}
          {showMenu ? (
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
            >
              <Home className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={handleBackToMenu}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}

          {/* Center: Title / Breadcrumb */}
          <div className="flex-1 min-w-0">
            {showMenu ? (
              <h1 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                Admin Panel
              </h1>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleBackToMenu}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Admin
                </button>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                <span className="text-xs text-primary font-medium truncate" style={{ fontFamily: "var(--font-heading)" }}>
                  {currentItem?.label}
                </span>
              </div>
            )}
          </div>

          {/* Right: Search + Notifications */}
          <button
            onClick={() => { setSearchOpen(!searchOpen); setSearchQuery(""); }}
            className={`shrink-0 transition-colors ${searchOpen ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
          >
            {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <div className="relative shrink-0">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {unresolvedTicketCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
                {unresolvedTicketCount}
              </span>
            )}
          </div>
        </div>

        {/* Search Bar (expandable) */}
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden border-t border-border/50"
            >
              <div className="px-4 py-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search sections…"
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
                {searchQuery.trim() && (
                  <div className="mt-2 max-h-[50vh] overflow-y-auto space-y-0.5">
                    {filtered.length > 0 ? filtered.map(item => (
                      <button
                        key={item.key}
                        onClick={() => handleSelectSection(item.key)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-muted/30 active:bg-muted/50"
                      >
                        <item.Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground">{item.label}</span>
                        <span className="ml-auto text-[9px] text-muted-foreground/40 uppercase tracking-wider">{item.group}</span>
                      </button>
                    )) : (
                      <p className="text-center text-sm text-muted-foreground py-6">No sections found</p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Stats Bar (visible on menu grid only) */}
        {showMenu && !searchOpen && (
          <div className="flex items-center border-t border-border/50">
            {[
              { label: "Users", value: stats.users, color: "text-primary" },
              { label: "Entries", value: stats.entries, color: "text-primary" },
              { label: "Contests", value: stats.competitions, color: "text-primary" },
              { label: "Tickets", value: stats.tickets, color: stats.tickets > 0 ? "text-destructive" : "text-primary" },
            ].map((stat, i) => (
              <div key={stat.label} className={`flex-1 text-center py-2 ${i > 0 ? "border-l border-border/50" : ""}`}>
                <div className={`text-sm font-semibold ${stat.color}`} style={{ fontFamily: "var(--font-heading)" }}>{stat.value}</div>
                <div className="text-[7px] tracking-[0.15em] uppercase text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Menu Grid (the landing page) ── */}
      {showMenu && (
        <ScrollArea className="h-[calc(100vh-120px)]">
          <div className="px-4 py-4 space-y-5">
            {tabGroups.map(group => (
              <div key={group.label}>
                <h4
                  className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground/50 px-1 mb-2"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {group.label}
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {group.items.map(([key, label, Icon]) => {
                    const isActive = tab === key && !showMenu;
                    return (
                      <button
                        key={key}
                        onClick={() => handleSelectSection(key)}
                        className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all duration-150 active:scale-95 ${
                          isActive
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/30 bg-card/50 text-muted-foreground hover:border-primary/30 hover:bg-card"
                        }`}
                      >
                        <Icon className="h-6 w-6" />
                        <span
                          className="text-[9px] tracking-wider uppercase text-center leading-tight"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {label}
                        </span>
                        {key === "support_tickets" && unresolvedTicketCount > 0 && (
                          <span className="absolute top-1.5 right-1.5 bg-destructive text-destructive-foreground text-[7px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
                            {unresolvedTicketCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Exit to Site card */}
            <button
              onClick={() => navigate("/")}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/30 bg-card/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-all active:scale-[0.98]"
            >
              <Home className="h-5 w-5" />
              <span className="text-sm" style={{ fontFamily: "var(--font-heading)" }}>
                Back to Site
              </span>
            </button>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
