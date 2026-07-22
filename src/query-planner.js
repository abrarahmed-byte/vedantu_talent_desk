import { expandTokens, locationSearchTerms, parseSearchIntent, tokenize } from "./search.js";
import { extractResponseText, openAiFetch } from "./ai.js";

export const DEFAULT_SEARCH_MODEL = "gpt-5-nano";

const PLAN_BUCKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    track: { type: "string", enum: ["All", "Teacher", "Non-teaching"] },
    subjects: { type: "array", items: { type: "string" }, maxItems: 8 },
    exams: { type: "array", items: { type: "string" }, maxItems: 8 },
    locations: { type: "array", items: { type: "string" }, maxItems: 8 },
    pincodes: { type: "array", items: { type: "string" }, maxItems: 8 },
    languages: { type: "array", items: { type: "string" }, maxItems: 8 },
    grades: { type: "array", items: { type: "integer", minimum: 1, maximum: 12 }, maxItems: 12 },
    minimum_experience_months: { type: "integer", minimum: 0, maximum: 600 },
    work_mode: { type: "string", enum: ["", "Online / Remote", "Offline / On-site", "Hybrid"] },
    keywords: { type: "array", items: { type: "string" }, maxItems: 12 },
    employment_statuses: { type: "array", items: { type: "string", enum: ["Active employee", "Former employee", "No employment match"] }, maxItems: 3 },
    minimum_views: { type: "integer", minimum: 0, maximum: 100000 },
    minimum_calls: { type: "integer", minimum: 0, maximum: 100000 },
    maximum_calls: { type: "integer", minimum: -1, maximum: 100000 },
    maximum_age_days: { type: "integer", minimum: 0, maximum: 3650 },
  },
  required: ["track", "subjects", "exams", "locations", "pincodes", "languages", "grades",
    "minimum_experience_months", "work_mode", "keywords", "employment_statuses", "minimum_views",
    "minimum_calls", "maximum_calls", "maximum_age_days"],
};

export const SEARCH_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: { type: "string" },
    semantic_query: { type: "string" },
    required: PLAN_BUCKET_SCHEMA,
    preferred: PLAN_BUCKET_SCHEMA,
    excluded: PLAN_BUCKET_SCHEMA,
    freshest_first: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["interpretation", "semantic_query", "required", "preferred", "excluded", "freshest_first", "confidence"],
};

const SYSTEM_PROMPT = `You are the search planner for an internal recruitment repository. Convert the recruiter's natural-language request into a precise search plan.

Rules:
- Separate explicit non-negotiable requirements from preferences and exclusions.
- Words such as must, only, required and needs mean required. Words such as prefer, ideally and bonus mean preferred. Words such as exclude, without, not and do not show mean excluded. "No previous calls" is the special required constraint maximum_calls=0, not an Excluded chip.
- Every non-empty field must be supported by words in the current user message. Start with every field empty; never reuse details from an earlier request, an example, or a common candidate profile.
- A criterion may appear in exactly one bucket. Never repeat the same track, subject, exam, location, language, grade, keyword, employment state or work mode across Required, Preferred and Excluded.
- Preserve alternatives: "JEE or NEET" means either exam may match, not that every candidate must match both.
- Use only filters this tool can execute: profile track, subject/function, exam, location or pincode, language, grade, experience, work mode, employment status, views, calls, freshness window and searchable row/resume context. Put unsupported but searchable concepts in keywords; never invent a filter.
- Expand common Indian recruiting abbreviations when the user uses them. Examples: AP -> Andhra Pradesh, TS -> Telangana, NCR -> Delhi NCR, BLR -> Bengaluru, HYD -> Hyderabad.
- Excluded must stay completely empty unless the current message explicitly says exclude, excluding, without, except, avoid, not, no, do not show or an equivalent negative instruction.
- A central noun phrase such as "JEE Physics teacher in Telangana" normally makes Teacher, Physics, JEE and Telangana required unless the user weakens it.
- Translate equivalent concepts into common recruitment terms. Examples: engineering entrance coaching -> JEE; senior secondary -> grades 11 and 12; classroom teaching -> Offline / On-site; online tutor -> Online / Remote.
- Put employer names, job titles, skills and contextual concepts that do not fit a structured field in keywords. Keep useful multi-word phrases together.
- "Worked at/in [company]" means that company is a required keyword. It does not mean Active employee, Former employee or No employment match; those statuses refer only to the Vedantu employment master.
- Set maximum_calls to 0 when the recruiter asks for uncontacted or never-called profiles. Put this constraint in required even if the user describes previously contacted profiles as an exclusion. Otherwise use -1.
- Use maximum_age_days only when the recruiter gives an actual time window. "Recent" alone means freshest_first=true, not an invented cutoff.
- Never add facts the recruiter did not request. Never infer or search protected or sensitive traits such as gender, religion, caste, age, disability, health, marital status or ethnicity.
- The semantic_query should be a compact, search-oriented restatement using useful equivalents, not a copy of filler words.
- Example: "Early learner teachers who have worked in Cuemath" requires Teacher plus the keywords "early learner" and "Cuemath". Subjects, exams, locations, languages, grades, employment statuses, work mode, contact status, Preferred and Excluded must all remain empty.
- Return only the requested JSON.`;

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function uniqueStrings(value, max = 12) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 120)).filter(Boolean))].slice(0, max);
}

