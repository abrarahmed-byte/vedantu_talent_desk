import assert from "node:assert/strict";
import test from "node:test";
import {
  createAiSearchPlan,
  describeSearchPlan,
  fallbackSearchPlan,
  parseClientSearchPlan,
  sanitizeSearchPlan,
  scoreSearchPlanPreferences,
  searchPlanToIntent,
} from "../src/query-planner.js";

function bucket(overrides = {}) {
  return {
    track: "All", subjects: [], exams: [], locations: [], pincodes: [], languages: [], grades: [],
    minimum_experience_months: 0, work_mode: "", keywords: [], employment_statuses: [],
    minimum_views: 0, minimum_calls: 0, maximum_calls: -1, maximum_age_days: 0,
    ...overrides,
  };
}

function openAiEnv(result, onRequest = () => {}) {
  return {
    OPENAI_API_KEY: "test-key",
    AI_SEARCH_MODEL: "gpt-5-nano",
    OPENAI_FETCH: async (_url, options) => {
      onRequest(JSON.parse(options.body));
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

test("fallback keeps the existing parser as a safe rollback path", () => {
  const plan = fallbackSearchPlan("JEE Physics teacher in Telangana with 4 years experience");
  assert.equal(plan.required.track, "Teacher");
  assert.deepEqual(plan.required.subjects, ["Physics"]);
  assert.deepEqual(plan.required.exams, ["JEE"]);
  assert.deepEqual(plan.required.locations, ["Telangana"]);
  assert.equal(plan.required.minimum_experience_months, 48);
});

test("AI plan distinguishes required, preferred and excluded criteria", async () => {
  let request;
  const raw = {
    interpretation: "Physics and JEE are required; Hindi is preferred; previously contacted profiles are excluded.",
    semantic_query: "JEE Physics senior secondary teacher Hindi Telangana",
    required: bucket({ track: "Teacher", subjects: ["Physics"], exams: ["JEE"], locations: ["Telangana"], maximum_calls: 0 }),
    preferred: bucket({ languages: ["Hindi"], grades: [11, 12] }),
    excluded: bucket(),
    freshest_first: true,
    confidence: 0.93,
  };
  const env = openAiEnv(raw, (input) => { request = input; });
  const plan = await createAiSearchPlan(env, "JEE Physics in Telangana, prefer Hindi and no previous calls");
  assert.deepEqual(plan.required.subjects, ["Physics"]);
  assert.deepEqual(plan.preferred.languages, ["Hindi"]);
  assert.equal(plan.required.maximum_calls, 0);
  assert.equal(request.model, "gpt-5-nano");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(plan.planner.provider, "openai");
});

test("client plans are bounded before they affect database search", () => {
  const plan = sanitizeSearchPlan({
    interpretation: "x".repeat(1000),
    semantic_query: "physics",
    required: bucket({ grades: [-5, 11, 99], minimum_experience_months: 900, maximum_calls: -9, pincodes: ["500032", "abc"] }),
    preferred: bucket(),
    excluded: bucket(),
    confidence: 4,
  });
  assert.deepEqual(plan.required.grades, [1, 11, 12]);
  assert.equal(plan.required.minimum_experience_months, 600);
  assert.equal(plan.required.maximum_calls, -1);
  assert.deepEqual(plan.required.pincodes, ["500032"]);
  assert.equal(plan.confidence, 1);
  assert.equal(plan.interpretation.length, 360);
});

test("preferred criteria increase score without becoming mandatory filters", () => {
  const plan = sanitizeSearchPlan({
    interpretation: "Physics required and Hindi preferred",
    semantic_query: "physics teacher hindi",
    required: bucket({ track: "Teacher", subjects: ["Physics"] }),
    preferred: bucket({ languages: ["Hindi"], minimum_experience_months: 48 }),
    excluded: bucket(),
    freshest_first: false,
    confidence: 0.9,
  });
  const intent = searchPlanToIntent(plan, "Physics teacher, preferably Hindi");
  assert.deepEqual(intent.subjects, ["Physics"]);
  assert.deepEqual(intent.languages, []);
  const fit = scoreSearchPlanPreferences({ languages_display: "English, Hindi", experience_months: 60 }, plan);
  assert.ok(fit.bonus >= 11);
  assert.ok(fit.reasons.some((reason) => reason.includes("Hindi")));
  assert.ok(describeSearchPlan(plan).some((criterion) => criterion.importance === "preferred"));
});

test("AI hallucinations are removed from a Cuemath early-learner search", async () => {
  const hallucinated = {
    interpretation: "Teacher, Maths, JEE, Telangana, English and active employees.",
    semantic_query: "JEE Maths teacher Telangana English",
    required: bucket({ track: "Teacher", subjects: ["Maths"], exams: ["JEE"], locations: ["Telangana"], languages: ["English"], grades: [11, 12], keywords: ["Cuemath"], employment_statuses: ["Active employee"], work_mode: "Offline / On-site", maximum_calls: 0 }),
    preferred: bucket({ track: "Teacher", subjects: ["Maths"], exams: ["JEE"], locations: ["Telangana"], languages: ["English"], grades: [11, 12], keywords: ["Cuemath"], employment_statuses: ["Active employee"], work_mode: "Offline / On-site" }),
    excluded: bucket({ track: "Teacher", subjects: ["Maths"], locations: ["Telangana"], keywords: ["Cuemath"], employment_statuses: ["No employment match"], work_mode: "Offline / On-site", maximum_calls: 0 }),
    freshest_first: true,
    confidence: 0.8,
  };
  const env = openAiEnv(hallucinated);
  const plan = await createAiSearchPlan(env, "Early learner teachers who have worked in Cuemath");
  assert.equal(plan.required.track, "Teacher");
  assert.deepEqual(plan.required.keywords, ["Cuemath", "early learner"]);
  assert.deepEqual(plan.required.subjects, []);
  assert.deepEqual(plan.required.exams, []);
  assert.deepEqual(plan.required.locations, []);
  assert.deepEqual(plan.required.languages, []);
  assert.deepEqual(plan.required.grades, []);
  assert.deepEqual(plan.required.employment_statuses, []);
  assert.equal(plan.required.work_mode, "");
  assert.equal(plan.required.maximum_calls, -1);
  assert.deepEqual(describeSearchPlan(plan).filter((item) => item.importance === "preferred"), []);
  assert.deepEqual(describeSearchPlan(plan).filter((item) => item.importance === "excluded"), []);
  assert.equal(plan.freshest_first, false);
  assert.doesNotMatch(plan.interpretation, /JEE|Telangana|English|active employee/i);
  assert.equal(plan.semantic_query, "Early learner teachers who have worked in Cuemath");
  assert.equal(plan.grounded, true);

  plan.required.keywords = plan.required.keywords.filter((keyword) => keyword !== "early learner");
  const afterRecruiterEdit = parseClientSearchPlan(JSON.stringify(plan), "Early learner teachers who have worked in Cuemath");
  assert.deepEqual(afterRecruiterEdit.required.keywords, ["Cuemath"]);
});

test("AI plan converts grammar into structured Biology and alternative exams", async () => {
  const raw = {
    interpretation: "JEE and NEET teacher with Tamil and Bio context",
    semantic_query: "JEE NEET teacher Tamil Nadu Tamil Bio speak teaches",
    required: bucket({
      track: "Teacher", subjects: ["Biology"], exams: ["JEE", "NEET UG"], locations: ["Tamil Nadu"],
      languages: ["Tamil"], keywords: ["Tamil", "Bio", "speak", "teaches"],
    }),
    preferred: bucket(), excluded: bucket(), freshest_first: false, confidence: 0.94,
  };
  const env = openAiEnv(raw);
  const plan = await createAiSearchPlan(env, "JEE or NEET Teacher from Tamil Nadu who can speak Tamil and Teaches Bio");
  assert.deepEqual(plan.required.subjects, ["Biology"]);
  assert.deepEqual(plan.required.exams, ["JEE", "NEET UG"]);
  assert.equal(plan.match_modes.exams, "any");
  assert.deepEqual(plan.required.locations, ["Tamil Nadu"]);
  assert.deepEqual(plan.required.languages, ["Tamil"]);
  assert.deepEqual(plan.required.keywords, []);
  assert.ok(describeSearchPlan(plan).filter((item) => item.field === "exams").every((item) => item.label.startsWith("Exam option:")));
});

test("protected gender instructions are ignored and explained", async () => {
  const raw = {
    interpretation: "Exclude female candidates",
    semantic_query: "JEE NEET Tamil Bio female",
    required: bucket({ track: "Teacher", subjects: ["Biology"], exams: ["JEE", "NEET UG"], locations: ["Tamil Nadu"], languages: ["Tamil"], keywords: ["speak", "dont", "include"] }),
    preferred: bucket(), excluded: bucket({ keywords: ["female"] }), freshest_first: false, confidence: 0.91,
  };
  const env = openAiEnv(raw);
  const query = "JEE or NEET Teacher from Tamil Nadu who can speak Tamil and Teaches Bio dont include female";
  const plan = await createAiSearchPlan(env, query);
  assert.deepEqual(plan.required.keywords, []);
  assert.deepEqual(plan.excluded.keywords, []);
  assert.ok(plan.notices.some((notice) => /Gender filtering was ignored/i.test(notice)));
  assert.doesNotMatch(plan.interpretation, /female|speak|dont|include/i);

  const fallback = fallbackSearchPlan(query);
  assert.deepEqual(fallback.required.keywords, []);
  assert.ok(fallback.notices.length > 0);
});

test("OpenAI interpretation grounds AP/TS to location options the repository can execute", async () => {
  const raw = {
    interpretation: "JEE Physics teacher located in Andhra Pradesh or Telangana",
    semantic_query: "JEE Physics teacher Andhra Pradesh Telangana",
    required: bucket({ track: "Teacher", subjects: ["Physics"], exams: ["JEE"], locations: ["Andhra Pradesh", "Telangana"] }),
    preferred: bucket(), excluded: bucket(), freshest_first: false, confidence: 0.96,
  };
  const plan = await createAiSearchPlan(openAiEnv(raw), "JEE Physics teacher in AP/TS region");
  assert.equal(plan.planner.provider, "openai");
  assert.equal(plan.planner.model, "gpt-5-nano");
  assert.deepEqual(plan.required.locations, ["Andhra Pradesh", "Telangana"]);
  assert.equal(plan.match_modes.locations, "any");
  assert.deepEqual(plan.required.keywords, []);
  assert.ok(describeSearchPlan(plan).filter((item) => item.field === "locations").every((item) => item.label.startsWith("Location option:")));
});
