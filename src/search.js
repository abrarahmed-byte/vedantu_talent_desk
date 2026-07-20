const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "candidate", "candidates", "for", "from",
  "in", "is", "looking", "me", "of", "on", "or", "profile", "profiles", "show", "that", "the",
  "they", "to", "want", "who", "with", "years", "year", "months", "month",
]);

const SYNONYMS = {
  maths: ["mathematics"],
  math: ["mathematics"],
  bangalore: ["bengaluru"],
  gurgaon: ["gurugram"],
  teacher: ["faculty", "educator"],
  faculty: ["teacher", "educator"],
  grade: ["class"],
  grades: ["class"],
  remote: ["online"],
  online: ["remote"],
  ops: ["operations"],
  marketing: ["growth"],
};

const SUBJECTS = ["Mathematics", "Physics", "English", "Academic Operations", "Performance Marketing"];
const LANGUAGES = ["English", "Hindi", "Malayalam", "Urdu", "Marathi", "Gujarati"];
const LOCATIONS = ["Bengaluru", "Bangalore", "Kochi", "New Delhi", "Delhi", "Gurugram", "Gurgaon", "Pune", "Ahmedabad"];

export function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function expandTokens(tokens) {
  const expanded = new Set(tokens);
  tokens.forEach((token) => (SYNONYMS[token] || []).forEach((value) => expanded.add(value)));
  return [...expanded].slice(0, 18);
}

export function buildFtsQuery(value) {
  const tokens = expandTokens(tokenize(value));
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

function findKnown(query, values) {
  const normalized = String(query || "").toLowerCase();
  return values.filter((value) => normalized.includes(value.toLowerCase()));
}

export function parseSearchIntent(query) {
  const normalized = String(query || "").toLowerCase();
  const subjects = findKnown(query, SUBJECTS);
  if ((normalized.includes("maths") || normalized.includes("math ")) && !subjects.includes("Mathematics")) subjects.push("Mathematics");
  const locations = findKnown(query, LOCATIONS).map((value) => value === "Bangalore" ? "Bengaluru" : value === "Gurgaon" ? "Gurugram" : value);
  const gradeMatches = [...normalized.matchAll(/(?:grade|grades|class|classes)\s*(\d{1,2})(?:\s*(?:-|to|–)\s*(\d{1,2}))?/g)];
  const grades = [];
  gradeMatches.forEach((match) => {
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let grade = start; grade <= Math.min(end, 12); grade += 1) grades.push(grade);
  });
  const experienceMatch = normalized.match(/(\d+)\s*(?:\+\s*)?(?:years?|yrs?)/);
  return {
    track: normalized.includes("non teaching") || normalized.includes("non-teaching") ? "Non-teaching" : normalized.includes("teacher") || normalized.includes("faculty") ? "Teacher" : "All",
    subjects: [...new Set(subjects)],
    languages: findKnown(query, LANGUAGES),
    locations: [...new Set(locations)],
    grades: [...new Set(grades)],
    minimumExperienceMonths: experienceMatch ? Number(experienceMatch[1]) * 12 : 0,
    freshestFirst: /fresh|latest|newest|recent/.test(normalized),
    tokens: expandTokens(tokenize(query)),
  };
}

export function scoreCandidate(candidate, query, intent, now = Date.now()) {
  const haystack = String(candidate.search_text || "").toLowerCase();
  const queryTokens = intent.tokens || expandTokens(tokenize(query));
  const matchedTokens = queryTokens.filter((token) => haystack.includes(token));
  const textScore = queryTokens.length ? Math.round(matchedTokens.length / queryTokens.length * 30) : 28;
  let structured = 8;
  if (intent.track !== "All") structured += candidate.track === intent.track ? 8 : -15;
  if (intent.subjects.length) structured += intent.subjects.some((value) => haystack.includes(value.toLowerCase())) ? 12 : -16;
  if (intent.languages.length) structured += intent.languages.every((value) => haystack.includes(value.toLowerCase())) ? 7 : -8;
  if (intent.locations.length) structured += intent.locations.some((value) => haystack.includes(value.toLowerCase())) ? 12 : -12;
  if (intent.grades.length) structured += intent.grades.some((grade) => haystack.includes(String(grade))) ? 8 : -6;
  if (intent.minimumExperienceMonths) structured += Number(candidate.experience_months) >= intent.minimumExperienceMonths ? 6 : -10;
  const applied = Date.parse(candidate.applied_at || "") || 0;
  const ageDays = Math.max((now - applied) / 86400000, 0);
  const freshness = Math.max(3, Math.round(15 - Math.min(ageDays, 90) / 90 * 12));
  return Math.max(25, Math.min(99, textScore + structured + freshness + 8));
}

export function describeIntent(intent) {
  const parts = [];
  if (intent.track !== "All") parts.push(intent.track);
  parts.push(...intent.subjects, ...intent.locations, ...intent.languages);
  if (intent.grades.length) parts.push(`Grades ${Math.min(...intent.grades)}–${Math.max(...intent.grades)}`);
  if (intent.minimumExperienceMonths) parts.push(`${intent.minimumExperienceMonths}+ months experience`);
  parts.push("fresh profiles first when fit is similar");
  return [...new Set(parts)].join(" · ");
}
