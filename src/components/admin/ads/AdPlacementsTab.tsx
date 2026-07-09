/**
 * Placements overview tab — extracted from AdminAdvertisements.
 */
import { useState } from "react";
import { Loader2, Save, Info, Monitor, Smartphone } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AdSlot, Placement } from "./AdTypes";
import { placementOptions, headingFont, bodyFont } from "./AdTypes";

interface Props {
  slots: AdSlot[];
  feedAdPositions: string;
  onFeedAdPositionsChange: (val: string) => void;
  onSaveFeedPositions: () => void;
  savingPositions: boolean;
}

export default function AdPlacementsTab({ slots, feedAdPositions, onFeedAdPositionsChange, onSaveFeedPositions, savingPositions }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Monitor className="h-5 w-5 text-primary" />
        <span className="text-xs tracking-[0.2em] uppercase text-foreground" style={headingFont}>Placement Overview</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {placementOptions.map((p) => {
          const pSlots = slots.filter((s) => s.placement === p.value);
          const active = pSlots.filter((s) => s.is_active).length;
          return (
            <div key={p.value} className="border border-border p-4 rounded-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] tracking-[0.15em] uppercase text-foreground" style={headingFont}>{p.label}</span>
                <span className="text-[9px] text-muted-foreground" style={headingFont}>{pSlots.length} slot{pSlots.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${active > 0 ? "bg-primary" : "bg-muted-foreground/30"}`} />
                <span className="text-[10px] text-muted-foreground" style={bodyFont}>
                  {active > 0 ? `${active} active` : "No active slots"}
                </span>
              </div>
              {pSlots.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
                  {pSlots.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-[11px]" style={bodyFont}>
                      <span className={s.is_active ? "text-foreground" : "text-muted-foreground line-through"}>{s.name}</span>
                      <span className={`text-[9px] ${s.ad_source === "adsense" ? "text-blue-500" : "text-muted-foreground"}`}>
                        {s.ad_source === "adsense" ? "AdSense" : "Internal"} · P{s.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Feed Ad Positions */}
      <div className="border border-border p-6 space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-[0.15em] uppercase text-foreground" style={headingFont}>Feed Ad Positions</span>
          <Tooltip>
            <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Comma-separated 0-indexed post indices after which a "between-entries" ad appears. Progressive post-count guards apply automatically (1st ad needs 4 posts, 2nd needs 14, 3rd needs 34, etc.)
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={feedAdPositions}
            onChange={(e) => onFeedAdPositionsChange(e.target.value)}
            placeholder="1, 4, 14, 34, 54"
            className="flex-1 bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
            style={bodyFont}
          />
          <button
            onClick={onSaveFeedPositions}
            disabled={savingPositions}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs tracking-[0.15em] uppercase border border-border hover:border-primary hover:text-primary transition-all disabled:opacity-50"
            style={headingFont}
          >
            {savingPositions ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground space-y-1" style={bodyFont}>
          <p>Current positions: ads appear after post #{feedAdPositions.split(",").map(s => parseInt(s.trim()) + 1).filter(n => !isNaN(n)).join(", #")}</p>
          <p>Min posts required: {feedAdPositions.split(",").map((_, i) => i === 0 ? 4 : i === 1 ? 14 : 14 + (i - 1) * 20).join(", ")}</p>
        </div>
      </div>
    </div>
  );
}
