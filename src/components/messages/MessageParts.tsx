/**
 * Messages · shared pieces of the messenger: avatar, refusal wording, helpline card, bubbles with photos.
 * Plain text only — a body is rendered as text, never as HTML, and a link in it is not made clickable.
 */
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCheck, Clock, Copy, HeartHandshake, ImageOff, Reply } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { isEmojiOnly } from "@/lib/messages/emoji";
import OptimizedImage from "@/components/OptimizedImage";
import AutoBadge from "@/components/AutoBadge";
import { signedPhotoUrl, type SendRefusal, type ThreadMessage, type MessagePerson, type MessageTick } from "@/lib/messages/api";
import { clockText } from "@/lib/messages/format";
import { keepPhotoOnDevice, readLocalPhoto } from "@/lib/messages/photoCache";
import { useOnline } from "@/lib/presence/online";

const PhotoViewer = lazy(() => import("@/components/messages/PhotoViewer"));

export const headingFont = { fontFamily: "var(--font-heading)" };

/** "They are typing": a small bubble on their side with three bouncing dots (still dots when the device asks for less motion). */
export function TypingDots({ name }: { name?: string | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-start px-4 mt-3" data-testid="typing-dots" role="status" aria-label={`${name || "They"} is typing`}>
      <span className="inline-flex items-center gap-1.5 rounded-[22px] rounded-tl-md bg-foreground/10 px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-2 w-2 rounded-full bg-muted-foreground/70"
            animate={reduce ? undefined : { y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
            transition={reduce ? undefined : { duration: 0.9, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
          />
        ))}
      </span>
    </div>
  );
}

/** One grey tick = sent · two grey = delivered to their app · two blue = read. Shown only on the viewer's own messages. */
export function Ticks({ tick, className = "" }: { tick: MessageTick | null | undefined; className?: string }) {
  if (!tick) return null;
  const label = tick === "read" ? "Read" : tick === "delivered" ? "Delivered" : "Sent";
  const Icon = tick === "sent" ? Check : CheckCheck;
  return (
    <span role="img" aria-label={label} data-testid={`tick-${tick}`} className={`inline-flex shrink-0 ${tick === "read" ? "text-sky-500" : "text-muted-foreground"} ${className}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
    </span>
  );
}

/** The small green "online now" dot (the site's one presence channel; nothing when the member hid their status). */
function OnlineDot({ userId, size }: { userId: string; size: number }) {
  const online = useOnline(userId);
  if (!online) return null;
  const d = Math.max(9, Math.round(size * 0.26));
  return <span aria-label="Online" data-testid="online-dot" className="absolute bottom-0 right-0 rounded-full bg-green-500 ring-2 ring-background" style={{ width: d, height: d }} />;
}

export function PersonAvatar({ person, size = 44, showOnline = false }: { person: MessagePerson | null; size?: number; showOnline?: boolean }) {
  const face = <PersonFace person={person} size={size} />;
  if (!showOnline || !person?.userId) return face;
  return <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>{face}<OnlineDot userId={person.userId} size={size} /></span>;
}

function PersonFace({ person, size }: { person: MessagePerson | null; size: number }) {
  const name = person?.fullName?.trim() || "Member";
  const initial = name.charAt(0).toUpperCase();
  return person?.avatarUrl ? (
    <span className="shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border/60" style={{ width: size, height: size }}>
      <OptimizedImage src={person.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
    </span>
  ) : (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/25 to-amber-400/25 font-semibold text-foreground/80 ring-1 ring-border/60"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initial}
    </span>
  );
}

/** What the member reads when the server refuses a send. Calm, one line, no codes. */
export function refusalText(r: SendRefusal): string {
  switch (r) {
    case "under_review": return "Your account is under review · Contact support@50mmretina.com";
    case "no_link": return "You can message people you follow and your friends.";
    case "blocked": return "You can't message this member.";
    case "word_guard": return "This message can't be sent. Please change the words and try again.";
    case "new_link": return "New accounts can't send web links yet. You can after 7 days.";
    case "too_fast": return "You're sending too fast. Try again in a minute.";
    case "daily_limit": return "You've reached today's message limit.";
    case "chat_limit": return "You've started too many new chats today.";
    case "photo_limit": return "You've reached today's photo limit.";
    case "paused": return "Messaging is paused for your account.";
    case "not_available": return "Messaging isn't available for your account.";
    case "text_off": return "Text messages aren't available for your account.";
    case "photos_off": return "Photos aren't available for your account.";
    case "friends_only": return "Your account can message friends only.";
    case "recipient_unavailable": return "This member can't receive messages right now.";
    case "announcement_only": return "Only 50mm Retina World can write in this chat.";
    case "bad_photo": return "That photo couldn't be sent. Try another one.";
    case "upload_failed": return "The photo could not be uploaded just now. Please try again in a moment.";
    case "bad_message": return "Write 1 to 4000 characters.";
    case "sign_in": return "Please sign in to send a message.";
    default: return "Message not sent. Please try again.";
  }
}

/** Shown after the word guard finds a self-harm phrase. The message itself was delivered. */
export function HelplineCard({ onClose }: { onClose: () => void }) {
  return (
    <div role="status" data-testid="helpline-card" className="mx-4 my-3 rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/10 to-amber-400/10 p-4 text-sm">
      <div className="mb-1.5 flex items-center gap-2 font-semibold" style={headingFont}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary"><HeartHandshake className="h-4 w-4" /></span>
        You are not alone
      </div>
      <p className="text-muted-foreground">If you are going through a hard time, please talk to someone now.
        India: Tele-MANAS 14416 (free, 24 hours). United States: call or text 988.</p>
      <button type="button" onClick={onClose} className="mt-2.5 rounded-full bg-background/70 px-3 py-1 text-xs font-semibold text-primary hover:bg-background">Close</button>
    </div>
  );
}

function PhotoTile({ path, width, height, single, expired }: { path: string; width: number | null; height: number | null; single: boolean; expired?: boolean }) {
  const [open, setOpen] = useState(false);
  // 1) this device's own copy (kept the first time the photo was shown); 2) a 5-minute link, asked for only when the tile is
  // on screen — the server's read rule decides — and a copy is kept on this device; 3) the server deleted it after 30 days
  // and this device has no copy: "Photo no longer available".
  const { data } = useQuery({
    queryKey: ["messages", "photo", path, !!expired],
    queryFn: async (): Promise<{ url: string | null; gone: boolean }> => {
      const local = await readLocalPhoto(path);
      if (local) return { url: local, gone: false };
      if (expired) return { url: null, gone: true };
      const url = await signedPhotoUrl(path);
      if (url) void keepPhotoOnDevice(path, url);
      return { url, gone: false };
    },
    staleTime: 4 * 60_000,
  });
  const ratio = single && width && height ? `${width} / ${height}` : "1 / 1";
  if (data?.gone) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-1 overflow-hidden bg-muted px-3 text-center text-muted-foreground" style={{ aspectRatio: ratio, minHeight: 96 }}>
        <ImageOff aria-hidden className="h-6 w-6" />
        <span className="text-xs">Photo no longer available</span>
      </div>
    );
  }
  return (
    <div className="w-full overflow-hidden bg-muted" style={{ aspectRatio: ratio }}>
      {data?.url ? (
        <button type="button" data-testid="photo-open" aria-label="Open photo" onClick={() => setOpen(true)} className="block h-full w-full cursor-zoom-in">
          <OptimizedImage src={data.url} alt="Photo in this chat" loading="lazy" className="h-full w-full object-cover" />
        </button>
      ) : <div aria-hidden className="h-full w-full animate-pulse" />}
      {open && data?.url && <Suspense fallback={null}><PhotoViewer url={data.url} onClose={() => setOpen(false)} /></Suspense>}
    </div>
  );
}

/**
 * One bubble. `first` / `last` come from groupChat: a run of messages from the same person reads as one
 * block (small corner where they join), and only the last one carries the time.
 */
/** Message text with web links made tappable. Plain React text (never HTML); only http(s) links open, in a new tab, without referrer. */
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
export function LinkedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <span>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          let ok = false;
          try { const u = new URL(part); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
          if (ok) return <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 break-all" onClick={(e) => e.stopPropagation()}>{part}</a>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export function MessageBubble({ m, mine, first, last, onReply, onJump, nameOf }: {
  m: ThreadMessage; mine: boolean; first: boolean; last: boolean;
  /** Reply to this message (swipe right on a phone, the arrow beside it on a computer). Left out where replying is not possible. */
  onReply?: (m: ThreadMessage) => void;
  /** Tap the quote: scroll to the original. */
  onJump?: (messageId: number) => void;
  /** Name shown on a quote ("You" or the person). */
  nameOf?: (senderId: string) => string;
}) {
  // 1–3 emoji and nothing else: shown large with no bubble, and they pop in
  if (m.photos.length === 0 && m.status !== "held" && !m.reply && isEmojiOnly(m.body)) {
    return (
      <div id={`msg-${m.id}`} className={`flex flex-col ${mine ? "items-end" : "items-start"} px-4 ${first ? "mt-3" : "mt-0.5"}`}>
        <motion.span
          data-testid="emoji-big"
          initial={{ scale: 0.3, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          whileHover={{ scale: 1.18, rotate: [0, -8, 8, -4, 0] }}
          transition={{ type: "spring", stiffness: 420, damping: 14 }}
          className="inline-block cursor-default select-none text-[52px] leading-none"
        >
          {m.body.trim()}
        </motion.span>
        {last && <span className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">{clockText(m.createdAt)}{mine && <Ticks tick={m.tick} />}</span>}
      </div>
    );
  }
  const photoOnly = m.photos.length > 0 && !m.body && !m.reply && m.status !== "held";
  const single = m.photos.length === 1;
  // swipe right to reply: touch screens only (a mouse drag would fight with selecting text)
  const touch = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const canReply = !!onReply && m.status === "sent";
  // rounded 22px; the corner facing the other side tightens where bubbles join, and flattens on the tail side of the last one
  const join = mine
    ? `${first ? "rounded-tr-[22px]" : "rounded-tr-md"} ${last ? "rounded-br-md" : "rounded-br-md"}`
    : `${first ? "rounded-tl-[22px]" : "rounded-tl-md"} ${last ? "rounded-bl-md" : "rounded-bl-md"}`;
  const shape = `rounded-[22px] ${join}`;
  return (
    <div id={`msg-${m.id}`} className={`flex flex-col ${mine ? "items-end" : "items-start"} px-4 ${first ? "mt-3" : "mt-0.5"} transition-colors`}>
      <div className={`group flex w-full items-center gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
      <motion.div
        data-testid={mine ? "bubble-mine" : "bubble-theirs"}
        drag={canReply && touch ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.4 }}
        dragSnapToOrigin
        onDragEnd={(_, info) => { if (canReply && info.offset.x > 56) onReply?.(m); }}
        className={`max-w-[80%] overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-[1.35] sm:max-w-[68%] ${shape} ${
          photoOnly
            ? "w-[min(80%,280px)] shadow-sm ring-1 ring-border/50"
            : mine
              ? "bg-gradient-to-br from-primary to-primary/80 px-3.5 py-2 text-primary-foreground shadow-sm"
              : "bg-foreground/10 px-3.5 py-2 text-foreground"
        }`}
      >
        {m.reply && (
          <button
            type="button"
            data-testid="reply-quote"
            onClick={() => onJump?.(m.reply!.id)}
            className={`mb-1.5 block w-full rounded-xl border-l-4 px-2.5 py-1.5 text-left text-[13px] leading-snug ${mine ? "border-white/70 bg-white/15" : "border-primary bg-foreground/10"}`}
          >
            <span className="flex items-center gap-1 text-[12px] font-bold opacity-90"><span className="truncate">{nameOf ? nameOf(m.reply.senderId) : "Message"}</span><AutoBadge userId={m.reply.senderId} only="verified" /></span>
            <span className="line-clamp-2 whitespace-pre-wrap break-words opacity-90">{m.reply.body || (m.reply.photo ? "📷 Photo" : "")}</span>
          </button>
        )}
        {m.photos.length > 0 && (
          <div className={`grid gap-0.5 ${single ? "grid-cols-1" : "grid-cols-2"} ${m.body || m.reply ? "-mx-3.5 mb-2 " + (m.reply ? "" : "-mt-2") : ""}`}>
            {m.photos.map((p) => <PhotoTile key={p.path} path={p.path} width={p.width} height={p.height} single={single} expired={p.expired} />)}
          </div>
        )}
        {m.body && <LinkedText text={m.body} />}
      </motion.div>
      {canReply && (
        <button
          type="button"
          aria-label="Reply"
          data-testid="reply-button"
          onClick={() => onReply?.(m)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:hidden"
        >
          <Reply className="h-4 w-4" />
        </button>
      )}
      {m.body && m.status === "sent" && (
        <button
          type="button"
          aria-label="Copy message"
          data-testid="copy-button"
          onClick={() => { void navigator.clipboard?.writeText(m.body).catch(() => undefined); }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:hidden"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
      </div>
      {(last || m.status === "held") && (
        <span className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          {m.status === "held" ? <><Clock className="h-3 w-3" /> Waiting for review</> : <>{clockText(m.createdAt)}{mine && <Ticks tick={m.tick} />}</>}
        </span>
      )}
    </div>
  );
}