function integer(value, minimum, maximum, fallback = 0) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function emptyBucket() {
  return {
    track: "All", subjects: [], exams: [], locations: [], pincodes: [], languages: [], grades: [],
    minimum_experience_months: 0, work_mode: "", keywords: [], employment_statuses: [],
    minimum_views: 0, minimum_calls: 0, maximum_calls: -1, maximum_age_days: 0,
  };
}

function sanitizeBucket(value = {}) {
  const bucket = emptyBucket();
  bucket.track = ["Teacher", "Non-teaching"].includes(value.track) ? value.track : "All";
  for (const key of ["subjects", "exams", "locations", "pincodes", "languages", "keywords", "employment_statuses"]) {
    bucket[key] = uniqueStrings(value[key], key === "keywords" ? 12 : 8);
  }
  bucket.pincodes = bucket.pincodes.filter((item) => /^[1-9]\d{5}$/.test(item));
  bucket.grades = [...new Set((Array.isArray(value.grades) ? value.grades : [])
    .map((item) => integer(item, 1, 12, 0)).filter(Boolean))].sort((a, b) => a - b);
  bucket.minimum_experience_months = integer(value.minimum_experience_months, 0, 600);
  bucket.work_mode = ["Online / Remote", "Offline / On-site", "Hybrid"].includes(value.work_mode) ? value.work_mode : "";
  bucket.employment_statuses = bucket.employment_statuses.filter((item) => ["Active employee", "Former employee", "No employment match"].includes(item));
  bucket.minimum_views = integer(value.minimum_views, 0, 100000);
  bucket.minimum_calls = integer(value.minimum_calls, 0, 100000);
  bucket.maximum_calls = integer(value.maximum_calls, -1, 100000, -1);
  bucket.maximum_age_days = integer(value.maximum_age_days, 0, 3650);
  return bucket;
}

const PROTECTED_CRITERIA = [
  { label: "Gender", pattern: /\b(?:female|male|woman|women|man|men|gender|nonbinary|non binary|transgender)\b/i },
  { label: "Religion or caste", pattern: /\b(?:religion|religious|caste|hindu|muslim|christian|sikh|jain|buddhist)\b/i },
  { label: "Age", pattern: /\b(?:age|aged|years? old)\b/i },
  { label: "Disability or health", pattern: /\b(?:disability|disabled|health|medical|pregnant|pregnancy)\b/i },
  { label: "Marital status or ethnicity", pattern: /\b(?:marital|married|unmarried|single|ethnicity|ethnic|race|racial)\b/i },
];

function protectedCriteriaNotices(query) {
  const labels = PROTECTED_CRITERIA.filter((criterion) => criterion.pattern.test(String(query || ""))).map((criterion) => criterion.label);
  if (!labels.length) return [];
  return [`${labels.join(", ")} filtering was ignored. Talent Desk does not filter candidates using protected personal attributes.`];
}

function containsProtectedCriterion(value) {
  return PROTECTED_CRITERIA.some((criterion) => criterion.pattern.test(String(value || "")));
}

