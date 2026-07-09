# Changelog — 50mm Retina World

All notable changes to this project are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### 2026-03-24
#### Fixed
- **Follow button crash** — Fixed `notify_new_follower` trigger casting `follower_id` as text instead of UUID, causing a database error when users tried to follow others.
- **Edge function boot failures** — Fixed `rank-feed` and `backup-reminder` functions importing a non-existent `corsHeaders` export; switched to `getSecureHeaders(req)` pattern.
- **Profile name truncation** — Removed restrictive `max-w` and `truncate` classes from the profile name so full names (e.g. "Pradip Mondal") display without ellipsis.

### 2026-03-23
#### Added
- **Post reports system** — `post_reports` table for users to flag inappropriate wall posts, with admin review workflow.
- **Date of birth field** — Added `date_of_birth` column to profiles and the public data projection.
- **Notification emails** — `send_notification_email()` trigger auto-calls the `send-transactional-email` edge function when a new notification is inserted.
- **Mutual friends** — `mutual_friends_count()` database function to calculate shared connections between two users.
- **Pinned comments** — `is_pinned` flag added to both `comments` and `post_comments` tables.
- **Realtime subscriptions** — Enabled realtime for `posts`, `post_comments`, `post_reactions`, `image_comments`, `image_reactions`, `user_notifications`, and `friendships`.
- **Notification actor tracking** — `actor_id` and `email_sent` columns added to `user_notifications`.

### 2026-03-22
#### Added
- **Email infrastructure** — Queue system, send log, send state, suppression list, and unsubscribe token tables for both auth and transactional emails.
- **Email asset storage** — `email-assets` storage bucket for email template images.
- **Scheduling for banners & photos** — `active_from` / `active_until` columns on `hero_banners` and `photo_of_the_day`.
- **Portfolio thumbnails** — `thumbnail_url` column on `portfolio_images`.
#### Fixed
- **Double-encoded JSON** — Fixed `site_settings` values that were stored as double-encoded JSON strings for on-page images.

### 2026-03-21
#### Added
- **Competition slugs** — `slug` column on `competitions` for SEO-friendly URLs.
- **Portfolio scheduling** — `active_from` / `active_until` columns on `portfolio_images`.
#### Changed
- **Hardened wallet transactions** — `wallet_transaction` now only allows self-transactions; cross-user transfers require `admin_wallet_credit` or trusted edge functions.
- **Profile data security** — Replaced blanket public SELECT on `profiles_public_data` with authenticated-only access; removed `privacy_settings` from public view.

### 2026-03-20
#### Added
- **Admin brand enforcement** — `enforce_admin_brand_name()` trigger auto-sets admin profile name to the brand name.
#### Changed
- **Site settings security** — Restricted sensitive keys from the public `site_settings` SELECT policy.
- **Public profile projection** — Created `profiles_public_data` table with safe-only columns, removing security-definer dependency.

### 2026-03-19
#### Added
- **Custom vanity URLs** — `custom_url` column on profiles for personalized profile links (e.g. `/50mm`).
- **Profile intro fields** — Added `pronouns`, `current_city`, `workplace`, `education` to profiles.
#### Fixed
- **Wallet transaction function** — Rewrote `wallet_transaction()` RPC for robustness.

### 2026-03-18
#### Added
- **Onboarding modal** — `onboarding_skipped_at` column on profiles to track whether onboarding was dismissed.
- **User type field** — `user_type` column on profiles for photographer / enthusiast / student classification.

### 2026-03-15
#### Added
- **Per-image judging** — `photo_index` column on `judge_scores`, `judge_comments`, and `judge_tag_assignments` for scoring individual photos in multi-image entries.
- **Public profiles for anonymous visitors** — RLS policy allowing anyone to view profiles.
- **User score visibility** — Users can now view judge scores and comments on their own entries.
- **Realtime for votes & friendships** — Enabled realtime on `competition_votes` and `friendships`.
#### Changed
- **Judge comment visibility** — All judges and admins can now view all judge comments (shared panel).
- **Judge score management** — Judges can delete and replace their own photo-level scores.

### 2026-03-14
#### Added
- **Competition judges system** — `competition_judges` table for assigning judges to specific competitions.
- **Judging tag images** — `image_url` and `icon` columns on `judging_tags`.
- **Tag visibility for entrants** — Users can view tag assignments on their own entries (stamp display).
- **Realtime for tag assignments** — Enabled realtime on `judge_tag_assignments`.
#### Changed
- **Entry visibility** — Updated RLS to show both `approved` and `submitted` entries publicly.

