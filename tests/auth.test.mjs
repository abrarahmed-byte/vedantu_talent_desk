import test from "node:test";
import assert from "node:assert/strict";
import { roleAtLeast } from "../src/auth.js";

test("Admin includes Recruiter permissions", () => {
  assert.equal(roleAtLeast("Admin", "Recruiter"), true);
  assert.equal(roleAtLeast("Admin", "Admin"), true);
});

test("Recruiter cannot perform Admin actions", () => {
  assert.equal(roleAtLeast("Recruiter", "Admin"), false);
  assert.equal(roleAtLeast("Recruiter", "Recruiter"), true);
});
