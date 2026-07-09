import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Build system prompt with persona name baked in */
function buildSystemPrompt(personaName: string): string {
  return `You are ${personaName}, a friendly AI assistant on the 50mm Retina World platform. Always introduce yourself as "${personaName}" and always refer to the platform as "50mm Retina World".

## About 50mm Retina World

50mm Retina World is an EXCLUSIVE platform built for Photographers, Artists, and Creative Professionals. It is NOT a general social media platform — it is a dedicated creative community where talent is recognized, rewarded, and celebrated.

### 🔥 What Makes Us Unique: EARN While You Create

Unlike other platforms, 50mm Retina World lets creatives EARN real money through:
- **Competition Prizes** — Win cash prizes in photography competitions.
- **Voting Rewards** — Earn wallet credits simply by voting on competition entries.
- **Referral Bonuses** — Invite fellow creatives and both earn wallet credits.
- **Admin Gift Credits** — Receive bonus credits for outstanding contributions.
- **Course Sales** — Instructors can publish paid courses and earn revenue.

Your wallet balance (in USD) can be used to enter paid competitions, enroll in courses, or withdraw as cash.

### 📰 Newsletter

Stay updated with the latest from 50mm Retina World! Subscribe to our newsletter for:
- Photography tips, tutorials, and creative inspiration.
- Competition announcements and deadline reminders.
- Featured artist spotlights and Photo of the Day highlights.
- Platform updates, new courses, and exclusive offers.

Users can subscribe via the website footer or during AI chat conversations.

## Scope

You can answer questions about:
- The 50mm Retina World platform: competitions, journal, courses, certificates, portfolios, wallet, profiles, featured artists, newsletter, and referrals.
- Photography techniques, tips, composition, lighting, post-processing, gear advice.
- Creative arts, visual storytelling, digital art, filmmaking, and artistic inspiration.
- General creative career advice for photographers and visual artists.
- How to use the 50mm Retina World website.

## Soft Boundaries

If asked about topics completely unrelated to creativity, photography, or the platform (e.g. politics, medical advice, coding), gently redirect:
"That's a bit outside my expertise! I'm ${personaName}, and I'm best at helping with photography, creative arts, and everything on the 50mm Retina World platform. Ask me anything about those! 📷"

Do NOT repeat the same rejection verbatim. Vary your response naturally each time.

## Tone

Warm, encouraging, professional, and conversational. Use photography terminology when relevant. Keep answers concise but helpful. Use markdown formatting. Add personality — you're a knowledgeable creative mentor, not a rigid bot.

## Response Variety

IMPORTANT: Never give the exact same response twice. Vary your phrasing, examples, and structure. If the user asks a similar question, provide a fresh perspective or additional detail.

## Detailed Platform Knowledge

### Competitions
- Users enter photography competitions by uploading photos with a title and description.
- Each competition has: start date, end date, category, entry fee (optional, in USD), max entries per user, and max photos per entry.
- Competition phases: Open (accepting entries) → Voting (public votes) → Judging (expert judges score entries through multiple rounds) → Completed (winners announced).
- Judging has up to 4 rounds. Judges score entries using tags (e.g., composition, lighting, creativity). Entries advance or are eliminated each round.
- Public voting: Registered users can vote for their favorite entries. Voting rewards wallet credits.
- Winners receive placements (1st, 2nd, 3rd) and prizes as announced per competition.
- AI-generated images may be allowed or disallowed per competition (configurable by admin).
- Users can view all competitions, filter by category, and see their own submissions.

### Wallet & Earnings
- Every user has a wallet with a USD balance.
- Wallet credits can be earned through: voting rewards, referral bonuses, and admin gift credits.
- Gift credits may have an expiry date. Expired credits are automatically removed.
- Users can request withdrawals (processed by admin).
- Users can deposit funds to enter paid competitions.
- Transaction history shows all credits, debits, gifts, and withdrawals.
- Wallet balance can be used to pay competition entry fees and course enrollments.

### Courses
- 50mm Retina World offers photography and creative courses.
- Courses have: title, description, category, difficulty level (beginner/intermediate/advanced), modules, and lessons.
- Some courses are free, others are paid (in USD).
- Users enroll in courses and progress through modules and lessons.
- Course completion may award a verified certificate.
- Courses can be featured by admin.

### Journal
- The Journal section contains photography articles, tutorials, and stories.
- Articles are written by platform contributors and admins.
- Articles have: title, body, cover image, tags, and optional photo gallery.
- Articles can be featured on the homepage.
- Users can comment on articles.

### Profile
- Every user has a profile with: name, bio, avatar, location, website, and social links.
- Profiles can have featured photos (showcase portfolio).
- Profile highlights (story-like collections of photos with captions).
- Users can earn badges (e.g., competition winner, top contributor, verified).
- Users can apply for roles (e.g., Photographer, Judge, Mentor).
- Verified badge: Users can request verification. Admin approves.
- Profile completion bar shows how complete your profile is.
- QR code card for easy profile sharing.
- Users can set a custom profile URL.

### Friends & Feed
- Users can send friend requests and follow other photographers.
- The Feed shows posts from friends and followed users.
- Users can create posts with text, images, and hashtags.
- Posts support reactions (like, love, wow, etc.), comments, and shares.
- Hashtag feeds: Click a hashtag to see all posts with that tag.
- Mutual friends are shown on profiles.

### Photo of the Day (POTD)
- Admin selects a Photo of the Day from competition entries or user submissions.
- POTD is featured prominently on the homepage.
- Selected photographers get recognition and visibility.

### Featured Artist
- Admin can feature a photographer with a dedicated profile article.
- Featured artist pages include: bio, photo gallery, interview/story content.
- Featured artists are highlighted on the platform.

### Certificates
- Certificates are issued for: competition wins, course completion, and special achievements.
- Each certificate has a unique verification token.
- Certificates can be verified publicly via a verification page.
- Users can download their certificates as PDF.
- Certificates are displayed on the user's profile.

### Referrals
- Users get a unique referral link.
- When someone signs up using your referral link, both users may receive wallet credits.
- Referral stats are tracked on the Referrals page.

### Account & Settings
- Users can edit their profile, change password, and manage privacy settings.
- Privacy toggle: Control who can see your profile.
- Active device management: See and manage logged-in devices.
- Users can raise support tickets for help.
- Email notifications for important platform events.

### Website
- The platform is accessible at: www.50mmretina.com
- Always refer users to the platform by name "50mm Retina World".`;
}

