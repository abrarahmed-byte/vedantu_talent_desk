import assert from "node:assert/strict";
import test from "node:test";
import { buildFtsQuery, matchesMandatoryIntent, parseSearchIntent, scoreCandidate } from "../src/search.js";

test("natural language query becomes safe indexed search terms", () => {
  const fts = buildFtsQuery("Maths teachers in Bangalore for grades 9-12 who speak Hindi");
  assert.match(fts, /"maths"/);
  assert.match(fts, /"mathematics"/);
  assert.match(fts, /"bengaluru"/);
  assert.doesNotMatch(fts, /\bin\b/);
});

test("an arbitrary employer keyword remains an exact full-text term", () => {
  assert.equal(buildFtsQuery("Unacademy"), '\"unacademy\"');
  assert.deepEqual(parseSearchIntent("Unacademy").keywords, ["unacademy"]);
});

test("employer names remain mandatory beside structured teaching criteria", () => {
  const intent = parseSearchIntent("Physics teacher with Unacademy experience in Telangana");
  assert.deepEqual(intent.subjects, ["Physics"]);
  assert.deepEqual(intent.locations, ["Telangana"]);
  assert.deepEqual(intent.keywords, ["unacademy"]);
});

test("field routing separates Tamil Nadu from Tamil language and keeps the employer", () => {
  const intent = parseSearchIntent("Math teachers in Tamil Nadu worked in Unacademy");
  assert.equal(intent.track, "Teacher");
  assert.deepEqual(intent.subjects, ["Mathematics"]);
  assert.deepEqual(intent.locations, ["Tamil Nadu"]);
  assert.deepEqual(intent.languages, []);
  assert.deepEqual(intent.keywords, ["unacademy"]);
});

test("common abbreviated subjects map to the standardized subject column", () => {
  const intent = parseSearchIntent("Chem teachers in Tamil Nadu worked in Unacademy");
  assert.deepEqual(intent.subjects, ["Chemistry"]);
  assert.deepEqual(intent.keywords, ["unacademy"]);
});