export function sanitizeSearchPlan(value = {}, fallbackQuery = "") {
  const fallback = fallbackSearchPlan(fallbackQuery);
  return {
    interpretation: text(value.interpretation, 360) || fallback.interpretation,
    semantic_query: text(value.semantic_query, 360) || fallback.semantic_query,
    required: sanitizeBucket(value.required),
    preferred: sanitizeBucket(value.preferred),
    excluded: sanitizeBucket(value.excluded),
    freshest_first: Boolean(value.freshest_first),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    match_modes: {
      exams: value?.match_modes?.exams === "any" ? "any" : "all",
      locations: value?.match_modes?.locations === "any" ? "any" : "all",
    },
    planner: {
      provider: value?.planner?.provider === "openai" ? "openai" : "local",
      model: text(value?.planner?.model, 120),
    },
    notices: uniqueStrings(value.notices, 4),
    grounded: Boolean(value.grounded),
    guardrails_applied: Boolean(value.guardrails_applied),
  };
}

export function fallbackSearchPlan(query) {
  const intent = parseSearchIntent(query);
  const required = emptyBucket();
  required.track = intent.track;
  required.subjects = [...intent.subjects];
  required.exams = [...intent.exams];
  required.locations = [...intent.locations];
  required.pincodes = [...(intent.pincodes || [])];
  required.languages = [...intent.languages];
  required.grades = [...intent.grades];
  required.minimum_experience_months = intent.minimumExperienceMonths;
  required.keywords = [...(intent.keywords || [])].filter((keyword) => !containsProtectedCriterion(keyword));
  return {
    interpretation: query ? `Search for ${text(query, 260)}` : "All profiles",
    semantic_query: text(query, 360),
    required,
    preferred: emptyBucket(),
    excluded: emptyBucket(),
    freshest_first: intent.freshestFirst,
    confidence: 0,
    match_modes: {
      exams: intent.examMatchMode === "any" ? "any" : "all",
      locations: intent.locationMatchMode === "any" ? "any" : "all",
    },
    planner: { provider: "local", model: "" },
    notices: protectedCriteriaNotices(query),
    grounded: true,
    guardrails_applied: true,
  };
}

