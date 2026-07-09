import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Zap, Image, FileCode, Database, Globe2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { User } from "@supabase/supabase-js";

interface LazyLoadSettings {
  images: boolean;
  iframes: boolean;
  videos: boolean;
  offscreen_components: boolean;
  intersection_threshold: string;
  placeholder_blur: boolean;
}

interface MinifySettings {
  minify_html: boolean;
  minify_css: boolean;
  minify_js: boolean;
  remove_comments: boolean;
  compress_images: boolean;
  image_quality: number;
  webp_conversion: boolean;
}

interface CacheSettings {
  static_assets_max_age: string;
  api_cache_ttl: string;
  html_cache_ttl: string;
  image_cache_ttl: string;
  service_worker_enabled: boolean;
  stale_while_revalidate: boolean;
  cache_busting_enabled: boolean;
}

interface CDNSettings {
  cdn_enabled: boolean;
  cdn_provider: string;
  cdn_url: string;
  edge_caching: boolean;
  geo_routing: boolean;
  auto_purge_on_deploy: boolean;
}

const defaultLazyLoad: LazyLoadSettings = {
  images: true,
  iframes: true,
  videos: true,
  offscreen_components: true,
  intersection_threshold: "200",
  placeholder_blur: true,
};

const defaultMinify: MinifySettings = {
  minify_html: true,
  minify_css: true,
  minify_js: true,
  remove_comments: true,
  compress_images: true,
  image_quality: 80,
  webp_conversion: true,
};

const defaultCache: CacheSettings = {
  static_assets_max_age: "31536000",
  api_cache_ttl: "300",
  html_cache_ttl: "3600",
  image_cache_ttl: "604800",
  service_worker_enabled: false,
  stale_while_revalidate: true,
  cache_busting_enabled: true,
};

const defaultCDN: CDNSettings = {
  cdn_enabled: false,
  cdn_provider: "cloudflare",
  cdn_url: "",
  edge_caching: true,
  geo_routing: false,
  auto_purge_on_deploy: true,
};

const cacheDurations: { value: string; label: string }[] = [
  { value: "0", label: "No cache" },
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "900", label: "15 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "1 week" },
  { value: "2592000", label: "30 days" },
  { value: "31536000", label: "1 year" },
];

