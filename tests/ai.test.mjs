import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchJsonl, classifyAiFailure, extractResponseText, profileClassification, verificationForIntent } from "../src/ai.js";

test("batch lines use Responses, stored resume files and strict structured output", () => {
  const jsonl = buildBatchJsonl([{
    id: "job-1",
    model: "gpt-5-nano",
    resume_file_id: "file-resume-1",
    resume_mime_type: "application/pdf",
    claims_json: JSON.stringify({ standardized: { subjects: "Physics", levels: "JEE" } }),
  }]);
  const request = JSON.parse(jsonl.trim());
  assert.equal(request.custom_id, "job-1");
  assert.equal(request.url, "/v1/responses");
  assert.equal(request.body.model, "gpt-5-nano");
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, "json_schema");
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.body.text.format.schema.properties.resume_text.type, "string");
  assert.ok(request.body.text.format.schema.required.includes("resume_text"));
  assert.deepEqual(
    request.body.text.format.schema.properties.profile_classification.properties.recommended_track.enum,
    ["Teacher", "Non-teaching", "Unclear"],
  );
  assert.match(request.body.input[0].content[0].text, /resume text only/i);
  assert.match(request.body.input[0].content[0].text, /plain text from the entire resume/i);
  assert.equal(request.body.input[1].content[1].file_id, "file-resume-1");
  assert.equal(request.body.input[1].content[1].detail, "low");
});

test("processed profiles reject unsupported JEE claims by default", () => {
  const profile = {
    facts: [
      { category: "subject", normalized_value: "physics", resume_status: "supported" },
      { category: "exam", normalized_value: "jee", resume_status: "claim_only" },
    ],
  };
  const intent = { subjects: ["Physics"], exams: ["JEE"] };
  assert.deepEqual(verificationForIntent(profile, intent, false), { verified: false, rejected: true });
  assert.deepEqual(verificationForIntent(profile, intent, true), { verified: true, rejected: false });
});

test("processed profiles accept resume-backed exam and subject evidence", () => {
  const profile = {
    facts: [
      { category: "subject", value: "Physics", resume_status: "supported" },
      { category: "exam", value: "IIT-JEE", resume_status: "supported" },
    ],
  };
  assert.equal(verificationForIntent(profile, { subjects: ["Physics"], exams: ["JEE"] }).verified, true);
});

test("batch output text is extracted from the Responses output array", () => {
  const value = extractResponseText({ output: [{ content: [{ type: "output_text", text: "{\"facts\":[]}" }] }] });
  assert.equal(value, '{"facts":[]}');
});

test("resume classification remains separate from the source-sheet category", () => {
  const classification = profileClassification({
    profile_classification: {
      recommended_track: "Non-teaching",
      confidence: 0.91,
      rationale: "The resume describes design work and no teaching history.",
      evidence: [{ quote: "Product Designer", page: 1 }],
    },
  }, "Teacher");
  assert.equal(classification.recommendedTrack, "Non-teaching");
  assert.equal(classification.effectiveTrack, "Non-teaching");
  assert.equal(classification.disagreesWithSource, true);
});

test("AI failures distinguish automatic retries from human-fix issues", () => {
  assert.equal(classifyAiFailure("failed", "OpenAI batch expired").autoRetry, true);
  assert.equal(classifyAiFailure("no_resume", "Drive permission denied").autoRetry, false);
  assert.equal(classifyAiFailure("failed", "Project does not have access to model").category, "OpenAI setup");
  assert.equal(classifyAiFailure("no_resume", "You do not have permission to call DriveApp.getFileById").category, "Connector authorization");
});
