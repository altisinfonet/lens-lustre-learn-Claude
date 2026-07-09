import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, BarChart3, Code, Smartphone, ToggleLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { User } from "@supabase/supabase-js";

interface AnalyticsSettings {
  google_analytics_id: string;
  gtm_container_id: string;
  meta_pixel_id: string;
  twitter_pixel_id: string;
  pinterest_tag_id: string;
  linkedin_partner_id: string;
  custom_head_scripts: string;
  custom_body_scripts: string;
}

interface EventTrackingSettings {
  track_page_views: boolean;
  track_sign_ups: boolean;
  track_logins: boolean;
  track_competition_entries: boolean;
  track_course_enrollments: boolean;
  track_votes: boolean;
  track_comments: boolean;
  track_portfolio_views: boolean;
  track_wallet_transactions: boolean;
  track_article_reads: boolean;
}

const defaultAnalytics: AnalyticsSettings = {
  google_analytics_id: "",
  gtm_container_id: "",
  meta_pixel_id: "",
  twitter_pixel_id: "",
  pinterest_tag_id: "",
  linkedin_partner_id: "",
  custom_head_scripts: "",
  custom_body_scripts: "",
};

const defaultEventTracking: EventTrackingSettings = {
  track_page_views: true,
  track_sign_ups: true,
  track_logins: true,
  track_competition_entries: true,
  track_course_enrollments: true,
  track_votes: false,
  track_comments: false,
  track_portfolio_views: false,
  track_wallet_transactions: false,
  track_article_reads: true,
};

