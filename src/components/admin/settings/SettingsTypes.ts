import type { User } from "@supabase/supabase-js";

export type EmailProvider = "brevo" | "resend" | "sendgrid" | "smtp";

export interface SmtpSettings {
  provider: EmailProvider;
  api_key: string;
  host: string;
  port: string;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  encryption: "tls" | "ssl" | "none";
}

export interface WhatsAppSettings {
  provider: "twilio" | "meta" | "other";
  api_key: string;
  api_secret: string;
  phone_number: string;
  account_sid: string;
  webhook_url: string;
}

export interface SocialMediaLinks {
  facebook: string;
  instagram: string;
  twitter: string;
  youtube: string;
  linkedin: string;
  github: string;
  tiktok: string;
  pinterest: string;
  whatsapp_link: string;
  telegram: string;
  website: string;
}

export interface S3StorageSettings {
  enabled: boolean;
  provider: string;
  bucket_name: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint: string;
  path_prefix: string;
  public_url: string;
}

export interface AiModelSettings {
  enabled: boolean;
  primary_model: string;
  fallback_model: string;
  max_tokens: number;
  temperature: number;
  image_analysis_model: string;
  ask_anything_model: string;
  custom_api_key: string;
  api_provider: "lovable" | "google" | "openai";
}

export interface LogEntry {
  timestamp: string;
  step: string;
  status: "ok" | "error" | "info" | "warn";
  detail: string;
}

export interface SettingsSectionProps {
  user: User | null;
}

export const defaultSmtp: SmtpSettings = {
  provider: "brevo",
  api_key: "",
  host: "",
  port: "587",
  username: "",
  password: "",
  from_email: "",
  from_name: "",
  encryption: "tls",
};

export const defaultWhatsApp: WhatsAppSettings = {
  provider: "twilio",
  api_key: "",
  api_secret: "",
  phone_number: "",
  account_sid: "",
  webhook_url: "",
};

export const defaultSocial: SocialMediaLinks = {
  facebook: "",
  instagram: "",
  twitter: "",
  youtube: "",
  linkedin: "",
  github: "",
  tiktok: "",
  pinterest: "",
  whatsapp_link: "",
  telegram: "",
  website: "",
};

export const defaultS3: S3StorageSettings = {
  enabled: false,
  provider: "aws",
  bucket_name: "",
  region: "us-east-1",
  access_key_id: "",
  secret_access_key: "",
  endpoint: "",
  path_prefix: "",
  public_url: "",
};

export const defaultAi: AiModelSettings = {
  enabled: true,
  primary_model: "google/gemini-2.5-flash-lite",
  fallback_model: "google/gemini-3-flash-preview",
  max_tokens: 200,
  temperature: 0.7,
  image_analysis_model: "google/gemini-2.5-flash-lite",
  ask_anything_model: "google/gemini-3-flash-preview",
  custom_api_key: "",
  api_provider: "lovable",
};

export const AI_MODELS = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", desc: "Fastest & cheapest — great for classification, summaries" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Balanced speed & quality for most tasks" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview", desc: "Next-gen balanced speed & capability" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Top-tier reasoning & multimodal" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", desc: "Latest next-gen reasoning model" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano", desc: "Speed & cost optimized for simple tasks" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", desc: "Strong performance at lower cost" },
  { id: "openai/gpt-5", label: "GPT-5", desc: "Powerful all-rounder, excellent reasoning" },
  { id: "openai/gpt-5.2", label: "GPT-5.2", desc: "Latest with enhanced reasoning" },
];

import { Facebook, Instagram, Twitter, Youtube, Globe, Linkedin, Github, Music2, MapPin, Phone as PhoneIcon, Send } from "lucide-react";

export const SOCIAL_FIELDS: { key: keyof SocialMediaLinks; label: string; icon: any; placeholder: string; hoverColor: string }[] = [
  { key: "facebook", label: "Facebook", icon: Facebook, placeholder: "https://facebook.com/yourpage", hoverColor: "hover:text-[#1877F2]" },
  { key: "instagram", label: "Instagram", icon: Instagram, placeholder: "https://instagram.com/yourhandle", hoverColor: "hover:text-[#E4405F]" },
  { key: "twitter", label: "X (Twitter)", icon: Twitter, placeholder: "https://x.com/yourhandle", hoverColor: "hover:text-foreground" },
  { key: "youtube", label: "YouTube", icon: Youtube, placeholder: "https://youtube.com/@yourchannel", hoverColor: "hover:text-[#FF0000]" },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, placeholder: "https://linkedin.com/company/yourco", hoverColor: "hover:text-[#0A66C2]" },
  { key: "github", label: "GitHub", icon: Github, placeholder: "https://github.com/yourorg", hoverColor: "hover:text-foreground" },
  { key: "tiktok", label: "TikTok", icon: Music2, placeholder: "https://tiktok.com/@yourhandle", hoverColor: "hover:text-foreground" },
  { key: "pinterest", label: "Pinterest", icon: MapPin, placeholder: "https://pinterest.com/yourprofile", hoverColor: "hover:text-[#E60023]" },
  { key: "whatsapp_link", label: "WhatsApp", icon: PhoneIcon, placeholder: "https://wa.me/1234567890", hoverColor: "hover:text-[#25D366]" },
  { key: "telegram", label: "Telegram", icon: Send, placeholder: "https://t.me/yourchannel", hoverColor: "hover:text-[#0088CC]" },
  { key: "website", label: "Website", icon: Globe, placeholder: "https://yourwebsite.com", hoverColor: "hover:text-primary" },
];

export const inputClass = "w-full bg-background border border-border px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-primary transition-colors";
export const labelClass = "text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5";
