/**
 * translations — the app's own free i18n dictionaries.
 *
 * Real, human-checked translations (not a broken auto-widget). Each visible
 * string has a key; every language provides its own value. Missing keys fall
 * back to English, so a partially-translated language never shows blanks.
 *
 * Add a language: add its code to LANGS + a dictionary below.
 * Add a string: add the key to `en` (and translate it where you can).
 */
export type Lang = "en" | "hi" | "bn" | "mr" | "gu" | "ta" | "te";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "हिंदी", flag: "🇮🇳" },
  { code: "bn", label: "বাংলা", flag: "🇮🇳" },
  { code: "mr", label: "मराठी", flag: "🇮🇳" },
  { code: "gu", label: "ગુજરાતી", flag: "🇮🇳" },
  { code: "ta", label: "தமிழ்", flag: "🇮🇳" },
  { code: "te", label: "తెలుగు", flag: "🇮🇳" },
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

const mr: Dict = {
  "nav.competitions": "स्पर्धा",
  "nav.journal": "जर्नल",
  "nav.courses": "कोर्स",
  "nav.winners": "विजेते",
  "nav.login": "लॉग इन",
  "nav.join": "सामील व्हा",
  "feed.newsFeed": "न्यूज फीड",
  "feed.yourFeed": "तुमची फीड",
  "composer.placeholder": "तुमच्या मनात काय आहे?",
  "composer.addPhoto": "फोटो जोडा",
  "composer.dragDrop": "किंवा ओढून सोडा",
  "composer.excludeSearch": "ही पोस्ट सर्च इंजिनांपासून वगळा",
  "post.comment": "टिप्पणी",
  "post.share": "शेअर करा",
  "sidebar.voteEarn": "मत द्या आणि कमवा",
  "sidebar.voteEarnDesc": "स्पर्धा प्रवेशिकांवर मत द्या आणि वॉलेट क्रेडिट्स कमवा!",
  "sidebar.startVoting": "मतदान सुरू करा",
  "sidebar.trending": "या आठवड्यातील ट्रेंडिंग",
  "sidebar.latestJournal": "जर्नलमधील नवीनतम",
  "sidebar.readMore": "अधिक वाचा",
  "sidebar.peopleYouMayKnow": "तुम्हाला माहीत असू शकतील अशा व्यक्ती",
};

const gu: Dict = {
  "nav.competitions": "સ્પર્ધાઓ",
  "nav.journal": "જર્નલ",
  "nav.courses": "કોર્સ",
  "nav.winners": "વિજેતાઓ",
  "nav.login": "લૉગ ઇન",
  "nav.join": "જોડાઓ",
  "feed.newsFeed": "ન્યૂઝ ફીડ",
  "feed.yourFeed": "તમારી ફીડ",
  "composer.placeholder": "તમારા મનમાં શું છે?",
  "composer.addPhoto": "ફોટો ઉમેરો",
  "composer.dragDrop": "અથવા ખેંચીને મૂકો",
  "composer.excludeSearch": "આ પોસ્ટને સર્ચ એન્જિનથી બાકાત રાખો",
  "post.comment": "ટિપ્પણી",
  "post.share": "શેર કરો",
  "sidebar.voteEarn": "મત આપો અને કમાઓ",
  "sidebar.voteEarnDesc": "સ્પર્ધા એન્ટ્રીઓ પર મત આપો અને વૉલેટ ક્રેડિટ્સ કમાઓ!",
  "sidebar.startVoting": "મતદાન શરૂ કરો",
  "sidebar.trending": "આ અઠવાડિયે ટ્રેન્ડિંગ",
  "sidebar.latestJournal": "જર્નલમાંથી નવીનતમ",
  "sidebar.readMore": "વધુ વાંચો",
  "sidebar.peopleYouMayKnow": "તમે જાણતા હો તેવા લોકો",
};

const ta: Dict = {
  "nav.competitions": "போட்டிகள்",
  "nav.journal": "இதழ்",
  "nav.courses": "படிப்புகள்",
  "nav.winners": "வெற்றியாளர்கள்",
  "nav.login": "உள்நுழைக",
  "nav.join": "இணையுங்கள்",
  "feed.newsFeed": "செய்தி ஊட்டம்",
  "feed.yourFeed": "உங்கள் ஊட்டம்",
  "composer.placeholder": "உங்கள் மனதில் என்ன?",
  "composer.addPhoto": "புகைப்படம் சேர்க்கவும்",
  "composer.dragDrop": "அல்லது இழுத்து விடவும்",
  "composer.excludeSearch": "இந்த இடுகையை தேடுபொறிகளிலிருந்து விலக்கவும்",
  "post.comment": "கருத்து",
  "post.share": "பகிர்",
  "sidebar.voteEarn": "வாக்களித்து சம்பாதியுங்கள்",
  "sidebar.voteEarnDesc": "போட்டி பதிவுகளுக்கு வாக்களித்து வாலட் கிரெடிட்களைப் பெறுங்கள்!",
  "sidebar.startVoting": "வாக்களிப்பைத் தொடங்கு",
  "sidebar.trending": "இந்த வாரம் பிரபலமானவை",
  "sidebar.latestJournal": "இதழிலிருந்து சமீபத்தியவை",
  "sidebar.readMore": "மேலும் படிக்க",
  "sidebar.peopleYouMayKnow": "உங்களுக்குத் தெரிந்தவர்கள்",
};

const te: Dict = {
  "nav.competitions": "పోటీలు",
  "nav.journal": "జర్నల్",
  "nav.courses": "కోర్సులు",
  "nav.winners": "విజేతలు",
  "nav.login": "లాగిన్",
  "nav.join": "చేరండి",
  "feed.newsFeed": "న్యూస్ ఫీడ్",
  "feed.yourFeed": "మీ ఫీడ్",
  "composer.placeholder": "మీ మనసులో ఏముంది?",
  "composer.addPhoto": "ఫోటో జోడించండి",
  "composer.dragDrop": "లేదా లాగి వదలండి",
  "composer.excludeSearch": "ఈ పోస్ట్‌ను సెర్చ్ ఇంజిన్‌ల నుండి మినహాయించండి",
  "post.comment": "వ్యాఖ్య",
  "post.share": "షేర్ చేయండి",
  "sidebar.voteEarn": "ఓటు వేసి సంపాదించండి",
  "sidebar.voteEarnDesc": "పోటీ ఎంట్రీలపై ఓటు వేసి వాలెట్ క్రెడిట్‌లను సంపాదించండి!",
  "sidebar.startVoting": "ఓటింగ్ ప్రారంభించండి",
  "sidebar.trending": "ఈ వారం ట్రెండింగ్",
  "sidebar.latestJournal": "జర్నల్ నుండి తాజావి",
  "sidebar.readMore": "మరింత చదవండి",
  "sidebar.peopleYouMayKnow": "మీకు తెలిసిన వ్యక్తులు",
};

export const translations: Record<Lang, Dict> = { en, hi, bn, mr, gu, ta, te };

/** Top-nav labels come from the DB; map the known English ones to keys so they
 *  translate too. Unknown labels fall through to their original text. */
const NAV_LABEL_MAP: Record<string, string> = {
  Competitions: "nav.competitions",
  Journal: "nav.journal",
  Courses: "nav.courses",
  Winners: "nav.winners",
};

export const navKeyForLabel = (label: string): string | null => NAV_LABEL_MAP[label] || null;
