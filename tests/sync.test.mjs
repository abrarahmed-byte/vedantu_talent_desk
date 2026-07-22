import test from "node:test";
import assert from "node:assert/strict";
import { APPLICATION_SYNC_BATCH_SIZE, connectorRequest, connectorTimeoutMessage, connectorTimeoutMs, EMPLOYMENT_SYNC_BATCH_SIZE, mergeStandardized, parseSpreadsheetId, standardizeEmploymentRow, standardizeRow, withIdentityLocks } from "../src/sync.js";

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

test("standardizes GreytHR employee rows with work and personal identities", () => {
  const row = {
    "Employee Number": "VD1234",
    "Employee Name": "Anita Rao",
    Email: "anita.rao@vedantu.com",
    "Employee Personal Email": "anita@example.com",
    Phone: "+91 98765 43210",
    "Date Of Joining": "10 Jul 2022",
  };
  const mapping = {
    employeeId: "Employee Number",
    fullName: "Employee Name",
    workEmail: "Email",
    personalEmail: "Employee Personal Email",
    phone: "Phone",
    joiningDate: "Date Of Joining",
    _employmentStatus: "Active employee",
  };
  const result = standardizeEmploymentRow(row, mapping, "GreytHR Active");
  assert.equal(result.employeeId, "VD1234");
  assert.equal(result.workEmail, "anita.rao@vedantu.com");
  assert.equal(result.personalEmail, "anita@example.com");
  assert.equal(result.phone, "919876543210");
  assert.equal(result.employmentStatus, "Active employee");
  assert.equal(result.identities.length, 3);
});

test("incremental merge keeps old data when a new row is blank", () => {
  assert.deepEqual(mergeStandardized({ city: "Pune", languages: "English" }, { city: "", languages: "Hindi", availability: "20 hours" }), {
    city: "Pune",
    languages: "Hindi",
    availability: "20 hours",
  });
});

test("parallel imports serialize rows that share an identity", async () => {
  const locks = new Map();
  let active = 0;
  let maximumActive = 0;
  const run = () => withIdentityLocks(locks, [{ type: "email", value: "same@example.com" }], async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });
  await Promise.all([run(), run(), run()]);
  assert.equal(maximumActive, 1);
});

test("temporary connector failures are marked for an automatic retry", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 503 }));
  await assert.rejects(
    connectorRequest({ APPS_SCRIPT_CONNECTOR_URL: "https://connector.example", CONNECTOR_SECRET: "test" }, { action: "readRows" }),
    (error) => error.retryable === true,
  );
});

test("interactive Sheet previews wait for Apps Script cold starts without promising a background retry", () => {
  assert.equal(connectorTimeoutMs("preview"), 90000);
  assert.equal(connectorTimeoutMs("readRows"), 90000);
  assert.match(connectorTimeoutMessage("preview"), /Select Read columns again/);
  assert.doesNotMatch(connectorTimeoutMessage("preview"), /retry automatically/i);
  assert.match(connectorTimeoutMessage("readRows"), /background sync will retry automatically/i);
});

test("source batches stay below the Cloudflare Free subrequest ceiling", () => {
  assert.equal(APPLICATION_SYNC_BATCH_SIZE, 2);
  assert.equal(EMPLOYMENT_SYNC_BATCH_SIZE, 4);
});
