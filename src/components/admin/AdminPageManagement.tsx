import { useState, useEffect, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import {
  Loader2, Save, Plus, Trash2, Eye, EyeOff, FileText, Globe, GripVertical,
  Copy, Calendar, BarChart3, Layout, Type, Clock, Code,
  Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Link,
  ImagePlus, Heading1, Heading2, Minus, Undo, Redo
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { User } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import SidebarSectionsPanel from "./pages/SidebarSectionsPanel";
import { PAGE_TEMPLATES } from "./pages/PageTemplates";

/* ── Types ── */
export type NavPlacement = "none" | "header" | "footer" | "both";

export interface ManagedPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  meta_title: string;
  meta_description: string;
  og_image: string;
  noindex: boolean;
  is_published: boolean;
  sort_order: number;
  show_in_nav: boolean;
  nav_placement: NavPlacement;
  template: string;
  scheduled_at: string | null;
  view_count: number;
  json_ld: string;
  translations: Record<string, { title: string; content: string; meta_title: string; meta_description: string }>;
  created_at: string;
  updated_at: string;
}

const emptyPage: Omit<ManagedPage, "id" | "created_at" | "updated_at"> = {
  title: "", slug: "", content: "", meta_title: "", meta_description: "",
  og_image: "", noindex: false, is_published: false, sort_order: 0,
  show_in_nav: false, nav_placement: "none", template: "blank", scheduled_at: null, view_count: 0,
  json_ld: "", translations: {},
};

/* ── Styles ── */
const headingFont = { fontFamily: "var(--font-heading)" } as const;
const bodyFont = { fontFamily: "var(--font-body)" } as const;
const displayFont = { fontFamily: "var(--font-display)" } as const;
const inputClass = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 text-sm transition-colors duration-500";
const labelClass = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";

/* ── Mini Rich Text Toolbar ── */
const RichTextToolbar = ({ editorRef, onInput }: { editorRef: React.RefObject<HTMLDivElement | null>; onInput: () => void }) => {
  const exec = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    onInput();
  }, [editorRef, onInput]);

  const btnClass = "p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2 mb-2">
      <button type="button" className={btnClass} onClick={() => exec("bold")} title="Bold"><Bold className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("italic")} title="Italic"><Italic className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("underline")} title="Underline"><Underline className="h-3.5 w-3.5" /></button>
      <div className="w-px h-5 bg-border mx-0.5" />
      <button type="button" className={btnClass} onClick={() => exec("formatBlock", "<h1>")} title="Heading 1"><Heading1 className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("formatBlock", "<h2>")} title="Heading 2"><Heading2 className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("formatBlock", "<p>")} title="Paragraph"><Type className="h-3.5 w-3.5" /></button>
      <div className="w-px h-5 bg-border mx-0.5" />
      <button type="button" className={btnClass} onClick={() => exec("insertUnorderedList")} title="Bullet List"><List className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("insertOrderedList")} title="Numbered List"><ListOrdered className="h-3.5 w-3.5" /></button>
      <div className="w-px h-5 bg-border mx-0.5" />
      <button type="button" className={btnClass} onClick={() => exec("justifyLeft")} title="Align Left"><AlignLeft className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("justifyCenter")} title="Align Center"><AlignCenter className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("justifyRight")} title="Align Right"><AlignRight className="h-3.5 w-3.5" /></button>
      <div className="w-px h-5 bg-border mx-0.5" />
      <button type="button" className={btnClass} onClick={() => {
        const url = prompt("Enter URL:");
        if (url) exec("createLink", url);
      }} title="Insert Link"><Link className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => {
        const url = prompt("Enter image URL:");
        if (url) exec("insertImage", url);
      }} title="Insert Image"><ImagePlus className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("insertHorizontalRule")} title="Horizontal Rule"><Minus className="h-3.5 w-3.5" /></button>
      <div className="w-px h-5 bg-border mx-0.5" />
      <button type="button" className={btnClass} onClick={() => exec("undo")} title="Undo"><Undo className="h-3.5 w-3.5" /></button>
      <button type="button" className={btnClass} onClick={() => exec("redo")} title="Redo"><Redo className="h-3.5 w-3.5" /></button>
    </div>
  );
};

