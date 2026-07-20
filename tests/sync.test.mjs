import test from "node:test";
import assert from "node:assert/strict";
import { mergeStandardized, parseSpreadsheetId, standardizeRow } from "../src/sync.js";

test("parses a Google Spreadsheet URL or id", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz123456";
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(parseSpreadsheetId(id), id);
  assert.equal(parseSpreadsheetId("not a sheet"), "");
});

test("standardizes a teacher response and normalizes identity", () => {
  const row = {
    Timestamp: "2026-07-20 09:30:00",
    Name: "  Anita Rao ",
    Email: "ANITA@EXAMPLE.COM",
    Phone: "+91 98765-43210",
    Subject: "Physics",
    Grades: "9 to 12",
    Languages: "English, Hindi",
    Experience: "48 months",
    City: "Bengaluru",
  };
  const mapping = { appliedAt: "Timestamp", fullName: "Name", email: "Email", phone: "Phone", subjects: "Subject", levels: "Grades", languages: "Languages", experienceMonths: "Experience", city: "City" };
  const result = standardizeRow(row, mapping, "Teacher applications");
  assert.equal(result.fullName, "Anita Rao");
  assert.equal(result.email, "anita@example.com");
  assert.equal(result.phone, "919876543210");
  assert.equal(result.track, "Teacher");
  assert.equal(result.experienceMonths, 48);
  assert.match(result.searchText, /physics/);
});

test("standardizes a non-teaching application", () => {
  const row = { Time: "2026-07-20", Name: "Kabir Shah", Email: "kabir@example.com", Track: "Non teaching", Role: "Performance Marketing" };
  const result = standardizeRow(row, { appliedAt: "Time", fullName: "Name", email: "Email", track: "Track", role: "Role" }, "Corporate hiring");
  assert.equal(result.track, "Non-teaching");
  assert.equal(result.role, "Performance Marketing");
});

test("requires a name and a deduplication identity", () => {
  assert.throws(() => standardizeRow({ Time: "2026-07-20" }, { appliedAt: "Time" }, "Test"), /Full name/);
  assert.throws(() => standardizeRow({ Name: "No Identity" }, { fullName: "Name" }, "Test"), /Email or phone/);
});

test("incremental merge keeps old data when a new row is blank", () => {
  assert.deepEqual(mergeStandardized({ city: "Pune", languages: "English" }, { city: "", languages: "Hindi", availability: "20 hours" }), {
    city: "Pune",
    languages: "Hindi",
    availability: "20 hours",
  });
});
