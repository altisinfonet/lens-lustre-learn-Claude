/**
 * S7b-6 · "Saved for no internet": how much of the phone saved videos may use
 * (one shared budget, default 300 MB), whether they are saved on Wi-Fi only
 * (default yes), what is used now, and a way to remove them.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { CloudOff } from "lucide-react";
import PageSEO from "@/components/PageSEO";
import { useAuth } from "@/hooks/core/useAuth";
import {
  BUDGET_CHOICES_MB, clearSavedVideos, getVideoOfflineSettings, savedVideoUsage, setVideoOfflineSettings, subscribeVideoOffline,
} from "@/lib/video/offlineVideo";

const MB = 1024 * 1024;
let snapshot = { settings: getVideoOfflineSettings(), usage: savedVideoUsage() };
const read = () => {
  const settings = getVideoOfflineSettings();
  const usage = savedVideoUsage();
  const s = snapshot;
  if (s.settings.budgetMB !== settings.budgetMB || s.settings.wifiOnly !== settings.wifiOnly || s.usage.bytes !== usage.bytes || s.usage.videos !== usage.videos) {
    snapshot = { settings, usage };
  }
  return snapshot;
};

export default function OfflineSettings() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { settings, usage } = useSyncExternalStore(subscribeVideoOffline, read, read);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [user, loading, navigate]);
  if (loading || !user) return null;

  const usedMB = Math.round(usage.bytes / MB);
  const remove = async () => {
    setRemoving(true);
    try { await clearSavedVideos(); } finally { setRemoving(false); }
  };

  return (
    <>
      <PageSEO title="Saved for no internet" description="Videos kept on this phone for when there is no internet." />
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 rounded-xl bg-primary/10">
              <CloudOff className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Saved for no internet</h1>
              <p className="text-sm text-muted-foreground">
                Feed videos that play while you scroll are saved on this phone (the first part of each, in small size), so they play again with no internet.
              </p>
            </div>
          </div>

          <div className="space-y-6 rounded-xl border border-border p-4">
            <div>
              <label htmlFor="video-budget" className="block text-sm font-medium text-foreground">Space for saved videos</label>
              <select
                id="video-budget"
                className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
                value={String(settings.budgetMB)}
                onChange={(e) => setVideoOfflineSettings({ budgetMB: Number(e.target.value) })}
              >
                {(BUDGET_CHOICES_MB.includes(settings.budgetMB as (typeof BUDGET_CHOICES_MB)[number]) ? BUDGET_CHOICES_MB : [...BUDGET_CHOICES_MB, settings.budgetMB]).map((mb) => (
                  <option key={mb} value={String(mb)}>{mb === 0 ? "Off — do not save videos" : mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {usedMB} MB of {settings.budgetMB} MB used · {usage.videos} {usage.videos === 1 ? "video" : "videos"}
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.wifiOnly}
                onChange={(e) => setVideoOfflineSettings({ wifiOnly: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Save videos only on Wi-Fi</span>
                <span className="block text-xs text-muted-foreground">Saving videos does not use your mobile data.</span>
              </span>
            </label>

            <button
              type="button"
              onClick={() => void remove()}
              disabled={removing || usage.videos === 0}
              className="rounded-md border border-border px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              Remove saved videos
            </button>

            <p className="text-xs text-muted-foreground">
              Course lesson videos play from YouTube, so they need a connection.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
