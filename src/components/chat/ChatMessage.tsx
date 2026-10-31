import ReactMarkdown from "react-markdown";
import { User } from "lucide-react";
import type { ChatPersona } from "./ChatPersona";

export type Msg = { role: "user" | "assistant"; content: string };

interface ChatMessageProps {
  msg: Msg;
  persona: ChatPersona;
}

const ChatMessage = ({ msg, persona }: ChatMessageProps) => {
  return (
    <div className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      {msg.role === "assistant" && (
        <img
          src={persona.image}
          alt={persona.name}
          className="h-7 w-7 rounded-full object-cover shrink-0 mt-0.5"
          loading="lazy"
          width={28}
          height={28}
        />
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          msg.role === "user"
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        }`}
      >
        {msg.role === "assistant" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
      </div>
      {msg.role === "user" && (
        <div className="h-7 w-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
