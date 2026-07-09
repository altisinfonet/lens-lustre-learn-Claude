import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Globe, FileText, Map, Bot, Plus, Trash2, RefreshCw, Code2, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import FileUploadDropZone, { type UploadedFile } from "@/components/FileUploadDropZone";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import CloudflareEdgeChecklist from "@/components/admin/CloudflareEdgeChecklist";
import type { User } from "@supabase/supabase-js";

interface PageSEO {
  path: string;
  title: string;
  description: string;
  og_image: string;
  noindex: boolean;
}

interface GlobalSEO {
  title_template: string;
  default_title: string;
  default_description: string;
  default_og_image: string;
  site_name: string;
  twitter_handle: string;
  canonical_base: string;
  google_verification: string;
  bing_verification: string;
}

const defaultGlobalSEO: GlobalSEO = {
  title_template: "%s — 50mm Retina World",
  default_title: "50mm Retina World — Competitions, Education & Journal for Photographers",
  default_description: "Join 50mm Retina World — the ultimate platform for photographers. Enter global competitions, master your craft through expert courses, and explore our photography journal.",
  default_og_image: "",
  site_name: "50mm Retina World",
  twitter_handle: "",
  canonical_base: "https://50mmretina.com",
  google_verification: "",
  bing_verification: "",
};

const knownRoutes = [
  "/", "/login", "/signup", "/competitions", "/journal", "/courses",
  "/winners", "/certificates", "/discover", "/feed", "/friends",
  "/dashboard", "/profile", "/wallet", "/forgot-password",
];

const defaultRobotsTxt = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /edit-profile
Disallow: /dashboard
Disallow: /wallet
Disallow: /judge
Disallow: /reset-password
Disallow: /forgot-password

Sitemap: https://50mmretina.com/sitemap.xml`;

