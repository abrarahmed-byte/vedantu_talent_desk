import assert from "node:assert/strict";
import test from "node:test";
import { buildFtsQuery, parseSearchIntent, scoreCandidate } from "../src/search.js";

test("natural language query becomes safe indexed search terms", () => {
  const fts = buildFtsQuery("Maths teachers in Bangalore for grades 9-12 who speak Hindi");
  assert.match(fts, /"maths"/);
  assert.match(fts, /"mathematics"/);
  assert.match(fts, /"bengaluru"/);
  assert.doesNotMatch(fts, /\bin\b/);
});

test("intent parser understands track, location, grades, language and experience", () => {
  const intent = parseSearchIntent("Physics teacher in Gurgaon for grades 9 to 12, Hindi, 4 years experience");
  assert.equal(intent.track, "Teacher");
  assert.deepEqual(intent.subjects, ["Physics"]);
  assert.ok(intent.locations.includes("Gurugram"));
  assert.deepEqual(intent.grades, [9, 10, 11, 12]);
  assert.ok(intent.languages.includes("Hindi"));
  assert.equal(intent.minimumExperienceMonths, 48);
});

test("relevance and freshness produce a transparent bounded score", () => {
  const intent = parseSearchIntent("fresh physics teacher, Hindi, grades 11-12");
  const candidate = {
    track: "Teacher",
    search_text: "physics teacher faculty hindi grades class 11 12",
    experience_months: 60,
    applied_at: new Date().toISOString(),
  };
  const score = scoreCandidate(candidate, "fresh physics teacher, Hindi, grades 11-12", intent);
  assert.ok(score >= 80 && score <= 99);
});
