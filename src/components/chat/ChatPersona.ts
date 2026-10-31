/** Rotating AI assistant personas for Ask Anything chat */

import emmaImg from "@/assets/agents/emma.jpg";
import oliviaImg from "@/assets/agents/olivia.jpg";
import ameliaImg from "@/assets/agents/amelia.jpg";
import isabellaImg from "@/assets/agents/isabella.jpg";
import sophiaImg from "@/assets/agents/sophia.jpg";

export interface ChatPersona {
  name: string;
  avatar: string; // emoji fallback
  image: string; // real photo
  greeting: string;
}

const PERSONAS: ChatPersona[] = [
  {
    name: "Emma",
    avatar: "👩‍🦰",
    image: emmaImg,
    greeting: "Hello, I am Emma! How can I help you? 📷",
  },
  {
    name: "Olivia",
    avatar: "👩‍🦱",
    image: oliviaImg,
    greeting: "Hello, I am Olivia! How can I help you? 📷",
  },
  {
    name: "Amelia",
    avatar: "👩",
    image: ameliaImg,
    greeting: "Hello, I am Amelia! How can I help you? 📷",
  },
  {
    name: "Isabella",
    avatar: "👩‍🔬",
    image: isabellaImg,
    greeting: "Hello, I am Isabella! How can I help you? 📷",
  },
  {
    name: "Sophia",
    avatar: "👩‍🎨",
    image: sophiaImg,
    greeting: "Hello, I am Sophia! How can I help you? 📷",
  },
];

const SESSION_KEY = "50mm_chat_persona_idx";

/** Get a random persona for this browser session (sticky per session) */
export function getSessionPersona(): ChatPersona {
  let idx = sessionStorage.getItem(SESSION_KEY);
  if (idx === null) {
    const randomIdx = Math.floor(Math.random() * PERSONAS.length);
    sessionStorage.setItem(SESSION_KEY, String(randomIdx));
    idx = String(randomIdx);
  }
  return PERSONAS[Number(idx) % PERSONAS.length];
}

/** Get all persona names for display */
export function getAllPersonaNames(): string[] {
  return PERSONAS.map((p) => p.name);
}
