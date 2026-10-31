// Cascading country → state → city data
// Covers major countries; extend as needed

export const COUNTRY_STATE_CITY: Record<string, Record<string, string[]>> = {
  India: {
    "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Tirupati"],
    "Arunachal Pradesh": ["Itanagar", "Tawang", "Ziro"],
    Assam: ["Guwahati", "Silchar", "Dibrugarh", "Jorhat"],
    Bihar: ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"],
    Chhattisgarh: ["Raipur", "Bhilai", "Bilaspur", "Korba"],
    Delhi: ["New Delhi", "Delhi"],
    Goa: ["Panaji", "Margao", "Vasco da Gama"],
    Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar"],
    Haryana: ["Gurgaon", "Faridabad", "Panipat", "Ambala", "Karnal"],
    "Himachal Pradesh": ["Shimla", "Manali", "Dharamshala", "Kullu"],
    Jharkhand: ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro"],
    Karnataka: ["Bangalore", "Mysore", "Hubli", "Mangalore", "Belgaum"],
    Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur"],
    "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain"],
    Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Thane"],
    Manipur: ["Imphal", "Thoubal", "Bishnupur"],
    Meghalaya: ["Shillong", "Tura", "Jowai"],
    Mizoram: ["Aizawl", "Lunglei"],
    Nagaland: ["Kohima", "Dimapur", "Mokokchung"],
    Odisha: ["Bhubaneswar", "Cuttack", "Rourkela", "Puri"],
    Punjab: ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Patiala"],
    Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer"],
    Sikkim: ["Gangtok", "Namchi"],
    "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Salem", "Tiruchirappalli"],
    Telangana: ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar"],
    Tripura: ["Agartala", "Udaipur"],
    "Uttar Pradesh": ["Lucknow", "Kanpur", "Agra", "Varanasi", "Allahabad", "Noida", "Ghaziabad"],
    Uttarakhand: ["Dehradun", "Haridwar", "Rishikesh", "Nainital"],
    "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Siliguri", "Asansol"],
  },
  "United States": {
    Alabama: ["Birmingham", "Montgomery", "Huntsville"],
    Alaska: ["Anchorage", "Fairbanks", "Juneau"],
    Arizona: ["Phoenix", "Tucson", "Mesa", "Scottsdale"],
    California: ["Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento"],
    Colorado: ["Denver", "Colorado Springs", "Aurora"],
    Connecticut: ["Hartford", "New Haven", "Stamford"],
    Florida: ["Miami", "Orlando", "Tampa", "Jacksonville"],
    Georgia: ["Atlanta", "Savannah", "Augusta"],
    Illinois: ["Chicago", "Springfield", "Naperville"],
    Massachusetts: ["Boston", "Cambridge", "Worcester"],
    Michigan: ["Detroit", "Grand Rapids", "Ann Arbor"],
    "New York": ["New York City", "Buffalo", "Rochester", "Albany"],
    Ohio: ["Columbus", "Cleveland", "Cincinnati"],
    Pennsylvania: ["Philadelphia", "Pittsburgh", "Harrisburg"],
    Texas: ["Houston", "Dallas", "Austin", "San Antonio", "Fort Worth"],
    Washington: ["Seattle", "Tacoma", "Spokane"],
  },
  "United Kingdom": {
    England: ["London", "Manchester", "Birmingham", "Liverpool", "Leeds", "Bristol"],
    Scotland: ["Edinburgh", "Glasgow", "Aberdeen", "Dundee"],
    Wales: ["Cardiff", "Swansea", "Newport"],
    "Northern Ireland": ["Belfast", "Derry", "Lisburn"],
  },
  Canada: {
    Ontario: ["Toronto", "Ottawa", "Mississauga", "Hamilton"],
    Quebec: ["Montreal", "Quebec City", "Laval"],
    "British Columbia": ["Vancouver", "Victoria", "Surrey"],
    Alberta: ["Calgary", "Edmonton", "Red Deer"],
  },
  Australia: {
    "New South Wales": ["Sydney", "Newcastle", "Wollongong"],
    Victoria: ["Melbourne", "Geelong", "Ballarat"],
    Queensland: ["Brisbane", "Gold Coast", "Cairns"],
    "Western Australia": ["Perth", "Fremantle"],
  },
  Bangladesh: {
    Dhaka: ["Dhaka", "Narayanganj", "Gazipur"],
    Chittagong: ["Chittagong", "Cox's Bazar", "Comilla"],
    Rajshahi: ["Rajshahi", "Bogra"],
    Khulna: ["Khulna", "Jessore"],
    Sylhet: ["Sylhet", "Habiganj"],
  },
  Pakistan: {
    Punjab: ["Lahore", "Faisalabad", "Rawalpindi", "Multan"],
    Sindh: ["Karachi", "Hyderabad", "Sukkur"],
    "Khyber Pakhtunkhwa": ["Peshawar", "Mardan", "Abbottabad"],
    Balochistan: ["Quetta", "Gwadar"],
  },
  Nepal: {
    Bagmati: ["Kathmandu", "Lalitpur", "Bhaktapur"],
    Gandaki: ["Pokhara", "Gorkha"],
    Lumbini: ["Butwal", "Bhairahawa"],
  },
  "Sri Lanka": {
    Western: ["Colombo", "Negombo", "Moratuwa"],
    Central: ["Kandy", "Nuwara Eliya"],
    Southern: ["Galle", "Matara"],
  },
  Germany: {
    Bavaria: ["Munich", "Nuremberg", "Augsburg"],
    Berlin: ["Berlin"],
    Hamburg: ["Hamburg"],
    Hesse: ["Frankfurt", "Wiesbaden"],
    "North Rhine-Westphalia": ["Cologne", "Düsseldorf", "Dortmund", "Essen"],
  },
  France: {
    "Île-de-France": ["Paris", "Versailles", "Boulogne-Billancourt"],
    "Provence-Alpes-Côte d'Azur": ["Marseille", "Nice", "Toulon"],
    "Auvergne-Rhône-Alpes": ["Lyon", "Grenoble", "Saint-Étienne"],
  },
  Japan: {
    Tokyo: ["Tokyo", "Shibuya", "Shinjuku"],
    Osaka: ["Osaka", "Sakai"],
    Hokkaido: ["Sapporo", "Hakodate"],
    Kyoto: ["Kyoto", "Uji"],
  },
  UAE: {
    "Abu Dhabi": ["Abu Dhabi", "Al Ain"],
    Dubai: ["Dubai"],
    Sharjah: ["Sharjah"],
    Ajman: ["Ajman"],
  },
  Singapore: {
    Singapore: ["Singapore"],
  },
  "South Africa": {
    Gauteng: ["Johannesburg", "Pretoria", "Soweto"],
    "Western Cape": ["Cape Town", "Stellenbosch"],
    "KwaZulu-Natal": ["Durban", "Pietermaritzburg"],
  },
};

export function getStatesForCountry(country: string): string[] {
  return Object.keys(COUNTRY_STATE_CITY[country] || {}).sort();
}

export function getCitiesForState(country: string, state: string): string[] {
  return (COUNTRY_STATE_CITY[country]?.[state] || []).sort();
}

export function getCountries(): string[] {
  return Object.keys(COUNTRY_STATE_CITY).sort();
}
