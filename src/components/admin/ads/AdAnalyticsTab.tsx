/**
 * Analytics tab — extracted from AdminAdvertisements.
 */
import { useMemo } from "react";
import { Loader2, BarChart3, Info, Beaker } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AdSlot, ImpressionAgg, ConversionAgg } from "./AdTypes";
import { headingFont, bodyFont } from "./AdTypes";

interface Props {
  slots: AdSlot[];
  impressions: ImpressionAgg[];
  conversions: ConversionAgg[];
  analyticsRange: "7d" | "30d" | "90d";
  onRangeChange: (range: "7d" | "30d" | "90d") => void;
  loading: boolean;
}

interface SourceMetrics { impressions: number; clicks: number; conversions: number; revenue: number }

export default function AdAnalyticsTab({ slots, impressions, conversions, analyticsRange, onRangeChange, loading }: Props) {
  const activeSlots = slots.filter((s) => s.is_active);

  const analytics = useMemo(() => {
    let totalImpressions = 0, totalClicks = 0, totalRevenue = 0, totalConversions = 0, totalConversionValue = 0;

    type SlotData = { impressions: number; clicks: number; conversions: number; revenue: number; conversionValue: number; name: string; placement: string };
    const bySlot = new Map<string, SlotData>();
    type PlacementData = { impressions: number; clicks: number; conversions: number; revenue: number; conversionValue: number };
    const byPlacement = new Map<string, PlacementData>();
    const bySource = {
      internal: { impressions: 0, clicks: 0, revenue: 0, conversions: 0 },
      adsense: { impressions: 0, clicks: 0, revenue: 0, conversions: 0 },
    };
    const byDevice = new Map<string, number>();
    const bySlotSource = new Map<string, { internal: SourceMetrics; adsense: SourceMetrics; isAb: boolean; name: string }>();

    const getSlotSource = (slotId: string) => {
      if (!bySlotSource.has(slotId)) {
        const slot = slots.find((s) => s.id === slotId);
        bySlotSource.set(slotId, {
          internal: { impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
          adsense: { impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
          isAb: slot?.ab_enabled === true,
          name: slot?.name || `Unnamed Slot (${slotId.slice(0, 8)})`,
        });
      }
      return bySlotSource.get(slotId)!;
    };

    impressions.forEach((i) => {
      const cnt = i.count || 0;
      const rev = i.revenue || 0;
      if (i.event_type === "impression") totalImpressions += cnt;
      else if (i.event_type === "click") totalClicks += cnt;
      totalRevenue += rev;

      if (!bySlot.has(i.slot_id)) {
        const slot = slots.find((s) => s.id === i.slot_id);
        bySlot.set(i.slot_id, { impressions: 0, clicks: 0, conversions: 0, revenue: 0, conversionValue: 0, name: slot?.name || `Unnamed Slot (${i.slot_id.slice(0, 8)})`, placement: slot?.placement || i.placement });
      }
      const slotEntry = bySlot.get(i.slot_id)!;
      if (i.event_type === "impression") slotEntry.impressions += cnt;
      else if (i.event_type === "click") slotEntry.clicks += cnt;
      slotEntry.revenue += rev;

      if (!byPlacement.has(i.placement)) byPlacement.set(i.placement, { impressions: 0, clicks: 0, conversions: 0, revenue: 0, conversionValue: 0 });
      const plEntry = byPlacement.get(i.placement)!;
      if (i.event_type === "impression") plEntry.impressions += cnt;
      else if (i.event_type === "click") plEntry.clicks += cnt;
      plEntry.revenue += rev;

      const src = i.ad_source === "adsense" ? "adsense" : "internal";
      if (i.event_type === "impression") bySource[src].impressions += cnt;
      else if (i.event_type === "click") bySource[src].clicks += cnt;
      bySource[src].revenue += rev;

      const ss = getSlotSource(i.slot_id);
      if (i.event_type === "impression") ss[src].impressions += cnt;
      else if (i.event_type === "click") ss[src].clicks += cnt;
      ss[src].revenue += rev;

      if (i.event_type === "impression") byDevice.set(i.device, (byDevice.get(i.device) || 0) + cnt);
    });

    conversions.forEach((c) => {
      const cnt = c.count || 0;
      const val = c.conv_value || 0;
      totalConversions += cnt;
      totalConversionValue += val;
      const slotEntry = bySlot.get(c.ad_id);
      if (slotEntry) { slotEntry.conversions += cnt; slotEntry.conversionValue += val; }
      const plEntry = byPlacement.get(c.placement);
      if (plEntry) { plEntry.conversions += cnt; plEntry.conversionValue += val; }
    });

    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00";
    const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(2) : "0.00";
    const rpm = totalImpressions > 0 ? ((totalRevenue / totalImpressions) * 1000).toFixed(2) : "0.00";

    return { totalImpressions, totalClicks, totalConversions, totalRevenue, totalConversionValue, ctr, conversionRate, rpm, bySlot, byPlacement, bySource, byDevice, bySlotSource };
  }, [impressions, conversions, slots]);

  const calcRpm = (m: { impressions: number; revenue: number }) => m.impressions > 0 ? (m.revenue / m.impressions) * 1000 : 0;
  const calcCtr = (m: { impressions: number; clicks: number }) => m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <span className="text-xs tracking-[0.2em] uppercase text-foreground" style={headingFont}>Ad Performance Analytics</span>
        </div>
        <div className="flex gap-2">
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button key={r} onClick={() => onRangeChange(r)}
              className={`text-[9px] tracking-wider uppercase px-3 py-1.5 border transition-all ${analyticsRange === r ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`} style={headingFont}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
            {[
              { label: "Impressions", value: analytics.totalImpressions.toLocaleString() },
              { label: "Clicks", value: analytics.totalClicks.toLocaleString() },
              { label: "Conversions", value: analytics.totalConversions.toLocaleString() },
              { label: "CTR", value: `${analytics.ctr}%` },
              { label: "Conv. Rate", value: `${analytics.conversionRate}%`, tooltip: "Based on tracked conversions linked to ad clicks. May exclude indirect or untracked conversions." },
              { label: "Revenue (Est.)", value: `₹${analytics.totalRevenue.toFixed(2)}`, tooltip: "Based on your configured CPM/CPC rates. Actual AdSense revenue is not tracked internally — check your AdSense dashboard for real earnings." },
              { label: "Conv. Value (Est.)", value: `₹${analytics.totalConversionValue.toFixed(2)}`, tooltip: "Based on fixed conversion values configured per ad. Not actual tracked transaction amounts." },
              { label: "RPM (Est.)", value: `₹${analytics.rpm}` },
              { label: "Active Slots", value: activeSlots.length.toString() },
            ].map((card: { label: string; value: string; tooltip?: string }) => (
              <div key={card.label} className="border border-border p-3">
                <p className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground mb-1 flex items-center gap-1" style={headingFont}>
                  {card.label}
                  {card.tooltip && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></TooltipTrigger>
                        <TooltipContent className="max-w-[220px] text-[10px]"><p>{card.tooltip}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </p>
                <p className="text-xl font-light text-foreground" style={{ fontFamily: "var(--font-display)" }}>{card.value}</p>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-muted-foreground/70 italic -mt-1" style={bodyFont}>Includes estimated revenue from internal ads and AdSense (not actual AdSense earnings)</p>

          {/* Source Comparison */}
          <div className="border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>Source Comparison</p>
              <span className="text-[9px] tracking-[0.1em] uppercase px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 border border-amber-500/20" style={headingFont}>Partial data</span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {(["internal", "adsense"] as const).map((src) => {
                const d = analytics.bySource[src];
                const srcCtr = d.impressions > 0 ? ((d.clicks / d.impressions) * 100).toFixed(2) : "0.00";
                const srcRpm = d.impressions > 0 ? ((d.revenue / d.impressions) * 1000).toFixed(2) : "0.00";
                return (
                  <div key={src} className="border border-border/50 rounded-sm p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <p className={`text-[10px] tracking-[0.15em] uppercase ${src === "adsense" ? "text-accent-foreground" : "text-foreground"}`} style={headingFont}>
                        {src === "adsense" ? "Google AdSense" : "Internal Ads"}
                      </p>
                      {src === "adsense" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild><Info className="h-3 w-3 text-amber-500/70 cursor-help" /></TooltipTrigger>
                            <TooltipContent className="max-w-[240px] text-[10px]"><p>Actual AdSense revenue is not tracked internally. Revenue & RPM shown here are estimates based on your configured CPM/CPC rates. Check your AdSense dashboard for real earnings.</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div><p className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>{d.impressions}</p><p className="text-[9px] text-muted-foreground" style={headingFont}>Impr.</p></div>
                      <div><p className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>{d.clicks}</p><p className="text-[9px] text-muted-foreground" style={headingFont}>Clicks</p></div>
                      <div><p className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>{srcCtr}%</p><p className="text-[9px] text-muted-foreground" style={headingFont}>CTR</p></div>
                      <div><p className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>{src === "adsense" ? <span className="text-muted-foreground/70">~</span> : ""}₹{srcRpm}</p><p className="text-[9px] text-muted-foreground" style={headingFont}>RPM (Est.)</p></div>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-[8px] text-muted-foreground/60 mt-2 cursor-help italic" style={bodyFont}>Conv. & Conv. Rate: Not available</p>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[220px] text-[10px]"><p>Conversions are tracked per ad, not per source</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {src === "adsense" && (d.impressions > 0 || d.clicks > 0) && (
                      <p className="text-[9px] text-amber-500/80 mt-3 text-center italic" style={bodyFont}>⚠ Estimated — not actual AdSense revenue</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-Slot Breakdown */}
          <div className="border border-border p-5">
            <p className="text-[10px] tracking-[0.2em] uppercase text-foreground mb-4" style={headingFont}>Per-Slot Performance <span className="text-muted-foreground">(sorted by revenue)</span></p>
            {analytics.bySlot.size === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6" style={bodyFont}>No data yet for this period.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-8 gap-2 text-[8px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border pb-2 mb-1" style={headingFont}>
                  <span className="col-span-2">Slot</span><span className="text-right">Impr.</span><span className="text-right">Clicks</span><span className="text-right">Conv.</span><span className="text-right">CTR</span><span className="text-right">Conv %</span><span className="text-right">Revenue (Est.)</span>
                </div>
                {Array.from(analytics.bySlot.entries())
                  .sort(([, a], [, b]) => b.revenue - a.revenue)
                  .map(([slotId, d]) => {
                    const slotCtr = d.impressions > 0 ? ((d.clicks / d.impressions) * 100).toFixed(1) : "0.0";
                    const slotConvRate = d.clicks > 0 ? ((d.conversions / d.clicks) * 100).toFixed(1) : "0.0";
                    return (
                      <div key={slotId} className="grid grid-cols-8 gap-2 py-2 border-b border-border/20 last:border-0 text-[11px]" style={bodyFont}>
                        <span className="col-span-2 truncate text-foreground font-medium">{d.name}</span>
                        <span className="text-right text-muted-foreground">{d.impressions}</span>
                        <span className="text-right text-muted-foreground">{d.clicks}</span>
                        <span className="text-right text-muted-foreground">{d.conversions}</span>
                        <span className="text-right text-foreground">{slotCtr}%</span>
                        <span className="text-right text-foreground">{slotConvRate}%</span>
                        <span className="text-right text-foreground font-medium">₹{d.revenue.toFixed(2)}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* A/B Per-Slot Breakdown */}
          {(() => {
            const abSlots = Array.from(analytics.bySlotSource.entries()).filter(([, d]) => d.isAb && (d.internal.impressions > 0 || d.adsense.impressions > 0));
            if (abSlots.length === 0) return null;

            const getWinner = (int: SourceMetrics, ads: SourceMetrics): "internal" | "adsense" | "tie" => {
              const intRpm = calcRpm(int);
              const adsRpm = calcRpm(ads);
              if (intRpm === 0 && adsRpm === 0) return "tie";
              if (intRpm > adsRpm * 1.05) return "internal";
              if (adsRpm > intRpm * 1.05) return "adsense";
              return "tie";
            };

            return (
              <div className="border border-border p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Beaker className="h-4 w-4 text-primary" />
                  <p className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>A/B Test Results Per Slot</p>
                </div>
                <div className="space-y-4">
                  {abSlots.map(([slotId, data]) => {
                    const winner = getWinner(data.internal, data.adsense);
                    const slot = slots.find(s => s.id === slotId);
                    const currentPct = slot?.ab_adsense_pct ?? 50;
                    return (
                      <div key={slotId} className="border border-border/50 rounded-sm p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground" style={bodyFont}>{data.name}</span>
                            <span className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-amber-400/40 text-amber-500" style={headingFont}>A/B</span>
                            <span className="text-[8px] tracking-[0.1em] uppercase px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 border border-amber-500/20" style={headingFont}>Partial data</span>
                            <span className="text-[9px] text-muted-foreground" style={bodyFont}>Split: {100 - currentPct}% Internal / {currentPct}% AdSense</span>
                          </div>
                          {winner !== "tie" && (
                            <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-sm ${winner === "internal" ? "bg-primary/10 text-primary border border-primary/30" : "bg-blue-500/10 text-blue-500 border border-blue-500/30"}`} style={headingFont}>
                              {winner === "internal" ? "Internal leads" : "AdSense leads"}
                            </span>
                          )}
                        </div>
                        <div className="grid md:grid-cols-2 gap-3">
                          {(["internal", "adsense"] as const).map((src) => {
                            const m = src === "internal" ? data.internal : data.adsense;
                            const mCtr = calcCtr(m);
                            const mRpm = calcRpm(m);
                            return (
                              <div key={src} className={`border rounded-sm p-3 ${winner === src ? "border-primary/40 bg-primary/5" : "border-border/30"}`}>
                                <p className="text-[9px] tracking-wider uppercase text-muted-foreground mb-2" style={headingFont}>{src === "internal" ? "Internal" : "AdSense"}</p>
                                <div className="grid grid-cols-4 gap-1 text-center text-[10px]" style={bodyFont}>
                                  <div><p className="font-medium text-foreground">{m.impressions}</p><p className="text-[8px] text-muted-foreground">Impr</p></div>
                                  <div><p className="font-medium text-foreground">{m.clicks}</p><p className="text-[8px] text-muted-foreground">Clicks</p></div>
                                  <div><p className="font-medium text-foreground">{mCtr.toFixed(1)}%</p><p className="text-[8px] text-muted-foreground">CTR</p></div>
                                  <div><p className="font-medium text-foreground">{src === "adsense" ? "~" : ""}₹{mRpm.toFixed(1)}</p><p className="text-[8px] text-muted-foreground">RPM</p></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