test("working for a named company is not mistaken for a location", () => {
  const intent = parseSearchIntent("Early learner teachers who have worked in Cuemath");
  assert.equal(intent.track, "Teacher");
  assert.deepEqual(intent.locations, []);
  assert.deepEqual(intent.keywords, ["early", "learner", "cuemath"]);
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

test("Indian states are parsed and enforced as mandatory locations", () => {
  const intent = parseSearchIntent("JEE Physics teacher in Telangana");
  assert.deepEqual(intent.locations, ["Telangana"]);
  assert.equal(matchesMandatoryIntent({
    track: "Teacher", subject_display: "Physics", grades_display: "JEE Main", city: "Hyderabad", state: "Telangana",
    languages_display: "English", experience_months: 48,
  }, intent), true);
  assert.equal(matchesMandatoryIntent({
    track: "Teacher", subject_display: "Physics", grades_display: "JEE Main", city: "Kochi", state: "Kerala",
    languages_display: "English", experience_months: 48,
  }, intent), false);
});

test("location aliases and smaller contextually named cities match canonical fields", () => {
  const bengaluru = parseSearchIntent("Maths teacher in Bangalore");
  assert.deepEqual(bengaluru.locations, ["Bengaluru"]);
  assert.equal(matchesMandatoryIntent({ track: "Teacher", subject_display: "Mathematics", city: "Bangalore", state: "Karnataka", grades_display: "", languages_display: "", experience_months: 0 }, bengaluru), true);
  const tirupati = parseSearchIntent("teacher based in Tirupati");
  assert.ok(tirupati.locations.includes("Tirupati"));
  assert.equal(matchesMandatoryIntent({ track: "Teacher", subject_display: "", city: "Tirupati", state: "Andhra Pradesh", grades_display: "", languages_display: "", experience_months: 0 }, tirupati), true);
});

test("skills and exam phrases are not mistaken for locations", () => {
  assert.deepEqual(parseSearchIntent("Physics teacher experienced in JEE").locations, []);
  assert.deepEqual(parseSearchIntent("candidate proficient in Python").locations, []);
});

test("six-digit pin codes are parsed and enforced", () => {
  const intent = parseSearchIntent("teacher in Hyderabad 500032");
  assert.deepEqual(intent.pincodes, ["500032"]);
  assert.equal(matchesMandatoryIntent({ track: "Teacher", subject_display: "", city: "Hyderabad", state: "Telangana", grades_display: "", languages_display: "", experience_months: 0, search_text: "Hyderabad Telangana 500032" }, intent), true);
  assert.equal(matchesMandatoryIntent({ track: "Teacher", subject_display: "", city: "Hyderabad", state: "Telangana", grades_display: "", languages_display: "", experience_months: 0, search_text: "Hyderabad Telangana 500081" }, intent), false);
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

test("JEE is parsed as an explicit teaching-level requirement", () => {
  const intent = parseSearchIntent("JEE Physics teachers");
  assert.deepEqual(intent.subjects, ["Physics"]);
  assert.deepEqual(intent.exams, ["JEE"]);
});

test("Bio is normalized to Biology instead of becoming a loose keyword", () => {
  const intent = parseSearchIntent("Bio");
  assert.deepEqual(intent.subjects, ["Biology"]);
  assert.deepEqual(intent.keywords, []);
});

test("natural grammar is removed and JEE or NEET remains an alternative", () => {
  const intent = parseSearchIntent("JEE or NEET Teacher from Tamil Nadu who can speak Tamil and Teaches Bio");
  assert.equal(intent.track, "Teacher");
  assert.deepEqual(intent.subjects, ["Biology"]);
  assert.deepEqual(intent.exams, ["JEE", "NEET UG"]);
  assert.equal(intent.examMatchMode, "any");
  assert.deepEqual(intent.locations, ["Tamil Nadu"]);
  assert.deepEqual(intent.languages, ["Tamil"]);
  assert.deepEqual(intent.keywords, []);
});

test("date grammar and conjunctions do not become resume keywords", () => {
  const intent = parseSearchIntent("Teachers who can speak Tamil but in Tamil Nadu and applied in the past 7 days");
  assert.equal(intent.track, "Teacher");
  assert.deepEqual(intent.locations, ["Tamil Nadu"]);
  assert.deepEqual(intent.languages, ["Tamil"]);
  assert.deepEqual(intent.keywords, []);
});

test("either JEE or NEET can satisfy an explicitly alternative exam request", () => {
  const intent = parseSearchIntent("JEE or NEET Teacher from Tamil Nadu who speaks Tamil and teaches Bio");
  const base = {
    track: "Teacher", subject_display: "Biology", languages_display: "Tamil", city: "Chennai",
    state: "Tamil Nadu", experience_months: 24,
  };
  assert.equal(matchesMandatoryIntent({ ...base, grades_display: "JEE Main" }, intent), true);
  assert.equal(matchesMandatoryIntent({ ...base, grades_display: "NEET UG" }, intent), true);
  assert.equal(matchesMandatoryIntent({ ...base, grades_display: "Foundation" }, intent), false);
});

test("AP/TS recruiting shorthand expands into searchable location options", () => {
  const intent = parseSearchIntent("JEE Physics teacher in AP/TS region");
  assert.deepEqual(intent.locations, ["Andhra Pradesh", "Telangana"]);
  assert.equal(intent.locationMatchMode, "any");
  assert.deepEqual(intent.keywords, []);
  const base = { track: "Teacher", subject_display: "Physics", grades_display: "JEE Main", languages_display: "", experience_months: 0 };
  assert.equal(matchesMandatoryIntent({ ...base, city: "Vijayawada", state: "Andhra Pradesh" }, intent), true);
  assert.equal(matchesMandatoryIntent({ ...base, city: "Hyderabad", state: "Telangana" }, intent), true);
  assert.equal(matchesMandatoryIntent({ ...base, city: "Bengaluru", state: "Karnataka" }, intent), false);
});

test("a Foundation-only Physics profile cannot satisfy a JEE Physics search", () => {
  const intent = parseSearchIntent("JEE Physics");
  const foundationOnly = {
    track: "Teacher",
    subject_display: "Mathematics, Physics",
    grades_display: "Foundation (Grades 8 to 10)",
    languages_display: "English, Telugu",
    city: "Tirupati",
    state: "Andhra Pradesh",
    experience_months: 0,
  };
  assert.equal(matchesMandatoryIntent(foundationOnly, intent), false);
});

test("an explicit JEE Physics profile passes field-level requirements", () => {
  const intent = parseSearchIntent("Physics teacher for grades 11-12 with JEE experience");
  const jeePhysics = {
    track: "Teacher",
    role: "Physics faculty",
    subject_display: "Physics",
    grades_display: "Grade 11 to 12, JEE Main, JEE Advanced",
    languages_display: "English, Hindi",
    city: "Kochi",
    state: "Kerala",
    experience_months: 60,
  };
  assert.equal(matchesMandatoryIntent(jeePhysics, intent), true);
});