function normalized(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenStem(value) {
  const token = normalized(value);
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function fieldValueKey(field, value) {
  let result = normalized(value);
  if (field === "subjects") result = result.replace(/\bmaths?\b/g, "mathematics");
  if (field === "locations") {
    const terms = locationSearchTerms([value]);
    result = normalized(terms[0] || value);
  }
  return result;
}

function allowedFieldValue(field, value, allowed) {
  const key = fieldValueKey(field, value);
  return (allowed || []).find((item) => fieldValueKey(field, item) === key) || null;
}

function mentionVariants(field, value) {
  if (field === "locations") return locationSearchTerms([value]);
  if (field === "subjects" && fieldValueKey(field, value) === "mathematics") return ["mathematics", "maths", "math"];
  if (field === "work_mode") {
    if (value === "Online / Remote") return ["online", "remote", "work from home", "wfh"];
    if (value === "Offline / On-site") return ["offline", "on site", "onsite", "classroom"];
  }
  return [String(value || "")];
}

function importanceForMention(query, field, value, fallback = "required") {
  const haystack = normalized(query);
  const variants = mentionVariants(field, value).map(normalized).filter(Boolean);
  let index = -1;
  let length = 0;
  for (const variant of variants) {
    index = haystack.indexOf(variant);
    if (index >= 0) { length = variant.length; break; }
  }
  if (index < 0) return fallback;
  const before = haystack.slice(Math.max(0, index - 45), index).trim();
  const after = haystack.slice(index + length, Math.min(haystack.length, index + length + 24)).trim();
  const exclusionBefore = /\b(?:exclude|excluding|without|except|avoid|not|no|do not show|dont show)(?:\s+\w+){0,3}\s*$/.test(before);
  const exclusionAfter = /^(?:is\s+)?(?:excluded|not allowed|must not match)\b/.test(after);
  if (exclusionBefore || exclusionAfter) return "excluded";
  const preferenceBefore = /\b(?:prefer|preferred|preferably|ideally|bonus|nice to have|good to have)(?:\s+\w+){0,3}\s*$/.test(before);
  const preferenceAfter = /^(?:is\s+)?(?:preferred|preferable|ideal|a bonus|nice to have)\b/.test(after);
  if (preferenceBefore || preferenceAfter) return "preferred";
  return "required";
}

function groundedKeyword(value, query) {
  const queryTokens = new Set(tokenize(query).map(tokenStem));
  const valueTokens = tokenize(value).map(tokenStem);
  return Boolean(valueTokens.length)
    && !valueTokens.every((token) => /^\d+$/.test(token))
    && valueTokens.every((token) => queryTokens.has(token));
}

function keywordCoveredByStructuredIntent(value, intent) {
  const keywordIntent = parseSearchIntent(value);
  const overlaps = (left, right) => left.some((item) => right.some((candidate) => fieldValueKey("keywords", item) === fieldValueKey("keywords", candidate)));
  const counters = explicitCounters(value);
  return (keywordIntent.track !== "All" && keywordIntent.track === intent.track)
    || overlaps(keywordIntent.subjects, intent.subjects)
    || overlaps(keywordIntent.exams, intent.exams)
    || overlaps(keywordIntent.languages, intent.languages)
    || overlaps(keywordIntent.locations, intent.locations)
    || overlaps(keywordIntent.pincodes || [], intent.pincodes || [])
    || overlaps((keywordIntent.grades || []).map(String), (intent.grades || []).map(String))
    || keywordIntent.minimumExperienceMonths > 0
    || Boolean(explicitWorkMode(value))
    || explicitEmploymentStatuses(value).length > 0
    || counters.minimum_views > 0 || counters.minimum_calls > 0 || counters.maximum_calls >= 0
    || explicitMaximumAgeDays(value) > 0;
}

function explicitWorkMode(query) {
  const value = normalized(query);
  if (/\bhybrid\b/.test(value)) return "Hybrid";
  if (/\b(?:online|remote|work from home|wfh)\b/.test(value)) return "Online / Remote";
  if (/\b(?:offline|on site|onsite|classroom)\b/.test(value)) return "Offline / On-site";
  return "";
}

function explicitEmploymentStatuses(query) {
  const value = normalized(query);
  const statuses = [];
  if (/\b(?:active|current)\s+(?:vedantu\s+)?employee\b|\bcurrently employed (?:at|by) vedantu\b/.test(value)) statuses.push("Active employee");
  if (/\b(?:former|ex|previous)\s+(?:vedantu\s+)?employee\b|\bpreviously (?:worked|employed) (?:at|by) vedantu\b/.test(value)) statuses.push("Former employee");
  if (/\b(?:never|not)\s+(?:worked|employed) (?:at|by) vedantu\b|\bno employment match\b/.test(value)) statuses.push("No employment match");
  return statuses;
}

function explicitCounters(query) {
  const value = normalized(query);
  const views = value.match(/\b(?:at least|minimum|min|more than)?\s*(\d+)\+?\s+views?\b/);
  const calls = value.match(/\b(?:at least|minimum|min|more than)?\s*(\d+)\+?\s+calls?\b/);
  const maximumCalls = value.match(/\b(?:at most|maximum|max|no more than)\s*(\d+)\s+calls?\b/);
  const uncontacted = /\b(?:not contacted|never contacted|never called|no previous calls?|zero calls?|0 calls?)\b/.test(value);
  return {
    minimum_views: views ? integer(views[1], 0, 100000) : 0,
    minimum_calls: calls && !maximumCalls ? integer(calls[1], 0, 100000) : 0,
    maximum_calls: uncontacted ? 0 : maximumCalls ? integer(maximumCalls[1], 0, 100000) : -1,
  };
}

function explicitMaximumAgeDays(query) {
  const value = normalized(query);
  const match = value.match(/\b(?:applied\s+)?(?:in\s+)?(?:the\s+)?(?:last|past|previous|within)\s+(\d+)\s+(days?|weeks?|months?|years?)\b/);
  if (!match) return 0;
  const amount = integer(match[1], 0, 3650);
  const unit = match[2];
  const multiplier = unit.startsWith("week") ? 7 : unit.startsWith("month") ? 30 : unit.startsWith("year") ? 365 : 1;
  return Math.min(3650, amount * multiplier);
}

function assignArrayValue(output, occurrences, query, field, value, fallbackImportance = "required") {
  const importance = importanceForMention(query, field, value, fallbackImportance);
  if (!output[importance][field].some((item) => fieldValueKey(field, item) === fieldValueKey(field, value))) {
    output[importance][field].push(value);
  }
  return importance;
}

function planInterpretation(plan, query) {
  const chips = describeSearchPlan(plan);
  const labels = (importance) => chips.filter((chip) => chip.importance === importance).map((chip) => chip.label);
  const required = labels("required");
  const preferred = labels("preferred");
  const excluded = labels("excluded");
  const parts = [];
  if (required.length) parts.push(`Searching for ${required.join(" · ")}`);
  if (preferred.length) parts.push(`Prefer ${preferred.join(" · ")}`);
  if (excluded.length) parts.push(`Exclude ${excluded.join(" · ")}`);
  return text(parts.join(". ") || `Search across all profiles for ${query}`, 360);
}

export function groundSearchPlan(value = {}, query = "", options = {}) {
  const safe = sanitizeSearchPlan(value, query);
  const parsed = parseSearchIntent(query);
  const addMissing = options.addMissing !== false;
  const output = {
    interpretation: "",
    semantic_query: text(query, 360),
    required: emptyBucket(), preferred: emptyBucket(), excluded: emptyBucket(),
    freshest_first: /\b(?:fresh|latest|newest|recent)\b/i.test(query) && (addMissing || safe.freshest_first),
    confidence: safe.confidence,
    match_modes: {
      exams: parsed.examMatchMode === "any" ? "any" : "all",
      locations: parsed.locationMatchMode === "any" ? "any" : "all",
    },
    planner: safe.planner,
    notices: protectedCriteriaNotices(query),
    grounded: true,
    guardrails_applied: true,
  };
  const allowed = {
    subjects: parsed.subjects, exams: parsed.exams, locations: parsed.locations, pincodes: parsed.pincodes,
    languages: parsed.languages, grades: parsed.grades,
  };
  for (const field of ["subjects", "exams", "locations", "pincodes", "languages", "grades"]) {
    const seen = new Map();
    for (const importance of ["required", "preferred", "excluded"]) {
      for (const raw of safe[importance][field]) {
        const canonical = allowedFieldValue(field, raw, allowed[field]);
        if (!canonical) continue;
        const key = fieldValueKey(field, canonical);
        if (!seen.has(key)) seen.set(key, { value: canonical, occurrences: [] });
        seen.get(key).occurrences.push(importance);
      }
    }
    for (const { value: item, occurrences } of seen.values()) {
      assignArrayValue(output, occurrences, query, field, item, occurrences.includes("required") ? "required" : occurrences[0]);
    }
    if (addMissing) {
      for (const item of allowed[field]) {
        const exists = ["required", "preferred", "excluded"].some((importance) => output[importance][field].some((value) => fieldValueKey(field, value) === fieldValueKey(field, item)));
        if (!exists) assignArrayValue(output, [], query, field, item);
      }
    }
  }
  if (parsed.track !== "All") {
    const occurrences = ["required", "preferred", "excluded"].filter((importance) => safe[importance].track === parsed.track);
    if (addMissing || occurrences.length) {
      const importance = importanceForMention(query, "track", parsed.track, occurrences.includes("required") ? "required" : occurrences[0] || "required");
      output[importance].track = parsed.track;
    }
  }
  const keywordOccurrences = new Map();
  for (const importance of ["required", "preferred", "excluded"]) {
    for (const keyword of safe[importance].keywords) {
      if (!groundedKeyword(keyword, query) || containsProtectedCriterion(keyword) || keywordCoveredByStructuredIntent(keyword, parsed)) continue;
      const key = normalized(keyword);
      if (!keywordOccurrences.has(key)) keywordOccurrences.set(key, { value: keyword, occurrences: [] });
      keywordOccurrences.get(key).occurrences.push(importance);
    }
  }
  for (const { value: keyword, occurrences } of keywordOccurrences.values()) {
    assignArrayValue(output, occurrences, query, "keywords", keyword, occurrences.includes("required") ? "required" : occurrences[0]);
  }
  const contextPhrases = [];
  if (/\bearly\s+learners?\b/i.test(query)) contextPhrases.push("early learner");
  for (const phrase of addMissing ? contextPhrases : []) {
    const phraseTokens = new Set(tokenize(phrase).map(tokenStem));
    const alreadyPresent = ["required", "preferred", "excluded"].some((importance) => output[importance].keywords.some((keyword) => normalized(keyword) === normalized(phrase)));
    if (alreadyPresent) continue;
    for (const importance of ["required", "preferred", "excluded"]) {
      output[importance].keywords = output[importance].keywords.filter((keyword) => {
        const tokens = tokenize(keyword).map(tokenStem);
        return tokens.length !== 1 || !phraseTokens.has(tokens[0]);
      });
    }
    output[importanceForMention(query, "keywords", phrase)].keywords.push(phrase);
  }
  const keywordTokens = new Set(["required", "preferred", "excluded"].flatMap((importance) => output[importance].keywords.flatMap((value) => tokenize(value).map(tokenStem))));
  if (addMissing) {
    for (const keyword of parsed.keywords || []) {
      if (keywordTokens.has(tokenStem(keyword)) || containsProtectedCriterion(keyword) || keywordCoveredByStructuredIntent(keyword, parsed)) continue;
      const importance = importanceForMention(query, "keywords", keyword);
      output[importance].keywords.push(keyword);
      keywordTokens.add(tokenStem(keyword));
    }
  }
  const hasExperience = ["required", "preferred", "excluded"].some((importance) => safe[importance].minimum_experience_months > 0);
  if (parsed.minimumExperienceMonths && (addMissing || hasExperience)) {
    const importance = importanceForMention(query, "minimum_experience_months", "experience");
    output[importance].minimum_experience_months = parsed.minimumExperienceMonths;
  }
  const workMode = explicitWorkMode(query);
  const hasWorkMode = ["required", "preferred", "excluded"].some((importance) => safe[importance].work_mode === workMode);
  if (workMode && (addMissing || hasWorkMode)) output[importanceForMention(query, "work_mode", workMode)].work_mode = workMode;
  for (const status of explicitEmploymentStatuses(query)) {
    const hasStatus = ["required", "preferred", "excluded"].some((importance) => safe[importance].employment_statuses.includes(status));
    if (addMissing || hasStatus) assignArrayValue(output, [], query, "employment_statuses", status);
  }
  const counters = explicitCounters(query);
  const hasMinimumViews = ["required", "preferred", "excluded"].some((importance) => safe[importance].minimum_views > 0);
  const hasMinimumCalls = ["required", "preferred", "excluded"].some((importance) => safe[importance].minimum_calls > 0);
  const hasMaximumCalls = ["required", "preferred", "excluded"].some((importance) => safe[importance].maximum_calls >= 0);
  if (counters.minimum_views && (addMissing || hasMinimumViews)) output[importanceForMention(query, "minimum_views", "views")].minimum_views = counters.minimum_views;
  if (counters.minimum_calls && (addMissing || hasMinimumCalls)) output[importanceForMention(query, "minimum_calls", "calls")].minimum_calls = counters.minimum_calls;
  if (counters.maximum_calls >= 0 && (addMissing || hasMaximumCalls)) output.required.maximum_calls = counters.maximum_calls;
  const maximumAgeDays = explicitMaximumAgeDays(query);
  const hasMaximumAge = ["required", "preferred", "excluded"].some((importance) => safe[importance].maximum_age_days > 0);
  if (maximumAgeDays && (addMissing || hasMaximumAge)) output[importanceForMention(query, "maximum_age_days", "last")].maximum_age_days = maximumAgeDays;
  output.interpretation = planInterpretation(output, query);
  const beforeCount = describeSearchPlan(safe).length;
  const afterCount = describeSearchPlan(output).length;
  if (beforeCount > afterCount) output.confidence = Math.min(output.confidence, 0.8);
  return output;
}

export async function createAiSearchPlan(env, query) {
  const model = text(env?.AI_SEARCH_MODEL || env?.AI_MODEL || DEFAULT_SEARCH_MODEL, 120);
  const effort = /^gpt-5(?:$|-mini|-nano|-2025)/.test(model) ? "minimal" : "low";
  const response = await openAiFetch(env, "/responses", {
    method: "POST",
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: text(query, 500) }] },
      ],
      reasoning: { effort },
      text: { format: { type: "json_schema", name: "talent_search_plan", strict: true, schema: SEARCH_PLAN_SCHEMA } },
      max_output_tokens: 1800,
    }),
  });
  const result = await response.json();
  const raw = extractResponseText(result);
  if (!raw) throw new Error("OpenAI returned an empty search plan");
  const plan = groundSearchPlan(JSON.parse(raw), query);
  plan.planner = { provider: "openai", model };
  return plan;
}

