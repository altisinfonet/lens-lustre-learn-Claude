import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Plus, Trash2, ArrowRight, ExternalLink } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

interface Redirect {
  id: string;
  from_path: string;
  to_path: string;
  type: "301" | "302" | "404";
  is_active: boolean;
  hit_count: number;
  created_at: string;
}

const headingFont = { fontFamily: "var(--font-heading)" } as const;
const bodyFont = { fontFamily: "var(--font-body)" } as const;
const displayFont = { fontFamily: "var(--font-display)" } as const;
const inputClass = "w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 text-sm transition-colors duration-500";
const labelClass = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";

export default function AdminRedirects({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRedirects();
  }, []);

  const fetchRedirects = async () => {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "url_redirects")
      .maybeSingle();
    if (data?.value && Array.isArray(data.value)) {
      setRedirects(data.value as unknown as Redirect[]);
    }
    setLoading(false);
  };

  const saveRedirects = async (updated: Redirect[]) => {
    // Check for redirect loops
    const loopPaths = updated.filter(r => r.is_active).filter(r => {
      return updated.some(other => other.is_active && other.from_path === r.to_path && other.to_path === r.from_path);
    });
    if (loopPaths.length > 0) {
      toast({ title: "Redirect loop detected", description: `"${loopPaths[0].from_path}" and "${loopPaths[0].to_path}" create a circular redirect.`, variant: "destructive" });
      return;
    }
    // Check for self-redirects
    const selfRedirects = updated.filter(r => r.is_active && r.from_path === r.to_path);
    if (selfRedirects.length > 0) {
      toast({ title: "Self-redirect detected", description: `"${selfRedirects[0].from_path}" redirects to itself.`, variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "url_redirects",
      value: updated as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setRedirects(updated);
      qc.setQueryData(["site-setting", "url_redirects"], updated);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Redirects saved" });
    }
  };

  const addRedirect = () => {
    setRedirects((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        from_path: "/old-page",
        to_path: "/new-page",
        type: "301",
        is_active: true,
        hit_count: 0,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  const updateRedirect = (id: string, field: keyof Redirect, value: any) => {
    setRedirects((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const removeRedirect = (id: string) => {
    setRedirects((prev) => prev.filter((r) => r.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-px bg-primary" />
        <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={headingFont}>SEO</span>
      </div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-light tracking-tight" style={displayFont}>
          URL <em className="italic text-primary">Redirects</em>
        </h2>
        <button onClick={addRedirect} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity" style={headingFont}>
          <Plus className="h-3.5 w-3.5" /> Add Redirect
        </button>
      </div>

      {/* Stats */}
      {redirects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="border border-border p-4">
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>Total Rules</span>
            <span className="text-2xl font-light" style={displayFont}>{redirects.length}</span>
          </div>
          <div className="border border-border p-4">
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>Active</span>
            <span className="text-2xl font-light text-green-500" style={displayFont}>{redirects.filter((r) => r.is_active).length}</span>
          </div>
          <div className="border border-border p-4">
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={headingFont}>Total Hits</span>
            <span className="text-2xl font-light" style={displayFont}>{redirects.reduce((s, r) => s + (r.hit_count || 0), 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Redirects List */}
      {redirects.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border">
          <ExternalLink className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-2" style={bodyFont}>No URL redirects configured</p>
          <p className="text-xs text-muted-foreground/60 mb-6" style={bodyFont}>
            Manage 301 (permanent), 302 (temporary), and custom 404 redirects.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {redirects.map((r) => (
            <div key={r.id} className="border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <select
                    value={r.type}
                    onChange={(e) => updateRedirect(r.id, "type", e.target.value)}
                    className="bg-transparent border border-border rounded px-2 py-1 text-xs"
                    style={headingFont}
                  >
                    <option value="301">301 Permanent</option>
                    <option value="302">302 Temporary</option>
                    <option value="404">404 Custom</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      onChange={(e) => updateRedirect(r.id, "is_active", e.target.checked)}
                      className="accent-primary"
                    />
                    <span className="text-[10px] text-muted-foreground" style={bodyFont}>Active</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground" style={bodyFont}>
                    {(r.hit_count || 0).toLocaleString()} hits
                  </span>
                </div>
                <button onClick={() => removeRedirect(r.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className={labelClass} style={headingFont}>From Path</label>
                  <input
                    value={r.from_path}
                    onChange={(e) => updateRedirect(r.id, "from_path", e.target.value)}
                    className={inputClass}
                    style={bodyFont}
                    placeholder="/old-url"
                  />
                </div>
                <ArrowRight className="h-4 w-4 text-primary shrink-0 mt-5" />
                <div className="flex-1">
                  <label className={labelClass} style={headingFont}>{r.type === "404" ? "Show Page" : "To Path"}</label>
                  <input
                    value={r.to_path}
                    onChange={(e) => updateRedirect(r.id, "to_path", e.target.value)}
                    className={inputClass}
                    style={bodyFont}
                    placeholder={r.type === "404" ? "/page/not-found" : "/new-url"}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {redirects.length > 0 && (
        <button onClick={() => saveRedirects(redirects)} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Redirects
        </button>
      )}
    </div>
  );
}
