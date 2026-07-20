const SUBJECT_TAXONOMY = [
  ["Mathematics", ["mathematics", "maths", "math"]],
  ["Physics", ["physics"]],
  ["Chemistry", ["chemistry", "biochemistry"]],
  ["Biology", ["biology", "botany", "zoology", "biotechnology", "microbiology", "anatomy", "physiology", "genetics"]],
  ["General Science", ["general science", "basic science", "science upto", "science up to", "science for class"]],
  ["Environmental Science / EVS", ["environmental science", "environment science", "environmental biology", "ecology", "e.v.s", "evs"]],
  ["English", ["english"]],
  ["Hindi", ["hindi"]],
  ["Sanskrit", ["sanskrit"]],
  ["Regional Languages", ["bengali", "assamese", "kannada", "malayalam", "marathi", "odia", "oriya", "punjabi", "tamil", "telugu", "urdu"]],
  ["Social Science", ["social science", "social studies", "civics"]],
  ["History", ["history"]],
  ["Geography", ["geography"]],
  ["Political Science", ["political science"]],
  ["Psychology / Sociology", ["psychology", "sociology"]],
  ["Computer Science & Coding", ["computer science", "computer basics", "coding", "programming", "cyber security", "artificial intelligence", "robotics", "c++"]],
  ["Commerce", ["commerce"]],
  ["Accountancy", ["accountancy", "accounts"]],
  ["Economics", ["economics"]],
  ["Business Studies", ["business studies", "business study"]],
  ["Statistics", ["statistics", "biostatistics"]],
  ["JEE", ["jee main", "jee advanced", "jee"]],
  ["NEET", ["neet"]],
  ["Olympiad", ["olympiad"]],
  ["Foundation", ["foundation"]],
  ["CUET", ["cuet"]],
  ["UPSC / Competitive Exams", ["upsc", "competitive exam", "general knowledge"]],
  ["Early Years", ["early years", "pre-primary", "preschool", "kindergarten"]],
  ["Communication / Public Speaking", ["public speaking", "communication skill", "spoken english"]],
  ["Art & Craft", ["art and craft", "arts and crafts", "art & craft", "painting", "craft"]],
  ["Music", ["music"]],
  ["Chess", ["chess"]],
  ["Abacus", ["abacus"]],
  ["Academic Operations", ["academic operations", "academic operation"]],
  ["Sales", ["sales", "business development"]],
  ["Performance Marketing", ["performance marketing"]],
  ["Marketing", ["marketing", "brand", "growth"]],
  ["Talent Acquisition / Recruitment", ["talent acquisition", "recruitment", "recruiter"]],
  ["Human Resources / People", ["human resources", "people operations", "hr operations"]],
  ["Customer Support / Success", ["customer support", "customer success", "learner support"]],
  ["Operations", ["business operations", "sales operations", "program operations", "centre operations", "center operations", "operations lead", "operations executive"]],
  ["Product", ["product manager", "product management"]],
  ["Engineering / Technology", ["software engineer", "technology", "developer", "engineering"]],
  ["Data / Analytics", ["data analytics", "data science", "business analyst", "analytics"]],
  ["Finance", ["finance", "financial", "audit", "tax"]],
  ["Content / Curriculum", ["content", "curriculum", "instructional design"]],
  ["Design / Creative", ["graphic design", "visual design", "creative"]],
];

const LANGUAGE_TAXONOMY = [
  ["English", ["english"]], ["Hindi", ["hindi"]], ["Hinglish", ["hinglish"]],
  ["Bengali", ["bengali", "bangla"]], ["Telugu", ["telugu"]], ["Marathi", ["marathi"]],
  ["Tamil", ["tamil"]], ["Urdu", ["urdu"]], ["Gujarati", ["gujarati"]],
  ["Kannada", ["kannada"]], ["Malayalam", ["malayalam"]], ["Odia", ["odia", "oriya"]],
  ["Punjabi", ["punjabi"]], ["Assamese", ["assamese"]], ["Sanskrit", ["sanskrit"]],
  ["French", ["french"]], ["German", ["german"]], ["Spanish", ["spanish"]],
];

export const EXPERIENCE_FILTERS = [
  { value: 0, label: "Any experience" },
  { value: 6, label: "6+ months" },
  { value: 12, label: "1+ year" },
  { value: 24, label: "2+ years" },
  { value: 36, label: "3+ years" },
  { value: 48, label: "4+ years" },
  { value: 60, label: "5+ years" },
  { value: 72, label: "6+ years" },
  { value: 96, label: "8+ years" },
  { value: 120, label: "10+ years" },
];

function textRows(rows) {
  return (rows || []).map((row) => String(row.value || "").toLowerCase()).filter(Boolean);
}

function detectedValues(rows, taxonomy) {
  const text = textRows(rows);
  return taxonomy.filter(([, terms]) => text.some((value) => terms.some((term) => value.includes(term)))).map(([label]) => label);
}

export function subjectFilterValues(rows) {
  return detectedValues(rows, SUBJECT_TAXONOMY);
}

export function subjectFilterTerms(label) {
  return SUBJECT_TAXONOMY.find(([name]) => name === label)?.[1] || [String(label || "").toLowerCase()];
}

export function languageFilterValues(rows) {
  return detectedValues(rows, LANGUAGE_TAXONOMY);
}

export function workModeFilterValues(rows) {
  const text = textRows(rows);
  const values = [];
  if (text.some((value) => value.includes("online") || value.includes("remote"))) values.push("Online / Remote");
  if (text.some((value) => value.includes("offline") || value.includes("on-site") || value.includes("onsite"))) values.push("Offline / On-site");
  if (text.some((value) => value.includes("hybrid"))) values.push("Hybrid");
  return values;
}
