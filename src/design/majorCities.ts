// A built-in list of major cities, used only when the online place search
// cannot be reached.
//
// WHY. Every place search goes to Photon (and Nominatim as its fallback) over
// the network. On a network that blocks them -- a campus firewall, a projector
// laptop on guest Wi-Fi -- the search box found nothing at all, and nothing in
// the planner can start without a site. These cities cover the data-centre
// and cable hubs the tool is most likely to be demonstrated with, so a session
// can go ahead offline. Coordinates are city centres.
import type { GeocodeResult } from "./geocoding";

interface City {
  name: string;
  country: string;
  code: string;
  lat: number;
  lng: number;
  /** Other names people type: "Bangalore" for Bengaluru, "Bombay" for Mumbai. */
  aka?: string[];
}

const CITIES: City[] = [
  // India
  { name: "Mumbai", country: "India", code: "in", lat: 19.076, lng: 72.8777, aka: ["Bombay"] },
  { name: "Delhi", country: "India", code: "in", lat: 28.6139, lng: 77.209, aka: ["New Delhi"] },
  { name: "Bengaluru", country: "India", code: "in", lat: 12.9716, lng: 77.5946, aka: ["Bangalore"] },
  { name: "Chennai", country: "India", code: "in", lat: 13.0827, lng: 80.2707, aka: ["Madras"] },
  { name: "Hyderabad", country: "India", code: "in", lat: 17.385, lng: 78.4867 },
  { name: "Kolkata", country: "India", code: "in", lat: 22.5726, lng: 88.3639, aka: ["Calcutta"] },
  { name: "Pune", country: "India", code: "in", lat: 18.5204, lng: 73.8567 },
  { name: "Ahmedabad", country: "India", code: "in", lat: 23.0225, lng: 72.5714 },
  { name: "Kochi", country: "India", code: "in", lat: 9.9312, lng: 76.2673, aka: ["Cochin"] },
  { name: "Visakhapatnam", country: "India", code: "in", lat: 17.6868, lng: 83.2185, aka: ["Vizag"] },
  { name: "Noida", country: "India", code: "in", lat: 28.5355, lng: 77.391 },
  { name: "Jaipur", country: "India", code: "in", lat: 26.9124, lng: 75.7873 },
  // Rest of Asia
  { name: "Singapore", country: "Singapore", code: "sg", lat: 1.3521, lng: 103.8198 },
  { name: "Tokyo", country: "Japan", code: "jp", lat: 35.6762, lng: 139.6503 },
  { name: "Osaka", country: "Japan", code: "jp", lat: 34.6937, lng: 135.5023 },
  { name: "Seoul", country: "South Korea", code: "kr", lat: 37.5665, lng: 126.978 },
  { name: "Hong Kong", country: "Hong Kong", code: "hk", lat: 22.3193, lng: 114.1694 },
  { name: "Shanghai", country: "China", code: "cn", lat: 31.2304, lng: 121.4737 },
  { name: "Beijing", country: "China", code: "cn", lat: 39.9042, lng: 116.4074 },
  { name: "Shenzhen", country: "China", code: "cn", lat: 22.5431, lng: 114.0579 },
  { name: "Taipei", country: "Taiwan", code: "tw", lat: 25.033, lng: 121.5654 },
  { name: "Bangkok", country: "Thailand", code: "th", lat: 13.7563, lng: 100.5018 },
  { name: "Jakarta", country: "Indonesia", code: "id", lat: -6.2088, lng: 106.8456 },
  { name: "Kuala Lumpur", country: "Malaysia", code: "my", lat: 3.139, lng: 101.6869 },
  { name: "Manila", country: "Philippines", code: "ph", lat: 14.5995, lng: 120.9842 },
  { name: "Ho Chi Minh City", country: "Vietnam", code: "vn", lat: 10.8231, lng: 106.6297, aka: ["Saigon"] },
  { name: "Hanoi", country: "Vietnam", code: "vn", lat: 21.0278, lng: 105.8342 },
  { name: "Dhaka", country: "Bangladesh", code: "bd", lat: 23.8103, lng: 90.4125 },
  { name: "Karachi", country: "Pakistan", code: "pk", lat: 24.8607, lng: 67.0011 },
  { name: "Colombo", country: "Sri Lanka", code: "lk", lat: 6.9271, lng: 79.8612 },
  // Middle East
  { name: "Dubai", country: "United Arab Emirates", code: "ae", lat: 25.2048, lng: 55.2708 },
  { name: "Abu Dhabi", country: "United Arab Emirates", code: "ae", lat: 24.4539, lng: 54.3773 },
  { name: "Riyadh", country: "Saudi Arabia", code: "sa", lat: 24.7136, lng: 46.6753 },
  { name: "Jeddah", country: "Saudi Arabia", code: "sa", lat: 21.4858, lng: 39.1925 },
  { name: "Doha", country: "Qatar", code: "qa", lat: 25.2854, lng: 51.531 },
  { name: "Muscat", country: "Oman", code: "om", lat: 23.588, lng: 58.3829 },
  { name: "Tel Aviv", country: "Israel", code: "il", lat: 32.0853, lng: 34.7818 },
  { name: "Istanbul", country: "Turkey", code: "tr", lat: 41.0082, lng: 28.9784 },
  // Europe
  { name: "London", country: "United Kingdom", code: "gb", lat: 51.5074, lng: -0.1278 },
  { name: "Paris", country: "France", code: "fr", lat: 48.8566, lng: 2.3522 },
  { name: "Marseille", country: "France", code: "fr", lat: 43.2965, lng: 5.3698 },
  { name: "Frankfurt", country: "Germany", code: "de", lat: 50.1109, lng: 8.6821 },
  { name: "Berlin", country: "Germany", code: "de", lat: 52.52, lng: 13.405 },
  { name: "Amsterdam", country: "Netherlands", code: "nl", lat: 52.3676, lng: 4.9041 },
  { name: "Dublin", country: "Ireland", code: "ie", lat: 53.3498, lng: -6.2603 },
  { name: "Madrid", country: "Spain", code: "es", lat: 40.4168, lng: -3.7038 },
  { name: "Barcelona", country: "Spain", code: "es", lat: 41.3874, lng: 2.1686 },
  { name: "Lisbon", country: "Portugal", code: "pt", lat: 38.7223, lng: -9.1393 },
  { name: "Milan", country: "Italy", code: "it", lat: 45.4642, lng: 9.19 },
  { name: "Rome", country: "Italy", code: "it", lat: 41.9028, lng: 12.4964 },
  { name: "Stockholm", country: "Sweden", code: "se", lat: 59.3293, lng: 18.0686 },
  { name: "Oslo", country: "Norway", code: "no", lat: 59.9139, lng: 10.7522 },
  { name: "Copenhagen", country: "Denmark", code: "dk", lat: 55.6761, lng: 12.5683 },
  { name: "Helsinki", country: "Finland", code: "fi", lat: 60.1699, lng: 24.9384 },
  { name: "Warsaw", country: "Poland", code: "pl", lat: 52.2297, lng: 21.0122 },
  { name: "Zurich", country: "Switzerland", code: "ch", lat: 47.3769, lng: 8.5417 },
  { name: "Brussels", country: "Belgium", code: "be", lat: 50.8503, lng: 4.3517 },
  { name: "Vienna", country: "Austria", code: "at", lat: 48.2082, lng: 16.3738 },
  { name: "Athens", country: "Greece", code: "gr", lat: 37.9838, lng: 23.7275 },
  { name: "Moscow", country: "Russia", code: "ru", lat: 55.7558, lng: 37.6173 },
  // Africa
  { name: "Cairo", country: "Egypt", code: "eg", lat: 30.0444, lng: 31.2357 },
  { name: "Lagos", country: "Nigeria", code: "ng", lat: 6.5244, lng: 3.3792 },
  { name: "Nairobi", country: "Kenya", code: "ke", lat: -1.2921, lng: 36.8219 },
  { name: "Mombasa", country: "Kenya", code: "ke", lat: -4.0435, lng: 39.6682 },
  { name: "Johannesburg", country: "South Africa", code: "za", lat: -26.2041, lng: 28.0473 },
  { name: "Cape Town", country: "South Africa", code: "za", lat: -33.9249, lng: 18.4241 },
  { name: "Casablanca", country: "Morocco", code: "ma", lat: 33.5731, lng: -7.5898 },
  { name: "Accra", country: "Ghana", code: "gh", lat: 5.6037, lng: -0.187 },
  { name: "Djibouti", country: "Djibouti", code: "dj", lat: 11.5721, lng: 43.1456 },
  // Americas
  { name: "New York", country: "United States", code: "us", lat: 40.7128, lng: -74.006, aka: ["NYC"] },
  { name: "Los Angeles", country: "United States", code: "us", lat: 34.0522, lng: -118.2437, aka: ["LA"] },
  { name: "San Francisco", country: "United States", code: "us", lat: 37.7749, lng: -122.4194 },
  { name: "Seattle", country: "United States", code: "us", lat: 47.6062, lng: -122.3321 },
  { name: "Chicago", country: "United States", code: "us", lat: 41.8781, lng: -87.6298 },
  { name: "Miami", country: "United States", code: "us", lat: 25.7617, lng: -80.1918 },
  { name: "Dallas", country: "United States", code: "us", lat: 32.7767, lng: -96.797 },
  { name: "Ashburn", country: "United States", code: "us", lat: 39.0438, lng: -77.4874 },
  { name: "Virginia Beach", country: "United States", code: "us", lat: 36.8529, lng: -75.978 },
  { name: "Honolulu", country: "United States", code: "us", lat: 21.3069, lng: -157.8583 },
  { name: "Toronto", country: "Canada", code: "ca", lat: 43.6532, lng: -79.3832 },
  { name: "Montreal", country: "Canada", code: "ca", lat: 45.5019, lng: -73.5674 },
  { name: "Vancouver", country: "Canada", code: "ca", lat: 49.2827, lng: -123.1207 },
  { name: "Mexico City", country: "Mexico", code: "mx", lat: 19.4326, lng: -99.1332 },
  { name: "Panama City", country: "Panama", code: "pa", lat: 8.9824, lng: -79.5199 },
  { name: "Bogotá", country: "Colombia", code: "co", lat: 4.711, lng: -74.0721, aka: ["Bogota"] },
  { name: "Lima", country: "Peru", code: "pe", lat: -12.0464, lng: -77.0428 },
  { name: "São Paulo", country: "Brazil", code: "br", lat: -23.5505, lng: -46.6333, aka: ["Sao Paulo"] },
  { name: "Rio de Janeiro", country: "Brazil", code: "br", lat: -22.9068, lng: -43.1729 },
  { name: "Fortaleza", country: "Brazil", code: "br", lat: -3.7319, lng: -38.5267 },
  { name: "Buenos Aires", country: "Argentina", code: "ar", lat: -34.6037, lng: -58.3816 },
  { name: "Santiago", country: "Chile", code: "cl", lat: -33.4489, lng: -70.6693 },
  // Oceania
  { name: "Sydney", country: "Australia", code: "au", lat: -33.8688, lng: 151.2093 },
  { name: "Melbourne", country: "Australia", code: "au", lat: -37.8136, lng: 144.9631 },
  { name: "Perth", country: "Australia", code: "au", lat: -31.9505, lng: 115.8605 },
  { name: "Auckland", country: "New Zealand", code: "nz", lat: -36.8485, lng: 174.7633 },
];

/** Lowercase, accents removed: "São Paulo" and "sao paulo" match. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Built-in cities matching `query`: names that start with it first, then names
 * with a word that does, up to `limit`. Marked offline so the search box can
 * say where the suggestions came from.
 */
export function searchMajorCities(query: string, limit = 5): GeocodeResult[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const scored: { city: City; rank: number }[] = [];
  for (const city of CITIES) {
    const names = [city.name, ...(city.aka ?? [])].map(fold);
    let rank = Infinity;
    for (const n of names) {
      if (n.startsWith(q)) rank = Math.min(rank, 0);
      else if (n.split(/[\s-]+/).some((w) => w.startsWith(q))) rank = Math.min(rank, 1);
    }
    if (rank !== Infinity) scored.push({ city, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.city.name.localeCompare(b.city.name))
    .slice(0, limit)
    .map(({ city }) => ({
      displayName: city.name === city.country ? city.name : `${city.name}, ${city.country}`,
      country: city.country,
      countryCode: city.code,
      lat: city.lat,
      lng: city.lng,
      offline: true,
    }));
}
