import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircleQuestion, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/core/use-toast";
import { useChatSession } from "@/hooks/chat/useChatSession";
import ChatMessage from "@/components/chat/ChatMessage";

const AskAnything = () => {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterSubmitted, setNewsletterSubmitted] = useState(false);

  const {
    messages,
    input,
    setInput,
    isLoading,
    limitReached,
    showNewsletterCapture,
    setShowNewsletterCapture,
    typingName,
    persona,
    send,
    subscribeNewsletter,
    maxInput,
  } = useChatSession();

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingName]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 200);
  }, [open]);

  const handleSend = async () => {
    const error = await send();
    if (error) {
      toast({ title: "Chat Error", description: error, variant: "destructive" });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewsletterSubmit = async () => {
    if (!newsletterEmail.trim()) return;
    const ok = await subscribeNewsletter(newsletterEmail);
    if (ok) {
      setNewsletterSubmitted(true);
      setShowNewsletterCapture(false);
      toast({ title: "Subscribed!", description: "Thanks for subscribing to our newsletter." });
    } else {
      toast({ title: "Error", description: "Could not subscribe. Please try again.", variant: "destructive" });
    }
  };

  const isOnline = !limitReached;

  return (
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[40] flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-lg hover:opacity-90 transition-opacity"
            style={{ fontFamily: "var(--font-heading)" }}
            aria-label="Ask anything about photography"
          >
            <MessageCircleQuestion className="h-5 w-5" />
            <span className="text-xs tracking-[0.12em] uppercase font-semibold hidden sm:inline">Ask Anything</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/40 backdrop-blur-sm z-[80] sm:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-[90] w-full sm:w-[400px] h-[100dvh] sm:h-[540px] sm:rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <img loading="lazy" decoding="async"
                      src={persona.image}
                      alt={persona.name}
                      className="h-8 w-8 rounded-full object-cover"
                      width={32}
                      height={32}
                    />
                    {/* Online/Offline status dot */}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card transition-colors duration-300 ${
                        isOnline ? "bg-green-500" : "bg-muted-foreground/40"
                      }`}
                    />
                  </div>
                  <div>
                    <h3
                      className="text-sm font-semibold tracking-[0.1em] uppercase"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      Ask Anything
                    </h3>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {persona.name}
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                      <span>{isOnline ? "Online" : "Offline"}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-full hover:bg-muted transition-colors"
                  aria-label="Close chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-80">
                    <img loading="lazy" decoding="async"
                      src={persona.image}
                      alt={persona.name}
                      className="h-16 w-16 rounded-full object-cover shadow-md"
                      width={64}
                      height={64}
                    />
                    <p className="text-sm text-muted-foreground max-w-[260px]">
                      {persona.greeting}
                    </p>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <ChatMessage key={i} msg={msg} persona={persona} />
                ))}

                {/* Typing indicator */}
                {isLoading && typingName && messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex gap-2.5">
                    <img loading="lazy" decoding="async"
                      src={persona.image}
                      alt={persona.name}
                      className="h-7 w-7 rounded-full object-cover shrink-0"
                      width={28}
                      height={28}
                    />
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground italic">
                        {typingName} is typing...
                      </span>
                    </div>
                  </div>
                )}

                {/* Newsletter capture for anonymous users */}
                {showNewsletterCapture && !newsletterSubmitted && (
                  <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Subscribe to our newsletter and stay updated with photography tips!
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={newsletterEmail}
                        onChange={(e) => setNewsletterEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="flex-1 h-8 rounded-lg border border-border bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <Button size="sm" onClick={handleNewsletterSubmit} className="h-8 text-xs">
                        Subscribe
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-border px-4 py-3 bg-card">
                {limitReached ? (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Session limit reached. Please come back later or{" "}
                    <a href="/help-support" className="text-primary underline">raise a support ticket</a>.
                  </p>
                ) : (
                  <div className="flex items-end gap-2">
                    <div className="relative flex-1">
                      <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value.slice(0, maxInput))}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about photography…"
                        className="min-h-[40px] max-h-[100px] resize-none text-sm rounded-xl border-border pr-12"
                        rows={1}
                        disabled={isLoading}
                      />
                      <span className="absolute right-3 bottom-2 text-[9px] text-muted-foreground/50">
                        {input.length}/{maxInput}
                      </span>
                    </div>
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!input.trim() || isLoading}
                      className="shrink-0 rounded-xl h-10 w-10"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default AskAnything;
