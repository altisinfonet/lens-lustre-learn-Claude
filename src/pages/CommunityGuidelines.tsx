import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

const headingFont = { fontFamily: "var(--font-heading)" };

/**
 * Terms of Use (EULA) and Community Guidelines for user-generated content.
 *
 * Apple App Review guideline 1.2 requires that users agree to terms with no
 * tolerance for objectionable content or abusive users BEFORE registering or
 * logging in, and that the terms say how content is flagged, how users are
 * blocked, and that the developer acts on reports. This page is static (not a
 * CMS page) so it is always reachable from the signup and login screens, and
 * so a CMS edit cannot silently remove those commitments.
 */
const CommunityGuidelines = () => (
  <>
    <Helmet>
      <title>Terms of Use &amp; Community Guidelines — 50mm Retina World</title>
      <meta
        name="description"
        content="The terms of use and community guidelines for 50mm Retina World, including our zero-tolerance policy for objectionable content and abusive users."
      />
    </Helmet>

    <div className="container mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-primary/10">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground" style={headingFont}>
          Terms of Use &amp; Community Guidelines
        </h1>
      </div>

      <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">
        <p className="text-muted-foreground leading-relaxed">
          By creating an account or signing in to 50mm Retina World you agree to these terms. They
          apply to everything you post, comment, upload or send — photos, captions, stories,
          competition entries, profile details and messages.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-foreground" style={headingFont}>
            Zero tolerance for objectionable content and abusive users
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            There is no place on 50mm Retina World for objectionable content or abusive behaviour.
            You must not post, upload or share content that is:
          </p>
          <ul className="text-muted-foreground leading-relaxed list-disc pl-5 space-y-1">
            <li>sexually explicit, pornographic or exploitative, and anything involving minors in a sexual context;</li>
            <li>hateful, discriminatory or harassing toward any person or group;</li>
            <li>threatening, violent, graphic or glorifying harm to people or animals;</li>
            <li>bullying, stalking, doxxing or an impersonation of another person;</li>
            <li>spam, scams, or content you do not have the right to share (including other photographers’ work);</li>
            <li>illegal in your country or ours.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Content that breaks these rules is removed, and the account behind it can be suspended or
            permanently removed, without notice.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground" style={headingFont}>
            Reporting objectionable content
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Every post and comment has a menu with a <strong>Report</strong> option. Reports go straight
            to our moderation team. We review reports and act on objectionable content within 24 hours
            by removing it and, where appropriate, removing the user who posted it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground" style={headingFont}>
            Blocking abusive users
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            You can block any member from their profile, or from the menu on any of their posts or
            comments. Blocking removes that member’s posts and comments from your feed immediately and
            alerts our moderation team so we can review the account. You can
            manage the people you have blocked in Settings.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground" style={headingFont}>
            Your content and your account
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            You keep ownership of the photographs and text you post. You give 50mm Retina World the
            right to display them on the platform as you direct. You can delete your own posts at any
            time, and you can permanently delete your account and its data from{" "}
            <strong>Settings → Delete My Account</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground" style={headingFont}>
            More
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            See our <Link to="/page/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>{" "}
            and <Link to="/cookie-policy" className="text-primary hover:underline">Cookie Policy</Link>. Questions
            or concerns: <Link to="/help-support" className="text-primary hover:underline">Help &amp; Support</Link>.
          </p>
        </section>
      </div>
    </div>
  </>
);

export default CommunityGuidelines;
