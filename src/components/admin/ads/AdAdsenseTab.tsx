/**
 * AdSense Config tab — extracted from AdminAdvertisements.
 */
import { Loader2, Save, Globe, Info } from "lucide-react";
import type { AdsenseConfig } from "./AdTypes";
import { headingFont, bodyFont, labelClass, inputClass } from "./AdTypes";

interface Props {
  config: AdsenseConfig;
  onChange: (config: AdsenseConfig) => void;
  onSave: () => void;
  saving: boolean;
}

export default function AdAdsenseTab({ config, onChange, onSave, saving }: Props) {
  return (
    <div className="border border-border p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="h-5 w-5 text-primary" />
        <span className="text-xs tracking-[0.2em] uppercase text-foreground" style={headingFont}>Google AdSense Configuration</span>
      </div>

      <div className="border border-border/50 rounded-sm px-5 py-4 bg-muted/10">
        <p className="text-[11px] text-muted-foreground leading-relaxed" style={bodyFont}>
          Connect your Google AdSense account to monetize ad slots with responsive AdSense units.
          All ad sizes are <strong className="text-foreground">responsive</strong> and comply with AdSense policies automatically.
          You can use the same ad space for either AdSense or internal ads — toggle per slot.
        </p>
      </div>

      <div>
        <label className={labelClass} style={headingFont}>Publisher ID *</label>
        <input value={config.publisher_id} onChange={(e) => onChange({ ...config, publisher_id: e.target.value })} className={inputClass} style={bodyFont} placeholder="ca-pub-XXXXXXXXXXXXXXXX" />
        <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>Find this in AdSense → Account → Account information</p>
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={config.enabled} onChange={(e) => onChange({ ...config, enabled: e.target.checked })} className="accent-primary w-4 h-4" />
          <span className="text-sm" style={bodyFont}>Enable AdSense</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={config.auto_ads} onChange={(e) => onChange({ ...config, auto_ads: e.target.checked })} className="accent-primary w-4 h-4" />
          <span className="text-sm" style={bodyFont}>Auto Ads (let Google place additional ads)</span>
        </label>
      </div>

      <div className="border border-primary/20 rounded-sm bg-primary/5 px-5 py-4">
        <p className="text-[10px] tracking-[0.2em] uppercase text-primary mb-2" style={headingFont}>Setup Steps</p>
        <ol className="text-[11px] text-muted-foreground leading-relaxed space-y-1 list-decimal list-inside" style={bodyFont}>
          <li>Sign up at <strong className="text-foreground">adsense.google.com</strong></li>
          <li>Add your site for verification</li>
          <li>Once approved, copy your Publisher ID (ca-pub-XXX) above</li>
          <li>Create responsive ad units in AdSense dashboard</li>
          <li>Copy each unit's Slot ID into the ad slots here</li>
          <li>Enable AdSense above and save</li>
        </ol>
      </div>

      <button onClick={onSave} disabled={saving}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save AdSense Config
      </button>
    </div>
  );
}