export function parseClientSearchPlan(value, query = "") {
  if (!value) return fallbackSearchPlan(query);
  try { return groundSearchPlan(JSON.parse(value), query, { addMissing: false }); }
  catch { return fallbackSearchPlan(query); }
}

export function searchPlanToIntent(plan, query = "") {
  const required = sanitizeBucket(plan?.required);
  const preferred = sanitizeBucket(plan?.preferred);
  const allWords = [plan?.semantic_query, ...required.keywords, ...preferred.keywords,
    ...required.subjects, ...preferred.subjects, ...required.exams, ...preferred.exams,
    ...required.locations, ...preferred.locations, ...required.languages, ...preferred.languages].join(" ");
  const structuredNumerics = new Set([...required.pincodes, ...required.grades.map(String)]);
  return {
    track: required.track,
    subjects: required.subjects,
    exams: required.exams,
    languages: required.languages,
    locations: required.locations,
    pincodes: required.pincodes,
    grades: required.grades,
    minimumExperienceMonths: required.minimum_experience_months,
    freshestFirst: Boolean(plan?.freshest_first),
    tokens: expandTokens(tokenize(allWords || query)).filter((token) => !/^\d+$/.test(token) || structuredNumerics.has(token)),
    keywords: required.keywords,
    examMatchMode: plan?.match_modes?.exams === "any" ? "any" : "all",
    locationMatchMode: plan?.match_modes?.locations === "any" ? "any" : "all",
  };
}

