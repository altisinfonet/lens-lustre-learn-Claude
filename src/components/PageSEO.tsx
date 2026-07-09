import { useSyncExternalStore } from "react";
import { Helmet } from "react-helmet-async";
import { useQueryClient } from "@tanstack/react-query";
import { useSEO } from "@/hooks/core/useSEO";

interface JsonLdArticle {
  type: "Article";
  headline: string;
  description?: string;
  image?: string;
  datePublished?: string;
  dateModified?: string;
  authorName?: string;
}

interface JsonLdCourse {
  type: "Course";
  name: string;
  description?: string;
  image?: string;
  provider?: string;
  difficulty?: string;
}

interface JsonLdEvent {
  type: "Event";
  name: string;
  description?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
}

interface JsonLdWebSite {
  type: "WebSite";
}

type JsonLdData = JsonLdArticle | JsonLdCourse | JsonLdEvent | JsonLdWebSite;

interface PageSEOProps {
  title?: string;
  description?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  jsonLd?: JsonLdData;
}

const SITE_URL = "https://50mmretina.com";
const SITE_NAME = "50mm Retina World";

function buildJsonLd(data: JsonLdData, canonicalUrl: string): object {
  switch (data.type) {
    case "Article":
      return {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: data.headline,
        description: data.description || "",
        image: data.image || "",
        datePublished: data.datePublished || "",
        dateModified: data.dateModified || data.datePublished || "",
        url: canonicalUrl,
        publisher: {
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_URL,
        },
        ...(data.authorName
          ? { author: { "@type": "Person", name: data.authorName } }
          : {}),
      };
    case "Course":
      return {
        "@context": "https://schema.org",
        "@type": "Course",
        name: data.name,
        description: data.description || "",
        image: data.image || "",
        url: canonicalUrl,
        provider: {
          "@type": "Organization",
          name: data.provider || SITE_NAME,
          sameAs: SITE_URL,
        },
        ...(data.difficulty
          ? { educationalLevel: data.difficulty }
          : {}),
      };
    case "Event":
      return {
        "@context": "https://schema.org",
        "@type": "Event",
        name: data.name,
        description: data.description || "",
        image: data.image || "",
        url: canonicalUrl,
        startDate: data.startDate || "",
        endDate: data.endDate || "",
        organizer: {
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_URL,
        },
        eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
      };
    case "WebSite":
      return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE_URL}/discover?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      };
  }
}

const PageSEO = ({ title, description, ogImage, ogType, jsonLd }: PageSEOProps) => {
  const meta = useSEO(title);
  const qc = useQueryClient();
  const queryCache = qc.getQueryCache();

  const finalDescription = description || meta.description;
  const finalOgImage = ogImage || meta.ogImage;
  const finalCanonical = meta.canonicalUrl;
  const finalOgType = ogType || "website";
  const shouldRenderSiteSchemas = !title && !description && !ogImage && !ogType && !jsonLd;

  const cachedSchemas = useSyncExternalStore(
    (onStoreChange) => queryCache.subscribe(() => onStoreChange()),
    () => qc.getQueryData<{ name: string; json: string }[]>(["site-setting", "seo_schemas"])
  );

  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={finalDescription} />

      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={finalDescription} />
      <meta property="og:site_name" content={meta.siteName} />
      <meta property="og:type" content={finalOgType} />
      {finalOgImage && <meta property="og:image" content={finalOgImage} />}
      {finalCanonical && <meta property="og:url" content={finalCanonical} />}

      {finalCanonical && <link rel="canonical" href={finalCanonical} />}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={finalDescription} />
      {finalOgImage && <meta name="twitter:image" content={finalOgImage} />}
      {meta.twitterHandle && <meta name="twitter:site" content={meta.twitterHandle} />}

      {meta.noindex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta name="robots" content="index, follow" />
      )}

      {meta.googleVerification && <meta name="google-site-verification" content={meta.googleVerification} />}
      {meta.bingVerification && <meta name="msvalidate.01" content={meta.bingVerification} />}

      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(buildJsonLd(jsonLd, finalCanonical || ""))}
        </script>
      )}

      {shouldRenderSiteSchemas && cachedSchemas?.map((schema, i) => {
        try {
          const parsed = JSON.parse(schema.json);
          return (
            <script key={`schema-${i}`} type="application/ld+json">
              {JSON.stringify(parsed)}
            </script>
          );
        } catch {
          return null;
        }
      })}
    </Helmet>
  );
};

export default PageSEO;
