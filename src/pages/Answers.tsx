/**
 * /help and /help/:slug — AEO answer pages (Owner order 2026-11-10).
 * Content: the ONE list in src/lib/answers/answers.ts (Owner-approved facts).
 * Robots get the same text as readable HTML + FAQPage markup from
 * seo-route-metadata (supabase/functions/_shared/answers.ts, kept identical).
 */
import { Link, useParams } from "react-router-dom";
import PageSEO from "@/components/PageSEO";
import { ANSWERS, ANSWERS_INTRO, ANSWERS_TITLE, answerBySlug, faqJsonLd, type Answer } from "@/lib/answers/answers";
import { SITE_ORIGIN } from "@/lib/env";
import NotFound from "@/pages/NotFound";

function AnswerBlock({ a, headingLevel }: { a: Answer; headingLevel: "h1" | "h2" }) {
  const H = headingLevel;
  return (
    <article id={a.slug} className="scroll-mt-20">
      <H
        className={headingLevel === "h1" ? "text-2xl md:text-5xl font-light tracking-tight mb-4" : "text-lg md:text-2xl font-light mb-2"}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {headingLevel === "h2" ? <Link to={`/help/${a.slug}`} className="hover:text-primary transition-colors">{a.question}</Link> : a.question}
      </H>
      {a.answer.map((p, i) => (
        <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-2" style={{ fontFamily: "var(--font-body)" }}>{p}</p>
      ))}
      {a.links.length > 0 && (
        <p className="text-xs mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {a.links.map(([label, to]) => (
            <Link key={to} to={to} className="text-primary hover:underline">{label}</Link>
          ))}
        </p>
      )}
    </article>
  );
}

export default function Answers() {
  const { slug } = useParams<{ slug?: string }>();
  const one = slug ? answerBySlug(slug) : undefined;
  if (slug && !one) return <NotFound />;

  const items = one ? [one] : ANSWERS;
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={one ? one.question : ANSWERS_TITLE}
        description={one ? one.answer.join(" ") : ANSWERS_INTRO}
        rawJsonLd={JSON.stringify(faqJsonLd(items, SITE_ORIGIN))}
      />
      <div className="container mx-auto max-w-3xl py-6 md:py-20">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-px bg-primary" />
          <Link to="/help" className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
            {ANSWERS_TITLE}
          </Link>
        </div>
        {one ? (
          <>
            <AnswerBlock a={one} headingLevel="h1" />
            <nav className="mt-10 border-t border-border pt-6">
              <h2 className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>More questions</h2>
              <ul className="space-y-2">
                {ANSWERS.filter((a) => a.slug !== one.slug).map((a) => (
                  <li key={a.slug}><Link to={`/help/${a.slug}`} className="text-sm hover:text-primary transition-colors">{a.question}</Link></li>
                ))}
              </ul>
            </nav>
          </>
        ) : (
          <>
            <h1 className="text-2xl md:text-6xl font-light tracking-tight mb-3 md:mb-6" style={{ fontFamily: "var(--font-display)" }}>{ANSWERS_TITLE}</h1>
            <p className="text-xs md:text-sm text-muted-foreground max-w-lg leading-relaxed mb-8 md:mb-12" style={{ fontFamily: "var(--font-body)" }}>{ANSWERS_INTRO}</p>
            <div className="space-y-8">
              {ANSWERS.map((a) => <AnswerBlock key={a.slug} a={a} headingLevel="h2" />)}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
