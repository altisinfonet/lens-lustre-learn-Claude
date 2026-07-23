/**
 * translations — the app's own free i18n dictionaries.
 *
 * Real, human-checked translations (not a broken auto-widget). Each visible
 * string has a key; every language provides its own value. Missing keys fall
 * back to English, so partially-translated languages never show blanks.
 *
 * Adding a language = add its code to LANGS + a dictionary below. Adding a
 * string = add the key to `en` (and translate it where you can).
 */
export type Lang = "en" | "hi" | "bn";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "हिंदी", flag: "🇮🇳" },
  { code: "bn", label: "বাংলা", flag: "🇮🇳" },
];

type Dict = Record<string, string>;

const en: Dict = {
  "nav.competitions": "Competitions",
  "nav.journal": "Journal",
  "nav.courses": "Courses",
  "nav.winners": "Winners",
  "nav.login": "Login",
  "nav.join": "Join",
  "feed.newsFeed": "News Feed",
  "feed.yourFeed": "Your Feed",
  "composer.placeholder": "What's on your mind?",
  "composer.addPhoto": "Add Photo",
  "composer.dragDrop": "or drag and drop",
  "composer.excludeSearch": "Exclude this post from search engines",
  "post.comment": "Comment",
  "post.share": "Share",
  "sidebar.voteEarn": "Vote & Earn",
  "sidebar.voteEarnDesc": "Vote on competition entries and earn wallet credits!",
  "sidebar.startVoting": "Start Voting",
  "sidebar.trending": "Trending This Week",
  "sidebar.latestJournal": "Latest from Journal",
  "sidebar.readMore": "Read More",
  "sidebar.peopleYouMayKnow": "People You May Know",
};

const hi: Dict = {
  "nav.competitions": "प्रतियोगिताएँ",
  "nav.journal": "जर्नल",
  "nav.courses": "कोर्स",
  "nav.winners": "विजेता",
  "nav.login": "लॉग इन",
  "nav.join": "जुड़ें",
  "feed.newsFeed": "न्यूज़ फ़ीड",
  "feed.yourFeed": "आपकी फ़ीड",
  "composer.placeholder": "आपके मन में क्या है?",
  "composer.addPhoto": "फ़ोटो जोड़ें",
  "composer.dragDrop": "या खींचकर छोड़ें",
  "composer.excludeSearch": "इस पोस्ट को सर्च इंजन से बाहर रखें",
  "post.comment": "टिप्पणी",
  "post.share": "साझा करें",
  "sidebar.voteEarn": "वोट करें और कमाएँ",
  "sidebar.voteEarnDesc": "प्रतियोगिता प्रविष्टियों पर वोट करें और वॉलेट क्रेडिट कमाएँ!",
  "sidebar.startVoting": "वोटिंग शुरू करें",
  "sidebar.trending": "इस सप्ताह ट्रेंडिंग",
  "sidebar.latestJournal": "जर्नल से नवीनतम",
  "sidebar.readMore": "और पढ़ें",
  "sidebar.peopleYouMayKnow": "जिन्हें आप जान सकते हैं",
};

const bn: Dict = {
  "nav.competitions": "প্রতিযোগিতা",
  "nav.journal": "জার্নাল",
  "nav.courses": "কোর্স",
  "nav.winners": "বিজয়ী",
  "nav.login": "লগ ইন",
  "nav.join": "যোগ দিন",
  "feed.newsFeed": "নিউজ ফিড",
  "feed.yourFeed": "আপনার ফিড",
  "composer.placeholder": "আপনার মনে কী আছে?",
  "composer.addPhoto": "ছবি যোগ করুন",
  "composer.dragDrop": "অথবা টেনে এনে ছাড়ুন",
  "composer.excludeSearch": "এই পোস্টটি সার্চ ইঞ্জিন থেকে বাদ দিন",
  "post.comment": "মন্তব্য",
  "post.share": "শেয়ার",
  "sidebar.voteEarn": "ভোট দিন ও আয় করুন",
  "sidebar.voteEarnDesc": "প্রতিযোগিতার এন্ট্রিতে ভোট দিন এবং ওয়ালেট ক্রেডিট আয় করুন!",
  "sidebar.startVoting": "ভোট দেওয়া শুরু করুন",
  "sidebar.trending": "এই সপ্তাহে ট্রেন্ডিং",
  "sidebar.latestJournal": "জার্নাল থেকে সর্বশেষ",
  "sidebar.readMore": "আরও পড়ুন",
  "sidebar.peopleYouMayKnow": "যাদের আপনি চিনতে পারেন",
};

export const translations: Record<Lang, Dict> = { en, hi, bn };

/** Top-nav labels come from the DB; map the known English ones to keys so they
 *  translate too. Unknown labels fall through to their original text. */
const NAV_LABEL_MAP: Record<string, string> = {
  Competitions: "nav.competitions",
  Journal: "nav.journal",
  Courses: "nav.courses",
  Winners: "nav.winners",
};

export const navKeyForLabel = (label: string): string | null => NAV_LABEL_MAP[label] || null;
