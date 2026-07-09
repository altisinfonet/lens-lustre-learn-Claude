// Profile completion calculator
// Each section has a weight. Total = 100%

interface ProfileFields {
  avatar_url?: string | null;
  full_name?: string | null;
  bio?: string | null;
  portfolio_url?: string | null;
  photography_interests?: string[] | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  website_url?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}

interface CompletionSection {
  label: string;
  percentage: number;
  completed: boolean;
}

export function calcProfileCompletion(p: ProfileFields): {
  total: number;
  sections: CompletionSection[];
} {
  const sections: CompletionSection[] = [
    { label: "Profile Picture", percentage: 5, completed: !!p.avatar_url },
    { label: "Full Name", percentage: 10, completed: !!p.full_name?.trim() },
    { label: "Bio", percentage: 8, completed: !!p.bio?.trim() },
    { label: "Portfolio URL", percentage: 5, completed: !!p.portfolio_url?.trim() },
    { label: "Photography Interests", percentage: 7, completed: !!(p.photography_interests && p.photography_interests.length > 0) },
    { label: "Social Media", percentage: 5, completed: !!(p.facebook_url || p.instagram_url || p.website_url) },
    { label: "Address", percentage: 10, completed: !!(p.address_line1?.trim() && p.city?.trim() && p.state?.trim() && p.country?.trim()) },
    { label: "Postal Code", percentage: 5, completed: !!p.postal_code?.trim() },
    { label: "Phone Number", percentage: 15, completed: !!p.phone?.trim() },
    { label: "WhatsApp Number", percentage: 10, completed: !!p.whatsapp?.trim() },
  ];

  const total = sections.reduce((sum, s) => sum + (s.completed ? s.percentage : 0), 0);
  return { total, sections };
}

export const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Argentina", "Australia", "Austria",
  "Bangladesh", "Belgium", "Bhutan", "Bolivia", "Brazil", "Cambodia", "Cameroon",
  "Canada", "Chile", "China", "Colombia", "Congo", "Costa Rica", "Croatia",
  "Cuba", "Czech Republic", "Denmark", "Ecuador", "Egypt", "Ethiopia",
  "Finland", "France", "Germany", "Ghana", "Greece", "Guatemala",
  "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
  "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
  "Kenya", "Kuwait", "Laos", "Latvia", "Lebanon", "Libya", "Lithuania",
  "Malaysia", "Maldives", "Mexico", "Mongolia", "Morocco", "Myanmar",
  "Nepal", "Netherlands", "New Zealand", "Nigeria", "Norway", "Oman",
  "Pakistan", "Palestine", "Panama", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia",
  "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "Somalia",
  "South Africa", "South Korea", "Spain", "Sri Lanka", "Sudan", "Sweden",
  "Switzerland", "Syria", "Taiwan", "Tanzania", "Thailand", "Tunisia",
  "Turkey", "UAE", "Uganda", "Ukraine", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];