export default function AdminAnalytics({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const [analytics, setAnalytics] = useState<AnalyticsSettings>(defaultAnalytics);
  const [events, setEvents] = useState<EventTrackingSettings>(defaultEventTracking);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("google");

  useEffect(() => {
    const fetchAll = async () => {
      const [{ data: analyticsData }, { data: eventsData }] = await Promise.all([
        supabase.from("site_settings").select("value").eq("key", "analytics_settings").maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "event_tracking").maybeSingle(),
      ]);
      if (analyticsData?.value) setAnalytics({ ...defaultAnalytics, ...(analyticsData.value as any) });
      if (eventsData?.value) setEvents({ ...defaultEventTracking, ...(eventsData.value as any) });
      setLoading(false);
    };
    fetchAll();
  }, []);

  const sanitizeScripts = (settings: AnalyticsSettings): AnalyticsSettings => ({
    ...settings,
    custom_head_scripts: DOMPurify.sanitize(settings.custom_head_scripts, { ALLOWED_TAGS: ["script", "noscript", "link", "meta"], ADD_ATTR: ["async", "defer", "src", "type", "charset", "content", "name", "property", "rel", "href"] }),
    custom_body_scripts: DOMPurify.sanitize(settings.custom_body_scripts, { ALLOWED_TAGS: ["script", "noscript", "img", "iframe"], ADD_ATTR: ["async", "defer", "src", "type", "width", "height", "style"] }),
  });

  const saveAnalytics = async () => {
    if (!user) return;
    setSaving(true);
    const sanitized = sanitizeScripts(analytics);
    const { error } = await supabase.from("site_settings").upsert({
      key: "analytics_settings",
      value: sanitized as any,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    }, { onConflict: "key" });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      setAnalytics(sanitized);
      qc.setQueryData(["site-setting", "analytics_settings"], sanitized);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Analytics settings saved" });
    }
  };

  const saveEvents = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "event_tracking",
      value: events as any,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    }, { onConflict: "key" });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else {
      qc.setQueryData(["site-setting", "event_tracking"], events);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Event tracking settings saved" });
    }
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

  const eventToggles: { key: keyof EventTrackingSettings; label: string; description: string }[] = [
    { key: "track_page_views", label: "Page Views", description: "Track every page navigation" },
    { key: "track_sign_ups", label: "Sign Ups", description: "Track new user registrations" },
    { key: "track_logins", label: "Logins", description: "Track user login events" },
    { key: "track_competition_entries", label: "Competition Entries", description: "Track competition submissions" },
    { key: "track_course_enrollments", label: "Course Enrollments", description: "Track course enrollment events" },
    { key: "track_votes", label: "Votes", description: "Track competition voting" },
    { key: "track_comments", label: "Comments", description: "Track comment submissions" },
    { key: "track_portfolio_views", label: "Portfolio Views", description: "Track portfolio image views" },
    { key: "track_wallet_transactions", label: "Wallet Transactions", description: "Track wallet credit/debit events" },
    { key: "track_article_reads", label: "Article Reads", description: "Track journal article views" },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
          Analytics & <em className="italic text-primary">Tracking</em>
        </h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border border-border mb-8">
          <TabsTrigger value="google" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Google Analytics
          </TabsTrigger>
          <TabsTrigger value="gtm" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Code className="h-3.5 w-3.5 mr-1.5" /> GTM
          </TabsTrigger>
          <TabsTrigger value="pixels" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Smartphone className="h-3.5 w-3.5 mr-1.5" /> Pixel Integrations
          </TabsTrigger>
          <TabsTrigger value="events" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <ToggleLeft className="h-3.5 w-3.5 mr-1.5" /> Event Tracking
          </TabsTrigger>
        </TabsList>

        {/* Google Analytics */}
        <TabsContent value="google">
          <div className="border border-border p-6 space-y-5">
            <div>
              <label className={labelClass} style={headingFont}>Google Analytics Measurement ID</label>
              <input
                value={analytics.google_analytics_id}
                onChange={(e) => setAnalytics((p) => ({ ...p, google_analytics_id: e.target.value }))}
                className={inputClass}
                style={bodyFont}
                placeholder="G-XXXXXXXXXX"
              />
              <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>
                Find this in Google Analytics → Admin → Data Streams → Measurement ID
              </p>
            </div>

            {analytics.google_analytics_id && (
              <div className="border border-border/50 rounded-sm p-4 bg-muted/20">
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-2" style={headingFont}>Preview Script</p>
                <pre className="text-[11px] text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all" style={bodyFont}>
{`<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${analytics.google_analytics_id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${analytics.google_analytics_id}');
</script>`}
                </pre>
              </div>
            )}

            <button onClick={saveAnalytics} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </button>
          </div>
        </TabsContent>

        {/* GTM */}
        <TabsContent value="gtm">
          <div className="border border-border p-6 space-y-5">
            <div>
              <label className={labelClass} style={headingFont}>GTM Container ID</label>
              <input
                value={analytics.gtm_container_id}
                onChange={(e) => setAnalytics((p) => ({ ...p, gtm_container_id: e.target.value }))}
                className={inputClass}
                style={bodyFont}
                placeholder="GTM-XXXXXXX"
              />
              <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>
                Find this in Google Tag Manager → Container → Container ID
              </p>
            </div>

            {analytics.gtm_container_id && (
              <div className="border border-border/50 rounded-sm p-4 bg-muted/20">
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-2" style={headingFont}>Preview Script</p>
                <pre className="text-[11px] text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all" style={bodyFont}>
{`<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${analytics.gtm_container_id}');</script>`}
                </pre>
              </div>
            )}

            <div className="mt-6">
              <label className={labelClass} style={headingFont}>Custom Head Scripts</label>
              <textarea
                value={analytics.custom_head_scripts}
                onChange={(e) => setAnalytics((p) => ({ ...p, custom_head_scripts: e.target.value }))}
                className={`${inputClass} resize-none border border-border rounded-sm p-3`}
                rows={4}
                style={bodyFont}
                placeholder="<!-- Paste any additional <head> scripts here -->"
              />
            </div>

            <div>
              <label className={labelClass} style={headingFont}>Custom Body Scripts</label>
              <textarea
                value={analytics.custom_body_scripts}
                onChange={(e) => setAnalytics((p) => ({ ...p, custom_body_scripts: e.target.value }))}
                className={`${inputClass} resize-none border border-border rounded-sm p-3`}
                rows={4}
                style={bodyFont}
                placeholder="<!-- Paste any additional <body> scripts here -->"
              />
            </div>

            <button onClick={saveAnalytics} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </button>
          </div>
        </TabsContent>

        {/* Pixel Integrations */}
        <TabsContent value="pixels">
          <div className="border border-border p-6 space-y-5">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={headingFont}>Meta (Facebook) Pixel ID</label>
                <input
                  value={analytics.meta_pixel_id}
                  onChange={(e) => setAnalytics((p) => ({ ...p, meta_pixel_id: e.target.value }))}
                  className={inputClass}
                  style={bodyFont}
                  placeholder="123456789012345"
                />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>Meta Events Manager → Pixel ID</p>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Twitter (X) Pixel ID</label>
                <input
                  value={analytics.twitter_pixel_id}
                  onChange={(e) => setAnalytics((p) => ({ ...p, twitter_pixel_id: e.target.value }))}
                  className={inputClass}
                  style={bodyFont}
                  placeholder="xxxxxxxx"
                />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>X Ads Manager → Conversion Tracking</p>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>Pinterest Tag ID</label>
                <input
                  value={analytics.pinterest_tag_id}
                  onChange={(e) => setAnalytics((p) => ({ ...p, pinterest_tag_id: e.target.value }))}
                  className={inputClass}
                  style={bodyFont}
                  placeholder="123456789"
                />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>Pinterest Ads → Conversions → Tag ID</p>
              </div>
              <div>
                <label className={labelClass} style={headingFont}>LinkedIn Partner ID</label>
                <input
                  value={analytics.linkedin_partner_id}
                  onChange={(e) => setAnalytics((p) => ({ ...p, linkedin_partner_id: e.target.value }))}
                  className={inputClass}
                  style={bodyFont}
                  placeholder="123456"
                />
                <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>LinkedIn Campaign Manager → Insight Tag</p>
              </div>
            </div>

            {analytics.meta_pixel_id && (
              <div className="border border-border/50 rounded-sm p-4 bg-muted/20">
                <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-2" style={headingFont}>Meta Pixel Preview</p>
                <pre className="text-[11px] text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all" style={bodyFont}>
{`<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${analytics.meta_pixel_id}');
fbq('track', 'PageView');
</script>`}
                </pre>
              </div>
            )}

            <button onClick={saveAnalytics} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Pixel Settings
            </button>
          </div>
        </TabsContent>

        {/* Event Tracking Controls */}
        <TabsContent value="events">
          <div className="border border-border p-6 space-y-5">
            <p className="text-sm text-muted-foreground mb-4" style={bodyFont}>
              Control which user interactions are sent as events to your analytics platforms. Toggle events on or off as needed.
            </p>

            <div className="space-y-1">
              {eventToggles.map(({ key, label, description }) => (
                <label
                  key={key}
                  className="flex items-center justify-between py-3 px-4 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group"
                >
                  <div>
                    <span className="text-sm font-medium text-foreground" style={bodyFont}>{label}</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5" style={bodyFont}>{description}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={events[key]}
                    onClick={() => setEvents((p) => ({ ...p, [key]: !p[key] }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      events[key] ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ${
                        events[key] ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>
              ))}
            </div>

            <button onClick={saveEvents} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50 mt-4" style={headingFont}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Event Settings
            </button>
          </div>

          {/* Info */}
          <div className="border border-border/50 rounded-sm px-5 py-4 bg-muted/20 mt-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed" style={bodyFont}>
              <strong className="text-foreground">Note:</strong> Events are only sent when an analytics platform (GA, GTM, or Pixel) is configured. Disabling an event here prevents it from being fired across all platforms.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
