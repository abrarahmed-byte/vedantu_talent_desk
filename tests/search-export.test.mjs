import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchExportRows, createSearchResultsWorkbook, SEARCH_EXPORT_COLUMNS } from "../src/search-export.js";

function zipFiles(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files.set(name, decoder.decode(bytes.slice(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}

const candidate = {
  id: "candidate-1", name: "Meera Rao", email: "meera@example.com", phone: "+91 99999 11111",
  track: "Teacher", effective_track: "Teacher", recommended_track: "Teacher", classification_confidence: 0.91,
  classification_rationale: "Resume shows classroom teaching.", role: "Physics Teacher", subjects: ["Physics"],
  grades: ["Grades 9–12"], boards: ["CBSE"], languages: ["English", "Hindi"], experience_months: 60,
  education: "M.Sc Physics", college: "IIT Delhi", city: "Hyderabad", state: "Telangana", work_mode: "Online",
  applied_at: "2026-07-22T08:00:00.000Z", source_sheet: "Teacher Applications", resume_url: "https://drive.google.com/example",
  resume_text: "Physics faculty at Example Academy. =This remains text", ai_summary: "Experienced Physics teacher.",
  ai_status: "completed", ai_processed_at: "2026-07-22T09:00:00.000Z", employment_status: "No employment match",
  employment_times_hired: 0, view_count: 3, resume_open_count: 2, call_count: 1, interviewer_count: 2, duplicate_count: 1,
  match_percent: 94, match_reasons: ["Physics is required", "Telangana is preferred"], missing_preferences: [],
  details: { pincode: "500032", relocation: "Open", availability: "20 hours/week", sourceLabel: "Teacher Applications" },
  application_history: [{ source: "Teacher Applications", source_row_key: "42", applied_at: "2026-07-22T08:00:00.000Z" }],
  ai_profile: {
    teaching_experience_months: 60, warnings: [], resume_text: "Physics faculty at Example Academy.",
    facts: [{ category: "subject", value: "Physics", resume_status: "supported", evidence: [{ quote: "Physics faculty" }] }],
    employment_history: [{ employer: "Example Academy", title: "Faculty", start_date: "2021", end_date: "2026", evidence: "Physics faculty" }],
    education: [{ qualification: "M.Sc Physics", institution: "IIT Delhi", year: "2020", evidence: "M.Sc Physics" }],
  },
  updated_at: "2026-07-22T09:30:00.000Z",
};

test("search export includes every declared profile column", () => {
  const [row] = buildSearchExportRows([candidate]);
  assert.equal(row.length, SEARCH_EXPORT_COLUMNS.length);
  assert.deepEqual(row[0], { value: 94, type: "percent" });
  assert.ok(String(row[45]).includes("Physics faculty"));
  assert.ok(String(row[46]).includes("subject: Physics"));
});

test("search export creates a real two-sheet XLSX package", () => {
  const bytes = createSearchResultsWorkbook({
    candidates: [candidate], exportedBy: "Abrar Ahmed (abrar@vedantu.com)", exportedAt: "2026-07-22T10:00:00.000Z",
    query: "JEE Physics teacher in Telangana", interpretation: "Teacher · Physics · Telangana", criteria: [{ label: "Physics required" }],
    filters: { track: "All", freshnessDecayDays: "120" },
  });
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), 0x04034b50);
  const files = zipFiles(bytes);
  assert.ok(files.has("[Content_Types].xml"));
  assert.match(files.get("xl/workbook.xml"), /Search Results/);
  assert.match(files.get("xl/workbook.xml"), /Export Details/);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /Match Score \(%\)/);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /Resume Text/);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /=This remains text/);
  assert.doesNotMatch(files.get("xl/worksheets/sheet1.xml"), /<f>/);
  assert.match(files.get("xl/worksheets/sheet2.xml"), /Abrar Ahmed/);
});
