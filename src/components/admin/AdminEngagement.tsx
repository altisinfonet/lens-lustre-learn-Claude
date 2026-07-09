import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Search, ThumbsUp, Heart, Vote, Plus, Minus, Loader2, Image as ImageIcon, Eye, Pin, TrendingUp, Clock, MessageCircle, Zap, Calendar } from "lucide-react";
import { User } from "@supabase/supabase-js";

interface Props {
  user: User | null;
}

interface ImageItem {
  id: string;
  title: string;
  image_url: string;
  type: "portfolio" | "competition_entry";
  owner_name: string | null;
  reactions: { like: number; love: number; vote: number };
  is_pinned: boolean;
  is_trending: boolean;
  view_count: number;
}

interface ScheduledBoost {
  id: string;
  image_id: string;
  image_type: string;
  reaction_type: string;
  total_amount: number;
  applied_amount: number;
  increment_per_hour: number;
  status: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

const REACTION_TYPES = [
  { type: "like", icon: ThumbsUp, label: "Likes", color: "text-primary" },
  { type: "love", icon: Heart, label: "Loves", color: "text-destructive" },
  { type: "vote", icon: Vote, label: "Votes", color: "text-primary" },
] as const;

type TabType = "reactions" | "testimonials" | "pinning" | "views" | "trending" | "boosts";

const AdminEngagement = ({ user }: Props) => {
  const qc = useQueryClient();
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "portfolio" | "competition_entry">("all");
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [bulkCount, setBulkCount] = useState<Record<string, Record<string, number>>>({});
  const [activeTab, setActiveTab] = useState<TabType>("reactions");

  // Seed testimonial state
  const [seedImageId, setSeedImageId] = useState("");
  const [seedImageType, setSeedImageType] = useState<"portfolio" | "competition_entry">("portfolio");
  const [seedContent, setSeedContent] = useState("");
  const [seedAuthorName, setSeedAuthorName] = useState("");
  const [seedPinned, setSeedPinned] = useState(true);
  const [postingSeed, setPostingSeed] = useState(false);
  const [seedComments, setSeedComments] = useState<any[]>([]);

  // Scheduled boosts
  const [boosts, setBoosts] = useState<ScheduledBoost[]>([]);
  const [boostForm, setBoostForm] = useState({
    image_id: "",
    image_type: "portfolio" as string,
    reaction_type: "like",
    total_amount: 50,
    increment_per_hour: 2,
    ends_at: "",
  });

  const fetchImages = async () => {
    setLoading(true);
    const { data: portfolio } = await supabase
      .from("portfolio_images")
      .select("id, title, image_url, uploaded_by, is_pinned, is_trending, view_count")
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: entries } = await supabase
      .from("competition_entries")
      .select("id, title, photos, user_id, is_pinned, is_trending, view_count")
      .order("created_at", { ascending: false })
      .limit(100);

    const portfolioIds = portfolio?.map(p => p.id) || [];
    const entryIds = entries?.map(e => e.id) || [];
    const allIds = [...portfolioIds, ...entryIds];

    const { data: reactions } = allIds.length > 0
      ? await supabase.from("image_reactions").select("image_id, reaction_type").in("image_id", allIds)
      : { data: [] };

    const reactionMap: Record<string, { like: number; love: number; vote: number }> = {};
    for (const r of reactions || []) {
      if (!reactionMap[r.image_id]) reactionMap[r.image_id] = { like: 0, love: 0, vote: 0 };
      if (r.reaction_type === "like") reactionMap[r.image_id].like++;
      else if (r.reaction_type === "love") reactionMap[r.image_id].love++;
      else if (r.reaction_type === "vote") reactionMap[r.image_id].vote++;
    }

    const ownerIds = [...new Set([
      ...(portfolio?.map(p => p.uploaded_by) || []),
      ...(entries?.map(e => e.user_id) || []),
    ])];
    const profileMap = await cachedFetchProfilesByIds(ownerIds);

    const items: ImageItem[] = [
      ...(portfolio?.map(p => ({
        id: p.id, title: p.title, image_url: p.image_url, type: "portfolio" as const,
        owner_name: profileMap.get(p.uploaded_by) || null,
        reactions: reactionMap[p.id] || { like: 0, love: 0, vote: 0 },
        is_pinned: p.is_pinned, is_trending: p.is_trending, view_count: p.view_count,
      })) || []),
      ...(entries?.map(e => ({
        id: e.id, title: e.title, image_url: e.photos?.[0] || "", type: "competition_entry" as const,
        owner_name: profileMap.get(e.user_id) || null,
        reactions: reactionMap[e.id] || { like: 0, love: 0, vote: 0 },
        is_pinned: e.is_pinned, is_trending: e.is_trending, view_count: e.view_count,
      })) || []),
    ];

    setImages(items);
    setLoading(false);
  };

