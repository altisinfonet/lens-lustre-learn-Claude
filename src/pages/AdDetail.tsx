/**
 * /ad/:creativeId — a sponsored ad on a page of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN AD NEEDS A PAGE
 *
 * Owner, 2026-08-11, choosing between the two options he was offered: a new
 * /ad/<id> page, so that "Like Comment share ... like a normal post" is true of
 * share as well as of like and comment. Without a page there is nothing to
 * share — copying the advertiser's own click_url would send people to the
 * advertiser's website rather than to the ad on 50mm Retina World, and a reply
 * notification would have had nowhere to open.
 *
 * The layout is PostDetail's, with the parts an ad actually has: the publisher
 * header (the same one the feed card draws, and by the same rules), the picture,
 * the action row, and the thread — open, because on this page the thread IS the
 * page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHOSE NAME IS ON IT
 *
 * Identical to AdZone's rule, deliberately: an empty advertiser_name means the
 * ad is the platform's own and it gets the site logo, the site name and the
 * verified tick. A named third party gets their own logo or a letter avatar and
 * NO tick, because we have verified nothing about them. Repeating the rule here
 * rather than importing it would be how the two drift, so the reasoning lives in
 * AdZone and this follows it.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import VerifiedBadge from "@/components/VerifiedBadge";
import AdEngagementBar from "@/components/ads/AdEngagementBar";
import PageSEO from "@/components/PageSEO";

interface Creative {
  id: string;
  image_url: string;
  click_url: string;
  alt_text: string;
  headline: string;
  subtext: string;
  cta: string;
  advertiser_name: string;
  advertiser_logo_url: string;
  is_active: boolean;
}

const AdDetail = () => {
  const { creativeId } = useParams<{ creativeId: string }>();
  const siteLogo = useSiteLogo();
  const [creative, setCreative] = useState<Creative | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!creativeId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("ad_creatives" as any)
        .select(
          "id, image_url, click_url, alt_text, headline, subtext, cta, advertiser_name, advertiser_logo_url, is_active",
        )
        .eq("id", creativeId)
        .maybeSingle();
      if (!alive) return;
      const row = data as any;
      setCreative(
        row
          ? {
              ...row,
              advertiser_name: row.advertiser_name || "",
              advertiser_logo_url: row.advertiser_logo_url || "",
              alt_text: row.alt_text || "",
              headline: row.headline || "",
              subtext: row.subtext || "",
              cta: row.cta || "",
              click_url: row.click_url || "",
            }
          : null,
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [creativeId]);

  if (loading) {
    return <div className="container py-10 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!creative) {
    return (
      <div className="container py-10 space-y-3">
        <p className="text-sm text-muted-foreground">This sponsored post is no longer available.</p>
        <Link to="/feed" className="text-sm text-primary hover:underline">
          Back to the feed
        </Link>
      </div>
    );
  }

  const advertiser = creative.advertiser_name.trim();
  const advertiserLogo = creative.advertiser_logo_url.trim();

  return (
    <>
      <PageSEO
        title={`${advertiser || "50mm Retina World"} — Sponsored`}
        description={
          creative.headline || creative.alt_text || "A sponsored post on 50mm Retina World."
        }
        ogImage={creative.image_url}
      />
      <div className="container max-w-[600px] py-3">
        <Link
          to="/feed"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Feed
        </Link>

        <div className="overflow-hidden">
          {/* Header — same geometry as PostCard's and AdZone's. */}
          <div className="flex items-center gap-2.5 p-3 pb-2">
            <span className="shrink-0 inline-block w-8 h-8">
              {advertiser && advertiserLogo ? (
                <img
                  src={advertiserLogo}
                  alt=""
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : advertiser ? (
                <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs text-primary" style={{ fontFamily: "var(--font-display)" }}>
                    {advertiser[0]?.toUpperCase()}
                  </span>
                </span>
              ) : (
                <img
                  src={siteLogo}
                  alt=""
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-8 h-8 rounded-full object-cover"
                />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <span
                  className="text-sm font-semibold truncate"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {advertiser || "50mm Retina World"}
                </span>
                {!advertiser && (
                  <span className="inline-flex shrink-0">
                    <VerifiedBadge className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">Sponsored</div>
            </div>
          </div>

          {/* Picture. Clicking it goes where the ad goes, and nowhere else. */}
          {creative.image_url &&
            (creative.click_url ? (
              <a href={creative.click_url} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={creative.image_url}
                  alt={creative.alt_text || "Sponsored"}
                  className="w-full h-auto"
                  loading="lazy"
                />
              </a>
            ) : (
              <img
                src={creative.image_url}
                alt={creative.alt_text || "Sponsored"}
                className="w-full h-auto"
                loading="lazy"
              />
            ))}

          <AdEngagementBar creativeId={creative.id} commentsAlwaysOpen />

          {(creative.headline || creative.subtext) && (
            <div className="px-3 pb-2 text-sm">
              {creative.headline && <span className="font-semibold">{creative.headline} </span>}
              {creative.subtext && <span className="text-foreground/90">{creative.subtext}</span>}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AdDetail;
