/**
 * Messages · the ONE data layer (M8 prep). Screens never touch the message tables:
 * every read and write goes through these functions → the server functions of
 * migrations 20261118_1100 … _1700 (message_send, message_send_photo,
 * message_my_conversations, message_thread, …). The server decides everything;
 * this file only shapes the answers and names the refusals.
 *
 * Text is PLAIN TEXT only: a message body is never inserted as HTML anywhere.
 * A reply that does not have the expected shape is dropped, never half-shown.
 */
import { supabase } from "@/integrations/supabase/client";
import { safeRandomUUID } from "@/lib/safeUuid";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export type MessageFolder = "inbox" | "requests";

export interface MessagePerson {
  userId: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
}
/** How far one of MY messages has got: stored → the other person's app fetched it → they opened the chat. */
export type MessageTick = "sent" | "delivered" | "read";
const tickOf = (v: unknown): MessageTick | null => (v === "sent" || v === "delivered" || v === "read" ? v : null);

export interface ConversationSummary {
  conversationId: string;
  kind: "direct" | "group";
  title: string | null;
  folder: string;
  muted: boolean;
  /** Broadcast chat the sender locked: members read it but only the sender writes (SQL 3600). */
  announcementOnly: boolean;
  lastMessageAt: string | null;
  other: MessagePerson | null;
  last: { id: number; senderId: string; kind: "text" | "photo"; body: string; createdAt: string; tick: MessageTick | null } | null;
  unread: number;
}
export interface MessageReplyQuote { id: number; senderId: string; body: string; photo: boolean }
/** `expired`: the server deleted the file after 30 days (SQL 3100); only a device that kept its own copy can still show it. */
export interface MessagePhoto { path: string; width: number | null; height: number | null; expired?: boolean }
export interface ThreadMessage {
  id: number;
  senderId: string;
  kind: "text" | "photo";
  body: string;
  createdAt: string;
  /** Only the sender's own held message says 'held'; everything else is 'sent'. */
  status: "sent" | "held";
  /** Only on the viewer's OWN stored messages; never on someone else's. */
  tick: MessageTick | null;
  /** The message this one answers (first 140 characters), when it is a reply and the original still exists. */
  reply: MessageReplyQuote | null;
  photos: MessagePhoto[];
}
export interface SendResult {
  messageId: number;
  conversationId: string;
  duplicate: boolean;
  status: "sent" | "held";
  folder: string | null;
  /** The word guard found a self-harm phrase: show the helpline. */
  help: boolean;
}

/** Why a send was refused, in words the screen can map to a calm message. */
export type SendRefusal =
  | "sign_in" | "under_review" | "bad_recipient" | "bad_message" | "not_available" | "recipient_unavailable"
  | "paused" | "text_off" | "photos_off" | "friends_only" | "blocked" | "no_link"
  | "too_fast" | "daily_limit" | "chat_limit" | "photo_limit" | "announcement_only" | "word_guard" | "new_link" | "bad_photo" | "upload_failed" | "unknown";

const REFUSALS: Record<string, SendRefusal> = {
  "MSG-001": "sign_in", ACCOUNT_UNDER_REVIEW: "under_review", "MSG-002": "bad_recipient", "MSG-003": "bad_message",
  "MSG-010": "not_available", "MSG-011": "recipient_unavailable", "MSG-020": "paused", "MSG-021": "text_off",
  "MSG-022": "friends_only", "MSG-023": "photos_off", "MSG-024": "bad_photo", "MSG-025": "bad_photo",
  "MSG-030": "blocked", "MSG-040": "no_link", "MSG-050": "too_fast", "MSG-051": "daily_limit",
  "MSG-052": "chat_limit", "MSG-053": "photo_limit", "MSG-090": "announcement_only", "MSG-060": "word_guard", "MSG-061": "new_link", "MSG-080": "bad_message",
};

export class MessageSendError extends Error {
  constructor(public refusal: SendRefusal, message: string) {
    super(message);
    this.name = "MessageSendError";
  }
}