  const fetchSeedComments = async () => {
    const { data } = await supabase
      .from("image_comments")
      .select("id, content, is_pinned, is_admin_seed, image_id, image_type, created_at")
      .eq("is_admin_seed", true)
      .order("created_at", { ascending: false })
      .limit(50);
    setSeedComments(data || []);
  };

  const fetchBoosts = async () => {
    const { data } = await supabase
      .from("scheduled_boosts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setBoosts((data as ScheduledBoost[]) || []);
  };

  useEffect(() => { fetchImages(); fetchSeedComments(); fetchBoosts(); }, []);

  const adjustReaction = async (imageId: string, imageType: string, reactionType: string, delta: number) => {
    if (!user) return;
    setAdjusting(`${imageId}-${reactionType}`);
    if (delta > 0) {
      const promises = [];
      for (let i = 0; i < delta; i++) {
        promises.push(supabase.from("image_reactions").insert({
          image_id: imageId, image_type: imageType, reaction_type: reactionType, user_id: crypto.randomUUID(),
        }));
      }
      await Promise.all(promises);
    } else if (delta < 0) {
      const { data: existing } = await supabase.from("image_reactions").select("id")
        .eq("image_id", imageId).eq("image_type", imageType).eq("reaction_type", reactionType)
        .order("created_at", { ascending: false }).limit(Math.abs(delta));
      if (existing?.length) await supabase.from("image_reactions").delete().in("id", existing.map(e => e.id));
    }
    setImages(prev => prev.map(img => img.id === imageId ? {
      ...img, reactions: { ...img.reactions, [reactionType]: Math.max(0, img.reactions[reactionType as keyof typeof img.reactions] + delta) },
    } : img));
    setAdjusting(null);
    qc.invalidateQueries({ queryKey: ["feed"] });
    toast({ title: `${Math.abs(delta)} ${reactionType}(s) ${delta > 0 ? "added" : "removed"}` });
  };

  const handleBulkApply = async (imageId: string, imageType: string) => {
    const counts = bulkCount[imageId] || {};
    for (const [type, count] of Object.entries(counts)) {
      if (count && count !== 0) await adjustReaction(imageId, imageType, type, count);
    }
    setBulkCount(prev => ({ ...prev, [imageId]: {} }));
  };

  // Toggle pin
  const togglePin = async (img: ImageItem) => {
    const table = img.type === "portfolio" ? "portfolio_images" : "competition_entries";
    await supabase.from(table).update({ is_pinned: !img.is_pinned } as any).eq("id", img.id);
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, is_pinned: !i.is_pinned } : i));
    qc.invalidateQueries({ queryKey: ["feed"] });
    toast({ title: img.is_pinned ? "Unpinned" : "Pinned to top" });
  };

  // Toggle trending
  const toggleTrending = async (img: ImageItem) => {
    const table = img.type === "portfolio" ? "portfolio_images" : "competition_entries";
    await supabase.from(table).update({ is_trending: !img.is_trending } as any).eq("id", img.id);
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, is_trending: !i.is_trending } : i));
    qc.invalidateQueries({ queryKey: ["feed"] });
    toast({ title: img.is_trending ? "Trending removed" : "Marked as trending" });
  };

  // Update view count
  const setViewCount = async (img: ImageItem, count: number) => {
    const table = img.type === "portfolio" ? "portfolio_images" : "competition_entries";
    await supabase.from(table).update({ view_count: count } as any).eq("id", img.id);
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, view_count: count } : i));
    toast({ title: `View count set to ${count}` });
  };

  // Create seed testimonial
  const createSeedTestimonial = async () => {
    if (!user || !seedContent.trim() || !seedImageId.trim()) return;
    setPostingSeed(true);
    const { error } = await supabase.from("image_comments").insert({
      user_id: user.id,
      image_id: seedImageId,
      image_type: seedImageType,
      content: seedContent.trim(),
      is_pinned: seedPinned,
      is_admin_seed: true,
    });
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Seed testimonial created" });
      setSeedContent(""); setSeedImageId(""); setSeedAuthorName("");
      fetchSeedComments();
    }
    setPostingSeed(false);
  };

  const deleteSeedComment = async (id: string) => {
    await supabase.from("image_comments").delete().eq("id", id);
    fetchSeedComments();
    toast({ title: "Seed comment deleted" });
  };

  // Create scheduled boost
  const createBoost = async () => {
    if (!user || !boostForm.image_id) return;
    const { error } = await supabase.from("scheduled_boosts").insert({
      image_id: boostForm.image_id,
      image_type: boostForm.image_type,
      reaction_type: boostForm.reaction_type,
      total_amount: boostForm.total_amount,
      increment_per_hour: boostForm.increment_per_hour,
      ends_at: boostForm.ends_at || null,
      created_by: user.id,
    } as any);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Boost scheduled" });
      setBoostForm({ image_id: "", image_type: "portfolio", reaction_type: "like", total_amount: 50, increment_per_hour: 2, ends_at: "" });
      fetchBoosts();
    }
  };

  const toggleBoostStatus = async (boost: ScheduledBoost) => {
    const newStatus = boost.status === "active" ? "paused" : "active";
    await supabase.from("scheduled_boosts").update({ status: newStatus, updated_at: new Date().toISOString() } as any).eq("id", boost.id);
    setBoosts(prev => prev.map(b => b.id === boost.id ? { ...b, status: newStatus } : b));
    toast({ title: `Boost ${newStatus}` });
  };

  const deleteBoost = async (id: string) => {
    await supabase.from("scheduled_boosts").delete().eq("id", id);
    setBoosts(prev => prev.filter(b => b.id !== id));
    toast({ title: "Boost deleted" });
  };

  const filtered = images.filter(img => {
    if (sourceFilter !== "all" && img.type !== sourceFilter) return false;
    if (search && !img.title.toLowerCase().includes(search.toLowerCase()) && !img.owner_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const tabs: { key: TabType; label: string; icon: any }[] = [
    { key: "reactions", label: "Reactions", icon: ThumbsUp },
    { key: "testimonials", label: "Seed Comments", icon: MessageCircle },
    { key: "pinning", label: "Pin Images", icon: Pin },
    { key: "views", label: "View Counts", icon: Eye },
    { key: "trending", label: "Trending", icon: TrendingUp },
    { key: "boosts", label: "Scheduled Boosts", icon: Clock },
  ];

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-lg font-light mb-1" style={{ fontFamily: "var(--font-display)" }}>
          Engagement <em className="italic text-primary">Control</em>
        </h3>
        <p className="text-[10px] text-muted-foreground tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>
          Full social proof management — reactions, comments, pins, views, trending & boosts
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-border pb-3">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 border rounded-sm transition-all ${
              activeTab === key ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground"
            }`} style={{ fontFamily: "var(--font-heading)" }}>
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {/* Search & Filters (shared) */}
      {activeTab !== "testimonials" && activeTab !== "boosts" && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or photographer..."
              className="w-full pl-9 pr-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none transition-colors"
              style={{ fontFamily: "var(--font-body)" }} />
          </div>
          <div className="flex gap-1">
            {(["all", "portfolio", "competition_entry"] as const).map(f => (
              <button key={f} onClick={() => setSourceFilter(f)}
                className={`text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border rounded-sm transition-all ${
                  sourceFilter === f ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground hover:text-foreground"
                }`} style={{ fontFamily: "var(--font-heading)" }}>
                {f === "all" ? "All" : f === "portfolio" ? "Portfolio" : "Entries"}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && activeTab !== "testimonials" && activeTab !== "boosts" ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* === REACTIONS TAB === */}
          {activeTab === "reactions" && (
            <div className="space-y-3">
              {filtered.length === 0 ? <p className="text-xs text-muted-foreground py-10 text-center">No images found</p> : filtered.map(img => {
                const counts = bulkCount[img.id] || {};
                return (
                  <div key={img.id} className="border border-border rounded-sm p-4 hover:border-primary/30 transition-colors">
                    <div className="flex gap-4">
                      <div className="w-20 h-20 rounded-sm overflow-hidden shrink-0 bg-muted">
                        {img.image_url ? <img loading="lazy" decoding="async" src={img.image_url} alt={img.title} className="w-full h-full object-cover" /> :
                          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-5 w-5 text-muted-foreground/40" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-heading)" }}>{img.title}</h4>
                          <span className={`text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 border rounded-sm ${
                            img.type === "portfolio" ? "text-primary border-primary/30" : "text-muted-foreground border-border"
                          }`} style={{ fontFamily: "var(--font-heading)" }}>
                            {img.type === "portfolio" ? "Portfolio" : "Entry"}
                          </span>
                        </div>
                        {img.owner_name && <p className="text-[10px] text-muted-foreground mb-2">by {img.owner_name}</p>}
                        <div className="flex items-center gap-4 flex-wrap">
                          {REACTION_TYPES.map(({ type, icon: Icon, color }) => (
                            <div key={type} className="flex items-center gap-1.5">
                              <Icon className={`h-3.5 w-3.5 ${color}`} />
                              <span className="text-sm font-medium min-w-[20px] text-center">{img.reactions[type as keyof typeof img.reactions]}</span>
                              <div className="flex items-center gap-0.5 ml-1">
                                <button onClick={() => adjustReaction(img.id, img.type, type, -1)}
                                  disabled={adjusting === `${img.id}-${type}` || img.reactions[type as keyof typeof img.reactions] === 0}
                                  className="h-5 w-5 flex items-center justify-center border border-border rounded-sm text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-30">
                                  <Minus className="h-2.5 w-2.5" />
                                </button>
                                <button onClick={() => adjustReaction(img.id, img.type, type, 1)}
                                  disabled={adjusting === `${img.id}-${type}`}
                                  className="h-5 w-5 flex items-center justify-center border border-border rounded-sm text-muted-foreground hover:text-primary hover:border-primary transition-colors disabled:opacity-30">
                                  <Plus className="h-2.5 w-2.5" />
                                </button>
                              </div>
                              <input type="number" min={-999} max={999} value={counts[type] || ""}
                                onChange={e => setBulkCount(prev => ({ ...prev, [img.id]: { ...prev[img.id], [type]: parseInt(e.target.value) || 0 } }))}
                                placeholder="±" className="w-12 text-center text-[10px] border border-border rounded-sm py-0.5 bg-transparent focus:border-primary outline-none" />
                            </div>
                          ))}
                          {Object.values(counts).some(v => v && v !== 0) && (
                            <button onClick={() => handleBulkApply(img.id, img.type)}
                              className="text-[9px] tracking-[0.15em] uppercase px-3 py-1 bg-primary text-primary-foreground rounded-sm hover:opacity-90"
                              style={{ fontFamily: "var(--font-heading)" }}>Apply Bulk</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* === SEED TESTIMONIALS TAB === */}
          {activeTab === "testimonials" && (
            <div className="space-y-6">
              <div className="border border-border rounded-sm p-5 space-y-4">
                <h4 className="text-xs tracking-[0.15em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Create Seed Comment</h4>
                <p className="text-[10px] text-muted-foreground">Admin-written comments that appear pinned on images as social proof.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Image ID</label>
                    <input value={seedImageId} onChange={e => setSeedImageId(e.target.value)} placeholder="Paste image UUID"
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Image Type</label>
                    <select value={seedImageType} onChange={e => setSeedImageType(e.target.value as any)}
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none">
                      <option value="portfolio">Portfolio</option>
                      <option value="competition_entry">Competition Entry</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Comment Content</label>
                  <textarea value={seedContent} onChange={e => setSeedContent(e.target.value)} rows={3} placeholder="Write a featured comment..."
                    className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none resize-none" />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={seedPinned} onChange={e => setSeedPinned(e.target.checked)}
                      className="rounded border-border" /> Pin to top
                  </label>
                  <button onClick={createSeedTestimonial} disabled={postingSeed || !seedContent.trim() || !seedImageId.trim()}
                    className="text-[9px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 disabled:opacity-30"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    {postingSeed ? "Posting..." : "Create Seed Comment"}
                  </button>
                </div>

                {/* Quick select from images */}
                <div className="border-t border-border pt-3 mt-3">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">Quick select image:</p>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {images.slice(0, 10).map(img => (
                      <button key={img.id} onClick={() => { setSeedImageId(img.id); setSeedImageType(img.type); }}
                        className={`shrink-0 w-14 h-14 rounded-sm overflow-hidden border-2 transition-all ${
                          seedImageId === img.id ? "border-primary" : "border-transparent hover:border-border"
                        }`}>
                        <img loading="lazy" decoding="async" src={img.image_url} alt={img.title} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Existing seed comments */}
              <div>
                <h4 className="text-xs tracking-[0.15em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                  Existing Seed Comments ({seedComments.length})
                </h4>
                {seedComments.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">No seed comments yet</p>
                ) : (
                  <div className="space-y-2">
                    {seedComments.map(c => (
                      <div key={c.id} className="border border-border rounded-sm p-3 flex items-start gap-3">
                        <MessageCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground/90 mb-1">{c.content}</p>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                            <span>{c.image_type}</span>
                            <span>•</span>
                            <span className="truncate max-w-[120px]">{c.image_id}</span>
                            {c.is_pinned && <span className="text-primary">📌 Pinned</span>}
                          </div>
                        </div>
                        <button onClick={() => deleteSeedComment(c.id)}
                          className="text-[9px] text-muted-foreground hover:text-destructive transition-colors">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === PINNING TAB === */}
          {activeTab === "pinning" && (
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground mb-4">Pinned images appear first in galleries and homepage.</p>
              {filtered.map(img => (
                <div key={img.id} className={`border rounded-sm p-3 flex items-center gap-3 transition-all ${
                  img.is_pinned ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                }`}>
                  <div className="w-12 h-12 rounded-sm overflow-hidden shrink-0 bg-muted">
                    {img.image_url && <img loading="lazy" decoding="async" src={img.image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium truncate">{img.title}</h4>
                    <p className="text-[9px] text-muted-foreground">{img.owner_name} • {img.type === "portfolio" ? "Portfolio" : "Entry"}</p>
                  </div>
                  <button onClick={() => togglePin(img)}
                    className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border rounded-sm transition-all ${
                      img.is_pinned ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-primary hover:border-primary"
                    }`} style={{ fontFamily: "var(--font-heading)" }}>
                    <Pin className="h-3 w-3" /> {img.is_pinned ? "Unpin" : "Pin"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* === VIEW COUNTS TAB === */}
          {activeTab === "views" && (
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground mb-4">Set inflated view counts to create social proof.</p>
              {filtered.map(img => (
                <div key={img.id} className="border border-border rounded-sm p-3 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-sm overflow-hidden shrink-0 bg-muted">
                    {img.image_url && <img loading="lazy" decoding="async" src={img.image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium truncate">{img.title}</h4>
                    <p className="text-[9px] text-muted-foreground">{img.owner_name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    <input type="number" min={0} value={img.view_count}
                      onChange={e => setViewCount(img, parseInt(e.target.value) || 0)}
                      className="w-20 text-center text-xs border border-border rounded-sm py-1 bg-transparent focus:border-primary outline-none" />
                    <div className="flex gap-1">
                      {[100, 500, 1000].map(n => (
                        <button key={n} onClick={() => setViewCount(img, img.view_count + n)}
                          className="text-[8px] px-2 py-1 border border-border rounded-sm text-muted-foreground hover:text-primary hover:border-primary transition-colors">
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* === TRENDING TAB === */}
          {activeTab === "trending" && (
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground mb-4">Mark images as "Trending" — they'll show a badge in galleries.</p>
              {filtered.map(img => (
                <div key={img.id} className={`border rounded-sm p-3 flex items-center gap-3 transition-all ${
                  img.is_trending ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                }`}>
                  <div className="w-12 h-12 rounded-sm overflow-hidden shrink-0 bg-muted">
                    {img.image_url && <img loading="lazy" decoding="async" src={img.image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium truncate">{img.title}</h4>
                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                      <span>{img.owner_name}</span>
                      <span>•</span>
                      <span><Eye className="h-2.5 w-2.5 inline" /> {img.view_count}</span>
                      <span>•</span>
                      <span>❤ {img.reactions.love + img.reactions.like}</span>
                    </div>
                  </div>
                  <button onClick={() => toggleTrending(img)}
                    className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border rounded-sm transition-all ${
                      img.is_trending ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-primary hover:border-primary"
                    }`} style={{ fontFamily: "var(--font-heading)" }}>
                    <TrendingUp className="h-3 w-3" /> {img.is_trending ? "Remove" : "Trending"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* === SCHEDULED BOOSTS TAB === */}
          {activeTab === "boosts" && (
            <div className="space-y-6">
              <div className="border border-border rounded-sm p-5 space-y-4">
                <h4 className="text-xs tracking-[0.15em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                  <Zap className="h-3.5 w-3.5 inline mr-1" /> Schedule Engagement Boost
                </h4>
                <p className="text-[10px] text-muted-foreground">Auto-increment reactions over time to simulate organic growth.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Image ID</label>
                    <input value={boostForm.image_id} onChange={e => setBoostForm(f => ({ ...f, image_id: e.target.value }))}
                      placeholder="Image UUID" className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Type</label>
                    <select value={boostForm.image_type} onChange={e => setBoostForm(f => ({ ...f, image_type: e.target.value }))}
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none">
                      <option value="portfolio">Portfolio</option>
                      <option value="competition_entry">Entry</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Reaction</label>
                    <select value={boostForm.reaction_type} onChange={e => setBoostForm(f => ({ ...f, reaction_type: e.target.value }))}
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none">
                      <option value="like">Like</option>
                      <option value="love">Love</option>
                      <option value="vote">Vote</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Total Amount</label>
                    <input type="number" value={boostForm.total_amount} onChange={e => setBoostForm(f => ({ ...f, total_amount: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Per Hour</label>
                    <input type="number" value={boostForm.increment_per_hour} onChange={e => setBoostForm(f => ({ ...f, increment_per_hour: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">End Date (optional)</label>
                    <input type="datetime-local" value={boostForm.ends_at} onChange={e => setBoostForm(f => ({ ...f, ends_at: e.target.value }))}
                      className="w-full px-3 py-2 bg-transparent border border-border rounded-sm text-xs focus:border-primary outline-none" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Quick select */}
                  <div className="flex gap-1 overflow-x-auto">
                    {images.slice(0, 6).map(img => (
                      <button key={img.id} onClick={() => setBoostForm(f => ({ ...f, image_id: img.id, image_type: img.type }))}
                        className={`shrink-0 w-10 h-10 rounded-sm overflow-hidden border-2 transition-all ${
                          boostForm.image_id === img.id ? "border-primary" : "border-transparent hover:border-border"
                        }`}>
                        <img loading="lazy" decoding="async" src={img.image_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <button onClick={createBoost} disabled={!boostForm.image_id}
                    className="text-[9px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 disabled:opacity-30 shrink-0"
                    style={{ fontFamily: "var(--font-heading)" }}>Schedule Boost</button>
                </div>
              </div>

              {/* Active boosts */}
              <div>
                <h4 className="text-xs tracking-[0.15em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                  Active Boosts ({boosts.length})
                </h4>
                {boosts.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">No scheduled boosts</p>
                ) : (
                  <div className="space-y-2">
                    {boosts.map(b => {
                      const progress = b.total_amount > 0 ? Math.round((b.applied_amount / b.total_amount) * 100) : 0;
                      return (
                        <div key={b.id} className={`border rounded-sm p-3 flex items-center gap-3 ${
                          b.status === "active" ? "border-primary/30" : "border-border"
                        }`}>
                          <Zap className={`h-4 w-4 shrink-0 ${b.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium">{b.reaction_type}</span>
                              <span className="text-muted-foreground">on {b.image_type}</span>
                              <span className={`text-[8px] uppercase px-1.5 py-0.5 rounded-sm ${
                                b.status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                              }`}>{b.status}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                              </div>
                              <span className="text-[9px] text-muted-foreground">{b.applied_amount}/{b.total_amount} • {b.increment_per_hour}/hr</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => toggleBoostStatus(b)}
                              className="text-[9px] px-2 py-1 border border-border rounded-sm text-muted-foreground hover:text-primary transition-colors">
                              {b.status === "active" ? "Pause" : "Resume"}
                            </button>
                            <button onClick={() => deleteBoost(b.id)}
                              className="text-[9px] px-2 py-1 border border-border rounded-sm text-muted-foreground hover:text-destructive transition-colors">
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminEngagement;