function includesTerm(value, term) {
  return String(value || "").toLowerCase().includes(String(term || "").toLowerCase());
}

function bucketMatches(candidate, bucket, field, value) {
  const searchable = `${candidate.search_text || ""} ${candidate.resume_text || ""} ${candidate.row_text || ""}`;
  if (field === "subjects") return includesTerm(`${candidate.subject_display || ""} ${candidate.role || ""} ${searchable}`, value);
  if (field === "exams" || field === "keywords") return includesTerm(searchable, value);
  if (field === "locations") return locationSearchTerms([value]).some((term) => includesTerm(`${candidate.city || ""} ${candidate.state || ""}`, term));
  if (field === "pincodes") return includesTerm(searchable, value);
  if (field === "languages") return includesTerm(`${candidate.languages_display || ""} ${searchable}`, value);
  if (field === "employment_statuses") return candidate.employment_status === value;
  if (field === "grades") return includesTerm(`${candidate.grades_display || ""} ${searchable}`, String(value));
  return false;
}

export function scoreSearchPlanPreferences(candidate, plan) {
  const preferred = sanitizeBucket(plan?.preferred);
  const reasons = [];
  const missing = [];
  let bonus = 0;
  if (preferred.track !== "All") {
    if (candidate.track === preferred.track) { bonus += 5; reasons.push(preferred.track); }
    else missing.push(preferred.track);
  }
  const labels = { subjects: "subject", exams: "exam", locations: "location", pincodes: "pincode", languages: "language", grades: "grade", keywords: "context", employment_statuses: "employment" };
  for (const field of Object.keys(labels)) {
    for (const value of preferred[field] || []) {
      if (bucketMatches(candidate, preferred, field, value)) {
        bonus += field === "keywords" ? 3 : 5;
        reasons.push(`${labels[field]}: ${value}`);
      } else missing.push(`${labels[field]}: ${value}`);
    }
  }
  if (preferred.minimum_experience_months) {
    if (Number(candidate.experience_months) >= preferred.minimum_experience_months) { bonus += 6; reasons.push(`${preferred.minimum_experience_months}+ months experience`); }
    else missing.push(`${preferred.minimum_experience_months}+ months experience`);
  }
  if (preferred.work_mode) {
    if (includesTerm(candidate.work_mode, preferred.work_mode.split(" /")[0])) { bonus += 4; reasons.push(preferred.work_mode); }
    else missing.push(preferred.work_mode);
  }
  if (preferred.maximum_calls >= 0) {
    if (Number(candidate.call_count || 0) <= preferred.maximum_calls) { bonus += 4; reasons.push(`at most ${preferred.maximum_calls} calls`); }
    else missing.push(`at most ${preferred.maximum_calls} calls`);
  }
  if (preferred.minimum_views) {
    if (Number(candidate.view_count || 0) >= preferred.minimum_views) { bonus += 4; reasons.push(`${preferred.minimum_views}+ views`); }
    else missing.push(`${preferred.minimum_views}+ views`);
  }
  if (preferred.minimum_calls) {
    if (Number(candidate.call_count || 0) >= preferred.minimum_calls) { bonus += 4; reasons.push(`${preferred.minimum_calls}+ calls`); }
    else missing.push(`${preferred.minimum_calls}+ calls`);
  }
  if (preferred.maximum_age_days) {
    const ageDays = Math.max(0, (Date.now() - (Date.parse(candidate.applied_at) || 0)) / 86400000);
    if (ageDays <= preferred.maximum_age_days) { bonus += 5; reasons.push(`applied within ${preferred.maximum_age_days} days`); }
    else missing.push(`applied within ${preferred.maximum_age_days} days`);
  }
  return { bonus: Math.min(24, bonus), reasons: reasons.slice(0, 5), missing: missing.slice(0, 5) };
}

