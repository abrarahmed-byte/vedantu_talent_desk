import { expandTokens, locationSearchTerms, parseSearchIntent, tokenize } from "./search.js";

export const DEFAULT_SEARCH_MODEL = "@cf/meta/llama-3.2-3b-instruct";

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
- Words such as must, only, required and needs mean required. Words such as prefer, ideally and bonus mean preferred. Words such as exclude, without, not, no previous calls and do not show mean excluded.
- A central noun phrase such as "JEE Physics teacher in Telangana" normally makes Teacher, Physics, JEE and Telangana required unless the user weakens it.
- Translate equivalent concepts into common recruitment terms. Examples: engineering entrance coaching -> JEE; senior secondary -> grades 11 and 12; classroom teaching -> Offline / On-site; online tutor -> Online / Remote.
- Put employer names, job titles, skills and contextual concepts that do not fit a structured field in keywords. Keep useful multi-word phrases together.
- Set maximum_calls to 0 when the recruiter asks for uncontacted or never-called profiles. Put this constraint in required even if the user describes previously contacted profiles as an exclusion. Otherwise use -1.
- Use maximum_age_days only when the recruiter gives an actual time window. "Recent" alone means freshest_first=true, not an invented cutoff.
- Never add facts the recruiter did not request. Never infer or search protected or sensitive traits such as gender, religion, caste, age, disability, health, marital status or ethnicity.
- The semantic_query should be a compact, search-oriented restatement using useful equivalents, not a copy of filler words.
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
  required.keywords = [...(intent.keywords || [])];
  return {
    interpretation: query ? `Search for ${text(query, 260)}` : "All profiles",
    semantic_query: text(query, 360),
    required,
    preferred: emptyBucket(),
    excluded: emptyBucket(),
    freshest_first: intent.freshestFirst,
    confidence: 0,
  };
}

function responseText(result) {
  if (typeof result?.response === "string") return result.response;
  if (result?.response && typeof result.response === "object") return JSON.stringify(result.response);
  if (typeof result === "string") return result;
  return "";
}

export async function createAiSearchPlan(env, query) {
  if (!env?.AI?.run) throw new Error("Cloudflare AI search is not configured");
  const result = await env.AI.run(env.AI_SEARCH_MODEL || DEFAULT_SEARCH_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text(query, 500) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "talent_search_plan", strict: true, schema: SEARCH_PLAN_SCHEMA },
    },
    temperature: 0,
    max_tokens: 850,
  });
  const raw = responseText(result);
  if (!raw) throw new Error("The AI planner returned an empty response");
  return sanitizeSearchPlan(JSON.parse(raw), query);
}

export function parseClientSearchPlan(value, query = "") {
  if (!value) return fallbackSearchPlan(query);
  try { return sanitizeSearchPlan(JSON.parse(value), query); }
  catch { return fallbackSearchPlan(query); }
}

export function searchPlanToIntent(plan, query = "") {
  const required = sanitizeBucket(plan?.required);
  const preferred = sanitizeBucket(plan?.preferred);
  const allWords = [plan?.semantic_query, ...required.keywords, ...preferred.keywords,
    ...required.subjects, ...preferred.subjects, ...required.exams, ...preferred.exams,
    ...required.locations, ...preferred.locations, ...required.languages, ...preferred.languages].join(" ");
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
    tokens: expandTokens(tokenize(allWords || query)),
    keywords: required.keywords,
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
  const labels = { subjects: "subject", exams: "exam", locations: "location", languages: "language", grades: "grade", keywords: "context", employment_statuses: "employment" };
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
  if (preferred.maximum_age_days) {
    const ageDays = Math.max(0, (Date.now() - (Date.parse(candidate.applied_at) || 0)) / 86400000);
    if (ageDays <= preferred.maximum_age_days) { bonus += 5; reasons.push(`applied within ${preferred.maximum_age_days} days`); }
    else missing.push(`applied within ${preferred.maximum_age_days} days`);
  }
  return { bonus: Math.min(24, bonus), reasons: reasons.slice(0, 5), missing: missing.slice(0, 5) };
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
    if (bucket.track !== "All") chips.push({ importance, field: "track", value: bucket.track, label: bucket.track });
    for (const [field, label] of Object.entries(labels)) {
      for (const value of bucket[field]) chips.push({ importance, field, value: String(value), label: `${label}: ${value}` });
    }
    if (bucket.minimum_experience_months) chips.push({ importance, field: "minimum_experience_months", value: String(bucket.minimum_experience_months), label: `${bucket.minimum_experience_months}+ months experience` });
    if (bucket.work_mode) chips.push({ importance, field: "work_mode", value: bucket.work_mode, label: bucket.work_mode });
    if (bucket.minimum_views) chips.push({ importance, field: "minimum_views", value: String(bucket.minimum_views), label: `${bucket.minimum_views}+ views` });
    if (bucket.minimum_calls) chips.push({ importance, field: "minimum_calls", value: String(bucket.minimum_calls), label: `${bucket.minimum_calls}+ calls` });
    if (bucket.maximum_calls >= 0) chips.push({ importance, field: "maximum_calls", value: String(bucket.maximum_calls), label: bucket.maximum_calls === 0 ? "Not contacted" : `At most ${bucket.maximum_calls} calls` });
    if (bucket.maximum_age_days) chips.push({ importance, field: "maximum_age_days", value: String(bucket.maximum_age_days), label: `Applied within ${bucket.maximum_age_days} days` });
  }
  if (safe.freshest_first) chips.push({ importance: "preferred", field: "freshest_first", value: "true", label: "Freshest first" });
  return chips;
}
