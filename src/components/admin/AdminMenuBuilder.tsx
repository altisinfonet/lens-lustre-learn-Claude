import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";
import {
  Loader2, Save, Plus, Trash2, GripVertical, Globe, Eye, EyeOff, ExternalLink,
  ChevronDown, ChevronRight, ArrowUp, ArrowDown, FileText, Home, Link as LinkIcon
} from "lucide-react";
import { useNavigationMenu, SYSTEM_PAGES, type MenuItem } from "@/hooks/core/useNavigationMenu";
import type { User } from "@supabase/supabase-js";

const headingFont = { fontFamily: "var(--font-heading)" } as const;
const bodyFont = { fontFamily: "var(--font-body)" } as const;
const displayFont = { fontFamily: "var(--font-display)" } as const;
const inputClass = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 text-sm transition-colors duration-500";
const labelClass = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";

const ICON_OPTIONS = [
  "Home", "Trophy", "Newspaper", "BookOpen", "Award", "FileCheck", "Compass",
  "Rss", "Users", "UserPlus", "HelpCircle", "LogIn", "Camera", "Image",
  "Star", "Heart", "Globe", "Map", "Zap", "Shield", "Info", "Mail",
  "Phone", "MessageSquare", "Calendar", "Clock", "Folder", "Tag",
];

const VISIBILITY_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "guest", label: "Guests Only" },
  { value: "authenticated", label: "Logged-in Users" },
  { value: "admin", label: "Admins Only" },
];

