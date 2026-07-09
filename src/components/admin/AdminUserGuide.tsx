import { BookOpen, Trophy, Users, Image, Newspaper, Wallet, MessageSquare, Settings, Globe, BarChart3, HelpCircle, Shield, Bell, Mail, Database, FileText, Star, Megaphone, Tag, Gavel, LayoutDashboard, LogIn, ExternalLink, Heart, UserPlus, Award, Vote, AlertTriangle, Upload, Zap } from "lucide-react";

const sections = [
  {
    title: "Getting Started",
    icon: BookOpen,
    items: [
      "Navigate sections using the left sidebar or mobile menu grid.",
      "Use the search bar at the top of the sidebar to quickly find any section.",
      "The Admin Panel remembers your last active tab between sessions.",
      "Click 'Back to Site' at the bottom of the sidebar to return to the main website.",
    ],
  },
  {
    title: "Content Management",
    icon: LayoutDashboard,
    items: [
      "Hero Banners — Upload and manage homepage banners with scheduling.",
      "Photo of Day — Select a daily featured photo from community submissions.",
      "Gallery — Curate and manage the public gallery showcase.",
      "On-Page Images — Upload images used across site pages.",
      "Featured Artist — Create in-depth artist spotlight articles.",
    ],
  },
  {
    title: "Competitions",
    icon: Trophy,
    items: [
      "Create competitions with entry fees, date ranges, and photo limits.",
      "Assign judges and configure judging rounds per competition.",
      "Manage entries: approve, reject, or flag submissions.",
      "Use Judging Tags to define scoring criteria for judges.",
      "Vote Rewards lets you configure credits earned per community vote.",
    ],
  },
  {
    title: "Users & Community",
    icon: Users,
    items: [
      "Manage Users — View, suspend, or modify user accounts.",
      "Blue Tick Requests — Review and approve verification applications.",
      "Badge & Role Types — Define custom badges and role labels.",
      "Role Applications — Approve or reject role upgrade requests.",
      "Referrals — Track referral activity and reward distribution.",
      "Engagement — Monitor community interaction metrics.",
    ],
  },
  {
    title: "Moderation",
    icon: Shield,
    items: [
      "Comments — Review and delete inappropriate comments.",
      "Comment Reports — Act on user-flagged comments.",
      "Post Reports — Handle reported wall posts.",
      "Keyword Blocklist — Add words that auto-flag or block content.",
    ],
  },
  {
    title: "Finance & Wallet",
    icon: Wallet,
    items: [
      "Configure payment gateways (Stripe, PayPal, Razorpay, UPI, Bank).",
      "Set USD-to-INR exchange rate (manual or auto-fetch).",
      "Credit user wallets for prizes, refunds, or promotions.",
      "Review and approve/reject withdrawal requests.",
      "Gift Credits — Send bulk credits to users by role or individually.",
      "Transactions — View the complete financial transaction log.",
    ],
  },
  {
    title: "Editorial",
    icon: Newspaper,
    items: [
      "Journal — Publish articles, tutorials, and news stories.",
      "Courses — Create structured learning content with modules and lessons.",
      "Certificates — Issue and manage achievement certificates.",
      "Excellence — Curate and highlight exceptional work.",
    ],
  },
  {
    title: "Marketing & SEO",
    icon: Globe,
    items: [
      "SEO Settings — Configure meta tags, sitemap, and social sharing defaults.",
      "Advertisements — Manage ad placements and sponsored content.",
      "Performance — Monitor site speed and optimization metrics.",
      "Announcements — Create site-wide announcement bars.",
      "Newsletter & FAQ — Manage FAQ entries and newsletter content.",
    ],
  },
  {
    title: "Pages & Navigation",
    icon: FileText,
    items: [
      "Page Management — Toggle sidebar sections and page visibility.",
      "Menu Builder — Customize the main navigation menu structure.",
      "URL Redirects — Create 301/302 redirects for changed URLs.",
    ],
  },
  {
    title: "System",
    icon: Settings,
    items: [
      "Integrations — Configure SMTP, S3, AI, and third-party API keys.",
      "Login / Signup — Customize authentication page branding.",
      "Email Templates — Edit transactional and notification email designs.",
      "Database — Export and manage database backups.",
      "Activity Logs — Audit trail of all admin and user actions.",
      "Notifications — View system alerts and admin notifications.",
    ],
  },
];

export default function AdminUserGuide() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Reference</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Admin <em className="italic text-primary">User Guide</em>
        </h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-lg" style={{ fontFamily: "var(--font-body)" }}>
          A quick reference for every section available in the Admin Panel. Use this guide to understand what each module does and how to use it effectively.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="border border-border rounded-sm p-5 space-y-3 hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-2.5">
              <section.icon className="h-4.5 w-4.5 text-primary shrink-0" />
              <h3 className="text-sm font-medium tracking-wide" style={{ fontFamily: "var(--font-heading)" }}>
                {section.title}
              </h3>
            </div>
            <ul className="space-y-1.5">
              {section.items.map((item, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-primary/30" style={{ fontFamily: "var(--font-body)" }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border border-dashed border-border rounded-sm p-5 text-center">
        <HelpCircle className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          Need more help? Visit <strong>Support Tickets</strong> to submit a request or check existing tickets.
        </p>
      </div>
    </div>
  );
}