/* ── Main Component ── */
export default function AdminPageManagement({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [pages, setPages] = useState<ManagedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingPage, setEditingPage] = useState<ManagedPage | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editorMode, setEditorMode] = useState<"visual" | "code">("visual");
  const [selectedTemplate, setSelectedTemplate] = useState("blank");
  const editorRef = useRef<HTMLDivElement>(null);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  useEffect(() => { fetchPages(); }, []);

  const fetchPages = async () => {
    const [pagesRes, navRes] = await Promise.all([
      supabase.from("site_settings").select("value").eq("key", "managed_pages").maybeSingle(),
      supabase.from("site_settings").select("value").eq("key", "navigation_menu").maybeSingle(),
    ]);

    let storedPages: ManagedPage[] = [];
    if (pagesRes.data?.value && Array.isArray(pagesRes.data.value)) {
      storedPages = pagesRes.data.value as unknown as ManagedPage[];
    }

    if (navRes.data?.value && Array.isArray(navRes.data.value)) {
      const navItems = navRes.data.value as Record<string, unknown>[];
      const managedNavItems = navItems.filter((n) => n.type === "managed");
      const existingIds = new Set(storedPages.map((p) => p.id));
      const existingSlugs = new Set(storedPages.map((p) => p.slug));
      let added = false;

      for (const nav of managedNavItems) {
        const slug = (String(nav.path || "")).replace(/^\/page\//, "") || `page-${nav.id}`;
        if (!existingIds.has(String(nav.id)) && !existingSlugs.has(slug)) {
          storedPages.push({
            id: String(nav.id),
            title: String(nav.label || "Untitled Page"),
            slug,
            content: "<h1>" + String(nav.label || "New Page") + "</h1><p>Edit this page content here.</p>",
            meta_title: String(nav.meta_title || ""),
            meta_description: String(nav.meta_description || ""),
            og_image: String(nav.og_image || ""),
            noindex: Boolean(nav.noindex),
            is_published: true,
            sort_order: storedPages.length,
            show_in_nav: nav.show_in_nav !== false,
            nav_placement: (String(nav.nav_placement || "") || (nav.show_in_nav !== false ? "header" : "none")) as NavPlacement,
            template: "blank",
            scheduled_at: null,
            view_count: 0,
            json_ld: "",
            translations: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          added = true;
        }
      }

      if (added) {
        await supabase.from("site_settings").upsert({
          key: "managed_pages",
          value: storedPages as unknown as Json,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        });
      }
    }

    setPages(storedPages);
    setLoading(false);
  };

  const savePages = async (updatedPages: ManagedPage[]) => {
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "managed_pages",
      value: updatedPages as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    }, { onConflict: "key" });

    if (error) {
      setSaving(false);
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }

    try {
      const { data: navData } = await supabase.from("site_settings").select("value").eq("key", "navigation_menu").maybeSingle();
      const navItems: Record<string, unknown>[] = (navData?.value && Array.isArray(navData.value)) ? navData.value as Record<string, unknown>[] : [];
      const nonManaged = navItems.filter((n) => n.type !== "managed");
      const managedNav = updatedPages
        .filter((p) => p.is_published && (p.nav_placement === "header" || p.nav_placement === "both"))
        .map((p, i) => ({
          id: p.id, label: p.title, path: `/page/${p.slug}`, icon: "FileText",
          description: p.meta_description || "", type: "managed", parent_id: null,
          sort_order: 100 + i, visibility: "all",
          meta_title: p.meta_title || "", meta_description: p.meta_description || "",
          og_image: p.og_image || "", noindex: p.noindex, show_in_nav: true, open_new_tab: false,
        }));

      const { error: navError } = await supabase.from("site_settings").upsert({
        key: "navigation_menu",
        value: [...nonManaged, ...managedNav] as unknown as Json,
        updated_at: new Date().toISOString(),
        updated_by: user?.id,
      }, { onConflict: "key" });

      if (navError) {
        console.error("Nav sync failed:", navError.message);
        toast({ title: "Page saved but navigation sync failed", description: navError.message, variant: "destructive" });
      }
    } catch (err) {
      console.error("Nav sync exception:", err);
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.navigationMenu() });
    queryClient.invalidateQueries({ queryKey: ["footer-pages"] });
    queryClient.invalidateQueries({ queryKey: ["site-setting", "managed_pages"] });
    setSaving(false);
    setPages(updatedPages);
    toast({ title: "Pages saved successfully" });
    window.dispatchEvent(new CustomEvent("pages-updated"));
  };

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const addNewPage = () => {
    setSelectedTemplate("blank");
    const newPage: ManagedPage = {
      ...emptyPage,
      id: crypto.randomUUID(),
      sort_order: pages.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setEditingPage(newPage);
    setEditorMode("visual");
    setShowForm(true);
  };

  const applyTemplate = (templateKey: string) => {
    const tmpl = PAGE_TEMPLATES.find((t) => t.key === templateKey);
    if (!tmpl || !editingPage) return;
    setSelectedTemplate(templateKey);
    const updated = { ...editingPage, content: tmpl.content, template: templateKey, title: editingPage.title || tmpl.label, slug: editingPage.slug || generateSlug(tmpl.label) };
    setEditingPage(updated);
    if (editorRef.current && editorMode === "visual") editorRef.current.innerHTML = DOMPurify.sanitize(tmpl.content || "");
  };

  const editPage = (page: ManagedPage) => {
    setEditingPage({ ...page });
    setSelectedTemplate(page.template || "blank");
    setEditorMode("visual");
    setShowForm(true);
  };

  const deletePage = async (id: string) => {
    confirmAction({
      title: "Delete this page?",
      description: "This cannot be undone.",
      onConfirm: async () => { await savePages(pages.filter((p) => p.id !== id)); },
    });
  };

  const syncEditorToState = () => {
    if (editorRef.current && editingPage) {
      setEditingPage((p) => p ? ({ ...p, content: editorRef.current?.innerHTML || "" }) : null);
    }
  };

  const handleSavePage = async () => {
    if (!editingPage) return;
    if (editorMode === "visual" && editorRef.current) editingPage.content = editorRef.current.innerHTML;
    if (!editingPage.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (!editingPage.slug.trim()) editingPage.slug = generateSlug(editingPage.title);
    const slugConflict = pages.find((p) => p.slug === editingPage.slug && p.id !== editingPage.id);
    if (slugConflict) { toast({ title: "Slug already exists", variant: "destructive" }); return; }
    editingPage.updated_at = new Date().toISOString();
    const existing = pages.find((p) => p.id === editingPage.id);
    const updated = existing ? pages.map((p) => (p.id === editingPage.id ? editingPage : p)) : [...pages, editingPage];
    await savePages(updated);
    setShowForm(false);
    setEditingPage(null);
  };

  const togglePublish = async (page: ManagedPage) => {
    const updated = pages.map((p) => p.id === page.id ? { ...p, is_published: !p.is_published, updated_at: new Date().toISOString() } : p);
    await savePages(updated);
  };

  const copyPageUrl = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/page/${slug}`);
    toast({ title: "Page URL copied to clipboard" });
  };

  useEffect(() => {
    if (showForm && editingPage && editorMode === "visual" && editorRef.current) {
      editorRef.current.innerHTML = DOMPurify.sanitize(editingPage.content || "");
    }
  }, [showForm, editorMode]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <ConfirmDialog {...dialogProps} />
      
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-px bg-primary" />
        <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={headingFont}>Management</span>
      </div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-light tracking-tight" style={displayFont}>Page <em className="italic text-primary">Management</em></h2>
        <button onClick={addNewPage} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity" style={headingFont}>
          <Plus className="h-3.5 w-3.5" /> New Page
        </button>
      </div>

      {/* Analytics Summary */}
      {pages.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Pages", value: pages.length, color: "" },
            { label: "Published", value: pages.filter((p) => p.is_published).length, color: "text-green-500" },
            { label: "Drafts", value: pages.filter((p) => !p.is_published).length, color: "text-yellow-500" },
            { label: "Total Views", value: pages.reduce((sum, p) => sum + (p.view_count || 0), 0).toLocaleString(), color: "" },
          ].map((s) => (
            <div key={s.label} className="border border-border p-4">
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>{s.label}</span>
              <span className={`text-2xl font-light ${s.color}`} style={displayFont}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Editor Form */}
      {showForm && editingPage && (
        <div className="border border-border p-6 mb-8 space-y-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs tracking-[0.2em] uppercase text-primary" style={headingFont}>
              {pages.find((p) => p.id === editingPage.id) ? "Edit Page" : "New Page"}
            </span>
            <button onClick={() => { setShowForm(false); setEditingPage(null); }} className="text-muted-foreground hover:text-foreground text-xs" style={headingFont}>Cancel</button>
          </div>

          {/* Template Selector */}
          {!pages.find((p) => p.id === editingPage.id) && (
            <div>
              <label className={labelClass} style={headingFont}><Layout className="h-3 w-3 inline mr-1" /> Choose Template</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {PAGE_TEMPLATES.map((tmpl) => (
                  <button key={tmpl.key} onClick={() => applyTemplate(tmpl.key)}
                    className={`text-left p-3 border rounded-sm transition-all ${selectedTemplate === tmpl.key ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}>
                    <span className="text-xs font-medium block" style={headingFont}>{tmpl.label}</span>
                    <span className="text-[9px] text-muted-foreground" style={bodyFont}>{tmpl.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Basic Info */}
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass} style={headingFont}>Page Title *</label>
              <input value={editingPage.title} onChange={(e) => {
                const title = e.target.value;
                setEditingPage((p) => p ? ({ ...p, title, slug: p.slug || generateSlug(title) }) : null);
              }} className={inputClass} style={bodyFont} placeholder="About Us" />
            </div>
            <div>
              <label className={labelClass} style={headingFont}>URL Slug *</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">/page/</span>
                <input value={editingPage.slug} onChange={(e) => setEditingPage((p) => p ? ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }) : null)}
                  className={inputClass} style={bodyFont} placeholder="about-us" />
              </div>
            </div>
          </div>

          {/* Content Editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass} style={headingFont}>Page Content</label>
              <div className="flex border border-border rounded-sm overflow-hidden">
                <button onClick={() => { if (editorMode === "code" && editorRef.current && editingPage) editorRef.current.innerHTML = DOMPurify.sanitize(editingPage.content || ""); setEditorMode("visual"); }}
                  className={`px-3 py-1 text-[9px] tracking-[0.15em] uppercase transition-colors ${editorMode === "visual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} style={headingFont}>
                  <Type className="h-3 w-3 inline mr-1" /> Visual
                </button>
                <button onClick={() => { if (editorMode === "visual" && editorRef.current) syncEditorToState(); setEditorMode("code"); }}
                  className={`px-3 py-1 text-[9px] tracking-[0.15em] uppercase transition-colors ${editorMode === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} style={headingFont}>
                  <Code className="h-3 w-3 inline mr-1" /> HTML
                </button>
              </div>
            </div>
            {editorMode === "visual" ? (
              <div className="border border-border rounded-sm">
                <div className="p-2 bg-muted/20"><RichTextToolbar editorRef={editorRef} onInput={syncEditorToState} /></div>
                <div ref={editorRef} contentEditable suppressContentEditableWarning
                  className="min-h-[300px] p-4 outline-none prose prose-sm max-w-none text-foreground [&_h1]:text-xl [&_h1]:font-light [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-light [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-2 [&_p]:mb-2 [&_p]:text-sm [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-2 [&_li]:text-sm [&_li]:mb-1 [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_img]:rounded-sm [&_img]:my-3 [&_hr]:my-4 [&_hr]:border-border"
                  onInput={syncEditorToState} style={bodyFont} />
              </div>
            ) : (
              <textarea value={editingPage.content} onChange={(e) => setEditingPage((p) => p ? ({ ...p, content: e.target.value }) : null)}
                className="w-full bg-muted/20 border border-border focus:border-primary outline-none p-4 text-sm font-mono transition-colors duration-500 rounded resize-y"
                rows={14} placeholder="<h1>Page Title</h1><p>Your content here...</p>" />
            )}
          </div>

          {/* SEO */}
          <div className="border-t border-border pt-5">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-primary" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={headingFont}>SEO & Meta</span>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={headingFont}>Meta Title</label>
                <input value={editingPage.meta_title} onChange={(e) => setEditingPage((p) => p ? ({ ...p, meta_title: e.target.value }) : null)} className={inputClass} style={bodyFont} placeholder="Custom meta title" />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>{(editingPage.meta_title || editingPage.title).length}/60 characters</p>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>OG Image URL</label>
                <input value={editingPage.og_image} onChange={(e) => setEditingPage((p) => p ? ({ ...p, og_image: e.target.value }) : null)} className={inputClass} style={bodyFont} placeholder="https://..." />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass} style={headingFont}>Meta Description</label>
                <textarea value={editingPage.meta_description} onChange={(e) => setEditingPage((p) => p ? ({ ...p, meta_description: e.target.value }) : null)} className={`${inputClass} resize-none`} rows={2} style={bodyFont} placeholder="A brief description for search engines..." />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>{editingPage.meta_description.length}/160 characters</p>
              </div>
            </div>
          </div>

          {/* JSON-LD */}
          <div className="border-t border-border pt-5">
            <div className="flex items-center gap-2 mb-4">
              <Code className="h-4 w-4 text-primary" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={headingFont}>Structured Data / JSON-LD</span>
            </div>
            <textarea value={editingPage.json_ld || ""} onChange={(e) => setEditingPage((p) => p ? ({ ...p, json_ld: e.target.value }) : null)}
              className="w-full bg-muted/20 border border-border focus:border-primary outline-none p-4 text-sm font-mono transition-colors duration-500 rounded resize-y"
              rows={6} placeholder={`{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "name": "${editingPage.title || "Page Title"}"\n}`} />
            <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>Paste valid JSON-LD for enhanced search results. Leave empty to skip.</p>
          </div>

          {/* Translations */}
          <div className="border-t border-border pt-5">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-primary" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={headingFont}>Multi-Language Versions</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-3" style={bodyFont}>
              Add translated versions of this page. These tie into the platform's language system.
            </p>
            {Object.entries(editingPage.translations || {}).map(([lang, trans]) => (
              <div key={lang} className="border border-border rounded-sm p-4 mb-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary" style={headingFont}>{lang}</span>
                  <button onClick={() => {
                    const updated = { ...editingPage.translations };
                    delete updated[lang];
                    setEditingPage((p) => p ? ({ ...p, translations: updated }) : null);
                  }} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
                <div>
                  <label className={labelClass} style={headingFont}>Title</label>
                  <input value={trans.title} onChange={(e) => {
                    const updated = { ...editingPage.translations, [lang]: { ...trans, title: e.target.value } };
                    setEditingPage((p) => p ? ({ ...p, translations: updated }) : null);
                  }} className={inputClass} style={bodyFont} />
                </div>
                <div>
                  <label className={labelClass} style={headingFont}>Content (HTML)</label>
                  <textarea value={trans.content} onChange={(e) => {
                    const updated = { ...editingPage.translations, [lang]: { ...trans, content: e.target.value } };
                    setEditingPage((p) => p ? ({ ...p, translations: updated }) : null);
                  }} className="w-full bg-muted/20 border border-border p-3 text-sm font-mono rounded resize-y" rows={4} />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <select id="add-lang-select" className="bg-transparent border border-border rounded px-2 py-1.5 text-xs" style={bodyFont} defaultValue="">
                <option value="" disabled>Select language…</option>
                {["Hindi", "Bengali", "Tamil", "Telugu", "Spanish", "French", "German", "Portuguese", "Arabic", "Chinese", "Japanese", "Korean", "Russian", "Italian", "Dutch", "Turkish"]
                  .filter((l) => !editingPage.translations?.[l])
                  .map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <button onClick={() => {
                const sel = (document.getElementById("add-lang-select") as HTMLSelectElement)?.value;
                if (!sel) return;
                const updated = { ...editingPage.translations, [sel]: { title: "", content: "", meta_title: "", meta_description: "" } };
                setEditingPage((p) => p ? ({ ...p, translations: updated }) : null);
              }} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border hover:border-primary hover:text-primary transition-all rounded-sm" style={headingFont}>
                <Plus className="h-3 w-3" /> Add Language
              </button>
            </div>
          </div>

          {/* Publishing Options */}
          <div className="border-t border-border pt-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={headingFont}>Publishing Options</span>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={headingFont}>Schedule Publish Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={cn("w-full text-left flex items-center gap-2", inputClass)} style={bodyFont}>
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {editingPage.scheduled_at ? format(new Date(editingPage.scheduled_at), "PPP 'at' h:mm a") : <span className="text-muted-foreground">No schedule (publish immediately)</span>}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarWidget mode="single"
                      selected={editingPage.scheduled_at ? new Date(editingPage.scheduled_at) : undefined}
                      onSelect={(date) => {
                        if (date) { const now = new Date(); date.setHours(now.getHours(), now.getMinutes()); setEditingPage((p) => p ? ({ ...p, scheduled_at: date.toISOString() }) : null); }
                        else { setEditingPage((p) => p ? ({ ...p, scheduled_at: null }) : null); }
                      }}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      initialFocus className={cn("p-3 pointer-events-auto")} />
                    <div className="px-3 pb-3 flex items-center justify-between">
                      {editingPage.scheduled_at && (
                        <input type="time" value={editingPage.scheduled_at ? format(new Date(editingPage.scheduled_at), "HH:mm") : ""}
                          onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); const d = new Date(editingPage.scheduled_at!); d.setHours(h, m); setEditingPage((p) => p ? ({ ...p, scheduled_at: d.toISOString() }) : null); }}
                          className="border border-border rounded px-2 py-1 text-xs" />
                      )}
                      <button onClick={() => setEditingPage((p) => p ? ({ ...p, scheduled_at: null }) : null)}
                        className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-destructive" style={headingFont}>Clear</button>
                    </div>
                  </PopoverContent>
                </Popover>
                {editingPage.scheduled_at && <p className="text-[10px] text-primary mt-1" style={bodyFont}>⏰ Will auto-publish on {format(new Date(editingPage.scheduled_at), "MMMM d, yyyy 'at' h:mm a")}</p>}
              </div>
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={editingPage.is_published} onChange={(e) => setEditingPage((p) => p ? ({ ...p, is_published: e.target.checked }) : null)} className="accent-primary" />
                  <label className="text-xs text-foreground" style={bodyFont}>Publish now (make it live)</label>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-foreground font-medium" style={bodyFont}>Navigation Placement</label>
                  <div className="flex flex-wrap gap-2">
                    {(["none", "header", "footer", "both"] as NavPlacement[]).map((opt) => (
                      <button key={opt} type="button" onClick={() => setEditingPage((p) => p ? ({ ...p, nav_placement: opt, show_in_nav: opt === "header" || opt === "both" }) : null)}
                        className={cn("px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase border transition-all",
                          editingPage.nav_placement === opt ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                        )} style={headingFont}>
                        {opt === "none" ? "None" : opt === "header" ? "Header Nav" : opt === "footer" ? "Footer Nav" : "Both"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground" style={bodyFont}>Choose where this page link appears on the site.</p>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={editingPage.noindex} onChange={(e) => setEditingPage((p) => p ? ({ ...p, noindex: e.target.checked }) : null)} className="accent-primary" />
                  <label className="text-xs text-muted-foreground" style={bodyFont}>noindex (hide from search engines)</label>
                </div>
              </div>
            </div>
          </div>

          <button onClick={handleSavePage} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Page
          </button>
        </div>
      )}

      {/* Pages List */}
      {pages.length === 0 && !showForm ? (
        <div className="text-center py-16 border border-dashed border-border">
          <FileText className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-2" style={bodyFont}>No pages created yet</p>
          <p className="text-xs text-muted-foreground/60 mb-6" style={bodyFont}>Create custom pages like About, Terms, Privacy, FAQ, and more.</p>
          <button onClick={addNewPage} className="inline-flex items-center gap-2 px-5 py-2.5 border border-primary text-primary text-xs tracking-[0.15em] uppercase hover:bg-primary/10 transition-all" style={headingFont}>
            <Plus className="h-3.5 w-3.5" /> Create Your First Page
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <div key={page.id} className="flex items-center gap-4 border border-border p-4 hover:border-primary/30 transition-colors">
              <GripVertical className="h-4 w-4 text-muted-foreground/30 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-medium truncate" style={headingFont}>{page.title}</span>
                  <span className={`text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-sm border ${page.is_published ? "text-green-500 border-green-500/40" : "text-muted-foreground border-border"}`} style={headingFont}>
                    {page.is_published ? "Live" : "Draft"}
                  </span>
                  {page.nav_placement && page.nav_placement !== "none" && (
                    <span className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-sm border border-primary/30 text-primary" style={headingFont}>
                      {page.nav_placement === "header" ? "Header" : page.nav_placement === "footer" ? "Footer" : page.nav_placement === "both" ? "Header + Footer" : "Nav"}
                    </span>
                  )}
                  {page.scheduled_at && !page.is_published && (
                    <span className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-sm border border-yellow-500/40 text-yellow-500" style={headingFont}>
                      <Clock className="h-2.5 w-2.5 inline mr-0.5" /> Scheduled
                    </span>
                  )}
                  {page.template && page.template !== "blank" && (
                    <span className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-sm border border-border text-muted-foreground" style={headingFont}>{page.template}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground" style={bodyFont}>
                  <span>/page/{page.slug}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><BarChart3 className="h-2.5 w-2.5" /> {(page.view_count || 0).toLocaleString()} views</span>
                  {page.scheduled_at && !page.is_published && (
                    <><span>•</span><span>Publishes {format(new Date(page.scheduled_at), "MMM d, yyyy")}</span></>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => copyPageUrl(page.slug)} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Copy URL"><Copy className="h-3.5 w-3.5" /></button>
                <button onClick={() => togglePublish(page)} className="p-2 text-muted-foreground hover:text-primary transition-colors" title={page.is_published ? "Unpublish" : "Publish"}>
                  {page.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => editPage(page)} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Edit"><FileText className="h-3.5 w-3.5" /></button>
                <button onClick={() => deletePage(page.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Create */}
      {!showForm && (
        <div className="mt-10 border border-dashed border-border p-6">
          <h3 className="text-xs tracking-[0.2em] uppercase text-primary mb-4" style={headingFont}>💡 Quick Create from Template</h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {PAGE_TEMPLATES.filter((t) => t.key !== "blank").map((tmpl) => {
              const exists = pages.some((p) => p.slug === generateSlug(tmpl.label));
              return (
                <button key={tmpl.key} disabled={exists} onClick={() => {
                  const newPage: ManagedPage = { ...emptyPage, id: crypto.randomUUID(), title: tmpl.label, slug: generateSlug(tmpl.label), content: tmpl.content, template: tmpl.key, sort_order: pages.length, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
                  setEditingPage(newPage);
                  setSelectedTemplate(tmpl.key);
                  setEditorMode("visual");
                  setShowForm(true);
                }} className={`text-left p-3 border rounded-sm transition-all ${exists ? "opacity-40 cursor-not-allowed border-border" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}>
                  <span className="text-xs font-medium block" style={headingFont}>{tmpl.label}</span>
                  <span className="text-[10px] text-muted-foreground" style={bodyFont}>{tmpl.description}</span>
                  {exists && <span className="text-[8px] text-primary block mt-1" style={headingFont}>Already created</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sidebar Sections */}
      <SidebarSectionsPanel user={user} />
    </div>
  );
}
