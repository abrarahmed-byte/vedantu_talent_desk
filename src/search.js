const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "candidate", "candidates", "for", "from",
  "fresh", "first", "in", "is", "latest", "looking", "me", "month", "months", "newest", "of", "on",
  "or", "profile", "profiles", "recent", "show", "that", "the", "they", "to", "want", "who", "with",
  "year", "years", "have", "has", "had", "work", "worked", "working", "prefer", "preferred", "preferably",
  "ideally", "bonus", "must", "required", "exclude", "excluding", "without", "not", "no", "previous",
  "call", "calls", "called", "contact", "contacted", "view", "views", "teachers",
  "speak", "speaks", "speaking", "teach", "teaches", "taught", "dont", "include", "including",
  "region", "regions", "area", "areas",
  "apply", "applied", "application", "applications", "past", "within", "ago", "but",
  "day", "days", "week", "weeks",
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

const SUBJECT_TERMS = [
  { label: "Mathematics", terms: ["mathematics", "maths", "math"] },
  { label: "Physics", terms: ["physics"] },
  { label: "Chemistry", terms: ["chemistry"] },
  { label: "Biology", terms: ["biology", "bio"] },
  { label: "English", terms: ["english"] },
  { label: "Computer Science", terms: ["computer science"] },
  { label: "Coding", terms: ["coding", "programming"] },
  { label: "Social Science", terms: ["social science"] },
  { label: "Commerce / Accounts / Economics", terms: ["commerce", "accounts", "accountancy", "economics"] },
  { label: "Academic Operations", terms: ["academic operations", "academic ops"] },
  { label: "Performance Marketing", terms: ["performance marketing"] },
];

