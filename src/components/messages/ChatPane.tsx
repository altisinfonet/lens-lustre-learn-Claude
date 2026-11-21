/**
 * Messages · one chat: header, request bar, day chips + grouped bubbles, composer.
 * The server decides who may send; the composer only shows what it answers. Plain text only. A retry of the
 * same text reuses its message id, so the server stores it once. Photos are re-encoded to WebP in the browser first.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProfileLink from "@/components/ProfileLink";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, ImagePlus, Loader2, Search, SendHorizontal, Smile, UserRound, X } from "lucide-react";
import { motion } from "framer-motion";
import { useT } from "@/i18n/I18nContext";
import { useAuth } from "@/hooks/core/useAuth";
import {
  newClientMsgId, useConversationActions, useConversations, useMessagingAllowed, useSendMessage, useSendPhotos, useThread,
} from "@/hooks/messages/useMessages";
import { fetchPerson, MessageSendError, type MessagePerson, type ThreadMessage } from "@/lib/messages/api";
import { EMOJI_SETS } from "@/lib/messages/emoji";
import { groupChat } from "@/lib/messages/format";
import { suggestReplies } from "@/lib/messages/suggest";
import { prepareAndUploadPhoto } from "@/lib/messages/photoUpload";
import { useChatLive } from "@/hooks/messages/useChatLive";
import { HelplineCard, MessageBubble, PersonAvatar, TypingDots, headingFont, refusalText } from "@/components/messages/MessageParts";
import ReportChat from "@/components/messages/ReportChat";
import ChatMenu from "@/components/messages/ChatMenu";
import AutoBadge from "@/components/AutoBadge";
import { usePeerStatus } from "@/hooks/messages/usePeerStatus";
import { useMessageQueue } from "@/hooks/messages/useMessageQueue";
import { isOfflineFailure, queueMessage } from "@/lib/messages/queue";
import { useViewAs } from "@/components/messages/viewAs";

const MAX_PHOTOS = 10;

export default function ChatPane({ conversationId, userId, onBack }: { conversationId: string | null; userId: string | null; onBack: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewAs = useViewAs();                     // admin viewing a member's box: read-only, that member is "me"
  const meId = viewAs?.userId ?? user?.id;
  const allowed = useMessagingAllowed();
  const inbox = useConversations("inbox");
  const requests = useConversations("requests");
  const known = useMemo(() => [...(inbox.data ?? []), ...(requests.data ?? [])], [inbox.data, requests.data]);
  const existing = userId ? known.find((c) => c.kind === "direct" && c.other?.userId === userId) : undefined;
  const convId = conversationId ?? existing?.conversationId ?? null;
  const entry = known.find((c) => c.conversationId === convId);
  const inRequests = entry?.folder === "requests";

  // /messages/with/:userId → the chat that already exists, else a new one to start
  useEffect(() => {
    if (userId && existing) navigate(`/messages/${existing.conversationId}`, { replace: true });
  }, [userId, existing, navigate]);

  const thread = useThread(convId);
  const oldestFirst = useMemo(() => [...(thread.data ?? [])].reverse(), [thread.data]);
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState("");
  const needle = searchText.trim().toLowerCase();
  const shown = useMemo(() => (needle ? oldestFirst.filter((m) => m.body.toLowerCase().includes(needle)) : oldestFirst), [oldestFirst, needle]);
  const items = useMemo(() => groupChat(shown), [shown]);
  const otherId = entry?.other?.userId ?? userId ?? oldestFirst.find((m) => m.senderId !== meId)?.senderId ?? null;
  const { data: fetched } = useQuery<MessagePerson | null>({
    queryKey: ["messages", "person", otherId],
    queryFn: () => fetchPerson(otherId as string),
    enabled: !!otherId && !entry?.other,
    staleTime: 5 * 60_000,
  });
  const person = entry?.other ?? fetched ?? null;

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState(0);
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const send = useSendMessage();
  const sendPhotos = useSendPhotos();
  const { accept, decline, markRead } = useConversationActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lastMarked = useRef<number | null>(null);
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);   // the message the next send answers
  useEffect(() => { setReplyTo(null); }, [convId]);
  const quoteName = (senderId: string) => (senderId === meId ? "You" : person?.fullName || "Member");
  /** Tap a quote: scroll to the original and flash it. */
  const jumpTo = (id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("bg-primary/15");
    window.setTimeout(() => el.classList.remove("bg-primary/15"), 1400);
  };
  const queued = useMessageQueue(viewAs ? undefined : user?.id, otherId);   // texts written with no network, waiting to be sent
  const live = useChatLive(convId, user?.id, !viewAs);   // typing dots + instant refresh; an admin's read-only view never joins

  const newestId = oldestFirst.length ? oldestFirst[oldestFirst.length - 1].id : null;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [newestId, help, convId]);
  useEffect(() => {
    if (!viewAs && !inRequests && convId && newestId !== null && lastMarked.current !== newestId) {
      lastMarked.current = newestId;
      markRead.mutate(convId, { onSuccess: () => live.ping() });   // the sender's ticks turn blue at once
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markRead is a stable mutation object per render; the guard above is the dedupe
  }, [convId, newestId, inRequests]);
  // the box grows with the text, up to about five lines
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  const busy = send.isPending || sendPhotos.isPending || uploading;

  /** Sends `raw` (the box, or a tapped suggestion). Only the box is cleared afterwards. */
  const sendText = async (raw: string, fromBox: boolean) => {
    const body = raw.trim();
    if (!body || !otherId || busy) return;
    setError(null);
    const id = attempt.current?.body === body ? attempt.current.id : newClientMsgId();
    attempt.current = { body, id };
    try {
      const r = await send.mutateAsync({ to: otherId, body, clientMsgId: id, replyTo: replyTo?.id ?? null });
      attempt.current = null;
      live.ping();
      setReplyTo(null);
      if (fromBox) setText("");
      setPicker(false);
      if (r.help) setHelp(true);
      if (!convId) navigate(`/messages/${r.conversationId}`, { replace: true });
    } catch (e) {
      // no network: keep the message on this device and send it, once, when the network is back (same id = never twice)
      if (isOfflineFailure(e) && meId && otherId && !viewAs && queueMessage({ id, userId: meId, to: otherId, body, replyTo: replyTo?.id ?? null })) {
        attempt.current = null;
        if (fromBox) setText("");
        setReplyTo(null);
        setPicker(false);
        return;
      }
      setError(refusalText(e instanceof MessageSendError ? e.refusal : "unknown"));
    }
  };
  const onSend = () => sendText(text, true);

  // smart replies: shown only when the last message in this chat is the other person's, and sending is allowed
  const lastMsg = oldestFirst.length ? oldestFirst[oldestFirst.length - 1] : null;
  const chips = allowed && !viewAs && lastMsg && lastMsg.senderId !== meId && !inRequests ? suggestReplies(lastMsg) : [];

  const addEmoji = (e: string) => {
    const el = areaRef.current;
    const at = el ? el.selectionStart ?? text.length : text.length;
    const to = el ? el.selectionEnd ?? at : at;
    const next = (text.slice(0, at) + e + text.slice(to)).slice(0, 4000);
    setText(next);
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); });
  };

  const onPickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0 || !otherId || !user || busy) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = [];
      for (const f of Array.from(files).slice(0, MAX_PHOTOS)) uploaded.push(await prepareAndUploadPhoto(f, user.id));
      const r = await sendPhotos.mutateAsync({ to: otherId, caption: text.trim(), clientMsgId: newClientMsgId(), photos: uploaded, replyTo: replyTo?.id ?? null });
      setText("");
      setReplyTo(null);
      live.ping();
      if (r.help) setHelp(true);
      if (!convId) navigate(`/messages/${r.conversationId}`, { replace: true });
    } catch (e) {
      setError(refusalText(e instanceof MessageSendError ? e.refusal : e instanceof Error && e.message === "upload-failed" ? "upload_failed" : "bad_photo"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const name = person?.fullName || t("messages.chat", "Chat");
  const peer = usePeerStatus(otherId, !viewAs);   // "Active now" / "Active 12 m ago" (Owner 21 Nov, Meta style)

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="flex items-center gap-3 border-b border-border/70 bg-background/80 px-3 py-2.5 backdrop-blur">
        <button type="button" onClick={onBack} aria-label={t("common.back", "Back")} className="grid h-11 w-11 place-items-center rounded-full text-foreground hover:bg-foreground/5 lg:hidden">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {/* Owner 21 Nov: tapping the picture or the name opens that member's profile */}
        {(() => {
          const head = (
            <>
              <PersonAvatar person={person} size={42} showOnline />
              <div className="min-w-0 flex-1">
                <h2 className="flex min-w-0 items-center gap-1 text-base font-bold leading-tight" style={headingFont}><span className="truncate">{name}</span>{otherId && <AutoBadge userId={otherId} only="verified" />}</h2>
                {(peer.text || person?.username) && <p className="truncate text-xs text-muted-foreground" data-testid="peer-status">{peer.text && <span className={peer.online ? "font-medium text-green-500" : ""}>{peer.text}</span>}{peer.text && person?.username ? " · " : ""}{person?.username ? `@${person.username}` : ""}</p>}
              </div>
            </>
          );
          return otherId
            ? <ProfileLink userId={otherId} handle={person?.username} aria-label={name} data-testid="chat-header-profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left hover:opacity-90">{head}</ProfileLink>
            : <div className="flex min-w-0 flex-1 items-center gap-3">{head}</div>;
        })()}
        {convId && !viewAs && <ReportChat conversationId={convId} />}
        {convId && !viewAs && <ChatMenu conversationId={convId} otherId={otherId} muted={!!entry?.muted} onSearch={() => setSearching(true)} />}
        {otherId && (
          <ProfileLink userId={otherId} handle={person?.username} aria-label={t("messages.viewProfile", "View profile")} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
            <UserRound className="h-5 w-5" />
          </ProfileLink>
        )}
      </header>

      {searching && (
        <div data-testid="chat-search" className="flex items-center gap-2 border-b border-border/70 bg-background/80 px-3 py-2">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus value={searchText} onChange={(e) => setSearchText(e.target.value)} maxLength={100}
            placeholder={t("messages.searchPlaceholder", "Search messages in this chat")}
            aria-label={t("messages.searchChat", "Search in this chat")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {needle && <span className="shrink-0 text-xs text-muted-foreground">{shown.length}</span>}
          <button type="button" onClick={() => { setSearching(false); setSearchText(""); }} aria-label={t("common.close", "Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/5"><X className="h-4 w-4" /></button>
        </div>
      )}

      {inRequests && convId && !viewAs && (
        <div data-testid="request-bar" className="mx-3 mt-3 rounded-3xl border border-border bg-background p-4 shadow-sm">
          <p className="text-sm font-semibold" style={headingFont}>{t("messages.request.title", "Message request")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("messages.request.note", "You don't follow this person. Accept to move this chat to your Chats.")}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => accept.mutate(convId)} className="flex-1 rounded-full bg-gradient-to-br from-primary to-amber-400 py-2 text-sm font-bold text-white">{t("messages.request.accept", "Accept")}</button>
            <button type="button" onClick={() => decline.mutate(convId, { onSuccess: () => navigate("/messages", { replace: true }) })} className="flex-1 rounded-full bg-muted py-2 text-sm font-semibold">{t("messages.request.decline", "Decline")}</button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3 pt-1" aria-live="polite">
        {thread.isLoading && convId && <p className="py-10 text-center text-sm text-muted-foreground">{t("common.loading", "Loading…")}</p>}
        {!thread.isLoading && items.length === 0 && (
          <div className="px-8 py-20 text-center">
            <PersonAvatar person={person} size={72} />
            <p className="mt-3 text-base font-semibold" style={headingFont}>{name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("messages.thread.empty", "Say hello and start the conversation.")}</p>
          </div>
        )}
        {items.map((it) =>
          it.type === "day" ? (
            <div key={it.key} className="flex justify-center pt-4">
              <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">{it.label}</span>
            </div>
          ) : (
            <MessageBubble
              key={it.key} m={it.m} mine={it.m.senderId === meId} first={it.first} last={it.last}
              onReply={allowed && !viewAs && !inRequests ? (msg) => { setReplyTo(msg); areaRef.current?.focus(); } : undefined}
              onJump={jumpTo} nameOf={quoteName}
            />
          ),
        )}
        {queued.map((q) => (
          <div key={q.id} data-testid="queued-message" className="mt-1 flex flex-col items-end px-4">
            <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[22px] rounded-br-md bg-primary/60 px-3.5 py-2 text-[15px] leading-[1.35] text-primary-foreground sm:max-w-[68%]">{q.body}</div>
            <span className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground"><Clock aria-hidden className="h-3 w-3" />{t("messages.waitingNetwork", "Waiting for network")}</span>
          </div>
        ))}
        {live.typing && <TypingDots name={person?.fullName} />}
        {help && <HelplineCard onClose={() => setHelp(false)} />}
        <div ref={endRef} />
      </div>

      {viewAs ? (
        <p className="border-t border-border/70 bg-background/80 px-4 py-3.5 text-center text-sm text-muted-foreground" data-testid="view-as-note">
          Read-only view of {viewAs.name}'s chat. Nothing you do here is sent or marked as read.
        </p>
      ) : !allowed ? (
        <p className="border-t border-border/70 bg-background/80 px-4 py-3.5 text-center text-sm text-muted-foreground" data-testid="send-off-note">
          {t("messages.sendOff", "Sending messages isn't available for your account. You can still read your chats.")}
        </p>
      ) : (
        <div className="relative bg-background/80 px-3 pb-3 pt-2 backdrop-blur">
          {error && <p role="alert" className="mb-2 px-3 text-xs font-medium text-destructive">{error}</p>}
          {replyTo && (
            <div data-testid="reply-bar" className="mb-2 flex items-center gap-2 rounded-2xl border-l-4 border-primary bg-muted/70 px-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex min-w-0 items-center gap-1 text-xs font-bold text-primary"><span className="truncate">{t("messages.replyingTo", "Replying to")} {quoteName(replyTo.senderId)}</span><AutoBadge userId={replyTo.senderId} only="verified" /></p>
                <p className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">{replyTo.body || (replyTo.photos.length > 0 ? "📷 Photo" : "")}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} aria-label={t("messages.cancelReply", "Cancel reply")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {chips.length > 0 && (
            <div data-testid="smart-replies" className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t("messages.suggested", "Suggested replies")}>
              {chips.map((c, i) => (
                <motion.button
                  key={c}
                  type="button"
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.06 * i, type: "spring", stiffness: 380, damping: 22 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => void sendText(c, false)}
                  disabled={busy}
                  className="h-11 shrink-0 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-foreground hover:bg-primary/15 disabled:opacity-50"
                >
                  {c}
                </motion.button>
              ))}
            </div>
          )}
          {picker && (
            <div data-testid="emoji-picker" className="absolute inset-x-3 bottom-full mb-2 rounded-3xl border border-border bg-background p-2 shadow-xl">
              <div role="tablist" className="mb-1 flex gap-1 px-1">
                {EMOJI_SETS.map((s, i) => (
                  <button key={s.id} type="button" role="tab" aria-selected={pickerTab === i} aria-label={s.label} onClick={() => setPickerTab(i)}
                    className={`grid h-11 flex-1 place-items-center rounded-2xl text-xl ${pickerTab === i ? "bg-primary/15" : "hover:bg-foreground/5"}`}>{s.icon}</button>
                ))}
              </div>
              <div className="grid max-h-56 grid-cols-6 gap-0.5 overflow-y-auto sm:grid-cols-8">
                {EMOJI_SETS[pickerTab].items.map((e) => (
                  <motion.button key={e} type="button" aria-label={e} onClick={() => addEmoji(e)} whileHover={{ scale: 1.3, rotate: [0, -10, 10, 0] }} whileTap={{ scale: 0.85 }}
                    className="grid h-11 w-full place-items-center rounded-xl text-[26px] hover:bg-foreground/5">{e}</motion.button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-end gap-1.5 rounded-[30px] border border-border bg-background p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-primary/60">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={(e) => void onPickPhotos(e.target.files)} />
            <button type="button" onClick={() => setPicker((p) => !p)} aria-label={t("messages.emoji", "Emoji")} aria-expanded={picker} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-foreground/5 ${picker ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary"}`}>
              <Smile className="h-6 w-6" />
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={t("messages.addPhoto", "Add photo")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-primary disabled:opacity-50">
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            </button>
            <textarea
              ref={areaRef}
              value={text}
              onChange={(e) => { setText(e.target.value.slice(0, 4000)); live.notifyTyping(e.target.value.trim().length > 0); }}
              rows={1}
              placeholder={t("messages.placeholder", "Message…")}
              aria-label={t("messages.placeholder", "Message…")}
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-1.5 py-3 text-[15px] leading-5 placeholder:text-muted-foreground focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSend(); } }}
            />
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={busy || !text.trim()}
              aria-label={t("messages.send", "Send")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-amber-400 text-white shadow-md shadow-primary/30 transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
