import { useCookieConsent } from "@/hooks/core/useCookieConsent";
import { Helmet } from "react-helmet-async";
import { Cookie, Shield, BarChart3, Megaphone, Settings } from "lucide-react";

const headingFont = { fontFamily: "var(--font-heading)" };

const CookiePolicy = () => {
  const { setShowPreferences } = useCookieConsent();

  return (
    <>
      <Helmet>
        <title>Cookie Policy — 50mm Retina World</title>
        <meta name="description" content="Learn about the cookies used on 50mm Retina World, why we use them, and how to manage your preferences." />
      </Helmet>

      <div className="container mx-auto max-w-3xl px-4 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-primary/10">
            <Cookie className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground" style={headingFont}>
            Cookie Policy
          </h1>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">
          <p className="text-muted-foreground leading-relaxed">
            This Cookie Policy explains what cookies are, how 50mm Retina World uses them, and
            how you can control your cookie preferences. By using our platform, you acknowledge
            the use of cookies as described below.
          </p>

          {/* What are Cookies */}
          <section>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2" style={headingFont}>
              What Are Cookies?
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Cookies are small text files stored on your device when you visit a website. They help
              the site remember your preferences, improve performance, and provide a better browsing
              experience.
            </p>
          </section>

          {/* Cookie Categories */}
          <section>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2" style={headingFont}>
              Types of Cookies We Use
            </h2>

            <div className="space-y-4 mt-4 not-prose">
              {/* Essential */}
              <div className="p-4 rounded-xl border border-border/50 bg-card/60">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Essential Cookies</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                    Always Active
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Required for the website to function correctly. These include authentication tokens,
                  session management, security features, and remembering your cookie preferences.
                  These cannot be disabled.
                </p>
              </div>

              {/* Analytics */}
              <div className="p-4 rounded-xl border border-border/50 bg-card/60">
                <div className="flex items-center gap-3 mb-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Analytics Cookies</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Help us understand how visitors interact with our website by collecting and reporting
                  information anonymously. This data helps us improve site performance and user experience.
                  Examples include page views, session duration, and traffic sources.
                </p>
              </div>

              {/* Marketing */}
              <div className="p-4 rounded-xl border border-border/50 bg-card/60">
                <div className="flex items-center gap-3 mb-2">
                  <Megaphone className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Marketing Cookies</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Used to deliver personalized advertisements and track the effectiveness of advertising
                  campaigns. These may be set by third-party advertising partners and can track your
                  browsing activity across websites.
                </p>
              </div>
            </div>
          </section>

          {/* How to manage */}
          <section>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2" style={headingFont}>
              How to Manage Cookies
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              You can manage your cookie preferences at any time by clicking the button below,
              or via the <strong>"Cookie Settings"</strong> link in the website footer.
            </p>
            <button
              onClick={() => setShowPreferences(true)}
              className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:brightness-110 active:scale-[0.98] transition-all"
            >
              <Settings className="w-4 h-4" />
              Open Cookie Settings
            </button>
            <p className="text-muted-foreground leading-relaxed mt-4">
              You can also control cookies through your browser settings. Most browsers allow you
              to block or delete cookies. Note that blocking essential cookies may affect the
              functionality of the website.
            </p>
          </section>

          {/* Updates */}
          <section>
            <h2 className="text-lg font-semibold text-foreground" style={headingFont}>
              Updates to This Policy
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Cookie Policy from time to time to reflect changes in our
              practices or for legal, operational, or regulatory reasons. The latest version
              will always be available on this page.
            </p>
          </section>

          <p className="text-xs text-muted-foreground/60 pt-4 border-t border-border/30">
            Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    </>
  );
};

export default CookiePolicy;
