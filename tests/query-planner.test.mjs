import assert from "node:assert/strict";
import test from "node:test";
import {
  createAiSearchPlan,
  describeSearchPlan,
  fallbackSearchPlan,
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
  const env = {
    AI: { run: async (_model, input) => { request = input; return { response: JSON.stringify(raw) }; } },
  };
  const plan = await createAiSearchPlan(env, "JEE Physics in Telangana, prefer Hindi and no previous calls");
  assert.deepEqual(plan.required.subjects, ["Physics"]);
  assert.deepEqual(plan.preferred.languages, ["Hindi"]);
  assert.equal(plan.required.maximum_calls, 0);
  assert.equal(request.response_format.type, "json_schema");
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