const CRITERION_DATABASE_FIELDS = {
  track: "profile type",
  subjects: "standardized row + résumé evidence",
  exams: "standardized row + résumé evidence",
  locations: "city/state",
  pincodes: "standardized row",
  languages: "standardized row + résumé text",
  grades: "standardized row + résumé text",
  keywords: "row + résumé text",
  employment_statuses: "employment history",
  minimum_experience_months: "experience months",
  work_mode: "work mode",
  minimum_views: "view log",
  minimum_calls: "call log",
  maximum_calls: "call log",
  maximum_age_days: "latest application date",
  freshest_first: "latest application date",
};

function executableCriterion(importance, field, value, label) {
  return {
    importance, field, value: String(value), label,
    executable: true,
    effect: importance === "preferred" ? "rank" : "filter",
    database_field: CRITERION_DATABASE_FIELDS[field] || "candidate repository",
  };
}

export function describeSearchPlan(plan) {
  const safe = sanitizeSearchPlan(plan);
  const chips = [];
  const labels = {
    subjects: "Subject", exams: "Exam", locations: "Location", pincodes: "Pincode", languages: "Language",
    grades: "Grade", keywords: "Context", employment_statuses: "Employment",
  };
  for (const importance of ["required", "preferred", "excluded"]) {
    const bucket = safe[importance];
    if (bucket.track !== "All") chips.push(executableCriterion(importance, "track", bucket.track, bucket.track));
    for (const [field, label] of Object.entries(labels)) {
      for (const value of bucket[field]) {
        const fieldLabel = field === "exams" && safe.match_modes.exams === "any"
          ? "Exam option"
          : field === "locations" && safe.match_modes.locations === "any" ? "Location option" : label;
        chips.push(executableCriterion(importance, field, value, `${fieldLabel}: ${value}`));
      }
    }
    if (bucket.minimum_experience_months) chips.push(executableCriterion(importance, "minimum_experience_months", bucket.minimum_experience_months, `${bucket.minimum_experience_months}+ months experience`));
    if (bucket.work_mode) chips.push(executableCriterion(importance, "work_mode", bucket.work_mode, bucket.work_mode));
    if (bucket.minimum_views) chips.push(executableCriterion(importance, "minimum_views", bucket.minimum_views, `${bucket.minimum_views}+ views`));
    if (bucket.minimum_calls) chips.push(executableCriterion(importance, "minimum_calls", bucket.minimum_calls, `${bucket.minimum_calls}+ calls`));
    if (bucket.maximum_calls >= 0) chips.push(executableCriterion(importance, "maximum_calls", bucket.maximum_calls, bucket.maximum_calls === 0 ? "Not contacted" : `At most ${bucket.maximum_calls} calls`));
    if (bucket.maximum_age_days) chips.push(executableCriterion(importance, "maximum_age_days", bucket.maximum_age_days, `Applied within ${bucket.maximum_age_days} days`));
  }
  if (safe.freshest_first) chips.push(executableCriterion("preferred", "freshest_first", "true", "Freshest first"));
  return chips;
}