export default function AdminMenuBuilder({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const { menuItems, loading, saveMenu } = useNavigationMenu();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Sync from hook once loaded — moved to useEffect to avoid state updates during render
  useEffect(() => {
    if (initialized || loading) return;
    if (menuItems.length > 0) {
      setItems(menuItems);
      setInitialized(true);
    } else {
      const initial: MenuItem[] = SYSTEM_PAGES.map((sp, i) => ({
        ...sp,
        id: crypto.randomUUID(),
        sort_order: i,
      }));
      setItems(initial);
      setInitialized(true);
    }
  }, [initialized, loading, menuItems]);

  const handleSave = async () => {
    setSaving(true);
    const error = await saveMenu(items, user?.id);
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      qc.invalidateQueries({ queryKey: queryKeys.navigationMenu() });
      toast({ title: "Navigation menu saved" });
    }
  };

  const addExternalLink = () => {
    const newItem: MenuItem = {
      id: crypto.randomUUID(),
      label: "New Link",
      path: "https://",
      icon: "ExternalLink",
      description: "",
      type: "external",
      parent_id: null,
      sort_order: items.length,
      visibility: "all",
      meta_title: "",
      meta_description: "",
      og_image: "",
      noindex: false,
      show_in_nav: true,
      open_new_tab: true,
    };
    setItems((prev) => [...prev, newItem]);
    setEditingId(newItem.id);
  };

  const addManagedPage = async () => {
    const slug = "new-page-" + Date.now();
    const newItem: MenuItem = {
      id: crypto.randomUUID(),
      label: "New Page",
      path: `/page/${slug}`,
      icon: "FileText",
      description: "",
      type: "managed",
      parent_id: null,
      sort_order: items.length,
      visibility: "all",
      meta_title: "",
      meta_description: "",
      og_image: "",
      noindex: false,
      show_in_nav: true,
      open_new_tab: false,
    };
    setItems((prev) => [...prev, newItem]);
    setEditingId(newItem.id);

    // Auto-create page in Page Management
    try {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "managed_pages")
        .maybeSingle();
      const existingPages = (data?.value && Array.isArray(data.value)) ? data.value as any[] : [];
      const newPage = {
        id: newItem.id,
        title: "New Page",
        slug,
        content: "<h1>New Page</h1><p>Edit this page from Page Management.</p>",
        meta_title: "",
        meta_description: "",
        og_image: "",
        noindex: false,
        is_published: true,
        sort_order: existingPages.length,
        show_in_nav: true,
        template: "blank",
        scheduled_at: null,
        view_count: 0,
        json_ld: "",
        translations: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase.from("site_settings").upsert({
        key: "managed_pages",
        value: [...existingPages, newPage] as any,
        updated_at: new Date().toISOString(),
        updated_by: user?.id,
      });
    } catch (e) {
      console.error("Failed to auto-create managed page:", e);
    }
  };

  const toSlug = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const updateItem = (id: string, field: keyof MenuItem, value: any) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      // Auto-generate slug from label for managed pages
      if (field === "label" && item.type === "managed") {
        const slug = toSlug(value as string) || "page";
        updated.path = `/page/${slug}`;
      }
      return updated;
    }));
  };

  const removeItem = (id: string) => {
    // Also remove children
    setItems((prev) => prev.filter((item) => item.id !== id && item.parent_id !== id));
  };

  const moveItem = (id: string, direction: "up" | "down") => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const copy = [...prev];
      const tempOrder = copy[idx].sort_order;
      copy[idx] = { ...copy[idx], sort_order: copy[swapIdx].sort_order };
      copy[swapIdx] = { ...copy[swapIdx], sort_order: tempOrder };
      [copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]];
      return copy;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const topLevelItems = items
    .filter((i) => !i.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const getChildren = (parentId: string) =>
    items.filter((i) => i.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);

  const topLevelOptions = items
    .filter((i) => !i.parent_id)
    .map((i) => ({ id: i.id, label: i.label }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderItem = (item: MenuItem, isChild = false) => {
    const children = getChildren(item.id);
    const isExpanded = expandedIds.has(item.id);
    const isEditing = editingId === item.id;

    return (
      <div key={item.id} className={`${isChild ? "ml-8" : ""}`}>
        <div className={`flex items-center gap-3 border border-border p-3 hover:border-primary/30 transition-colors ${isEditing ? "border-primary bg-primary/5" : ""}`}>
          <GripVertical className="h-4 w-4 text-muted-foreground/30 shrink-0 cursor-grab" />

          {/* Expand toggle for parents */}
          {!isChild && children.length > 0 ? (
            <button onClick={() => toggleExpand(item.id)} className="text-muted-foreground hover:text-primary">
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : !isChild ? (
            <div className="w-3.5" />
          ) : null}

          {/* Type badge */}
          <span className={`text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-sm border shrink-0 ${
            item.type === "system" ? "text-blue-500 border-blue-500/30" :
            item.type === "external" ? "text-orange-500 border-orange-500/30" :
            "text-green-500 border-green-500/30"
          }`} style={headingFont}>
            {item.type === "system" ? "SYS" : item.type === "external" ? "EXT" : "PAGE"}
          </span>

          {/* Label & path */}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate block" style={headingFont}>{item.label}</span>
            <span className="text-[10px] text-muted-foreground truncate block" style={bodyFont}>{item.path}</span>
          </div>

          {/* Nav visibility indicator */}
          {item.show_in_nav && (
            <span className="text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-sm border border-primary/30 text-primary shrink-0" style={headingFont}>NAV</span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => moveItem(item.id, "up")} className="p-1.5 text-muted-foreground hover:text-primary" title="Move up"><ArrowUp className="h-3 w-3" /></button>
            <button onClick={() => moveItem(item.id, "down")} className="p-1.5 text-muted-foreground hover:text-primary" title="Move down"><ArrowDown className="h-3 w-3" /></button>
            <button onClick={() => setEditingId(isEditing ? null : item.id)} className="p-1.5 text-muted-foreground hover:text-primary" title="Edit">
              <FileText className="h-3 w-3" />
            </button>
            {item.type !== "system" && (
              <button onClick={() => removeItem(item.id)} className="p-1.5 text-muted-foreground hover:text-destructive" title="Delete">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Edit panel */}
        {isEditing && (
          <div className="border border-t-0 border-border p-4 bg-muted/10 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={headingFont}>Label</label>
                <input value={item.label} onChange={(e) => updateItem(item.id, "label", e.target.value)} className={inputClass} style={bodyFont} />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Path / URL</label>
                <input value={item.path} onChange={(e) => updateItem(item.id, "path", e.target.value)} className={inputClass} style={bodyFont} disabled={item.type === "system"} />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Icon</label>
                <select value={item.icon} onChange={(e) => updateItem(item.id, "icon", e.target.value)} className={inputClass} style={bodyFont}>
                  {ICON_OPTIONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Visibility</label>
                <select value={item.visibility} onChange={(e) => updateItem(item.id, "visibility", e.target.value)} className={inputClass} style={bodyFont}>
                  {VISIBILITY_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelClass} style={headingFont}>Description (shown in mega menu)</label>
                <input value={item.description} onChange={(e) => updateItem(item.id, "description", e.target.value)} className={inputClass} style={bodyFont} placeholder="Brief description..." />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Parent Menu</label>
                <select
                  value={item.parent_id || ""}
                  onChange={(e) => updateItem(item.id, "parent_id", e.target.value || null)}
                  className={inputClass}
                  style={bodyFont}
                >
                  <option value="">— Top Level —</option>
                  {topLevelOptions.filter((o) => o.id !== item.id).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              {item.type !== "system" && (
                <div>
                  <label className={labelClass} style={headingFont}>Meta Title</label>
                  <input value={item.meta_title} onChange={(e) => updateItem(item.id, "meta_title", e.target.value)} className={inputClass} style={bodyFont} />
                </div>
              )}
              {item.type === "system" && (
                <>
                  <div>
                    <label className={labelClass} style={headingFont}>SEO Title Override</label>
                    <input value={item.meta_title} onChange={(e) => updateItem(item.id, "meta_title", e.target.value)} className={inputClass} style={bodyFont} placeholder="Override page title for SEO" />
                  </div>
                  <div>
                    <label className={labelClass} style={headingFont}>SEO Description Override</label>
                    <input value={item.meta_description} onChange={(e) => updateItem(item.id, "meta_description", e.target.value)} className={inputClass} style={bodyFont} placeholder="Override meta description" />
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs" style={bodyFont}>
                <input type="checkbox" checked={item.show_in_nav} onChange={(e) => updateItem(item.id, "show_in_nav", e.target.checked)} className="accent-primary" />
                Show in navigation
              </label>
              <label className="flex items-center gap-2 text-xs" style={bodyFont}>
                <input type="checkbox" checked={item.noindex} onChange={(e) => updateItem(item.id, "noindex", e.target.checked)} className="accent-primary" />
                noindex
              </label>
              {item.type === "external" && (
                <label className="flex items-center gap-2 text-xs" style={bodyFont}>
                  <input type="checkbox" checked={item.open_new_tab} onChange={(e) => updateItem(item.id, "open_new_tab", e.target.checked)} className="accent-primary" />
                  Open in new tab
                </label>
              )}
            </div>
          </div>
        )}

        {/* Children */}
        {!isChild && isExpanded && children.map((child) => renderItem(child, true))}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-px bg-primary" />
        <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={headingFont}>Navigation</span>
      </div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-light tracking-tight" style={displayFont}>
          Menu <em className="italic text-primary">Builder</em>
        </h2>
        <div className="flex gap-2">
          <button onClick={addManagedPage} className="inline-flex items-center gap-2 px-4 py-2 border border-border text-xs tracking-[0.15em] uppercase hover:border-primary hover:text-primary transition-all" style={headingFont}>
            <FileText className="h-3.5 w-3.5" /> Add Page
          </button>
          <button onClick={addExternalLink} className="inline-flex items-center gap-2 px-4 py-2 border border-border text-xs tracking-[0.15em] uppercase hover:border-primary hover:text-primary transition-all" style={headingFont}>
            <ExternalLink className="h-3.5 w-3.5" /> Add Link
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border border-border p-4">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>Total Items</span>
          <span className="text-2xl font-light" style={displayFont}>{items.length}</span>
        </div>
        <div className="border border-border p-4">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>In Nav</span>
          <span className="text-2xl font-light text-primary" style={displayFont}>{items.filter((i) => i.show_in_nav).length}</span>
        </div>
        <div className="border border-border p-4">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>System</span>
          <span className="text-2xl font-light text-blue-500" style={displayFont}>{items.filter((i) => i.type === "system").length}</span>
        </div>
        <div className="border border-border p-4">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>External</span>
          <span className="text-2xl font-light text-orange-500" style={displayFont}>{items.filter((i) => i.type === "external").length}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6 text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> System Pages</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Managed Pages</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> External Links</span>
      </div>

      {/* Items */}
      <div className="space-y-1 mb-8">
        {topLevelItems.map((item) => renderItem(item))}
      </div>

      <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Menu
      </button>
    </div>
  );
}
