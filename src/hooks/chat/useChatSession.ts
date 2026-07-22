import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { getDeviceInfo } from "@/lib/deviceFingerprint";
import { getSessionPersona, type ChatPersona } from "@/components/chat/ChatPersona";
import type { Msg } from "@/components/chat/ChatMessage";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-anything`;
const MAX_INPUT = 1000;

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
}

export function useChatSession() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [showNewsletterCapture, setShowNewsletterCapture] = useState(false);
  const [typingName, setTypingName] = useState("");
  const faqCache = useRef<FaqEntry[]>([]);
  const persona = useRef<ChatPersona>(getSessionPersona());
  const questionCount = useRef(0);
  const deviceId = useRef(getDeviceInfo().deviceId);

  // Load FAQ cache on mount
  useEffect(() => {
    supabase
      .from("faq_entries" as any)
      .select("id, question, answer, keywords")
      .eq("is_active", true)
      .order("sort_order")
      .limit(50)
      .then(({ data }) => {
        if (data) faqCache.current = data as any as FaqEntry[];
      });
  }, []);

  // Check FAQ match (simple keyword + substring matching)
  const checkFaqMatch = useCallback((userQuestion: string): string | null => {
    const q = userQuestion.toLowerCase().trim();
    for (const faq of faqCache.current) {
      // Check keyword match
      if (faq.keywords.some((kw) => q.includes(kw.toLowerCase()))) {
        return faq.answer;
      }
      // Check question substring similarity
      const faqQ = faq.question.toLowerCase();
      if (q.includes(faqQ) || faqQ.includes(q)) {
        return faq.answer;
      }
    }
    return null;
  }, []);

  const streamChat = useCallback(
    async (allMessages: Msg[]) => {
      // Strip the display-only "**<name> says:** " prefix from assistant turns
      // before sending history to the model. Otherwise the model sees its own
      // past replies beginning with "<name> says:" and imitates the pattern,
      // producing a doubled "<name> says: <name> says:" prefix on new replies.
      const cleanMessages = allMessages.map((m) =>
        m.role === "assistant"
          ? { ...m, content: m.content.replace(/^\*\*[^*]+?\s+says:\*\*\s*/i, "") }
          : m
      );
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: cleanMessages,
          device_id: deviceId.current,
          persona_name: persona.current.name,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      // Check for limit_reached JSON response (non-streaming)
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await resp.json();
        if (json.limit_reached) {
          setLimitReached(true);
          setLimitMessage(json.message);
          // Show newsletter capture for anonymous users
          if (!user) {
            setShowNewsletterCapture(true);
          }
          // Add the limit message as assistant response
          const pName = persona.current.name;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `**${pName} says:** ${json.message}` },
          ]);
          return;
        }
        throw new Error(json.error || "Unknown error");
      }

      if (!resp.body) throw new Error("No response stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantSoFar = "";
      let streamDone = false;
      const pName = persona.current.name;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              const snapshot = assistantSoFar;
              // Prepend persona prefix on first token
              const prefixedContent = `**${pName} says:** ${snapshot}`;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: prefixedContent } : m
                  );
                }
                return [...prev, { role: "assistant", content: prefixedContent }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      questionCount.current += 1;
    },
    [user]
  );

  const send = useCallback(async () => {
    const trimmed = input.trim().slice(0, MAX_INPUT);
    if (!trimmed || isLoading || limitReached) return;

    const userMsg: Msg = { role: "user", content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setIsLoading(true);
    setTypingName(persona.current.name);

    try {
      // Check FAQ first
      const faqAnswer = checkFaqMatch(trimmed);
      if (faqAnswer) {
        const pName = persona.current.name;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `**${pName} says:** ${faqAnswer}` },
        ]);
        questionCount.current += 1;
        return;
      }

      await streamChat(updated);
    } catch (e: any) {
      return e.message || "Something went wrong";
    } finally {
      setIsLoading(false);
      setTypingName("");
    }

    return null;
  }, [input, isLoading, limitReached, messages, checkFaqMatch, streamChat]);

  const subscribeNewsletter = useCallback(async (email: string) => {
    try {
      await (supabase.from("newsletter_subscribers" as any).upsert(
        {
          email: email.toLowerCase().trim(),
          source: "ai_chat",
          user_id: user?.id || null,
        } as any,
        { onConflict: "email" }
      ) as any);
      return true;
    } catch {
      return false;
    }
  }, [user]);

  return {
    messages,
    input,
    setInput,
    isLoading,
    limitReached,
    limitMessage,
    showNewsletterCapture,
    setShowNewsletterCapture,
    typingName,
    persona: persona.current,
    send,
    subscribeNewsletter,
    maxInput: MAX_INPUT,
  };
}
