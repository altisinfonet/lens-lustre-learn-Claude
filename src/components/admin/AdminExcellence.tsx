import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds, cachedFetchProfilesDetailByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { Star, Award, Quote, Trophy, Users, Loader2, Trash2, Plus, XCircle, Eye, EyeOff, GripVertical } from "lucide-react";
import type { User } from "@supabase/supabase-js";

const DEFAULT_TIERS = [
  { name: "Bronze", min_certs: 1, color: "#CD7F32" },
  { name: "Silver", min_certs: 3, color: "#C0C0C0" },
  { name: "Gold", min_certs: 5, color: "#FFD700" },
];

interface FeaturedCert {
  id: string;
  title: string;
  type: string;
  is_featured: boolean;
  featured_quote: string | null;
  featured_order: number;
  user_name: string | null;
  issued_at: string;
}

interface Testimonial {
  id: string;
  certificate_id: string;
  user_id: string;
  testimonial: string;
  photo_url: string | null;
  is_visible: boolean;
  sort_order: number;
  user_name: string | null;
  cert_title: string | null;
}

interface TierConfig {
  name: string;
  min_certs: number;
  color: string;
}

interface LeaderboardEntry {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  cert_count: number;
  tier: string;
}

const AdminExcellence = ({ user }: { user: User | null }) => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"featured" | "testimonials" | "tiers" | "leaderboard" | "directory">("featured");
  const [featuredCerts, setFeaturedCerts] = useState<FeaturedCert[]>([]);
  const [allCerts, setAllCerts] = useState<FeaturedCert[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [tiers, setTiers] = useState<TierConfig[]>(DEFAULT_TIERS);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTiers, setSavingTiers] = useState(false);

  // Testimonial form
  const [showTestForm, setShowTestForm] = useState(false);
  const [testForm, setTestForm] = useState({ cert_search: "", testimonial: "", photo_url: "" });
  const [resolvedCertId, setResolvedCertId] = useState<string | null>(null);
  const [resolvedCertInfo, setResolvedCertInfo] = useState("");
  const [savingTest, setSavingTest] = useState(false);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: certsData }, { data: testData }, { data: tierSetting }] = await Promise.all([
      supabase.from("certificates").select("id, title, type, is_featured, featured_quote, featured_order, user_id, issued_at").order("featured_order"),
      supabase.from("certificate_testimonials").select("*").order("sort_order"),
      supabase.from("site_settings").select("value").eq("key", "certificate_tiers").maybeSingle(),
    ]);

    if (certsData && certsData.length > 0) {
      const userIds = [...new Set(certsData.map((c) => c.user_id))];
      const pMap = await cachedFetchProfilesByIds(userIds);
      const mapped = certsData.map((c) => ({ ...c, user_name: pMap.get(c.user_id) || null }));
      setAllCerts(mapped);
      setFeaturedCerts(mapped.filter((c) => c.is_featured));
    }

    if (testData && testData.length > 0) {
      const userIds = [...new Set(testData.map((t) => t.user_id))];
      const certIds = [...new Set(testData.map((t) => t.certificate_id))];
      const [pMap, { data: certs }] = await Promise.all([
        cachedFetchProfilesByIds(userIds),
        supabase.from("certificates").select("id, title").in("id", certIds),
      ]);
      const cMap = new Map(certs?.map((c) => [c.id, c.title]) || []);
      setTestimonials(testData.map((t) => ({ ...t, user_name: pMap.get(t.user_id) || null, cert_title: cMap.get(t.certificate_id) || null })));
    }

    if (tierSetting?.value) {
      setTiers(tierSetting.value as unknown as TierConfig[]);
    }

    // Build leaderboard
    if (certsData && certsData.length > 0) {
      const countMap = new Map<string, number>();
      certsData.forEach((c) => countMap.set(c.user_id, (countMap.get(c.user_id) || 0) + 1));
      const userIds = [...countMap.keys()];
      const detailMap = await cachedFetchProfilesDetailByIds(userIds);
      const pMap = new Map([...detailMap].map(([id, p]) => [id, { id, ...p }]));
      const currentTiers = tierSetting?.value ? (tierSetting.value as unknown as TierConfig[]) : DEFAULT_TIERS;
      const sorted = [...countMap.entries()]
        .map(([uid, count]) => {
          const p = pMap.get(uid);
          const tier = [...currentTiers].reverse().find((t) => count >= t.min_certs)?.name || "—";
          return { user_id: uid, full_name: p?.full_name || null, avatar_url: p?.avatar_url || null, cert_count: count, tier };
        })
        .sort((a, b) => b.cert_count - a.cert_count)
        .slice(0, 20);
      setLeaderboard(sorted);
    }

    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const toggleFeatured = async (certId: string, current: boolean) => {
    const { error } = await supabase.from("certificates").update({ is_featured: !current }).eq("id", certId);
    if (error) toast({ title: "Failed", variant: "destructive" });
    else {
      fetchAll();
      qc.invalidateQueries({ queryKey: ["certificates"] });
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
    }
  };

  const updateQuote = async (certId: string, quote: string) => {
    await supabase.from("certificates").update({ featured_quote: quote || null }).eq("id", certId);
  };

  const lookupCert = async () => {
    const q = testForm.cert_search.trim();
    if (!q) return;
    const { data } = await supabase.from("certificates").select("id, title, user_id").ilike("title", `%${q}%`).limit(1);
    if (data && data.length > 0) {
      setResolvedCertId(data[0].id);
      setResolvedCertInfo(data[0].title);
      toast({ title: `Found: ${data[0].title}` });
    } else toast({ title: "Not found", variant: "destructive" });
  };

  const saveTestimonial = async () => {
    if (!resolvedCertId || !testForm.testimonial.trim()) { toast({ title: "Certificate and testimonial required", variant: "destructive" }); return; }
    // Get user_id from the certificate
    const { data: cert } = await supabase.from("certificates").select("user_id").eq("id", resolvedCertId).single();
    if (!cert) return;
    setSavingTest(true);
    const { error } = await supabase.from("certificate_testimonials").insert({
      certificate_id: resolvedCertId,
      user_id: cert.user_id,
      testimonial: testForm.testimonial.trim(),
      photo_url: testForm.photo_url.trim() || null,
      sort_order: testimonials.length,
    });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Testimonial added" }); setShowTestForm(false); setTestForm({ cert_search: "", testimonial: "", photo_url: "" }); setResolvedCertId(null); fetchAll(); }
    setSavingTest(false);
  };

  const deleteTestimonial = async (id: string) => {
    confirmAction({
      title: "Delete this testimonial?",
      onConfirm: async () => {
        await supabase.from("certificate_testimonials").delete().eq("id", id);
        toast({ title: "Deleted" });
        fetchAll();
      },
    });
  };

  const toggleTestimonialVisibility = async (id: string, current: boolean) => {
    await supabase.from("certificate_testimonials").update({ is_visible: !current }).eq("id", id);
    setTestimonials((prev) => prev.map((t) => t.id === id ? { ...t, is_visible: !current } : t));
  };

  const saveTiers = async () => {
    setSavingTiers(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "certificate_tiers",
      value: tiers as any,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
    });
    if (error) toast({ title: "Save failed", variant: "destructive" });
    else toast({ title: "Tiers saved" });
    setSavingTiers(false);
  };

  const updateTier = (index: number, field: keyof TierConfig, value: string | number) => {
    setTiers((prev) => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const tabs = [
    ["featured", "Featured", Star],
    ["testimonials", "Testimonials", Quote],
    ["tiers", "Tiers", Trophy],
    ["leaderboard", "Leaderboard", Users],
  ] as const;

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <Award className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
          Certified <em className="italic text-primary">Excellence</em>
        </h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-4 py-2.5 border-b-2 transition-all ${
              activeTab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {/* Featured Certificates */}
      {activeTab === "featured" && (
        <div className="space-y-3">
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            Toggle the star to feature certificates on the homepage. Add a spotlight quote for each.
          </p>
          <div className="border border-border rounded-sm divide-y divide-border">
            {allCerts.map((cert) => (
              <div key={cert.id} className="px-3 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleFeatured(cert.id, cert.is_featured)}
                    className={`p-1 rounded-sm transition-colors shrink-0 ${cert.is_featured ? "text-yellow-500" : "text-muted-foreground/30 hover:text-yellow-500/60"}`}>
                    <Star className="h-4 w-4" fill={cert.is_featured ? "currentColor" : "none"} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{cert.title}</span>
                      <span className="text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 bg-primary/10 text-primary border-primary/30">
                        {cert.type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{cert.user_name || "Unknown"} · {new Date(cert.issued_at).toLocaleDateString()}</span>
                  </div>
                </div>
                {cert.is_featured && (
                  <div className="mt-2 ml-8">
                    <input
                      defaultValue={cert.featured_quote || ""}
                      onBlur={(e) => updateQuote(cert.id, e.target.value)}
                      placeholder="Add a spotlight quote…"
                      className="w-full bg-transparent border-b border-border/50 text-xs py-1 outline-none focus:border-primary italic text-muted-foreground"
                      style={{ fontFamily: "var(--font-body)" }}
                    />
                  </div>
                )}
              </div>
            ))}
            {allCerts.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">No certificates issued yet</div>
            )}
          </div>
        </div>
      )}

      {/* Testimonials */}
      {activeTab === "testimonials" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              Attach testimonials from certificate holders to showcase on the homepage.
            </p>
            <button onClick={() => setShowTestForm(true)}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}>
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          {showTestForm && (
            <div className="border border-border p-4 rounded-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>New Testimonial</span>
                <button onClick={() => setShowTestForm(false)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center gap-2">
                <input value={testForm.cert_search} onChange={(e) => setTestForm((f) => ({ ...f, cert_search: e.target.value }))} placeholder="Search certificate by title…"
                  className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
                <button onClick={lookupCert} className="px-3 py-1.5 text-[10px] uppercase border border-border hover:border-primary rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>Find</button>
                {resolvedCertInfo && <span className="text-xs text-primary">✓ {resolvedCertInfo}</span>}
              </div>
              <textarea value={testForm.testimonial} onChange={(e) => setTestForm((f) => ({ ...f, testimonial: e.target.value }))} placeholder="What did they say about their experience?"
                className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-xs outline-none focus:border-primary min-h-[80px]" />
              <div className="flex items-center gap-2">
                <input value={testForm.photo_url} onChange={(e) => setTestForm((f) => ({ ...f, photo_url: e.target.value }))} placeholder="Photo URL (optional)"
                  className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
                <button onClick={saveTestimonial} disabled={savingTest}
                  className="px-4 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm disabled:opacity-50"
                  style={{ fontFamily: "var(--font-heading)" }}>
                  {savingTest ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </button>
              </div>
            </div>
          )}

          <div className="border border-border rounded-sm divide-y divide-border">
            {testimonials.map((t) => (
              <div key={t.id} className="px-3 py-3 hover:bg-muted/30 transition-colors group">
                <div className="flex items-start gap-3">
                  <Quote className="h-4 w-4 text-primary/40 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs italic text-muted-foreground leading-relaxed mb-1" style={{ fontFamily: "var(--font-body)" }}>"{t.testimonial}"</p>
                    <span className="text-[10px] text-muted-foreground">— {t.user_name || "Unknown"} · {t.cert_title || "Certificate"}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => toggleTestimonialVisibility(t.id, t.is_visible)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title={t.is_visible ? "Hide" : "Show"}>
                      {t.is_visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => deleteTestimonial(t.id)} className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {testimonials.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">No testimonials yet</div>
            )}
          </div>
        </div>
      )}

      {/* Tiers */}
      {activeTab === "tiers" && (
        <div className="space-y-4">
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            Configure certification tiers based on the number of certificates earned. Users are automatically assigned the highest tier they qualify for.
          </p>
          <div className="space-y-3">
            {tiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-3 border border-border rounded-sm p-3">
                <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: tier.color }} />
                <input value={tier.name} onChange={(e) => updateTier(i, "name", e.target.value)}
                  className="bg-transparent border-b border-border/50 text-sm outline-none focus:border-primary w-32 py-0.5" placeholder="Tier name" />
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>Min certs:</span>
                  <input type="number" value={tier.min_certs} onChange={(e) => updateTier(i, "min_certs", parseInt(e.target.value) || 0)}
                    className="bg-transparent border border-border rounded-sm w-14 px-2 py-1 text-xs outline-none focus:border-primary text-center" />
                </div>
                <input type="color" value={tier.color} onChange={(e) => updateTier(i, "color", e.target.value)} className="w-8 h-6 cursor-pointer border-0" />
                <button onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))} className="p-1 text-muted-foreground hover:text-destructive ml-auto">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setTiers((prev) => [...prev, { name: "New Tier", min_certs: prev.length + 1, color: "#888888" }])}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-primary hover:opacity-80"
              style={{ fontFamily: "var(--font-heading)" }}>
              <Plus className="h-3 w-3" /> Add Tier
            </button>
            <button onClick={saveTiers} disabled={savingTiers}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded-sm ml-auto"
              style={{ fontFamily: "var(--font-heading)" }}>
              {savingTiers ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Tiers"}
            </button>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {activeTab === "leaderboard" && (
        <div className="space-y-3">
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            Top certified photographers ranked by number of certificates earned. Tiers are assigned automatically based on your tier configuration.
          </p>
          <div className="border border-border rounded-sm divide-y divide-border">
            {leaderboard.map((entry, i) => (
              <div key={entry.user_id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground w-6 text-center font-mono">{i + 1}</span>
                {entry.avatar_url ? (
                  <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={entry.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover border border-border" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center border border-border">
                    <Users className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block" style={{ fontFamily: "var(--font-body)" }}>{entry.full_name || "Unknown"}</span>
                </div>
                <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  {entry.cert_count} cert{entry.cert_count !== 1 ? "s" : ""}
                </span>
                <span className="text-[9px] px-2 py-0.5 border rounded-sm uppercase tracking-wider font-semibold"
                  style={{ fontFamily: "var(--font-heading)", borderColor: tiers.find((t) => t.name === entry.tier)?.color || "#888", color: tiers.find((t) => t.name === entry.tier)?.color || "#888" }}>
                  {entry.tier}
                </span>
              </div>
            ))}
            {leaderboard.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">No certified photographers yet</div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminExcellence;