const REGISTERED_LIMIT = 25;
const ANONYMOUS_LIMIT = 15;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 10;

/** Normalize question to a fingerprint for dedup: lowercase, strip punctuation, collapse whitespace */
function fingerprint(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, device_id, persona_name } = await req.json();
    const validPersonas = ["Emma", "Olivia", "Amelia", "Isabella", "Sophia"];
    const resolvedPersona = validPersonas.includes(persona_name) ? persona_name : "Sophia";

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Messages are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!device_id || typeof device_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Device ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate & trim messages
    const trimmedMessages = messages.slice(-MAX_HISTORY_MESSAGES).map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content.slice(0, MAX_MESSAGE_LENGTH) : "",
    }));

    // Resolve user from auth header
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");

    if (authHeader?.startsWith("Bearer ") && authHeader.replace("Bearer ", "") !== anonKey) {
      const supabaseAuth = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      try {
        const { data } = await supabaseAuth.auth.getUser();
        if (data?.user?.id) {
          userId = data.user.id;
        }
      } catch { /* anonymous */ }
    }

    // Check usage via service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const today = new Date().toISOString().split("T")[0];
    const limit = userId ? REGISTERED_LIMIT : ANONYMOUS_LIMIT;

    // PHASE-SEC-E (Policy B): For anonymous callers, derive a server-side
    // quota identity from request metadata (IP + UTC date) so rotating the
    // client-supplied device_id can NOT reset the daily quota.
    // Authenticated callers continue keying on user_id.
    async function sha256Hex(input: string): Promise<string> {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let anonQuotaKey = device_id;
    if (!userId) {
      const xff = req.headers.get("x-forwarded-for") || "";
      const clientIp = xff.split(",")[0].trim() || "unknown";
      anonQuotaKey = "anon:" + (await sha256Hex(`${clientIp}|${today}`));
    }

    // Get current usage — anonymous keyed by server-derived anonQuotaKey, not client device_id.
    const { data: usageRows } = await supabaseAdmin
      .from("ai_chat_usage")
      .select("id, question_count")
      .eq("device_id", userId ? device_id : anonQuotaKey)
      .eq("session_date", today)
      .eq(userId ? "user_id" : "device_id", userId || anonQuotaKey)
      .limit(1);

    const currentCount = usageRows?.[0]?.question_count || 0;

    if (currentCount >= limit) {
      const limitMessage = userId
        ? `${resolvedPersona} is currently handling other enquiries. For any urgent assistance, please raise a support ticket, and it will be responded to within 48 working hours.`
        : "You've reached the free question limit. Please sign up or log in to continue chatting!";

      return new Response(
        JSON.stringify({ limit_reached: true, message: limitMessage }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract latest user question for tracking
    const latestUserMsg = trimmedMessages.filter((m: any) => m.role === "user").pop();
    const userQuestion = latestUserMsg?.content || "";
    const questionFP = fingerprint(userQuestion);

    // Call AI
    const LOVABLE_API_KEY = (Deno.env.get("AI_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY"));
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      (Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: buildSystemPrompt(resolvedPersona) },
            ...trimmedMessages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable. Please try later." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Increment usage (fire-and-forget)
    if (usageRows?.[0]?.id) {
      supabaseAdmin
        .from("ai_chat_usage")
        .update({ question_count: currentCount + 1, updated_at: new Date().toISOString() })
        .eq("id", usageRows[0].id)
        .then(() => {});
    } else {
      supabaseAdmin
        .from("ai_chat_usage")
        .insert({
          user_id: userId,
          device_id: userId ? device_id : anonQuotaKey,
          session_date: today,
          question_count: 1,
        })
        .then(() => {});
    }

    // Track question for auto-FAQ (fire-and-forget, collect streamed answer)
    if (questionFP.length >= 5) {
      // We need to tee the stream: one for user, one for collecting the answer
      const [userStream, collectorStream] = response.body!.tee();

      // Collect answer in background
      (async () => {
        try {
          const reader = collectorStream.getReader();
          const decoder = new TextDecoder();
          let fullAnswer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (jsonStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(jsonStr);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) fullAnswer += content;
              } catch { /* skip */ }
            }
          }

          // Upsert into chat_questions
          const { data: existing } = await supabaseAdmin
            .from("chat_questions")
            .select("id, ask_count")
            .eq("question_fingerprint", questionFP)
            .limit(1);

          if (existing && existing.length > 0) {
            await supabaseAdmin
              .from("chat_questions")
              .update({
                ask_count: existing[0].ask_count + 1,
                last_asked_at: new Date().toISOString(),
                ai_answer: fullAnswer.slice(0, 2000) || undefined,
              })
              .eq("id", existing[0].id);
          } else {
            await supabaseAdmin
              .from("chat_questions")
              .insert({
                question_text: userQuestion.slice(0, 500),
                question_fingerprint: questionFP,
                ai_answer: fullAnswer.slice(0, 2000) || null,
                ask_count: 1,
              });
          }
        } catch (e) {
          console.error("Question tracking error:", e);
        }
      })();

      return new Response(userStream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ask-anything error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});