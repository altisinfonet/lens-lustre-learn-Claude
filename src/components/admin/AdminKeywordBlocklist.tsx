import { useState, useEffect, useCallback } from "react";
import { Shield, Plus, Trash2, Loader2, ToggleLeft, ToggleRight, Search, CheckSquare, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import type { User } from "@supabase/supabase-js";

const headingFont = { fontFamily: "var(--font-heading)" };

interface Props {
  user: User | null;
}

interface BlockedKeyword {
  id: string;
  keyword: string;
  category: string;
  severity: string;
  is_active: boolean;
  created_at: string;
}

const CATEGORIES = [
  { value: "profanity", label: "Profanity" },
  { value: "spam", label: "Spam" },
  { value: "hate", label: "Hate Speech" },
  { value: "custom", label: "Custom" },
];

const SEVERITIES = [
  { value: "auto_hide", label: "Auto-Hide", desc: "Comment is silently blocked" },
  { value: "flag_review", label: "Flag for Review", desc: "Comment posted but flagged for admin review" },
];

const AdminKeywordBlocklist = ({ user }: Props) => {
  const [keywords, setKeywords] = useState<BlockedKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  // New keyword form
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState("profanity");
  const [newSeverity, setNewSeverity] = useState("auto_hide");
  const [bulkInput, setBulkInput] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  useEffect(() => {
    fetchKeywords();
  }, []);

  const fetchKeywords = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from("blocked_keywords" as any).select("id, keyword, category, severity, is_active, created_at").order("created_at", { ascending: false }).limit(50) as any);
    if (error) {
      toast({ title: "Failed to load keywords", description: error.message, variant: "destructive" });
    }
    setKeywords((data as BlockedKeyword[]) || []);
    setSelected(new Set());
    setLoading(false);
  };

  const addKeyword = async () => {
    if (!newKeyword.trim() || !user) return;
    setSaving(true);
    const { error } = await (supabase.from("blocked_keywords" as any).insert({
      keyword: newKeyword.trim().toLowerCase(),
      category: newCategory,
      severity: newSeverity,
      created_by: user.id,
    } as any) as any);

    if (error) {
      if (error.message?.includes("unique") || error.code === "23505") {
        toast({ title: "Keyword already exists", variant: "destructive" });
      } else {
        toast({ title: "Failed to add", description: error.message, variant: "destructive" });
      }
    } else {
      toast({ title: `"${newKeyword.trim()}" added` });
      setNewKeyword("");
      fetchKeywords();
    }
    setSaving(false);
  };

  const addBulkKeywords = async () => {
    if (!bulkInput.trim() || !user) return;
    setSaving(true);
    const words = bulkInput
      .split(/[,\n]+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 0);

    const uniqueWords = [...new Set(words)];
    const payload = uniqueWords.map(keyword => ({
      keyword,
      category: newCategory,
      severity: newSeverity,
      created_by: user.id,
    }));

    let added = 0;
    let skipped = 0;
    for (const item of payload) {
      const { error } = await (supabase.from("blocked_keywords" as any).insert(item as any) as any);
      if (error) skipped++;
      else added++;
    }

    toast({ title: `${added} added, ${skipped} skipped (duplicates)` });
    setBulkInput("");
    setShowBulk(false);
    fetchKeywords();
    setSaving(false);
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    await (supabase.from("blocked_keywords" as any).update({ is_active: !currentActive, updated_at: new Date().toISOString() } as any).eq("id", id) as any);
    setKeywords(prev => prev.map(k => k.id === id ? { ...k, is_active: !currentActive } : k));
  };

  const deleteKeyword = async (id: string, keyword: string) => {
    confirmAction({
      title: `Delete "${keyword}" from blocklist?`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        await (supabase.from("blocked_keywords" as any).delete().eq("id", id) as any);
        setKeywords(prev => prev.filter(k => k.id !== id));
        setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
        toast({ title: `"${keyword}" removed` });
      },
    });
  };

  const deleteBulk = useCallback(() => {
    if (selected.size === 0) return;
    confirmAction({
      title: `Delete ${selected.size} keyword${selected.size > 1 ? "s" : ""}?`,
      description: `Permanently remove ${selected.size} keyword${selected.size > 1 ? "s" : ""} from the blocklist.`,
      confirmLabel: "Delete All",
      variant: "destructive",
      onConfirm: async () => {
        const ids = [...selected];
        for (const id of ids) {
          await (supabase.from("blocked_keywords" as any).delete().eq("id", id) as any);
        }
        setKeywords(prev => prev.filter(k => !selected.has(k.id)));
        setSelected(new Set());
        toast({ title: `${ids.length} keyword${ids.length > 1 ? "s" : ""} deleted` });
      },
    });
  }, [selected, confirmAction]);

  const toggleSelection = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = keywords.filter(k =>
    k.keyword.toLowerCase().includes(search.toLowerCase()) ||
    k.category.toLowerCase().includes(search.toLowerCase())
  );

  const toggleAll = () => {
    if (filtered.every(k => selected.has(k.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(k => k.id)));
    }
  };

  const stats = {
    total: keywords.length,
    active: keywords.filter(k => k.is_active).length,
    profanity: keywords.filter(k => k.category === "profanity").length,
    spam: keywords.filter(k => k.category === "spam").length,
    hate: keywords.filter(k => k.category === "hate").length,
    custom: keywords.filter(k => k.category === "custom").length,
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "Total", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Profanity", value: stats.profanity },
          { label: "Spam", value: stats.spam },
          { label: "Hate", value: stats.hate },
          { label: "Custom", value: stats.custom },
        ].map(s => (
          <div key={s.label} className="border border-border p-3 rounded-sm text-center">
            <p className="text-lg font-bold text-foreground" style={headingFont}>{s.value}</p>
            <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Add keyword form */}
      <div className="border border-border p-4 rounded-sm space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] tracking-[0.15em] uppercase text-foreground" style={headingFont}>Add Keyword</span>
          <button
            onClick={() => setShowBulk(!showBulk)}
            className="ml-auto text-[9px] tracking-[0.1em] uppercase text-primary hover:underline"
            style={headingFont}
          >
            {showBulk ? "Single" : "Bulk Add"}
          </button>
        </div>

        <div className="flex gap-3 flex-wrap">
          <select
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            className="bg-transparent border border-border rounded-sm px-2 py-1.5 text-xs"
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select
            value={newSeverity}
            onChange={e => setNewSeverity(e.target.value)}
            className="bg-transparent border border-border rounded-sm px-2 py-1.5 text-xs"
          >
            {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label} — {s.desc}</option>)}
          </select>
        </div>

        {showBulk ? (
          <div className="space-y-2">
            <textarea
              value={bulkInput}
              onChange={e => setBulkInput(e.target.value)}
              placeholder="Enter keywords separated by commas or new lines…"
              className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-xs min-h-[80px] resize-y"
              style={{ fontFamily: "var(--font-body)" }}
            />
            <button
              onClick={addBulkKeywords}
              disabled={saving || !bulkInput.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[9px] tracking-[0.15em] uppercase border border-primary text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50"
              style={headingFont}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add All
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={newKeyword}
              onChange={e => setNewKeyword(e.target.value)}
              placeholder="Enter keyword…"
              className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
              onKeyDown={e => e.key === "Enter" && addKeyword()}
            />
            <button
              onClick={addKeyword}
              disabled={saving || !newKeyword.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[9px] tracking-[0.15em] uppercase border border-primary text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50"
              style={headingFont}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search keywords…"
          className="w-full bg-transparent border border-border rounded-sm pl-9 pr-3 py-2 text-xs"
        />
      </div>

      {/* Keywords list */}
      {filtered.length === 0 ? (
        <div className="border border-dashed border-border p-8 text-center">
          <Shield className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            {keywords.length === 0 ? "No blocked keywords yet. Add your first keyword above." : "No keywords match your search."}
          </p>
        </div>
      ) : (
        <>
          {/* Select all + bulk bar */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              style={headingFont}
            >
              {filtered.every(k => selected.has(k.id))
                ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                : <Square className="h-3.5 w-3.5" />}
              Select All
            </button>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-sm">
              <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
                {selected.size} selected
              </span>
              <button
                onClick={deleteBulk}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase tracking-wider border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-sm transition-all"
                style={headingFont}
              >
                <Trash2 className="h-2.5 w-2.5" /> Delete Selected
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                style={headingFont}
              >
                Clear
              </button>
            </div>
          )}

          <div className="border border-border rounded-sm divide-y divide-border">
            {filtered.map(k => (
              <div key={k.id} className={`px-4 py-3 flex items-center gap-3 ${selected.has(k.id) ? "bg-primary/5" : ""}`}>
                <Checkbox
                  checked={selected.has(k.id)}
                  onCheckedChange={() => toggleSelection(k.id)}
                  className="shrink-0"
                />
                <button onClick={() => toggleActive(k.id, k.is_active)} className="shrink-0">
                  {k.is_active ? (
                    <ToggleRight className="h-5 w-5 text-primary" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <span className={`text-sm font-mono ${k.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}>
                  {k.keyword}
                </span>
                <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${
                  k.category === "profanity" ? "border-destructive/40 text-destructive"
                  : k.category === "hate" ? "border-orange-500/40 text-orange-500"
                  : k.category === "spam" ? "border-yellow-500/40 text-yellow-600"
                  : "border-muted-foreground/40 text-muted-foreground"
                }`} style={headingFont}>
                  {k.category}
                </span>
                <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${
                  k.severity === "auto_hide" ? "border-destructive/30 text-destructive" : "border-primary/30 text-primary"
                }`} style={headingFont}>
                  {k.severity === "auto_hide" ? "block" : "review"}
                </span>
                <span className="text-[9px] text-muted-foreground ml-auto hidden sm:inline">
                  {new Date(k.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => deleteKeyword(k.id, k.keyword)}
                  className="shrink-0 text-destructive/60 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminKeywordBlocklist;