const LANGUAGES = ["English", "Hindi", "Malayalam", "Urdu", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Bengali"];

const LOCATION_GROUPS = [
  { label: "Andhra Pradesh", terms: ["andhra pradesh", "ap"] },
  { label: "Arunachal Pradesh", terms: ["arunachal pradesh"] },
  { label: "Assam", terms: ["assam"] },
  { label: "Bihar", terms: ["bihar"] },
  { label: "Chhattisgarh", terms: ["chhattisgarh", "chattisgarh"] },
  { label: "Goa", terms: ["goa"] },
  { label: "Gujarat", terms: ["gujarat"] },
  { label: "Haryana", terms: ["haryana"] },
  { label: "Himachal Pradesh", terms: ["himachal pradesh"] },
  { label: "Jharkhand", terms: ["jharkhand"] },
  { label: "Karnataka", terms: ["karnataka"] },
  { label: "Kerala", terms: ["kerala"] },
  { label: "Madhya Pradesh", terms: ["madhya pradesh"] },
  { label: "Maharashtra", terms: ["maharashtra"] },
  { label: "Manipur", terms: ["manipur"] },
  { label: "Meghalaya", terms: ["meghalaya"] },
  { label: "Mizoram", terms: ["mizoram"] },
  { label: "Nagaland", terms: ["nagaland"] },
  { label: "Odisha", terms: ["odisha", "orissa"] },
  { label: "Punjab", terms: ["punjab"] },
  { label: "Rajasthan", terms: ["rajasthan"] },
  { label: "Sikkim", terms: ["sikkim"] },
  { label: "Tamil Nadu", terms: ["tamil nadu"] },
  { label: "Telangana", terms: ["telangana", "ts"] },
  { label: "Tripura", terms: ["tripura"] },
  { label: "Uttar Pradesh", terms: ["uttar pradesh"] },
  { label: "Uttarakhand", terms: ["uttarakhand", "uttaranchal"] },
  { label: "West Bengal", terms: ["west bengal"] },
  { label: "Andaman and Nicobar Islands", terms: ["andaman and nicobar", "andaman nicobar"] },
  { label: "Chandigarh", terms: ["chandigarh"] },
  { label: "Dadra and Nagar Haveli and Daman and Diu", terms: ["dadra and nagar haveli", "daman and diu"] },
  { label: "Delhi", terms: ["new delhi", "delhi", "nct delhi", "ncr"] },
  { label: "Jammu and Kashmir", terms: ["jammu and kashmir", "jammu kashmir"] },
  { label: "Ladakh", terms: ["ladakh"] },
  { label: "Lakshadweep", terms: ["lakshadweep"] },
  { label: "Puducherry", terms: ["puducherry", "pondicherry"] },
  { label: "Bengaluru", terms: ["bengaluru", "bangalore", "blr"] },
  { label: "Gurugram", terms: ["gurugram", "gurgaon"] },
  { label: "Kochi", terms: ["kochi", "cochin"] },
  { label: "Mumbai", terms: ["mumbai", "bombay"] },
  { label: "Chennai", terms: ["chennai", "madras"] },
  { label: "Kolkata", terms: ["kolkata", "calcutta"] },
  { label: "Thiruvananthapuram", terms: ["thiruvananthapuram", "trivandrum"] },
  { label: "Kozhikode", terms: ["kozhikode", "calicut"] },
  { label: "Visakhapatnam", terms: ["visakhapatnam", "vizag"] },
  { label: "Vadodara", terms: ["vadodara", "baroda"] },
  { label: "Mysuru", terms: ["mysuru", "mysore"] },
  { label: "Mangaluru", terms: ["mangaluru", "mangalore"] },
  { label: "Hyderabad", terms: ["hyderabad", "hyd"] },
  ...["Agra", "Ahmedabad", "Amritsar", "Bhopal", "Bhubaneswar", "Coimbatore", "Cuttack", "Dehradun",
    "Faridabad", "Ghaziabad", "Greater Noida", "Guntur", "Guwahati", "Hyderabad", "Indore", "Jaipur",
    "Jamshedpur", "Kanpur", "Lucknow", "Ludhiana", "Madurai", "Meerut", "Mohali", "Nagpur", "Nashik",
    "Navi Mumbai", "Noida", "Patna", "Pune", "Raipur", "Rajkot", "Ranchi", "Secunderabad", "Siliguri",
    "Surat", "Thane", "Thrissur", "Tirupati", "Vadodara", "Varanasi", "Vijayawada", "Warangal"]
    .map((label) => ({ label, terms: [label.toLowerCase()] })),
];

const LOCATION_NOISE = /\b(?:jee|neet|olympiad|foundation|physics|chemistry|mathematics|maths|biology|english|coding|teacher|faculty|educator|grade|grades|class|classes|experience|experienced|expert|skills?|proficient|online|remote)\b/i;

function hasTerm(value, term) {
  const haystack = ` ${String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const needle = ` ${String(term || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return needle.trim() !== "" && haystack.includes(needle);
}

function unique(values) {
  return [...new Set(values)];
}

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
  return [...expanded].slice(0, 22);
}

export function buildFtsQuery(value) {
  const tokens = expandTokens(tokenize(value));
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

function findKnown(query, values) {
  return values.filter((value) => hasTerm(query, value));
}

function locationGroup(value) {
  return LOCATION_GROUPS.find((group) => group.label.toLowerCase() === String(value || "").toLowerCase()
    || group.terms.some((term) => term === String(value || "").toLowerCase()));
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contextualLocations(query) {
  const normalized = String(query || "").toLowerCase().replace(/[()]/g, " ");
  const locations = [];
  const pattern = /\b(?:based\s+in|located\s+in|location\s*(?:is|:)?|city\s*(?:is|:)?|state\s*(?:is|:)?|from|in)\s+([a-z][a-z .'-]{1,70})/g;
  for (const match of normalized.matchAll(pattern)) {
    const prefix = normalized.slice(Math.max(0, match.index - 24), match.index);
    if (/\b(?:experience|experienced|expert|speciali[sz]ed|proficient|skilled|worked|employed)\s*$/.test(prefix)) continue;
    const phrase = match[1].split(/[,;]|\b(?:with|who|that|for|having|and|or|teaching|speaks?|grade|grades|class|classes|board|experience|years?|months?|available|open)\b/)[0].trim();
    if (!phrase || phrase.length > 45 || LOCATION_NOISE.test(phrase)) continue;
    const group = locationGroup(phrase);
    locations.push(group?.label || titleCase(phrase));
  }
  return locations;
}

function findLocations(query) {
  const known = LOCATION_GROUPS.filter((group) => group.terms.some((term) => hasTerm(query, term))).map((group) => group.label);
  return unique([...known, ...contextualLocations(query)]);
}

export function locationSearchTerms(locations) {
  return unique((locations || []).flatMap((location) => {
    const group = locationGroup(location);
    return group ? [group.label, ...group.terms] : [location];
  }).map((value) => String(value || "").toLowerCase()).filter(Boolean));
}

function findSubjects(query) {
  return SUBJECT_TERMS.filter((subject) => subject.terms.some((term) => hasTerm(query, term))).map((subject) => subject.label);
}

function findExams(query) {
  const normalized = String(query || "").toLowerCase();
  const exams = [];
  if (/\bjee\s+advanced\b/.test(normalized)) exams.push("JEE Advanced");
  else if (/\bjee\s+main\b/.test(normalized)) exams.push("JEE Main");
  else if (/\bjee\b/.test(normalized)) exams.push("JEE");
  if (/\bneet(?:\s+ug)?\b/.test(normalized)) exams.push("NEET UG");
  if (/\bolympiad\b|\bntse\b/.test(normalized)) exams.push("Olympiad / NTSE");
  if (/\bfoundation\b/.test(normalized)) exams.push("Foundation");
  return exams;
}

function examMatchMode(query, exams) {
  if ((exams || []).length < 2) return "all";
  const normalized = String(query || "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
  const exam = "(?:jee(?: main| advanced)?|neet(?: ug)?|olympiad|ntse|foundation)";
  return new RegExp(`\\b${exam}\\s*(?:or|/)\\s*${exam}\\b`).test(normalized) ? "any" : "all";
}

function subjectSearchTokens(subjects) {
  return (subjects || []).flatMap((label) => {
    const subject = SUBJECT_TERMS.find((item) => item.label === label);
    return subject ? subject.terms.flatMap(tokenize) : tokenize(label);
  });
}

export function parseSearchIntent(query) {
  const normalized = String(query || "").toLowerCase();
  const locations = findLocations(query);
  const pincodes = unique(normalized.match(/\b[1-9]\d{5}\b/g) || []);
  const gradeMatches = [...normalized.matchAll(/(?:grade|grades|class|classes)\s*(\d{1,2})(?:\s*(?:-|to|–)\s*(\d{1,2}))?/g)];
  const grades = [];
  gradeMatches.forEach((match) => {
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let grade = start; grade <= Math.min(end, 12); grade += 1) grades.push(grade);
  });
  const experienceMatch = normalized.match(/(\d+)\s*(?:\+\s*)?(?:years?|yrs?)/);
  const exams = findExams(query);
  const intent = {
    track: normalized.includes("non teaching") || normalized.includes("non-teaching")
      ? "Non-teaching"
      : normalized.includes("teacher") || normalized.includes("faculty") || normalized.includes("educator")
        ? "Teacher"
        : "All",
    subjects: unique(findSubjects(query)),
    exams,
    examMatchMode: examMatchMode(query, exams),
    languages: findKnown(query, LANGUAGES),
    locations: unique(locations),
    locationMatchMode: locations.length > 1 ? "any" : "all",
    pincodes,
    grades: unique(grades),
    minimumExperienceMonths: experienceMatch ? Number(experienceMatch[1]) * 12 : 0,
    freshestFirst: /fresh|latest|newest|recent/.test(normalized),
    tokens: expandTokens(tokenize(query)),
  };
  const knownTokens = new Set([
    ...tokenize(intent.track),
    ...subjectSearchTokens(intent.subjects),
    ...intent.exams.flatMap((value) => tokenize(value)),
    ...intent.languages.flatMap((value) => tokenize(value)),
    ...locationSearchTerms(intent.locations).flatMap((value) => tokenize(value)),
    ...intent.pincodes,
    ...intent.grades.map(String),
    "teacher", "teaching", "faculty", "educator", "jee", "iit", "neet", "olympiad", "ntse", "foundation",
    "grade", "grades", "class", "classes", "experience", "experienced", "year", "years", "month", "months",
  ]);
  intent.keywords = unique(tokenize(query).filter((token) => !knownTokens.has(token)));
  return intent;
}

function candidateGradeSet(candidate) {
  const value = String(candidate.grades_display || "").toLowerCase();
  const grades = new Set();
  for (const match of value.matchAll(/(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})/g)) {
    const start = Number(match[1]);
    const end = Math.min(12, Number(match[2]));
    for (let grade = start; grade <= end; grade += 1) grades.add(grade);
  }
  for (const match of value.matchAll(/\b(\d{1,2})\b/g)) {
    const grade = Number(match[1]);
    if (grade >= 1 && grade <= 12) grades.add(grade);
  }
  if (/\bjee\b|\bneet\b/.test(value)) { grades.add(11); grades.add(12); }
  if (/\bfoundation\b/.test(value)) { grades.add(8); grades.add(9); grades.add(10); }
  return grades;
}

function candidateSupportsExam(candidate, exam) {
  const value = `${candidate.grades_display || ""} ${candidate.role || ""}`;
  if (exam === "JEE") return hasTerm(value, "jee") || hasTerm(value, "jee main") || hasTerm(value, "jee advanced");
  if (exam === "JEE Main") return hasTerm(value, "jee main");
  if (exam === "JEE Advanced") return hasTerm(value, "jee advanced");
  if (exam === "NEET UG") return hasTerm(value, "neet") || hasTerm(value, "neet ug");
  if (exam === "Olympiad / NTSE") return hasTerm(value, "olympiad") || hasTerm(value, "ntse");
  if (exam === "Foundation") return hasTerm(value, "foundation");
  return false;
}

export function matchesMandatoryIntent(candidate, intent) {
  if (intent.track !== "All" && candidate.track !== intent.track) return false;
  const subjectText = `${candidate.subject_display || ""} ${candidate.role || ""}`;
  if (intent.subjects.length && !intent.subjects.some((subject) => hasTerm(subjectText, subject))) return false;
  if (intent.exams.length) {
    const matchesExam = intent.examMatchMode === "any"
      ? intent.exams.some((exam) => candidateSupportsExam(candidate, exam))
      : intent.exams.every((exam) => candidateSupportsExam(candidate, exam));
    if (!matchesExam) return false;
  }
  if (intent.languages.length && !intent.languages.every((language) => hasTerm(candidate.languages_display, language))) return false;
  const locationText = `${candidate.city || ""} ${candidate.state || ""}`;
  if (intent.locations.length && !locationSearchTerms(intent.locations).some((location) => hasTerm(locationText, location))) return false;
  if (intent.pincodes?.length && !intent.pincodes.every((pincode) => hasTerm(candidate.search_text, pincode))) return false;
  if (intent.grades.length) {
    const supportedGrades = candidateGradeSet(candidate);
    if (!intent.grades.every((grade) => supportedGrades.has(grade))) return false;
  }
  if (intent.minimumExperienceMonths && Number(candidate.experience_months) < intent.minimumExperienceMonths) return false;
  return true;
}

export function scoreCandidate(candidate, query, intent, now = Date.now(), options = {}) {
  const haystack = String(candidate.search_text || "").toLowerCase();
  const queryTokens = intent.tokens || expandTokens(tokenize(query));
  const suppliedHits = Number(candidate.search_token_hits);
  const matchedCount = Number.isFinite(suppliedHits)
    ? Math.max(0, Math.min(queryTokens.length, suppliedHits))
    : queryTokens.filter((token) => haystack.includes(token)).length;
  const textScore = queryTokens.length ? Math.round(matchedCount / queryTokens.length * 20) : 16;
  let score = 30 + textScore;
  if (intent.track !== "All") score += 6;
  if (intent.subjects.length) score += 16;
  if (intent.exams.length) score += 18;
  if (intent.languages.length) score += 9;
  if (intent.locations.length) score += 9;
  if (intent.pincodes?.length) score += 7;
  if (intent.grades.length) score += 12;
  if (intent.minimumExperienceMonths) score += 7;
  const applied = Date.parse(candidate.applied_at || "") || 0;
  const ageDays = Math.max((now - applied) / 86400000, 0);
  const decayDays = Math.max(0, Number(options.freshnessDecayDays ?? 120));
  const freshnessWeight = Math.max(0, Math.min(3, Number(options.freshnessWeight ?? 1)));
  const freshness = !decayDays || !freshnessWeight ? 0 : Math.round(Math.max(0, 10 - ageDays / decayDays * 10) * freshnessWeight);
  return Math.max(15, Math.min(99, score + freshness));
}

export function describeIntent(intent) {
  const parts = [];
  if (intent.track !== "All") parts.push(intent.track);
  parts.push(...intent.subjects, ...intent.exams, ...intent.locations, ...intent.languages);
  if (intent.pincodes?.length) parts.push(...intent.pincodes.map((pincode) => `Pincode ${pincode}`));
  if (intent.grades.length) parts.push(`Grades ${Math.min(...intent.grades)}–${Math.max(...intent.grades)}`);
  if (intent.minimumExperienceMonths) parts.push(`${intent.minimumExperienceMonths}+ months experience`);
  if (intent.keywords?.length) parts.push(`Keywords: ${intent.keywords.join(", ")}`);
  parts.push("fresh profiles first when fit is similar");
  return unique(parts).join(" · ");
}
