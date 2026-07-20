const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "candidate", "candidates", "for", "from",
  "fresh", "first", "in", "is", "latest", "looking", "me", "month", "months", "newest", "of", "on",
  "or", "profile", "profiles", "recent", "show", "that", "the", "they", "to", "want", "who", "with",
  "year", "years",
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
  { label: "Biology", terms: ["biology"] },
  { label: "English", terms: ["english"] },
  { label: "Computer Science", terms: ["computer science"] },
  { label: "Coding", terms: ["coding", "programming"] },
  { label: "Social Science", terms: ["social science"] },
  { label: "Commerce / Accounts / Economics", terms: ["commerce", "accounts", "accountancy", "economics"] },
  { label: "Academic Operations", terms: ["academic operations", "academic ops"] },
  { label: "Performance Marketing", terms: ["performance marketing"] },
];

const LANGUAGES = ["English", "Hindi", "Malayalam", "Urdu", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Bengali"];
const LOCATIONS = ["Bengaluru", "Bangalore", "Kochi", "New Delhi", "Delhi", "Gurugram", "Gurgaon", "Pune", "Ahmedabad", "Mumbai", "Hyderabad", "Chennai", "Kolkata"];

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

export function parseSearchIntent(query) {
  const normalized = String(query || "").toLowerCase();
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
    track: normalized.includes("non teaching") || normalized.includes("non-teaching")
      ? "Non-teaching"
      : normalized.includes("teacher") || normalized.includes("faculty") || normalized.includes("educator")
        ? "Teacher"
        : "All",
    subjects: unique(findSubjects(query)),
    exams: findExams(query),
    languages: findKnown(query, LANGUAGES),
    locations: unique(locations),
    grades: unique(grades),
    minimumExperienceMonths: experienceMatch ? Number(experienceMatch[1]) * 12 : 0,
    freshestFirst: /fresh|latest|newest|recent/.test(normalized),
    tokens: expandTokens(tokenize(query)),
  };
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
  if (intent.exams.length && !intent.exams.every((exam) => candidateSupportsExam(candidate, exam))) return false;
  if (intent.languages.length && !intent.languages.every((language) => hasTerm(candidate.languages_display, language))) return false;
  const locationText = `${candidate.city || ""} ${candidate.state || ""}`;
  if (intent.locations.length && !intent.locations.some((location) => hasTerm(locationText, location))) return false;
  if (intent.grades.length) {
    const supportedGrades = candidateGradeSet(candidate);
    if (!intent.grades.every((grade) => supportedGrades.has(grade))) return false;
  }
  if (intent.minimumExperienceMonths && Number(candidate.experience_months) < intent.minimumExperienceMonths) return false;
  return true;
}

export function scoreCandidate(candidate, query, intent, now = Date.now()) {
  const haystack = String(candidate.search_text || "").toLowerCase();
  const queryTokens = intent.tokens || expandTokens(tokenize(query));
  const matchedTokens = queryTokens.filter((token) => haystack.includes(token));
  const textScore = queryTokens.length ? Math.round(matchedTokens.length / queryTokens.length * 20) : 16;
  let score = 30 + textScore;
  if (intent.track !== "All") score += 6;
  if (intent.subjects.length) score += 16;
  if (intent.exams.length) score += 18;
  if (intent.languages.length) score += 9;
  if (intent.locations.length) score += 9;
  if (intent.grades.length) score += 12;
  if (intent.minimumExperienceMonths) score += 7;
  const applied = Date.parse(candidate.applied_at || "") || 0;
  const ageDays = Math.max((now - applied) / 86400000, 0);
  const freshness = Math.max(2, Math.round(10 - Math.min(ageDays, 120) / 120 * 8));
  return Math.max(15, Math.min(99, score + freshness));
}

export function describeIntent(intent) {
  const parts = [];
  if (intent.track !== "All") parts.push(intent.track);
  parts.push(...intent.subjects, ...intent.exams, ...intent.locations, ...intent.languages);
  if (intent.grades.length) parts.push(`Grades ${Math.min(...intent.grades)}–${Math.max(...intent.grades)}`);
  if (intent.minimumExperienceMonths) parts.push(`${intent.minimumExperienceMonths}+ months experience`);
  parts.push("fresh profiles first when fit is similar");
  return unique(parts).join(" · ");
}