export default function AdminPerformance({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const [lazyLoad, setLazyLoad] = useState<LazyLoadSettings>(defaultLazyLoad);
  const [minify, setMinify] = useState<MinifySettings>(defaultMinify);
  const [cache, setCache] = useState<CacheSettings>(defaultCache);
  const [cdn, setCDN] = useState<CDNSettings>(defaultCDN);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("lazyload");

  useEffect(() => {
    const fetchAll = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["perf_lazyload", "perf_minify", "perf_cache", "perf_cdn"]);

      if (data) {
        for (const row of data) {
          if (row.key === "perf_lazyload") setLazyLoad({ ...defaultLazyLoad, ...(row.value as any) });
          if (row.key === "perf_minify") setMinify({ ...defaultMinify, ...(row.value as any) });
          if (row.key === "perf_cache") setCache({ ...defaultCache, ...(row.value as any) });
          if (row.key === "perf_cdn") setCDN({ ...defaultCDN, ...(row.value as any) });
        }
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  const saveSetting = async (key: string, value: any) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: "key" }
    );
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      qc.setQueryData(["site-setting", key], value);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Settings saved" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const headingFont = { fontFamily: "var(--font-heading)" } as const;
  const bodyFont = { fontFamily: "var(--font-body)" } as const;
  const labelClass = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";
  const inputClass = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 text-sm transition-colors duration-500";

  const Toggle = ({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description: string }) => (
    <label className="flex items-center justify-between py-3 px-4 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer">
      <div>
        <span className="text-sm font-medium text-foreground" style={bodyFont}>{label}</span>
        <p className="text-[10px] text-muted-foreground mt-0.5" style={bodyFont}>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </label>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Zap className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
          Performance <em className="italic text-primary">Optimization</em>
        </h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border border-border mb-8">
          <TabsTrigger value="lazyload" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Image className="h-3.5 w-3.5 mr-1.5" /> Lazy Load
          </TabsTrigger>
          <TabsTrigger value="minify" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <FileCode className="h-3.5 w-3.5 mr-1.5" /> Minify Assets
          </TabsTrigger>
          <TabsTrigger value="cache" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Database className="h-3.5 w-3.5 mr-1.5" /> Cache Controls
          </TabsTrigger>
          <TabsTrigger value="cdn" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Globe2 className="h-3.5 w-3.5 mr-1.5" /> CDN Toggle
          </TabsTrigger>
        </TabsList>

        {/* Lazy Load */}
        <TabsContent value="lazyload">
          <div className="border border-border p-6 space-y-1">
            <p className="text-sm text-muted-foreground mb-4 px-4" style={bodyFont}>
              Defer loading of off-screen resources until they're needed. Improves initial page load time.
            </p>

            <Toggle checked={lazyLoad.images} onChange={() => setLazyLoad((p) => ({ ...p, images: !p.images }))} label="Images" description="Lazy load all images below the fold" />
            <Toggle checked={lazyLoad.iframes} onChange={() => setLazyLoad((p) => ({ ...p, iframes: !p.iframes }))} label="Iframes" description="Lazy load embedded videos and iframes" />
            <Toggle checked={lazyLoad.videos} onChange={() => setLazyLoad((p) => ({ ...p, videos: !p.videos }))} label="Videos" description="Defer video loading until visible" />
            <Toggle checked={lazyLoad.offscreen_components} onChange={() => setLazyLoad((p) => ({ ...p, offscreen_components: !p.offscreen_components }))} label="Off-screen Components" description="Defer rendering of off-screen React components" />
            <Toggle checked={lazyLoad.placeholder_blur} onChange={() => setLazyLoad((p) => ({ ...p, placeholder_blur: !p.placeholder_blur }))} label="Blur Placeholders" description="Show a blurred placeholder while images load" />

            <div className="px-4 pt-4">
              <label className={labelClass} style={headingFont}>Intersection Observer Threshold (px)</label>
              <input
                type="number"
                value={lazyLoad.intersection_threshold}
                onChange={(e) => setLazyLoad((p) => ({ ...p, intersection_threshold: e.target.value }))}
                className={inputClass}
                style={bodyFont}
                placeholder="200"
              />
              <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>
                How many pixels before the viewport to start loading (higher = earlier preloading)
              </p>
            </div>

            <div className="px-4 pt-4">
              <button onClick={() => saveSetting("perf_lazyload", lazyLoad)} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Lazy Load Settings
              </button>
            </div>
          </div>
        </TabsContent>

        {/* Minify Assets */}
        <TabsContent value="minify">
          <div className="border border-border p-6 space-y-1">
            <p className="text-sm text-muted-foreground mb-4 px-4" style={bodyFont}>
              Reduce file sizes by removing unnecessary characters and optimizing assets.
            </p>

            <Toggle checked={minify.minify_html} onChange={() => setMinify((p) => ({ ...p, minify_html: !p.minify_html }))} label="Minify HTML" description="Remove whitespace and comments from HTML output" />
            <Toggle checked={minify.minify_css} onChange={() => setMinify((p) => ({ ...p, minify_css: !p.minify_css }))} label="Minify CSS" description="Compress CSS files and remove unused styles" />
            <Toggle checked={minify.minify_js} onChange={() => setMinify((p) => ({ ...p, minify_js: !p.minify_js }))} label="Minify JavaScript" description="Compress and tree-shake JavaScript bundles" />
            <Toggle checked={minify.remove_comments} onChange={() => setMinify((p) => ({ ...p, remove_comments: !p.remove_comments }))} label="Remove Comments" description="Strip all code comments from production builds" />
            <Toggle checked={minify.compress_images} onChange={() => setMinify((p) => ({ ...p, compress_images: !p.compress_images }))} label="Compress Images" description="Automatically compress uploaded images" />
            <Toggle checked={minify.webp_conversion} onChange={() => setMinify((p) => ({ ...p, webp_conversion: !p.webp_conversion }))} label="WebP Conversion" description="Convert images to WebP format for smaller file sizes" />

            <div className="px-4 pt-4">
              <label className={labelClass} style={headingFont}>Image Quality ({minify.image_quality}%)</label>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={minify.image_quality}
                onChange={(e) => setMinify((p) => ({ ...p, image_quality: parseInt(e.target.value) }))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1" style={bodyFont}>
                <span>10% (smallest)</span>
                <span>100% (best quality)</span>
              </div>
            </div>

            <div className="px-4 pt-4">
              <button onClick={() => saveSetting("perf_minify", minify)} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Minify Settings
              </button>
            </div>
          </div>
        </TabsContent>

        {/* Cache Controls */}
        <TabsContent value="cache">
          <div className="border border-border p-6 space-y-5">
            <p className="text-sm text-muted-foreground mb-4" style={bodyFont}>
              Configure how long different resources are cached in the browser and on edge servers.
            </p>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={headingFont}>Static Assets (JS/CSS/Fonts)</label>
                <select value={cache.static_assets_max_age} onChange={(e) => setCache((p) => ({ ...p, static_assets_max_age: e.target.value }))} className={inputClass} style={bodyFont}>
                  {cacheDurations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>API Responses</label>
                <select value={cache.api_cache_ttl} onChange={(e) => setCache((p) => ({ ...p, api_cache_ttl: e.target.value }))} className={inputClass} style={bodyFont}>
                  {cacheDurations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>HTML Pages</label>
                <select value={cache.html_cache_ttl} onChange={(e) => setCache((p) => ({ ...p, html_cache_ttl: e.target.value }))} className={inputClass} style={bodyFont}>
                  {cacheDurations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Images</label>
                <select value={cache.image_cache_ttl} onChange={(e) => setCache((p) => ({ ...p, image_cache_ttl: e.target.value }))} className={inputClass} style={bodyFont}>
                  {cacheDurations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1 mt-4">
              <Toggle checked={cache.service_worker_enabled} onChange={() => setCache((p) => ({ ...p, service_worker_enabled: !p.service_worker_enabled }))} label="Service Worker" description="Enable offline caching with a service worker" />
              <Toggle checked={cache.stale_while_revalidate} onChange={() => setCache((p) => ({ ...p, stale_while_revalidate: !p.stale_while_revalidate }))} label="Stale While Revalidate" description="Serve cached content while fetching fresh data in the background" />
              <Toggle checked={cache.cache_busting_enabled} onChange={() => setCache((p) => ({ ...p, cache_busting_enabled: !p.cache_busting_enabled }))} label="Cache Busting" description="Append hash to file names to invalidate cache on deploy" />
            </div>

            <button onClick={() => saveSetting("perf_cache", cache)} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50 mt-2" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Cache Settings
            </button>
          </div>
        </TabsContent>

        {/* CDN Toggle */}
        <TabsContent value="cdn">
          <div className="border border-border p-6 space-y-5">
            <p className="text-sm text-muted-foreground mb-4" style={bodyFont}>
              Serve assets from a Content Delivery Network for faster global delivery and reduced server load.
            </p>

            <div className="space-y-1">
              <Toggle checked={cdn.cdn_enabled} onChange={() => setCDN((p) => ({ ...p, cdn_enabled: !p.cdn_enabled }))} label="Enable CDN" description="Route static assets through a CDN for global edge delivery" />
            </div>

            {cdn.cdn_enabled && (
              <div className="space-y-5 pt-2">
                <div className="grid md:grid-cols-2 gap-5">
                  <div>
                    <label className={labelClass} style={headingFont}>CDN Provider</label>
                    <select value={cdn.cdn_provider} onChange={(e) => setCDN((p) => ({ ...p, cdn_provider: e.target.value }))} className={inputClass} style={bodyFont}>
                      <option value="cloudflare">Cloudflare</option>
                      <option value="bunnycdn">BunnyCDN</option>
                      <option value="aws_cloudfront">AWS CloudFront</option>
                      <option value="fastly">Fastly</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} style={headingFont}>CDN Base URL</label>
                    <input
                      value={cdn.cdn_url}
                      onChange={(e) => setCDN((p) => ({ ...p, cdn_url: e.target.value }))}
                      className={inputClass}
                      style={bodyFont}
                      placeholder="https://cdn.yourdomain.com"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Toggle checked={cdn.edge_caching} onChange={() => setCDN((p) => ({ ...p, edge_caching: !p.edge_caching }))} label="Edge Caching" description="Cache responses at CDN edge nodes for faster delivery" />
                  <Toggle checked={cdn.geo_routing} onChange={() => setCDN((p) => ({ ...p, geo_routing: !p.geo_routing }))} label="Geo Routing" description="Route requests to the nearest edge server based on user location" />
                  <Toggle checked={cdn.auto_purge_on_deploy} onChange={() => setCDN((p) => ({ ...p, auto_purge_on_deploy: !p.auto_purge_on_deploy }))} label="Auto-Purge on Deploy" description="Automatically purge CDN cache when new code is deployed" />
                </div>
              </div>
            )}

            <button onClick={() => saveSetting("perf_cdn", cdn)} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50 mt-2" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save CDN Settings
            </button>
          </div>

          <div className="border border-border/50 rounded-sm px-5 py-4 bg-muted/20 mt-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed" style={bodyFont}>
              <strong className="text-foreground">Note:</strong> CDN configuration requires DNS setup with your domain provider. After enabling, point your domain's CNAME to the CDN provider's endpoint. Changes may take up to 24 hours to fully propagate.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
