/**
 * AEO answer pages (AI search plan, step D — Owner order 2026-11-10).
 *
 * THE ONE LIST of questions and answers about 50mm Retina World. Every fact
 * here is from the Owner-APPROVED text in
 * _control/claude/handoff/OWNER-ANSWERS-llms-full-2026-11-10.md ("OK llms"),
 * the same text as public/llms-full.txt. Do not add a fact that is not there:
 * no member counts, no money per vote, no judges' names, no dates.
 *
 * Two copies, kept identical by src/__tests__/answersOneSource.test.ts:
 *   src/lib/answers/answers.ts                 — the /help pages in the app
 *   supabase/functions/_shared/answers.ts      — readable HTML + FAQ markup for
 *                                               robots (seo-route-metadata) and
 *                                               the sitemap
 * Plain TypeScript only (no imports), so both runtimes load it.
 */

export interface Answer {
  /** Address: /help/<slug>. Lower case, words joined by "-". Never change a live one. */
  slug: string;
  question: string;
  /** Paragraphs of plain text. */
  answer: string[];
  /** Further reading on the site: [label, path]. */
  links: Array<[string, string]>;
}

export const ANSWERS: Answer[] = [
  {
    slug: "what-is-50mm-retina-world",
    question: "What is 50mm Retina World?",
    answer: [
      "50mm Retina World is an international online community and competition platform for photographers.",
      "It is an initiative of Payeliana, owned and led by renowned entrepreneur Payel Kundu Basu, and is based in Kolkata, India.",
    ],
    links: [["Competitions", "/competitions"], ["Courses", "/courses"], ["Journal", "/journal"]],
  },
  {
    slug: "is-it-free-to-join",
    question: "Is 50mm Retina World free to join?",
    answer: [
      "Yes. Joining is free. Photographers anywhere in the world aged 18 or over can create an account.",
    ],
    links: [["Create a free account", "/signup"]],
  },
  {
    slug: "how-to-enter-a-photography-competition",
    question: "How do I enter a photography competition on 50mm Retina World?",
    answer: [
      "Competitions are open to photographers worldwide. Create a free account, open a competition from the Competitions page while it is open for entries, and submit your photographs on that competition's page.",
      "Most competitions are free to enter. Where a competition has an entry fee, it is shown clearly on that competition's page before anyone enters.",
    ],
    links: [["Competitions", "/competitions"]],
  },
  {
    slug: "are-competitions-free",
    question: "Do competitions on 50mm Retina World cost money to enter?",
    answer: [
      "Most competitions are free to enter. Where a competition has an entry fee, it is shown clearly on that competition's page before anyone enters.",
    ],
    links: [["Competitions", "/competitions"]],
  },
  {
    slug: "what-do-winners-receive",
    question: "What do competition winners receive?",
    answer: [
      "Winners receive cash prizes and certificates. The prizes for each competition are listed on its page.",
      "Every certificate carries a verification link and can be checked on the Verify page.",
    ],
    links: [["Winners", "/winners"], ["Verify a certificate", "/verify"]],
  },
  {
    slug: "are-ai-generated-images-allowed",
    question: "Are AI-generated images accepted in competitions?",
    answer: [
      "No. AI-generated images are not accepted in competitions on 50mm Retina World.",
    ],
    links: [["Competitions", "/competitions"]],
  },
  {
    slug: "who-judges-the-competitions",
    question: "Who judges the competitions?",
    answer: [
      "Entries are judged by a jury of 50 photographers drawn from among the world's leading names in photography.",
      "To keep every decision independent and free from outside influence, 50mm Retina World does not disclose the identities of its judges. Results are published on the Winners page.",
    ],
    links: [["Winners", "/winners"]],
  },
  {
    slug: "how-to-verify-a-certificate",
    question: "How can I check that a 50mm Retina World certificate is genuine?",
    answer: [
      "Every certificate carries a verification link and can be checked on the Verify page. This applies to competition certificates and to course certificates.",
    ],
    links: [["Verify a certificate", "/verify"]],
  },
  {
    slug: "photography-courses",
    question: "Does 50mm Retina World offer photography courses?",
    answer: [
      "Yes. 50mm Retina World offers photography courses for every level, from beginner to advanced. Each course is taught by an experienced professional photographer, named on the course page, and combines video lessons with written material. Courses are in English.",
      "Some courses are free; for paid courses, the price is shown on the course page. Taking a course requires a free 50mm Retina World account. Every member who completes a course receives a certificate that anyone can check on the Verify page.",
    ],
    links: [["Courses", "/courses"], ["Verify a certificate", "/verify"]],
  },
  {
    slug: "vote-and-earn",
    question: "What is Vote & Earn?",
    answer: [
      "Members can vote for their favourite photographs in competitions and are rewarded for every vote, credited instantly to their 50mm wallet. Rewards apply to competition voting only.",
    ],
    links: [["Competitions", "/competitions"]],
  },
  {
    slug: "apps",
    question: "Is there a 50mm Retina World app?",
    answer: [
      "Yes. 50mm Retina World is available on the web, on Android and on iPhone (iOS) — one account, one community.",
    ],
    links: [],
  },
  {
    slug: "languages",
    question: "Which languages does 50mm Retina World support?",
    answer: [
      "English is the main language of the platform; content can be translated into other languages.",
    ],
    links: [],
  },
  {
    slug: "who-owns-the-photos",
    question: "Who owns the photographs posted on 50mm Retina World?",
    answer: [
      "Every photograph on 50mm Retina World belongs solely to the photographer who posted it. Please link to the post or profile rather than copying the image, and credit the photographer by name.",
      "Photos on 50mm Retina World are never used to train AI.",
    ],
    links: [],
  },
  {
    slug: "contact",
    question: "How do I contact 50mm Retina World?",
    answer: [
      "General enquiries, press and partnerships: mail@50mmretina.com.",
      "Advertising: advertisement@50mmretina.com.",
    ],
    links: [],
  },
];

export const ANSWERS_TITLE = "Questions & answers";
export const ANSWERS_INTRO =
  "Straight answers about 50mm Retina World: joining, competitions, prizes, judging, certificates, courses, Vote & Earn and the apps.";

export function answerBySlug(slug: string): Answer | undefined {
  return ANSWERS.find((a) => a.slug === slug);
}

/**
 * The ONLY official pages of 50mm Retina World elsewhere (Owner 2026-11-11: "No other pages have").
 * Search engines join these to the site through the Organization `sameAs` list.
 */
export const OFFICIAL_PROFILES: string[] = [
  "https://www.facebook.com/50mmretinaworld",
  "https://www.instagram.com/50mmretinaworld",
  "https://play.google.com/store/apps/details?id=com.fiftymmretina.app",
];

/**
 * Every Organization block about us names the one site address and the official pages.
 * Other schema types pass through unchanged. `site` = canonical origin, no trailing slash.
 */
export function withOfficialProfiles(schema: unknown, site: string): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const s = schema as Record<string, unknown>;
  if (s["@type"] !== "Organization") return schema;
  const had = Array.isArray(s.sameAs) ? s.sameAs.filter((x): x is string => typeof x === "string") : [];
  return { ...s, url: `${site}/`, sameAs: [...new Set([...had, ...OFFICIAL_PROFILES])] };
}

/** schema.org FAQPage for one or more answers. `site` = canonical origin, no trailing slash. */
export function faqJsonLd(items: Answer[], site: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((a) => ({
      "@type": "Question",
      name: a.question,
      url: `${site}/help/${a.slug}`,
      acceptedAnswer: { "@type": "Answer", text: a.answer.join(" ") },
    })),
  };
}
