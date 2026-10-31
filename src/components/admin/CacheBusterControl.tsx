/**
 * Cache-Buster Control (Admin / Dev)
 *
 * Surfaces the global `cache_buster` site_setting:
 *   { enabled: boolean, version: number }
 *
 * - Toggle "Enabled" → all clients run the cache-buster bootstrap on
 *   their next load.
 * - "Bump version now" increments the version, which forces every
 *   client (whose local stored version is lower) to unregister SWs,
 *   purge Cache Storage, and hard-reload with `?cb=<version>`.
 *
 * Lives on /admin/health under the existing audit widgets.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Zap } from "lucide-react";

type Value = { enabled: boolean; version: number };
const DEFAULT: Value = { enabled: false, version: 1 };

export default function CacheBusterControl() {
  const [value, setValue] = useState<Value>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "cache_buster")
        .maybeSingle();
      if (error) throw error;
      const raw = (data?.value ?? null) as Partial<Value> | null;
      setValue({
        enabled: Boolean(raw?.enabled ?? false),
        version: Number(raw?.version ?? 1) || 1,
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load setting");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const persist = async (next: Value) => {
    setSaving(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "cache_buster", value: next as any }, { onConflict: "key" });
      if (error) throw error;
      setValue(next);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = () => persist({ ...value, enabled: !value.enabled });
  const bumpVersion = () => persist({ ...value, version: value.version + 1 });

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Zap className="h-3.5 w-3.5" />
          Cache-Buster (Dev / Test)
        </h3>
        <button
          onClick={load}
          disabled={loading || saving}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border text-foreground hover:bg-muted disabled:opacity-50"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
        When <strong>Enabled</strong>, every client unregisters service workers,
        wipes Cache Storage, and hard-reloads with <code>?cb=&lt;version&gt;</code>{" "}
        the next time they load the app — but only if their stored version is
        lower than the server version. Use <strong>Bump version now</strong> to
        force all currently-online clients to refresh.
      </p>

      {err && (
        <div className="border border-destructive/30 bg-destructive/5 p-3 mb-3 text-[11px] text-destructive">
          {err}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-border rounded p-3 bg-background/50">
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">
            Status
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {value.enabled ? (
                <span className="text-emerald-500">Enabled</span>
              ) : (
                <span className="text-muted-foreground">Disabled</span>
              )}
            </span>
            <button
              onClick={toggleEnabled}
              disabled={saving || loading}
              className={`text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 disabled:opacity-50 ${
                value.enabled
                  ? "bg-muted text-foreground hover:bg-muted/70"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {value.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        </div>

        <div className="border border-border rounded p-3 bg-background/50">
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">
            Current Version
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-semibold">
              v{value.version}
            </span>
            <button
              onClick={bumpVersion}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Zap className="h-3 w-3" />
              Bump Version Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