export default function AdminSEO({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [globalSEO, setGlobalSEO] = useState<GlobalSEO>(defaultGlobalSEO);
  const [pageSEOList, setPageSEOList] = useState<PageSEO[]>([]);
  const [robotsTxt, setRobotsTxt] = useState(defaultRobotsTxt);
  const [sitemapPreview, setSitemapPreview] = useState("");
  const [schemas, setSchemas] = useState<{ name: string; json: string }[]>([]);
  const [editingSchemaIdx, setEditingSchemaIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("global");
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["global", "pages", "sitemap", "robots", "schema", "verify"].includes(t)) {
      setActiveTab(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    setSearchParams(next, { replace: true });
  };
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyStage, setVerifyStage] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string>("");
  const [verifyReport, setVerifyReport] = useState<any | null>(null);
  const [healthState, setHealthState] = useState<"unknown" | "checking" | "ok" | "down">("unknown");
  const [healthMsg, setHealthMsg] = useState<string>("");

  const FN_HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/seo-crawler-verify?health=1`;

  const checkHealth = async (): Promise<boolean> => {
    setHealthState("checking");
    setHealthMsg("");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(FN_HEALTH_URL, {
        method: "GET",
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        setHealthState("down");
        setHealthMsg(`HTTP ${res.status} from edge function — not deployed/published yet.`);
        return false;
      }
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setHealthState("down");
        setHealthMsg("Edge function reachable but returned an unexpected payload.");
        return false;
      }
      setHealthState("ok");
      setHealthMsg(`Edge function healthy at ${new Date(json.time).toLocaleTimeString()}`);
      return true;
    } catch (e: any) {
      setHealthState("down");
      setHealthMsg(
        e?.name === "AbortError"
          ? "Health check timed out — function is unreachable."
          : `Network error: ${e?.message || "unknown"} — function not deployed/published.`
      );
      return false;
    }
  };

  const runCrawlerVerify = async () => {
    setVerifyError("");
    setVerifyReport(null);
    setVerifyLoading(true);
    try {
      setVerifyStage("Pinging edge function health…");
      const healthy = await checkHealth();
      if (!healthy) {
        const msg = healthMsg || "Edge function unreachable. Deploy + publish, then retry.";
        setVerifyError(msg);
        toast({
          title: "Edge function unreachable",
          description: msg,
          variant: "destructive",
        });
        return;
      }
      setVerifyStage("Fetching production HTML + favicon hashes…");
      const { data, error } = await supabase.functions.invoke("seo-crawler-verify");
      if (error) throw error;
      if (!data) throw new Error("Empty response from edge function.");
      setVerifyReport(data);
      toast({ title: "Crawler verification complete" });
    } catch (e: any) {
      const msg = e?.message || e?.error_description || "Unknown error — see browser console.";
      setVerifyError(msg);
      toast({
        title: "Verification failed",
        description: msg,
        variant: "destructive",
      });
      // eslint-disable-next-line no-console
      console.error("[CrawlerVerify] failed:", e);
    } finally {
      setVerifyLoading(false);
      setVerifyStage("");
    }
  };

  useEffect(() => {
    const fetchAll = async () => {
      const [{ data: globalData }, { data: pagesData }, { data: robotsData }, { data: schemaData }] = await Promise.all([
        supabase.from("site_settings").select("value").eq("key", "seo_global").maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "seo_pages").maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "seo_robots").maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "seo_schemas").maybeSingle(),
      ]);
      if (globalData?.value) setGlobalSEO({ ...defaultGlobalSEO, ...(globalData.value as any) });
      if (pagesData?.value && Array.isArray(pagesData.value)) setPageSEOList(pagesData.value as unknown as PageSEO[]);
      if (robotsData?.value) setRobotsTxt((robotsData.value as any).content || defaultRobotsTxt);
      if (schemaData?.value && Array.isArray(schemaData.value)) setSchemas(schemaData.value as any);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const saveGlobal = async () => {
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "seo_global",
      value: globalSEO as any,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      queryClient.setQueryData(["site-setting", "seo_global"], globalSEO);
      queryClient.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Global SEO settings saved" });
    }
  };

  const savePages = async () => {
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "seo_pages",
      value: pageSEOList as any,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      queryClient.setQueryData(["site-setting", "seo_pages"], pageSEOList);
      queryClient.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Page SEO settings saved" });
    }
  };

  const saveRobots = async () => {
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "seo_robots",
      value: { content: robotsTxt } as any,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Robots.txt saved" });
  };

  const saveSchemas = async () => {
    // Validate all JSON before saving
    for (let i = 0; i < schemas.length; i++) {
      try {
        JSON.parse(schemas[i].json);
      } catch {
        toast({ title: "Invalid JSON", description: `Schema "${schemas[i].name || `#${i + 1}`}" has invalid JSON. Please fix it before saving.`, variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "seo_schemas",
      value: schemas as any,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      queryClient.setQueryData(["site-setting", "seo_schemas"], schemas);
      queryClient.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Schema markup saved" });
    }
  };

  const addSchema = () => {
    setSchemas((prev) => [...prev, {
      name: "New Schema",
      json: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "",
        "url": ""
      }, null, 2),
    }]);
  };

  const removeSchema = (idx: number) => {
    setSchemas((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSchema = (idx: number, field: "name" | "json", value: string) => {
    setSchemas((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const formatSchemaJson = (idx: number) => {
    try {
      const parsed = JSON.parse(schemas[idx].json);
      updateSchema(idx, "json", JSON.stringify(parsed, null, 2));
      toast({ title: "JSON formatted" });
    } catch {
      toast({ title: "Invalid JSON — cannot format", variant: "destructive" });
    }
  };

  const addPageSEO = () => {
    setPageSEOList((prev) => [...prev, { path: "/", title: "", description: "", og_image: "", noindex: false }]);
  };

  const removePageSEO = (idx: number) => {
    setPageSEOList((prev) => prev.filter((_, i) => i !== idx));
  };

  const updatePageSEO = (idx: number, field: keyof PageSEO, value: any) => {
    setPageSEOList((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const generateSitemap = async () => {
    const base = globalSEO.canonical_base || "https://50mmretina.com";

    // Fetch dynamic slugs
    const [{ data: articles }, { data: courses }, { data: comps }, { data: artists }] = await Promise.all([
      supabase.from("journal_articles").select("slug, updated_at").eq("status", "published").order("updated_at", { ascending: false }),
      supabase.from("courses").select("slug, updated_at").eq("status", "published").order("updated_at", { ascending: false }),
      supabase.from("competitions").select("id, updated_at").order("updated_at", { ascending: false }),
      supabase.from("featured_artists").select("slug, updated_at").eq("is_active", true),
    ]);

    const urls: { loc: string; lastmod: string; priority: string }[] = [];

    // Static routes
    const staticRoutes = [
      { path: "/", priority: "1.0" },
      { path: "/competitions", priority: "0.9" },
      { path: "/journal", priority: "0.9" },
      { path: "/courses", priority: "0.9" },
      { path: "/winners", priority: "0.8" },
      { path: "/certificates", priority: "0.6" },
      { path: "/discover", priority: "0.7" },
      { path: "/login", priority: "0.3" },
      { path: "/signup", priority: "0.4" },
    ];

    staticRoutes.forEach((r) => urls.push({ loc: `${base}${r.path}`, lastmod: new Date().toISOString().split("T")[0], priority: r.priority }));

    // Dynamic journal articles
    (articles || []).forEach((a) => urls.push({
      loc: `${base}/journal/${a.slug}`,
      lastmod: (a.updated_at || new Date().toISOString()).split("T")[0],
      priority: "0.7",
    }));

    // Dynamic courses
    (courses || []).forEach((c) => urls.push({
      loc: `${base}/courses/${c.slug}`,
      lastmod: (c.updated_at || new Date().toISOString()).split("T")[0],
      priority: "0.7",
    }));

    // Dynamic competitions
    (comps || []).forEach((c) => urls.push({
      loc: `${base}/competitions/${c.id}`,
      lastmod: (c.updated_at || new Date().toISOString()).split("T")[0],
      priority: "0.6",
    }));

    // Featured artists
    (artists || []).forEach((a) => urls.push({
      loc: `${base}/featured-artist/${a.slug}`,
      lastmod: (a.updated_at || new Date().toISOString()).split("T")[0],
      priority: "0.6",
    }));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

    setSitemapPreview(xml);
    toast({ title: `Sitemap generated with ${urls.length} URLs` });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inputClass = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 text-sm transition-colors duration-500";
  const labelClass = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";
  const headingFont = { fontFamily: "var(--font-heading)" } as const;
  const bodyFont = { fontFamily: "var(--font-body)" } as const;

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Globe className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
          SEO <em className="italic text-primary">Settings</em>
        </h2>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="bg-card border border-border mb-8">
          <TabsTrigger value="global" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Globe className="h-3.5 w-3.5 mr-1.5" /> Global SEO
          </TabsTrigger>
          <TabsTrigger value="pages" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Page-Level
          </TabsTrigger>
          <TabsTrigger value="sitemap" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Map className="h-3.5 w-3.5 mr-1.5" /> Sitemap
          </TabsTrigger>
          <TabsTrigger value="robots" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Bot className="h-3.5 w-3.5 mr-1.5" /> Robots.txt
          </TabsTrigger>
          <TabsTrigger value="schema" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Code2 className="h-3.5 w-3.5 mr-1.5" /> Schema
          </TabsTrigger>
          <TabsTrigger value="verify" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Crawler Verify
          </TabsTrigger>
        </TabsList>

        {/* Global SEO */}
        <TabsContent value="global">
          <div className="border border-border p-6 space-y-5">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={headingFont}>Title Template</label>
                <input value={globalSEO.title_template} onChange={(e) => setGlobalSEO((p) => ({ ...p, title_template: e.target.value }))} className={inputClass} style={bodyFont} placeholder="%s — 50mm Retina World" />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>Use %s as page title placeholder</p>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Default Title</label>
                <input value={globalSEO.default_title} onChange={(e) => setGlobalSEO((p) => ({ ...p, default_title: e.target.value }))} className={inputClass} style={bodyFont} placeholder="50mm Retina World" />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass} style={headingFont}>Default Description</label>
                <textarea value={globalSEO.default_description} onChange={(e) => setGlobalSEO((p) => ({ ...p, default_description: e.target.value }))} className={`${inputClass} resize-none`} rows={3} style={bodyFont} placeholder="Site description for search engines..." />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>{globalSEO.default_description.length}/160 characters</p>
              </div>
              <div className="md:col-span-2">
                <label className={labelClass} style={headingFont}>Default OG Image</label>
                {globalSEO.default_og_image && (
                  <div className="mb-3 relative inline-block">
                    <img loading="lazy" decoding="async" src={globalSEO.default_og_image} alt="OG Preview" className="h-24 rounded-sm border border-border object-cover" />
                    <button type="button" onClick={() => setGlobalSEO((p) => ({ ...p, default_og_image: "" }))} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <FileUploadDropZone
                  bucket="site-assets"
                  folder="seo"
                  allowedTypes="image"
                  compressImages={false}
                  showGallery={false}
                  compact
                  label="Upload OG image (1200×630 recommended)"
                  onFileUploaded={(f: UploadedFile) => setGlobalSEO((p) => ({ ...p, default_og_image: f.url }))}
                />
                <input value={globalSEO.default_og_image} onChange={(e) => setGlobalSEO((p) => ({ ...p, default_og_image: e.target.value }))} className={`${inputClass} mt-2`} style={bodyFont} placeholder="Or paste URL: https://..." />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Site Name</label>
                <input value={globalSEO.site_name} onChange={(e) => setGlobalSEO((p) => ({ ...p, site_name: e.target.value }))} className={inputClass} style={bodyFont} />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Twitter Handle</label>
                <input value={globalSEO.twitter_handle} onChange={(e) => setGlobalSEO((p) => ({ ...p, twitter_handle: e.target.value }))} className={inputClass} style={bodyFont} placeholder="@yourhandle" />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Canonical Base URL</label>
                <input value={globalSEO.canonical_base} onChange={(e) => setGlobalSEO((p) => ({ ...p, canonical_base: e.target.value }))} className={inputClass} style={bodyFont} placeholder="https://yourdomain.com" />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Google Verification Code</label>
                <input value={globalSEO.google_verification} onChange={(e) => setGlobalSEO((p) => ({ ...p, google_verification: e.target.value }))} className={inputClass} style={bodyFont} placeholder="google-site-verification=..." />
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Bing Verification Code</label>
                <input value={globalSEO.bing_verification} onChange={(e) => setGlobalSEO((p) => ({ ...p, bing_verification: e.target.value }))} className={inputClass} style={bodyFont} placeholder="msvalidate.01=..." />
              </div>
            </div>
            <button onClick={saveGlobal} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Global SEO
            </button>
          </div>
        </TabsContent>

        {/* Page-Level SEO */}
        <TabsContent value="pages">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
                {pageSEOList.length} page override{pageSEOList.length !== 1 ? "s" : ""}
              </span>
              <button onClick={addPageSEO} className="inline-flex items-center gap-2 px-4 py-2 text-xs tracking-[0.15em] uppercase border border-border hover:border-primary hover:text-primary transition-all" style={headingFont}>
                <Plus className="h-3.5 w-3.5" /> Add Page
              </button>
            </div>

            {pageSEOList.map((page, idx) => (
              <div key={idx} className="border border-border p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-primary" style={headingFont}>Page #{idx + 1}</span>
                  <button onClick={() => removePageSEO(idx)} className="text-destructive hover:opacity-70"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass} style={headingFont}>Path</label>
                    <select value={page.path} onChange={(e) => updatePageSEO(idx, "path", e.target.value)} className={inputClass} style={bodyFont}>
                      {knownRoutes.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} style={headingFont}>Custom Title</label>
                    <input value={page.title} onChange={(e) => updatePageSEO(idx, "title", e.target.value)} className={inputClass} style={bodyFont} placeholder="Page title..." />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass} style={headingFont}>Meta Description</label>
                    <textarea value={page.description} onChange={(e) => updatePageSEO(idx, "description", e.target.value)} className={`${inputClass} resize-none`} rows={2} style={bodyFont} placeholder="Page description..." />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass} style={headingFont}>OG Image Override</label>
                    {page.og_image && (
                      <div className="mb-2 relative inline-block">
                        <img loading="lazy" decoding="async" src={page.og_image} alt="OG Preview" className="h-16 rounded-sm border border-border object-cover" />
                        <button type="button" onClick={() => updatePageSEO(idx, "og_image", "")} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5">
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    )}
                    <FileUploadDropZone
                      bucket="site-assets"
                      folder={`seo/pages`}
                      allowedTypes="image"
                      compressImages={false}
                      showGallery={false}
                      compact
                      label="Upload OG image"
                      onFileUploaded={(f: UploadedFile) => updatePageSEO(idx, "og_image", f.url)}
                    />
                    <input value={page.og_image} onChange={(e) => updatePageSEO(idx, "og_image", e.target.value)} className={`${inputClass} mt-2`} style={bodyFont} placeholder="Or paste URL: https://..." />
                  </div>
                  <div className="flex items-center gap-3 pt-5">
                    <input type="checkbox" checked={page.noindex} onChange={(e) => updatePageSEO(idx, "noindex", e.target.checked)} className="accent-primary" />
                    <label className="text-xs text-muted-foreground" style={bodyFont}>noindex (hide from search engines)</label>
                  </div>
                </div>
              </div>
            ))}

            {pageSEOList.length === 0 && (
              <div className="text-center py-12 border border-dashed border-border">
                <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground" style={bodyFont}>No page-level SEO overrides yet. Add one to customize individual pages.</p>
              </div>
            )}

            {pageSEOList.length > 0 && (
              <button onClick={savePages} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Page SEO
              </button>
            )}
          </div>
        </TabsContent>

        {/* Sitemap Generator */}
        <TabsContent value="sitemap">
          <div className="space-y-6">
            <div className="border border-border p-6">
              <p className="text-sm text-muted-foreground mb-4" style={bodyFont}>
                Generate an XML sitemap based on all published content. This includes static pages, journal articles, courses, competitions, and featured artists.
              </p>
              <button onClick={generateSitemap} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity" style={headingFont}>
                <RefreshCw className="h-3.5 w-3.5" /> Generate Sitemap
              </button>
            </div>

            {sitemapPreview && (
              <div className="border border-border p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs tracking-[0.2em] uppercase text-primary" style={headingFont}>Sitemap Preview</span>
                  <button onClick={() => {
                    navigator.clipboard.writeText(sitemapPreview);
                    toast({ title: "Sitemap XML copied to clipboard" });
                  }} className="text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-primary transition-colors" style={headingFont}>
                    Copy XML
                  </button>
                </div>
                <pre className="bg-muted/30 p-4 rounded text-[11px] text-foreground/80 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre" style={bodyFont}>
                  {sitemapPreview}
                </pre>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Robots.txt Editor */}
        <TabsContent value="robots">
          <div className="border border-border p-6 space-y-5">
            <p className="text-sm text-muted-foreground" style={bodyFont}>
              Edit your robots.txt directives. This controls which pages search engine crawlers can access.
            </p>
            <div>
              <label className={labelClass} style={headingFont}>Robots.txt Content</label>
              <textarea
                value={robotsTxt}
                onChange={(e) => setRobotsTxt(e.target.value)}
                className="w-full bg-muted/20 border border-border focus:border-primary outline-none p-4 text-sm font-mono transition-colors duration-500 rounded resize-y"
                rows={12}
                style={bodyFont}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={saveRobots} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Robots.txt
              </button>
              <button onClick={() => setRobotsTxt(defaultRobotsTxt)} className="px-5 py-2.5 text-xs tracking-[0.15em] uppercase border border-border hover:border-primary hover:text-primary transition-all" style={headingFont}>
                Reset to Default
              </button>
            </div>
          </div>
        </TabsContent>

        {/* Schema Markup */}
        <TabsContent value="schema">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground" style={bodyFont}>
                Manage JSON-LD structured data schemas for search engines.
              </p>
              <button onClick={addSchema} className="inline-flex items-center gap-2 px-4 py-2 text-xs tracking-[0.15em] uppercase border border-border hover:border-primary hover:text-primary transition-all shrink-0" style={headingFont}>
                <Plus className="h-3.5 w-3.5" /> Add Schema
              </button>
            </div>

            {/* ── Summary Table ── */}
            {schemas.length > 0 && (
              <div className="border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-4 py-3 w-12" style={headingFont}>#</th>
                      <th className="text-left text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-4 py-3 w-[200px] min-w-[140px]" style={headingFont}>Name</th>
                      <th className="text-left text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-4 py-3 w-[160px] min-w-[120px]" style={headingFont}>@type</th>
                      <th className="text-center text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-4 py-3 w-[80px]" style={headingFont}>Valid</th>
                      <th className="text-center text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-4 py-3 w-[100px]" style={headingFont}>Size</th>
                      <th className="text-right text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-4 py-3 w-[120px]" style={headingFont}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schemas.map((schema, idx) => {
                      let isValid = true;
                      let schemaType = "—";
                      try {
                        const parsed = JSON.parse(schema.json);
                        schemaType = parsed?.["@type"] || "—";
                      } catch { isValid = false; }

                      return (
                        <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground" style={bodyFont}>{idx + 1}</td>
                          <td className="px-4 py-3 truncate max-w-[200px]" style={bodyFont}>{schema.name || <span className="text-muted-foreground italic">Unnamed</span>}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-primary/10 text-primary text-[11px]" style={headingFont}>
                              {schemaType}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isValid
                              ? <span className="text-primary text-[10px] tracking-wider uppercase" style={headingFont}>✓ Valid</span>
                              : <span className="text-destructive text-[10px] tracking-wider uppercase" style={headingFont}>✗ Invalid</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground text-xs" style={bodyFont}>
                            {(schema.json.length / 1024).toFixed(1)} KB
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button onClick={() => setEditingSchemaIdx(editingSchemaIdx === idx ? null : idx)} className="px-2 py-1 text-[10px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors" style={headingFont}>
                                {editingSchemaIdx === idx ? "Close" : "Edit"}
                              </button>
                              <button onClick={() => formatSchemaJson(idx)} className="px-2 py-1 text-[10px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors" style={headingFont}>
                                Format
                              </button>
                              <button onClick={() => removeSchema(idx)} className="text-destructive/60 hover:text-destructive transition-colors p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Inline Editor (expands below table) ── */}
            {editingSchemaIdx !== null && schemas[editingSchemaIdx] && (() => {
              const idx = editingSchemaIdx;
              const schema = schemas[idx];
              let isValid = true;
              try { JSON.parse(schema.json); } catch { isValid = false; }

              return (
                <div className="border border-primary/30 bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-primary" style={headingFont}>Editing: {schema.name || `Schema #${idx + 1}`}</span>
                    <button onClick={() => setEditingSchemaIdx(null)} className="text-xs text-muted-foreground hover:text-primary transition-colors" style={headingFont}>✕ Close</button>
                  </div>
                  <div>
                    <label className={labelClass} style={headingFont}>Schema Name</label>
                    <input
                      value={schema.name}
                      onChange={(e) => updateSchema(idx, "name", e.target.value)}
                      className={inputClass}
                      style={bodyFont}
                      placeholder="e.g. Organization, WebSite, BreadcrumbList..."
                    />
                  </div>
                  <div>
                    <label className={labelClass} style={headingFont}>JSON-LD</label>
                    <textarea
                      value={schema.json}
                      onChange={(e) => updateSchema(idx, "json", e.target.value)}
                      className={`w-full bg-muted/20 border ${isValid ? "border-border" : "border-destructive"} focus:border-primary outline-none p-4 text-sm font-mono transition-colors duration-500 rounded resize-y`}
                      rows={14}
                      spellCheck={false}
                    />
                  </div>
                </div>
              );
            })()}

            {schemas.length === 0 && (
              <div className="text-center py-12 border border-dashed border-border">
                <Code2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground" style={bodyFont}>No schema markup added yet. Click "Add Schema" to create JSON-LD structured data.</p>
              </div>
            )}

            {schemas.length > 0 && (
              <button onClick={saveSchemas} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Schemas
              </button>
            )}
          </div>
        </TabsContent>

        {/* Crawler Verification */}
        <TabsContent value="verify" className="space-y-6">
          <CloudflareEdgeChecklist />
          <div className="border border-border p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm tracking-[0.2em] uppercase text-primary mb-1" style={headingFont}>
                  Production Crawler Verification
                </h3>
                <p className="text-xs text-muted-foreground max-w-xl" style={bodyFont}>
                  Fetches the live HTML &amp; <code>/favicon.ico</code> from all production
                  domains using a Googlebot user-agent, then computes SHA-256 hashes so you
                  can prove exactly what Google will see on its next crawl.
                </p>
              </div>
              <button
                onClick={runCrawlerVerify}
                disabled={verifyLoading}
                aria-busy={verifyLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-wait"
                style={headingFont}
              >
                {verifyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {verifyLoading ? "Verifying…" : "Run Verification"}
              </button>
            </div>

            {verifyLoading && verifyStage && (
              <div className="flex items-center gap-2 border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-primary" style={bodyFont}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{verifyStage}</span>
              </div>
            )}

            {verifyError && !verifyLoading && (
              <div className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive" style={bodyFont}>
                <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="uppercase tracking-[0.15em] text-[10px] mb-0.5" style={headingFont}>Verification failed</div>
                  <div className="break-words">{verifyError}</div>
                </div>
                <button
                  onClick={runCrawlerVerify}
                  className="text-[10px] tracking-[0.2em] uppercase px-2 py-1 border border-destructive/40 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  style={headingFont}
                >
                  Retry
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border border-border bg-muted/10 p-3">
              <div className="flex items-center gap-2 text-[11px]" style={bodyFont}>
                {healthState === "ok" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {healthState === "down" && <XCircle className="h-4 w-4 text-destructive" />}
                {healthState === "checking" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {healthState === "unknown" && <ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                <span className="uppercase tracking-[0.15em] text-[10px]" style={headingFont}>
                  Edge Function:&nbsp;
                  {healthState === "ok" && <span className="text-green-500">Deployed &amp; Reachable</span>}
                  {healthState === "down" && <span className="text-destructive">Not deployed / Not published</span>}
                  {healthState === "checking" && <span>Checking…</span>}
                  {healthState === "unknown" && <span>Not yet checked</span>}
                </span>
                {healthMsg && <span className="text-muted-foreground ml-2">{healthMsg}</span>}
              </div>
              <button
                onClick={checkHealth}
                disabled={healthState === "checking"}
                className="text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                style={headingFont}
              >
                Check health
              </button>
            </div>

            {healthState === "down" && (
              <div className="border border-destructive/40 bg-destructive/10 text-destructive text-[11px] p-3" style={bodyFont}>
                The <code>seo-crawler-verify</code> edge function is unreachable. This usually means
                the latest code hasn’t been deployed/published yet. Click <strong>Publish</strong> in
                the top-right, wait ~30s, then re-run health check.
              </div>
            )}

            {verifyReport?.summary && (
              <div className="border border-border bg-muted/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {verifyReport.summary.faviconConsistentAcrossDomains ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-xs tracking-[0.15em] uppercase" style={headingFont}>
                    Favicon {verifyReport.summary.faviconConsistentAcrossDomains ? "consistent" : "DRIFT"} across {verifyReport.reports?.length} domains
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground" style={bodyFont}>
                  Generated {new Date(verifyReport.summary.generatedAt).toLocaleString()}
                </div>
                <div className="text-[11px]" style={bodyFont}>
                  Unique favicon hashes:{" "}
                  {verifyReport.summary.uniqueFaviconHashes?.map((h: string) => (
                    <code key={h} className="ml-1 px-1.5 py-0.5 bg-muted rounded text-[10px]">{h.slice(0, 16)}…</code>
                  ))}
                </div>
              </div>
            )}

            {verifyReport?.reports?.map((r: any) => (
              <div key={r.origin} className="border border-border p-4 space-y-3">
                <div className="text-xs tracking-[0.2em] uppercase text-primary" style={headingFont}>{r.origin}</div>

                <div className="grid md:grid-cols-2 gap-4 text-[11px]" style={bodyFont}>
                  <div className="space-y-1">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px]">HTML</div>
                    <div>Status: <code>{r.html?.status ?? "—"}</code></div>
                    <div>Bytes: <code>{r.html?.bytes ?? "—"}</code></div>
                    <div className="break-all">SHA-256: <code>{r.html?.sha256 ?? "—"}</code></div>
                    <div className="break-all">Title: <code>{r.html?.tags?.title ?? "—"}</code></div>
                    <div className="break-all">Canonical: <code>{r.html?.tags?.canonical ?? "—"}</code></div>
                    <div>Icon links: <code>{r.html?.tags?.iconLinks?.length ?? 0}</code></div>
                    <div>JSON-LD blocks: <code>{r.html?.tags?.jsonLd ?? 0}</code></div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Favicon (/favicon.ico)</div>
                    <div>Status: <code>{r.favicon?.status ?? "—"}</code></div>
                    <div>Bytes: <code>{r.favicon?.bytes ?? "—"}</code></div>
                    <div>Content-Type: <code>{r.favicon?.contentType ?? "—"}</code></div>
                    <div>ETag: <code>{r.favicon?.etag ?? "—"}</code></div>
                    <div className="break-all">SHA-256: <code>{r.favicon?.sha256 ?? "—"}</code></div>
                    <div className="break-all">Cache-Control: <code>{r.favicon?.cacheControl ?? "—"}</code></div>
                  </div>
                </div>

                {r.html?.tags?.iconLinks?.length > 0 && (
                  <details className="text-[11px]" style={bodyFont}>
                    <summary className="cursor-pointer text-muted-foreground">Raw &lt;link rel="icon"&gt; tags</summary>
                    <pre className="bg-muted/30 p-2 mt-2 overflow-x-auto rounded text-[10px]">
                      {r.html.tags.iconLinks.join("\n")}
                    </pre>
                  </details>
                )}
              </div>
            ))}

            {/* ── Per-route diff + JSON-LD + OG preview (Loop E §5.E) ── */}
            {verifyReport?.routes?.length > 0 && (
              <div className="border border-border p-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs tracking-[0.2em] uppercase text-primary" style={headingFont}>
                    Per-Route Diff &nbsp;·&nbsp; Bot vs Human UA
                  </div>
                  <div className="flex items-center gap-3 text-[10px] tracking-[0.15em] uppercase" style={headingFont}>
                    <span className="text-muted-foreground">
                      Sampled <code className="text-foreground">{verifyReport.summary?.perRoute?.sampled ?? 0}</code>
                    </span>
                    <span className={verifyReport.summary?.perRoute?.botRewriteDetected ? "text-green-500" : "text-amber-500"}>
                      {verifyReport.summary?.perRoute?.botRewriteDetected
                        ? `Worker rewriting ${verifyReport.summary.perRoute.rewrittenCount} route(s)`
                        : "No <head> rewrite detected (Loop D not live yet)"}
                    </span>
                    <span className={verifyReport.summary?.perRoute?.jsonLdInvalidCount > 0 ? "text-destructive" : "text-green-500"}>
                      JSON-LD invalid: <code>{verifyReport.summary?.perRoute?.jsonLdInvalidCount ?? 0}</code>
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {verifyReport.routes.map((rt: any) => (
                    <div key={rt.url} className="border border-border bg-muted/5 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-[11px]" style={bodyFont}>
                          <span className="text-muted-foreground uppercase tracking-[0.15em] text-[10px] mr-2" style={headingFont}>
                            {rt.family}
                          </span>
                          <code className="text-foreground">{rt.path}</code>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase" style={headingFont}>
                          {rt.diff?.headDiffers ? (
                            <span className="inline-flex items-center gap-1 text-green-500">
                              <CheckCircle2 className="h-3 w-3" /> Head differs
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <XCircle className="h-3 w-3" /> Identical
                            </span>
                          )}
                          {rt.jsonLdSummary?.invalid > 0 && (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <XCircle className="h-3 w-3" /> {rt.jsonLdSummary.invalid} bad JSON-LD
                            </span>
                          )}
                          {rt.jsonLdSummary?.valid > 0 && rt.jsonLdSummary?.invalid === 0 && (
                            <span className="inline-flex items-center gap-1 text-green-500">
                              <CheckCircle2 className="h-3 w-3" /> {rt.jsonLdSummary.valid} JSON-LD ok
                            </span>
                          )}
                        </div>
                      </div>

                      {/* OG preview card — what social scrapers would render */}
                      {(rt.ogPreview?.title || rt.ogPreview?.image) && (
                        <div className="border border-border bg-background overflow-hidden flex">
                          {rt.ogPreview.image && (
                            <div className="w-32 h-20 shrink-0 bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={rt.ogPreview.image}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          )}
                          <div className="flex-1 p-2 min-w-0" style={bodyFont}>
                            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground truncate">
                              {rt.ogPreview.url || rt.url}
                            </div>
                            <div className="text-[12px] font-medium text-foreground truncate">
                              {rt.ogPreview.title || "(no og:title)"}
                            </div>
                            <div className="text-[10px] text-muted-foreground line-clamp-2">
                              {rt.ogPreview.description || "(no og:description)"}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Bot vs Human side-by-side head signals */}
                      <div className="grid md:grid-cols-2 gap-3 text-[10px]" style={bodyFont}>
                        <div className="space-y-0.5">
                          <div className="text-muted-foreground uppercase tracking-[0.15em]" style={headingFont}>Googlebot UA</div>
                          <div>SHA: <code>{rt.bot?.sha256?.slice(0, 16)}…</code></div>
                          <div className="truncate">Title: <code>{rt.bot?.tags?.title}</code></div>
                          <div className="truncate">Canonical: <code>{rt.bot?.tags?.canonical}</code></div>
                          <div>JSON-LD: <code>{rt.bot?.tags?.jsonLd}</code></div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="text-muted-foreground uppercase tracking-[0.15em]" style={headingFont}>Default UA</div>
                          <div>SHA: <code>{rt.human?.sha256?.slice(0, 16)}…</code></div>
                          <div className="truncate">Title: <code>{rt.human?.tags?.title}</code></div>
                          <div className="truncate">Canonical: <code>{rt.human?.tags?.canonical}</code></div>
                          <div>JSON-LD: <code>{rt.human?.tags?.jsonLd}</code></div>
                        </div>
                      </div>

                      {rt.jsonLdSummary?.invalid > 0 && (
                        <details className="text-[10px]" style={bodyFont}>
                          <summary className="cursor-pointer text-destructive">
                            JSON-LD parse errors ({rt.jsonLdSummary.invalid})
                          </summary>
                          <pre className="bg-destructive/10 text-destructive p-2 mt-1 overflow-x-auto rounded text-[10px]">
                            {rt.jsonLdSummary.errors?.join("\n")}
                          </pre>
                        </details>
                      )}

                      {rt.bot?.jsonLd?.length > 0 && (
                        <details className="text-[10px]" style={bodyFont}>
                          <summary className="cursor-pointer text-muted-foreground">
                            Raw JSON-LD blocks (bot UA)
                          </summary>
                          <pre className="bg-muted/30 p-2 mt-1 overflow-x-auto rounded text-[10px]">
                            {rt.bot.jsonLd.map((b: any, i: number) =>
                              `--- block ${i + 1} (${b.valid ? b.type : "INVALID"}) ---\n${b.raw}`
                            ).join("\n\n")}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!verifyReport && !verifyLoading && (
              <div className="text-center py-12 border border-dashed border-border">
                <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground" style={bodyFont}>
                  Click "Run Verification" to fetch live production HTML + favicon hashes,
                  per-route bot-vs-human diff, JSON-LD validity, and OG previews.
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}