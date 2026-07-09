import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

/* ── In-memory cache (60s TTL) ── */
interface CacheEntry {
  data: Record<string, unknown>;
  ts: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000;

function getCached(key: string): Record<string, unknown> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: Record<string, unknown>) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }
}

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    /* ── 1. Auth validation ── */
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    let userId: string | null = null;

    if (token) {
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (!error && user) userId = user.id;
    }

    // SECURITY (D-1): identity is derived ONLY from a verified JWT.
    // The previous body.user_id fallback allowed unauthenticated callers
    // to impersonate any UUID. Drain the body harmlessly to avoid leaks.
    try { await req.json(); } catch { /* no body */ }

    const targetUserId = userId;

    /* ── 2. Check cache ── */
    const [
      { data: latestSettingsRow },
      { data: latestCompetitionRow },
      { data: latestEntryRow },
      { count: competitionEntryCount },
    ] = await Promise.all([
      admin.from("site_settings")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("competitions")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("competition_entries")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("competition_entries")
        .select("id", { count: "exact", head: true }),
    ]);

    const settingsVersion = latestSettingsRow?.updated_at ?? "no-settings";
    const competitionVersion = latestCompetitionRow?.updated_at ?? "no-competitions";
    const entryVersion = latestEntryRow?.updated_at ?? "no-entries";
    const entryCountVersion = competitionEntryCount ?? 0;
    // Include vote state in cache key so sidebar shows fresh vote counts
    let voteVersion = "no-votes";
    let voteCountVersion = 0;
    try {
      const [{ data: latestVoteRow }, { count: voteCount }] = await Promise.all([
        admin.from("competition_votes").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("competition_votes").select("id", { count: "exact", head: true }),
      ]);
      voteVersion = latestVoteRow?.created_at ?? "no-votes";
      voteCountVersion = voteCount ?? 0;
    } catch { /* non-critical */ }
    const cacheKey = `${targetUserId ?? "__anon__"}:${settingsVersion}:${competitionVersion}:${entryVersion}:${entryCountVersion}:${voteVersion}:${voteCountVersion}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { ...headers, "X-Cache": "HIT" },
      });
    }

    /* ── 3. Batch ALL queries in parallel ── */
    const now = new Date();
    const nowISO = now.toISOString();
    const weekAgoISO = new Date(Date.now() - 7 * 86400000).toISOString();
    const todayMD = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const [
      settingsRes,
      competitionsRes,
      coursesRes,
      journalRes,
      winnersRes,
      // Trending data
      entryReactionsRes,
      postReactionsRes,
      portfolioReactionsRes,
      // Voting entries: active competitions
      activeCompsRes,
      // Milestones + birthdays: profiles with dates
      profileDatesRes,
    ] = await Promise.all([
      // Q1: Site settings
      admin.from("site_settings").select("key, value").limit(100),
      // Q2: Upcoming/active competitions (sidebar) — phase derived client-side from dates
      admin.from("competitions")
        .select("id, slug, title, starts_at, ends_at, voting_ends_at, judging_completed, status, cover_image_url, phase")
        .not("status", "in", '("archived")')
        .order("starts_at", { ascending: true })
        .limit(10),
      // Q4: Recent courses (sidebar)
      admin.from("courses")
        .select("id, title, slug, cover_image_url, difficulty, is_free")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(3),
      // Q5: Journal articles (sidebar)
      admin.from("journal_articles")
        .select("id, title, slug, cover_image_url, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(3),
      // Q6: Winner entries (sidebar)
      admin.from("competition_entries")
        .select("id, title, photos, placement, competition_id, user_id")
        .in("placement", ["gold", "silver", "bronze", "winner", "1st", "2nd", "3rd"])
        .order("created_at", { ascending: false })
        .limit(6),
      // Q7: Entry reactions last 7 days (trending)
      admin.from("image_reactions")
        .select("image_id")
        .eq("image_type", "competition_entry")
        .gte("created_at", weekAgoISO),
      // Q8: Post reactions last 7 days (trending)
      admin.from("post_reactions")
        .select("post_id")
        .gte("created_at", weekAgoISO),
      // Q9: Portfolio reactions last 7 days (trending)
      admin.from("image_reactions")
        .select("image_id")
        .eq("image_type", "portfolio")
        .gte("created_at", weekAgoISO),
      // Q10: Competitions in voting phase (now > ends_at AND now <= voting_ends_at)
      // Use time-based filtering only — status field may not be auto-updated
      admin.from("competitions")
        .select("id, title, ends_at, voting_ends_at, status")
        .not("status", "in", '("archived","completed")')
        .lte("ends_at", nowISO)
        .limit(10),
      // Q11: Profiles with created_at and date_of_birth (milestones + birthdays)
      // DOB lives only on the private `profiles` table (service-role read here, RLS bypassed).
      admin.from("profiles")
        .select("id, full_name, avatar_url, created_at, date_of_birth")
        .eq("is_suspended", false)
        .limit(50),

    ]);

    // SECURITY (D-2): never emit secret-bearing settings keys to clients.
    // Admin UI reads these via admin-secure-settings (JWT + role check).
    const BLOCKED_SETTINGS_KEYS = new Set([
      "smtp_settings",
      "s3_storage_settings",
      "payment_gateways",
      "whatsapp_settings",
      "ai_model_settings",
    ]);
    const settings: Record<string, unknown> = {};
    (settingsRes.data ?? []).forEach((s: any) => {
      if (BLOCKED_SETTINGS_KEYS.has(s.key)) return;
      // Phase-3: managed_pages is projected to metadata-only here.
      // Full page content (HTML, JSON-LD, SEO, translations) is fetched
      // on-demand by ManagedPageView via ["managed-page", slug].
      if (s.key === "managed_pages" && Array.isArray(s.value)) {
        settings[s.key] = (s.value as any[]).map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          sort_order: p.sort_order,
          nav_placement: p.nav_placement,
          show_in_nav: p.show_in_nav,
          is_published: p.is_published,
          template: p.template,
        }));
        return;
      }
      settings[s.key] = s.value;
    });

    // ── Build trending data ──
    const trendingItems: any[] = [];

    // Trending entries
    const entryReactions = entryReactionsRes.data ?? [];
    if (entryReactions.length > 0) {
      const entryCounts: Record<string, number> = {};
      entryReactions.forEach((r: any) => { entryCounts[r.image_id] = (entryCounts[r.image_id] || 0) + 1; });
      const topEntryIds = Object.entries(entryCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
      if (topEntryIds.length > 0) {
        const { data: entries } = await admin.from("competition_entries")
          .select("id, title, photos").in("id", topEntryIds).eq("status", "approved");
        (entries ?? []).forEach((e: any) => {
          trendingItems.push({ id: e.id, image_url: e.photos?.[0] || "", title: e.title, reaction_count: entryCounts[e.id] || 0, source: "entry" });
        });
      }
    }

    // Trending posts
    const postReactions = postReactionsRes.data ?? [];
    if (postReactions.length > 0) {
      const postCounts: Record<string, number> = {};
      postReactions.forEach((r: any) => { postCounts[r.post_id] = (postCounts[r.post_id] || 0) + 1; });
      const topPostIds = Object.entries(postCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
      if (topPostIds.length > 0) {
        const { data: tPosts } = await admin.from("posts")
          .select("id, content, image_url, image_urls").in("id", topPostIds).eq("privacy", "public");
        (tPosts ?? []).forEach((p: any) => {
          const img = p.image_urls?.[0] || p.image_url || "";
          if (img) {
            trendingItems.push({ id: p.id, image_url: img, title: p.content?.slice(0, 40) || "Wall Post", reaction_count: postCounts[p.id] || 0, source: "post" });
          }
        });
      }
    }

    // Trending portfolio
    const portfolioReactions = portfolioReactionsRes.data ?? [];
    if (portfolioReactions.length > 0) {
      const pCounts: Record<string, number> = {};
      portfolioReactions.forEach((r: any) => { pCounts[r.image_id] = (pCounts[r.image_id] || 0) + 1; });
      const topPIds = Object.entries(pCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
      if (topPIds.length > 0) {
        const { data: images } = await admin.from("portfolio_images").select("id, image_url, title").in("id", topPIds);
        (images as any[] ?? []).forEach((img: any) => {
          trendingItems.push({ id: img.id, image_url: img.image_url, title: img.title, reaction_count: pCounts[img.id] || 0, source: "portfolio" });
        });
      }
    }
    trendingItems.sort((a, b) => b.reaction_count - a.reaction_count);

    // ── Voting entries ──
    const rawActiveComps = activeCompsRes.data ?? [];
    // Filter to only competitions currently in voting phase
    const activeComps = rawActiveComps.filter((c: any) => {
      const endsAt = c.ends_at ? new Date(c.ends_at) : null;
      const votingEndsAt = c.voting_ends_at ? new Date(c.voting_ends_at) : endsAt;
      if (!endsAt) return false;
      return now > endsAt && (!votingEndsAt || now <= votingEndsAt);
    });
    let votingEntries: any[] = [];
    let votingThumbnails: any[] = [];
    if (activeComps.length > 0) {
      const compIds = activeComps.map((c: any) => c.id);
      const compMap: Record<string, string> = {};
      activeComps.forEach((c: any) => { compMap[c.id] = c.title; });

      const { data: vEntries } = await admin.from("competition_entries")
        .select("id, title, photos, photo_meta, competition_id, user_id, created_at")
        .in("competition_id", compIds)
        .in("status", ["submitted", "approved"])
        .order("created_at", { ascending: false })
        .limit(200);

      const filtered = (vEntries ?? []).filter((e: any) => e.photos?.length > 0);

      // Fetch per-photo vote counts + user's own votes + photographer names
      const voteEntryIds = filtered.map((entry: any) => entry.id);
      const photographerIds = Array.from(new Set(filtered.map((entry: any) => entry.user_id).filter(Boolean)));
      const [voteRowsRes, userVoteRowsRes, adjustmentRowsRes, votingProfilesRes] = await Promise.all([
        voteEntryIds.length > 0 ? admin.from("competition_votes").select("entry_id, photo_index").in("entry_id", voteEntryIds) : Promise.resolve({ data: [] as any[] }),
        targetUserId && voteEntryIds.length > 0 ? admin.from("competition_votes").select("entry_id, photo_index").eq("user_id", targetUserId).in("entry_id", voteEntryIds) : Promise.resolve({ data: [] as any[] }),
        // Per-photo admin adjustments — combined with real votes so sidebar matches
        // the entry_final_votes view (real_votes + adjustment_total) at the photo level.
        voteEntryIds.length > 0 ? admin.from("admin_vote_adjustments").select("entry_id, photo_index, adjustment_value").in("entry_id", voteEntryIds) : Promise.resolve({ data: [] as any[] }),
        photographerIds.length > 0 ? admin.from("profiles_public_data").select("id, full_name").in("id", photographerIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const photoVoteCounts = new Map<string, number>();
      (voteRowsRes.data ?? []).forEach((v: any) => {
        const pi = typeof v.photo_index === "number" ? v.photo_index : 0;
        const key = `${v.entry_id}::${pi}`;
        photoVoteCounts.set(key, (photoVoteCounts.get(key) || 0) + 1);
      });
      // Apply admin adjustments per (entry, photo)
      (adjustmentRowsRes.data ?? []).forEach((a: any) => {
        const pi = typeof a.photo_index === "number" ? a.photo_index : 0;
        const key = `${a.entry_id}::${pi}`;
        photoVoteCounts.set(key, Math.max(0, (photoVoteCounts.get(key) || 0) + Number(a.adjustment_value || 0)));
      });
      const userVotedKeys = new Set(
        (userVoteRowsRes.data ?? []).map((v: any) => `${v.entry_id}::${typeof v.photo_index === "number" ? v.photo_index : 0}`),
      );
      const photographerMap: Record<string, string> = {};
      (votingProfilesRes.data ?? []).forEach((p: any) => { photographerMap[p.id] = p.full_name ?? "Anonymous"; });

      // Per-photo "One Image, One Reject" — admin-rejected photos must never reach voters.
      const isRejected = (entry: any, pi: number) => {
        const meta = Array.isArray(entry.photo_meta) ? entry.photo_meta : [];
        return meta[pi]?.rejected === true;
      };

      const toVotingPhoto = (entry: any, pi: number, photoUrl: string) => {
        const key = `${entry.id}::${pi}`;
        return {
          id: entry.id,
          entry_id: entry.id,
          title: entry.title,
          entry_title: entry.title,
          photo_url: photoUrl,
          photo_index: pi,
          total_photos: (entry.photos as string[]).length,
          competition_id: entry.competition_id,
          competition_title: compMap[entry.competition_id] || "Competition",
          user_id: entry.user_id,
          photographer_name: photographerMap[entry.user_id] || "Anonymous",
          vote_count: photoVoteCounts.get(key) || 0,
          user_voted: userVotedKeys.has(key),
          created_at: entry.created_at,
        };
      };

      // ALL individual photos flattened for lightbox voting
      // Each photo maps back to its entry_id + photo_index for per-image voting
      for (const e of filtered) {
        for (let pi = 0; pi < (e.photos as string[]).length; pi++) {
          if (isRejected(e, pi)) continue;
          const photoUrl = (e.photos as string[])[pi];
          votingEntries.push(toVotingPhoto(e, pi, photoUrl));
        }
      }

      // Last 6 individual photos for sidebar thumbnails (newest first)
      const recentPhotos: any[] = [];
      for (const e of filtered) {
        for (let pi = 0; pi < (e.photos as string[]).length; pi++) {
          if (isRejected(e, pi)) continue;
          const photoUrl = (e.photos as string[])[pi];
          recentPhotos.push(toVotingPhoto(e, pi, photoUrl));
          if (recentPhotos.length >= 6) break;
        }
        if (recentPhotos.length >= 6) break;
      }
      votingThumbnails = recentPhotos;
    }

    // ── Milestones + Birthdays ──
    const profileDates = profileDatesRes.data ?? [];
    const milestones: any[] = [];
    const birthdays: any[] = [];

    // SECURITY (dashboard_init_dob_anon): birthdays + milestones are
    // PII-derived (month+day of birth, account anniversary). Only emit them
    // to authenticated callers. Anonymous callers receive empty arrays.
    if (targetUserId) {
      (profileDates as any[]).forEach((p: any) => {
        if (!p.id) return;
        // Milestones: membership anniversary today
        if (p.created_at) {
          const created = new Date(p.created_at);
          const createdMD = `${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
          if (createdMD === todayMD && created.getFullYear() < now.getFullYear()) {
            milestones.push({
              id: p.id,
              full_name: p.full_name,
              avatar_url: p.avatar_url,
              created_at: p.created_at,
              years: now.getFullYear() - created.getFullYear(),
            });
          }
        }
        // Birthdays
        if (p.date_of_birth) {
          const parts = String(p.date_of_birth).split("-");
          if (parts.length >= 3) {
            const dobMD = `${parts[1]}-${parts[2]}`;
            if (dobMD === todayMD) {
              birthdays.push({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url });
            }
          }
        }
      });
    }

    // ── People suggestions (only for authenticated users) ──
    let suggestions: any[] = [];
    if (targetUserId) {
      const [friendsRes2, followsRes2, roleUsersRes] = await Promise.all([
        admin.from("friendships").select("requester_id, addressee_id")
          .or(`requester_id.eq.${targetUserId},addressee_id.eq.${targetUserId}`),
        admin.from("follows").select("following_id").eq("follower_id", targetUserId),
        admin.from("user_roles").select("user_id").in("role", ["admin", "judge"]),
      ]);

      const excludeIds = new Set<string>([targetUserId]);
      (friendsRes2.data ?? []).forEach((f: any) => { excludeIds.add(f.requester_id); excludeIds.add(f.addressee_id); });
      (followsRes2.data ?? []).forEach((f: any) => excludeIds.add(f.following_id));
      (roleUsersRes.data ?? []).forEach((r: any) => excludeIds.add(r.user_id));
      const excludeArr = Array.from(excludeIds);

      // Reuse profileDates which already has id, full_name, avatar_url
      const eligible = (profileDates as any[])
        .filter((p: any) => p.id && !excludeArr.includes(p.id))
        .map((p: any) => ({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url, mutual_count: 0 }));

      // Shuffle deterministically per day
      const seed = now.getDate() + now.getMonth() * 31;
      suggestions = eligible
        .sort((a: any, b: any) => {
          const ha = ((a.id.charCodeAt(0) * 31 + seed) % 1000);
          const hb = ((b.id.charCodeAt(0) * 31 + seed) % 1000);
          return ha - hb;
        })
        .slice(0, 5);
    }

    // Collect ALL user IDs needed (winners + current user)
    const userIdSet = new Set<string>();
    if (targetUserId) userIdSet.add(targetUserId);

    const winnerEntries = winnersRes.data ?? [];
    const winnerCompIds = new Set<string>();
    winnerEntries.forEach((e: any) => {
      userIdSet.add(e.user_id);
      winnerCompIds.add(e.competition_id);
    });

    const uniqueUserIds = Array.from(userIdSet);
    const uniqueCompIds = Array.from(winnerCompIds);

    // Batch: profiles + roles + badges + winner competition titles
    const [profilesRes, rolesRes, badgesRes, winnerCompsRes] = await Promise.all([
      uniqueUserIds.length > 0
        ? admin.from("profiles_public_data")
            .select("id, full_name, avatar_url, custom_url")
            .in("id", uniqueUserIds)
        : Promise.resolve({ data: [] }),
      uniqueUserIds.length > 0
        ? admin.from("user_roles").select("user_id, role").in("user_id", uniqueUserIds)
        : Promise.resolve({ data: [] }),
      uniqueUserIds.length > 0
        ? admin.from("user_badges").select("user_id, badge_type").in("user_id", uniqueUserIds)
        : Promise.resolve({ data: [] }),
      uniqueCompIds.length > 0
        ? admin.from("competitions").select("id, title").in("id", uniqueCompIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Build profiles map
    const profiles: Record<string, any> = {};
    (profilesRes.data ?? []).forEach((p: any) => {
      profiles[p.id] = {
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        custom_url: p.custom_url,
      };
    });

    // Build roles map.
    // SECURITY (dashboard_roles_leak): sensitive roles (admin / super_admin /
    // judge / moderator) MUST NOT leak to other users or anonymous callers.
    // The caller's OWN roles are preserved verbatim so client-side isAdmin
    // seeding in preSeedCaches keeps working. All other users only expose
    // display-safe roles.
    const DISPLAY_SAFE_ROLES = new Set([
      "artist",
      "content_editor",
      "student",
      "verified",
    ]);
    const roles: Record<string, string[]> = {};
    (rolesRes.data ?? []).forEach((r: any) => {
      const isSelf = targetUserId && r.user_id === targetUserId;
      if (!isSelf && !DISPLAY_SAFE_ROLES.has(r.role)) return;
      if (!roles[r.user_id]) roles[r.user_id] = [];
      roles[r.user_id].push(r.role);
    });

    // Build badges map
    const badges: Record<string, string[]> = {};
    (badgesRes.data ?? []).forEach((b: any) => {
      if (!badges[b.user_id]) badges[b.user_id] = [];
      badges[b.user_id].push(b.badge_type);
    });

    // Build winner competition title map
    const compTitleMap: Record<string, string> = {};
    (winnerCompsRes.data ?? []).forEach((c: any) => {
      compTitleMap[c.id] = c.title;
    });

    // Enrich winners with profile + competition data
    const winners = winnerEntries.map((e: any) => ({
      id: e.id,
      title: e.title,
      photos: e.photos || [],
      placement: e.placement,
      competition_title: compTitleMap[e.competition_id] || "Competition",
      user_id: e.user_id,
      user_name: profiles[e.user_id]?.full_name ?? null,
      user_avatar: profiles[e.user_id]?.avatar_url ?? null,
    }));

    // ── User meta (ban status, notification prefs) ──
    let userMeta: Record<string, unknown> = {};
    if (targetUserId) {
      const { data: metaRow } = await admin.from("profiles")
        .select("is_banned, notification_sound_enabled")
        .eq("id", targetUserId)
        .maybeSingle();
      if (metaRow) {
        userMeta = {
          is_banned: (metaRow as any).is_banned ?? false,
          notification_sound_enabled: (metaRow as any).notification_sound_enabled ?? true,
        };
      }
    }

    /* ── 4. Build response ── */
    const response = {
      settings,
      profiles,
      roles,
      badges,
      user_meta: userMeta,
      sidebar: {
        competitions: await (async () => {
          // R5: phase derivation mirrors public.current_phase() exactly.
          // Inlined here (not RPC) to avoid N round-trips on dashboard init.
          const now = new Date();
          const derive = (c: any): string => {
            if (c.status === "archived") return "archived";
            const start = c.starts_at ? new Date(c.starts_at) : null;
            const end = c.ends_at ? new Date(c.ends_at) : null;
            const votingEnd = c.voting_ends_at ? new Date(c.voting_ends_at) : end;
            if (start && end) {
              if (now < start) return "upcoming";
              if (now >= start && now <= end) return "submission_open";
              if (votingEnd && now > end && now <= votingEnd) return "voting";
              if (c.judging_completed) return "result";
              return "judging";
            }
            return c.phase || "submission_open";
          };
          return (competitionsRes.data ?? [])
            .map((c: any) => ({ ...c, phase: derive(c) }))
            .filter((c: any) => c.phase !== "result")
            .slice(0, 5);
        })(),
        courses: coursesRes.data ?? [],
        journal: journalRes.data ?? [],
        winners,
        trending: trendingItems.slice(0, 6),
        voting_entries: votingEntries,
        voting_thumbnails: votingThumbnails,
        milestones: milestones.slice(0, 3),
        birthdays: birthdays.slice(0, 3),
        suggestions: suggestions.slice(0, 5),
      },
      user_id: targetUserId,
      cached: false,
    };

    setCache(cacheKey, response);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...headers, "X-Cache": "MISS" },
    });
  } catch (err) {
    console.error("dashboard-init error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers },
    );
  }
});
