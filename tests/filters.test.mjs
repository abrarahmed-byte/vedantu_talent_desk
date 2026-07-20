import test from "node:test";
import assert from "node:assert/strict";
import { EXPERIENCE_FILTERS, languageFilterValues, subjectFilterTerms, subjectFilterValues, workModeFilterValues } from "../src/filters.js";

test("free-text subjects become a concise recruiter taxonomy", () => {
  const values = subjectFilterValues([
    { value: "All subjects from class 3rd to 8th and Computer Science with coding" },
    { value: "Mathematics, Physics, JEE Main and Olympiad" },
    { value: "Academic Operations Manager" },
  ]);
  assert.deepEqual(values, ["Mathematics", "Physics", "Computer Science & Coding", "JEE", "Olympiad", "Academic Operations"]);
});

test("canonical subjects retain aliases used by candidate rows", () => {
  assert.deepEqual(subjectFilterTerms("Mathematics"), ["mathematics", "maths", "math"]);
  assert.ok(subjectFilterTerms("Biology").includes("botany"));
});

test("languages and work modes merge spelling variants", () => {
  assert.deepEqual(languageFilterValues([{ value: "English, Hindi, Oriya" }]), ["English", "Hindi", "Odia"]);
  assert.deepEqual(workModeFilterValues([{ value: "Remote (Online)" }, { value: "Offline (On-site)" }, { value: "Hybrid" }]), ["Online / Remote", "Offline / On-site", "Hybrid"]);
});

test("experience filters cover early through senior profiles", () => {
  assert.deepEqual(EXPERIENCE_FILTERS.map((item) => item.value), [0, 6, 12, 24, 36, 48, 60, 72, 96, 120]);
});