### 2026-02-27 – 2026-03-13
#### Added
- **Featured artists system** — `featured_artists` table with cover image, photo gallery, artist bio, and slug-based routing.
- **Social feed** — `posts`, `post_comments`, `post_reactions`, `post_comment_reactions` tables with full CRUD and RLS.
- **Friendship system** — `friendships` table with request/accept/block flow.
- **Follow system** — `follows` table for one-way follows.
- **Image engagement** — `image_reactions` and `image_comments` tables for gallery/portfolio/competition images.
- **Comment reports** — `comment_reports` table for flagging inappropriate comments.
- **Engagement boosting** — `scheduled_boosts` table and `apply-scheduled-boosts` edge function for automated engagement.
- **Ad tracking** — `ad_impressions` table for monitoring ad placement performance.
- **Admin notifications** — `admin_notifications` table for system alerts.
- **Activity logging** — `activity_logs` table for user action tracking.
- **User notifications** — `user_notifications` table with realtime support.
- **Photo of the Day** — `photo_of_the_day` table for daily featured photography.
- **Verification requests** — `verification_requests` table for photographer verification workflow.
- **Highlights (Stories)** — `highlights` and `highlight_items` tables for profile story-like content.
- **Featured photos** — `featured_photos` table for profile showcases.
- **Referral system** — `referrals` table for tracking user-to-user referrals.
- **Navigation menu builder** — `navigation_items` table for admin-managed dynamic navigation.
- **Site settings** — `site_settings` table for global platform configuration.
- **Judging tags** — `judging_tags` and `competition_judging_tags` tables with `judge_tag_assignments`.
- **Judging rounds** — `judging_rounds` table for multi-round competition judging.
- **Judge comments** — `judge_comments` table for detailed feedback.
- **S3 upload support** — `s3-upload` and `s3-signed-url` edge functions for external storage.
- **AI image analysis** — `analyze-gallery-image` edge function using Lovable AI for auto-categorization.
- **AI content detection** — `detect-ai-image` edge function to flag AI-generated submissions.
- **Comment moderation** — `moderate-comment` edge function for automated content filtering.
- **Sitemap generation** — `sitemap` edge function for dynamic SEO sitemap.
- **Vote rewards** — `vote-wallet-reward` edge function awarding wallet credits for voting.
- **Ask Anything** — `ask-anything` edge function for AI Q&A.
- **Feed ranking** — `rank-feed` edge function for algorithmic feed ordering.

### 2026-02-26
#### Added
- **Wallet system** — `wallets` and `wallet_transactions` tables with `wallet_transaction()` RPC.
- **Gift credits** — `gift_credits` and `gift_announcements` tables; `send-gift-credit` and `expire-gift-credits` edge functions.
- **Hero banners** — `hero_banners` table for homepage carousel management.
- **Admin user search** — `admin_search_users()` function with email lookup from auth.
- **Admin wallet credit** — `admin_wallet_credit()` function for secure cross-user crediting.
- **Storage bucket** — `avatars` bucket for profile image uploads.
- **Certificate search** — `search_certificates()` function for public lookup.

### 2026-02-25
#### Added
- **Portfolio images** — `portfolio_images` table for user gallery management.
- **Registered photographer role** — Added `registered_photographer` to the `app_role` enum.
- **Social media fields** — Instagram, Facebook, Twitter, website, YouTube, LinkedIn columns on profiles.
- **Comments & reactions** — `comments` and `comment_reactions` tables with threading.
- **Judge scoring** — `judge_scores` table with 1–10 scoring and feedback.
- **Student role visibility** — Public RLS policy for student role badges.
#### Changed
- **Profile visibility** — Iterated on profile RLS policies (public → authenticated → simplified public access).
- **First admin setup** — `handle_first_admin()` trigger auto-assigns admin role to the first signup.

### 2026-02-24 — Project Launch
#### Added
- **Core database schema** — Profiles, user roles, competitions, competition entries, competition votes, journal articles, courses, lessons, lesson progress, course enrollments, certificates.
- **Role system** — `app_role` enum (`user`, `judge`, `content_editor`, `admin`) with `user_roles` table and `has_role()` security definer function.
- **Auto profile creation** — `handle_new_user()` trigger creates a profile row on signup.
- **Certificate verification** — `verify_certificate()` security definer function for public lookup.
- **Row Level Security** — RLS enabled on all tables with role-based policies.
- **Competition payment details** — `competition_payment_details` table for prize payout info.
- **Bank details** — `bank_details` table for user payout information.

---

## Edge Functions

| Function | Purpose |
|---|---|
| `analyze-gallery-image` | AI-powered image categorization and title suggestion |
| `apply-scheduled-boosts` | Process scheduled engagement boosts hourly |
| `ask-anything` | AI Q&A for platform questions |
| `auth-email-hook` | Custom auth email rendering with branded templates |
| `backup-reminder` | Automated backup health checks |
| `detect-ai-image` | Flag AI-generated competition submissions |
| `expire-gift-credits` | Auto-deduct expired gift credits from wallets |
| `handle-email-suppression` | Process email bounce/complaint webhooks |
| `handle-email-unsubscribe` | RFC 8058 one-click + token-based unsubscribe |
| `migrate-storage` | Migrate files between storage providers |
| `moderate-comment` | AI-powered comment content filtering |
| `preview-transactional-email` | Render all registered email templates for preview |
| `process-email-queue` | Batch-send queued emails via SMTP |
| `rank-feed` | Algorithmic feed ranking |
| `s3-signed-url` | Generate pre-signed URLs for S3 uploads |
| `s3-upload` | Direct S3 file upload handler |
| `send-gift-credit` | Admin gift credit distribution |
| `send-transactional-email` | Send templated transactional emails |
| `sitemap` | Dynamic XML sitemap generation |
| `test-smtp` | SMTP connection testing for email config |
| `verify-email-provider` | Verify email provider DNS configuration |
| `vote-wallet-reward` | Award wallet credits for competition voting |

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite 7, Tailwind CSS, shadcn/ui, Framer Motion
- **Backend**: Lovable Cloud (Supabase), Deno Edge Functions
- **AI**: Lovable AI Gateway (Gemini, GPT models)
- **Storage**: Supabase Storage + optional S3
- **Auth**: Supabase Auth with custom email templates