/** The server's refusal code is the first token of its error text (e.g. "MSG-040: …"). */
export function refusalFrom(message: string | undefined | null): SendRefusal {
  const m = /(ACCOUNT_UNDER_REVIEW|MSG-\d{3})/.exec(message ?? "");
  return (m && REFUSALS[m[1]]) || "unknown";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function person(v: unknown): MessagePerson | null {
  if (!isObj(v) || !str(v.user_id)) return null;
  return { userId: v.user_id as string, fullName: str(v.full_name), username: str(v.username), avatarUrl: str(v.avatar_url) };
}

export function parseConversations(data: unknown): ConversationSummary[] {
  if (!Array.isArray(data)) return [];
  const out: ConversationSummary[] = [];
  for (const r of data) {
    if (!isObj(r) || !str(r.conversation_id)) continue;
    const last = isObj(r.last) && num(r.last.id) !== null && str(r.last.sender_id) && str(r.last.created_at)
      ? { id: r.last.id as number, senderId: r.last.sender_id as string, kind: (r.last.kind === "photo" ? "photo" : "text") as "text" | "photo",
          body: str(r.last.body) ?? "", createdAt: r.last.created_at as string, tick: tickOf(r.last.tick) }
      : null;
    out.push({
      conversationId: r.conversation_id as string, kind: r.kind === "group" ? "group" : "direct", title: str(r.title),
      folder: str(r.folder) ?? "inbox", muted: r.muted === true, announcementOnly: r.announcement_only === true,
      lastMessageAt: str(r.last_message_at), other: person(r.other), last, unread: num(r.unread) ?? 0,
    });
  }
  return out;
}

function quoteOf(v: unknown): MessageReplyQuote | null {
  if (!isObj(v) || num(v.id) === null || !str(v.sender_id)) return null;
  return { id: v.id as number, senderId: v.sender_id as string, body: str(v.body) ?? "", photo: v.photo === true };
}

export function parseThread(data: unknown): ThreadMessage[] {
  if (!Array.isArray(data)) return [];
  const out: ThreadMessage[] = [];
  for (const r of data) {
    if (!isObj(r) || num(r.id) === null || !str(r.sender_id) || !str(r.created_at)) continue;
    const photos: MessagePhoto[] = Array.isArray(r.photos)
      ? r.photos.filter(isObj).filter((p) => !!str(p.path)).map((p) => ({ path: p.path as string, width: num(p.width), height: num(p.height), expired: p.expired === true }))
      : [];
    out.push({
      id: r.id as number, senderId: r.sender_id as string, kind: r.kind === "photo" ? "photo" : "text",
      body: str(r.body) ?? "", createdAt: r.created_at as string, status: r.status === "held" ? "held" : "sent", tick: tickOf(r.tick), reply: quoteOf(r.reply), photos,
    });
  }
  return out;
}

export function parseUnread(data: unknown): { inbox: number; requests: number } {
  const o = isObj(data) ? data : {};
  return { inbox: num(o.inbox) ?? 0, requests: num(o.requests) ?? 0 };
}

export function parseSendResult(data: unknown): SendResult | null {
  if (!isObj(data) || num(data.message_id) === null || !str(data.conversation_id)) return null;
  return {
    messageId: data.message_id as number, conversationId: data.conversation_id as string, duplicate: data.duplicate === true,
    status: data.status === "held" ? "held" : "sent", folder: str(data.folder), help: data.help === true,
  };
}

/** One id per user action: a retry of the same action reuses it, so the server never stores it twice. */
export const newClientMsgId = (): string => safeRandomUUID();

export async function fetchConversations(folder: MessageFolder, limit = 30, before: string | null = null): Promise<ConversationSummary[]> {
  const { data, error } = await rpc("message_my_conversations", { _folder: folder, _limit: limit, _before: before });
  if (error) throw new Error(error.message ?? "message_my_conversations failed");
  return parseConversations(data);
}
export async function fetchThread(conversationId: string, beforeId: number | null = null, limit = 50): Promise<ThreadMessage[]> {
  const { data, error } = await rpc("message_thread", { _conversation: conversationId, _before_id: beforeId, _limit: limit });
  if (error) throw new Error(error.message ?? "message_thread failed");
  return parseThread(data);
}
/** Admin "open a member's message box" (20261118_2200): the SAME answers the member's own screen gets, read-only, nothing written. */
export async function fetchViewInbox(userId: string, folder: MessageFolder, limit = 30, before: string | null = null): Promise<ConversationSummary[]> {
  const { data, error } = await rpc("admin_view_inbox", { _user: userId, _folder: folder, _limit: limit, _before: before });
  if (error) throw new Error(error.message ?? "admin_view_inbox failed");
  return parseConversations(data);
}
export async function fetchViewThread(userId: string, conversationId: string, beforeId: number | null = null, limit = 50): Promise<ThreadMessage[]> {
  const { data, error } = await rpc("admin_view_thread", { _user: userId, _conversation: conversationId, _before_id: beforeId, _limit: limit });
  if (error) throw new Error(error.message ?? "admin_view_thread failed");
  return parseThread(data);
}
// fetchUnread / fetchMessagingAllowed live in ./nav (the top bar needs them in the first download)
export { fetchMessagingAllowed } from "./nav";
export { fetchUnread } from "./unread";

export async function sendMessage(to: string, body: string, clientMsgId: string, replyTo: number | null = null): Promise<SendResult> {
  // a reply goes through the one reply door (the normal send door + the link, in one transaction)
  const { data, error } = replyTo !== null
    ? await rpc("message_send_reply", { _to: to, _body: body, _client_msg_id: clientMsgId, _reply_to: replyTo })
    : await rpc("message_send", { _to: to, _body: body, _client_msg_id: clientMsgId });
  if (error) throw new MessageSendError(refusalFrom(error.message), error.message ?? "send refused");
  const r = parseSendResult(data);
  if (!r) throw new MessageSendError("unknown", "unexpected reply");
  return r;
}
export async function sendPhotos(
  to: string, caption: string, clientMsgId: string, photos: Array<{ path: string; width?: number; height?: number }>, replyTo: number | null = null,
): Promise<SendResult> {
  const { data, error } = replyTo !== null
    ? await rpc("message_send_reply", { _to: to, _body: caption, _client_msg_id: clientMsgId, _reply_to: replyTo, _photos: photos })
    : await rpc("message_send_photo", { _to: to, _caption: caption, _client_msg_id: clientMsgId, _photos: photos });
  if (error) throw new MessageSendError(refusalFrom(error.message), error.message ?? "send refused");
  const r = parseSendResult(data);
  if (!r) throw new MessageSendError("unknown", "unexpected reply");
  return r;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await rpc("message_mark_read", { _conversation: conversationId });
}
/** "My app has loaded my chats": the senders' single tick becomes a double grey one. Fire-and-forget; a failure changes nothing for the member. */
export async function markDelivered(): Promise<void> {
  await rpc("message_mark_delivered");
}
export async function acceptRequest(conversationId: string): Promise<void> {
  const { error } = await rpc("message_accept_request", { _conversation: conversationId });
  if (error) throw new Error(error.message ?? "accept failed");
}
export async function declineRequest(conversationId: string): Promise<void> {
  const { error } = await rpc("message_decline_request", { _conversation: conversationId });
  if (error) throw new Error(error.message ?? "decline failed");
}
export type ReportReason = "spam" | "abuse" | "threat" | "nudity" | "other";
/** A member reports a chat they are in (M10). The server keeps one open report per member per chat. */
export async function reportConversation(conversationId: string, reason: ReportReason, note: string): Promise<void> {
  const { error } = await rpc("message_report", { _conversation: conversationId, _reason: reason, _note: note.trim() || null });
  if (error) throw new Error(error.message ?? "report failed");
}
export async function setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  const { error } = await rpc("message_set_muted", { _conversation: conversationId, _muted: muted });
  if (error) throw new Error(error.message ?? "mute failed");
}
/** "Delete chat for me" (SQL 3300): clears the chat from this member's side only; the other member keeps everything. */
export async function clearConversation(conversationId: string): Promise<void> {
  const { error } = await rpc("message_clear_chat", { _conversation: conversationId });
  if (error) throw new Error(error.message ?? "clear failed");
}

/** When a chat partner was last active (null: unknown, hidden by them, or no shared chat). Only asked while they are not online. */
export async function fetchPeerLastActive(userId: string): Promise<string | null> {
  const { data, error } = await rpc("message_peer_status", { _user: userId });
  if (error || typeof data !== "string") return null;
  return Number.isFinite(Date.parse(data)) ? data : null;
}

/** Name + picture of one member for a chat header (the public profile row; nothing private). */
export async function fetchPerson(userId: string): Promise<MessagePerson | null> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, custom_url, avatar_url").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return { userId: data.id, fullName: data.full_name ?? null, username: data.custom_url ?? null, avatarUrl: data.avatar_url ?? null };
}

/** A 5-minute link for one photo; storage creates it only if the server's read rule passes. */
export async function signedPhotoUrl(path: string): Promise<string | null> {
  if (path.startsWith("data:image/")) return path; // never a real storage path: lets the screenshot harness show a swatch with no network
  const { data, error } = await supabase.storage.from("message-photos").createSignedUrl(path, 300);
  return error || !data ? null : data.signedUrl;
}
