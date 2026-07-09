import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { clearS3Cache } from "@/lib/s3Upload";
import { Loader2, Save, Eye, EyeOff, Cloud, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import StorageMigrationPanel from "@/components/admin/StorageMigrationPanel";
import type { S3StorageSettings, SettingsSectionProps } from "./SettingsTypes";
import { inputClass, labelClass } from "./SettingsTypes";

interface Props extends SettingsSectionProps {
  s3: S3StorageSettings;
  setS3: React.Dispatch<React.SetStateAction<S3StorageSettings>>;
}

const PROVIDERS = [
  { id: "aws", label: "Amazon S3" },
  { id: "gcs", label: "Google Cloud Storage" },
  { id: "azure", label: "Azure Blob Storage" },
  { id: "digitalocean", label: "DigitalOcean Spaces" },
  { id: "wasabi", label: "Wasabi" },
  { id: "backblaze", label: "Backblaze B2" },
  { id: "cloudflare", label: "Cloudflare R2" },
  { id: "minio", label: "MinIO (Self-hosted)" },
];

const PROVIDER_HELP: Record<string, string> = {
  aws: "Use your IAM Access Key and Secret. Ensure your S3 bucket has the appropriate CORS and public access policies configured.",
  gcs: "Create an HMAC key in Google Cloud Console → Cloud Storage → Settings → Interoperability. Use the Access Key and Secret as credentials.",
  azure: "Use Azure Storage Account name as bucket, and a Shared Access Signature (SAS) or Storage Account Key. Set the endpoint to https://ACCOUNT.blob.core.windows.net.",
  digitalocean: "Create a Spaces access key in DigitalOcean → API → Spaces Keys. Set the endpoint to https://REGION.digitaloceanspaces.com.",
  wasabi: "Use Wasabi access keys from the Wasabi Console. Set the endpoint to https://s3.REGION.wasabisys.com.",
  backblaze: "Create an Application Key in Backblaze B2. Use the keyID as Access Key and the applicationKey as Secret. Set the endpoint to https://s3.REGION.backblazeb2.com.",
  cloudflare: "Get your R2 API token from Cloudflare Dashboard → R2 → Manage R2 API Tokens. Set endpoint to https://ACCOUNT_ID.r2.cloudflarestorage.com.",
  minio: "Use your MinIO server's access key and secret key. Set the endpoint to your MinIO server URL (e.g. http://localhost:9000).",
};

export default function StorageSettingsSection({ user, s3, setS3 }: Props) {
  const [savingS3, setSavingS3] = useState(false);
  const [showS3Secret, setShowS3Secret] = useState(false);

  const saveS3 = async () => {
    if (!user) return;
    setSavingS3(true);
    const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
      body: { action: "write", key: "s3_storage_settings", value: s3 },
    });
    setSavingS3(false);
    clearS3Cache();
    if (error || data?.error) {
      toast({ title: "Failed to save S3 settings", description: error?.message || data?.error, variant: "destructive" });
    } else {
      toast({ title: "S3 storage settings saved" });
    }
  };

  const applyProviderPreset = (providerId: string) => {
    const presets: Record<string, Partial<S3StorageSettings>> = {
      aws: { endpoint: "", region: s3.region || "us-east-1" },
      gcs: { endpoint: "https://storage.googleapis.com", region: "auto" },
      azure: { endpoint: `https://${s3.bucket_name || "ACCOUNT"}.blob.core.windows.net`, region: "auto" },
      digitalocean: { endpoint: `https://${s3.region || "nyc3"}.digitaloceanspaces.com`, region: s3.region || "nyc3" },
      wasabi: { endpoint: `https://s3.${s3.region || "us-east-1"}.wasabisys.com`, region: s3.region || "us-east-1" },
      backblaze: { endpoint: `https://s3.${s3.region || "us-west-004"}.backblazeb2.com`, region: s3.region || "us-west-004" },
      cloudflare: { endpoint: "", region: "auto" },
      minio: { endpoint: s3.endpoint || "http://localhost:9000", region: "us-east-1" },
    };
    setS3({ ...s3, ...presets[providerId], provider: providerId });
  };

  const renderRegionSelector = () => {
    if (s3.provider === "digitalocean") {
      return (
        <select className={inputClass} value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value, endpoint: `https://${e.target.value}.digitaloceanspaces.com` })}>
          {["nyc3", "sfo3", "ams3", "sgp1", "fra1", "blr1", "syd1"].map(r => (
            <option key={r} value={r}>{r.toUpperCase()}</option>
          ))}
        </select>
      );
    }
    if (s3.provider === "backblaze") {
      return (
        <select className={inputClass} value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value, endpoint: `https://s3.${e.target.value}.backblazeb2.com` })}>
          {["us-west-004", "us-west-002", "eu-central-003"].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      );
    }
    if (s3.provider === "wasabi") {
      return (
        <select className={inputClass} value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value, endpoint: `https://s3.${e.target.value}.wasabisys.com` })}>
          {["us-east-1", "us-east-2", "us-west-1", "us-central-1", "eu-central-1", "eu-central-2", "eu-west-1", "eu-west-2", "ap-northeast-1", "ap-southeast-1", "ap-southeast-2"].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      );
    }
    return (
      <select className={inputClass} value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })}>
        {["auto", "us-east-1", "us-east-2", "us-west-1", "us-west-2", "eu-west-1", "eu-west-2", "eu-central-1", "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "sa-east-1", "me-south-1", "af-south-1"].map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    );
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card/50">
        <Cloud className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>Cloud Storage (S3-Compatible)</h3>
      </div>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <label className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Enable External Storage</label>
          <Switch checked={s3.enabled} onCheckedChange={(checked) => setS3({ ...s3, enabled: checked })} />
          <span className={`text-[9px] tracking-wider uppercase ${s3.enabled ? "text-primary" : "text-muted-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
            {s3.enabled ? "Active" : "Disabled"}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-4" style={{ fontFamily: "var(--font-body)" }}>
          When enabled, all user-uploaded files will be stored in your chosen cloud storage provider instead of the default storage.
        </p>

        <div>
          <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Storage Provider</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {PROVIDERS.map((provider) => (
              <button key={provider.id} type="button" onClick={() => applyProviderPreset(provider.id)}
                className={`text-[9px] tracking-[0.1em] uppercase px-3 py-2.5 border rounded-sm transition-colors text-center ${
                  s3.provider === provider.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`} style={{ fontFamily: "var(--font-heading)" }}>
                {provider.label}
              </button>
            ))}
          </div>
        </div>

        {s3.provider && PROVIDER_HELP[s3.provider] && (
          <div className="border border-border/50 rounded-sm px-4 py-3 bg-muted/20 mb-2">
            <p className="text-[10px] text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
              {PROVIDER_HELP[s3.provider]}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Bucket Name</label>
            <input className={inputClass} placeholder="my-50mm-retina-bucket" value={s3.bucket_name} onChange={(e) => setS3({ ...s3, bucket_name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Region</label>
            {renderRegionSelector()}
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Access Key ID</label>
            <input className={inputClass} placeholder="AKIA..." value={s3.access_key_id} onChange={(e) => setS3({ ...s3, access_key_id: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Secret Access Key</label>
            <div className="relative">
              <input className={inputClass + " pr-10"} type={showS3Secret ? "text" : "password"} placeholder="••••••••" value={s3.secret_access_key} onChange={(e) => setS3({ ...s3, secret_access_key: e.target.value })} />
              <button onClick={() => setShowS3Secret(!showS3Secret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showS3Secret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Endpoint URL</label>
            <input className={inputClass} placeholder="https://s3.provider.com" value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} />
            <p className="text-[9px] text-muted-foreground mt-1">Leave empty for standard AWS S3. Auto-filled for other providers.</p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Public / CDN URL</label>
            <input className={inputClass} placeholder="https://cdn.example.com" value={s3.public_url || ""} onChange={(e) => setS3({ ...s3, public_url: e.target.value })} />
            <p className="text-[9px] text-muted-foreground mt-1">Public URL where uploaded files are served. Required for Cloudflare R2. <strong>Only applies to public buckets.</strong></p>
          </div>
          <div>
            <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Path Prefix (Optional)</label>
            <input className={inputClass} placeholder="uploads/50mm-retina" value={s3.path_prefix} onChange={(e) => setS3({ ...s3, path_prefix: e.target.value })} />
            <p className="text-[9px] text-muted-foreground mt-1">Files will be stored under this prefix in the bucket</p>
          </div>

          {/* Bucket Privacy Info */}
          <div className="col-span-full border border-border/50 rounded-sm p-4 bg-muted/10 mt-2">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] tracking-[0.15em] uppercase text-foreground font-medium" style={{ fontFamily: "var(--font-heading)" }}>Bucket Access Levels</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] tracking-[0.1em] uppercase text-muted-foreground mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>Public Buckets (CDN URL)</p>
                <div className="flex flex-wrap gap-1.5">
                  {["avatars", "post-images", "competition-photos", "journal-images", "course-images", "portfolio-images"].map((b) => (
                    <span key={b} className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{b}</span>
                  ))}
                </div>
                <p className="text-[8px] text-muted-foreground mt-1.5">Files served via the Public / CDN URL above. Accessible to anyone.</p>
              </div>
              <div>
                <p className="text-[9px] tracking-[0.1em] uppercase text-muted-foreground mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>Private Buckets (Signed URLs)</p>
                <div className="flex flex-wrap gap-1.5">
                  {["national-ids", "support-attachments"].map((b) => (
                    <span key={b} className="text-[9px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">{b}</span>
                  ))}
                </div>
                <p className="text-[8px] text-muted-foreground mt-1.5">Files require authentication. Accessed via time-limited signed URLs (15 min).</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button onClick={saveS3} disabled={savingS3}
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}>
            {savingS3 ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Storage Settings
          </button>
        </div>

        {s3.enabled && s3.bucket_name && s3.access_key_id && (
          <StorageMigrationPanel />
        )}
      </div>
    </div>
  );
}
