import { createXlsx } from "./xlsx.js";

function json(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function textList(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean).join(" · ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function dateCell(value) {
  return value ? { value, type: "date" } : "";
}

function percentCell(value) {
  const number = Number(value);
  return Number.isFinite(number) ? { value: Math.round(number), type: "percent" } : "";
}

function factText(aiProfile, statuses) {
  return (aiProfile?.facts || []).filter((fact) => statuses.includes(fact.resume_status)).map((fact) => {
    const evidence = (fact.evidence || []).map((item) => item.quote).filter(Boolean).join(" | ");
    return `${fact.category}: ${fact.value}${evidence ? ` — ${evidence}` : ""}`;
  }).join("\n");
}

function historyText(history, fields) {
  return (history || []).map((item) => fields.map((field) => item?.[field]).filter(Boolean).join(" · ")).filter(Boolean).join("\n");
}

function applicationHistoryText(history) {
  return (history || []).map((item) => [item.source, item.applied_at, item.duplicate_kind ? `duplicate: ${item.duplicate_kind}` : "", item.source_row_key ? `row ${item.source_row_key}` : ""].filter(Boolean).join(" · ")).join("\n");
}

export const SEARCH_EXPORT_COLUMNS = [
  { key: "match_score", label: "Match Score (%)", width: 15 },
  { key: "match_reasons", label: "Why This Matched", width: 44 },
  { key: "missing_preferences", label: "Missing Preferences", width: 36 },
  { key: "candidate_id", label: "Candidate ID", width: 38 },
  { key: "full_name", label: "Full Name", width: 28 },
  { key: "email", label: "Email Address", width: 32 },
  { key: "phone", label: "Phone Number", width: 20 },
  { key: "effective_track", label: "Effective Profile Type", width: 21 },
  { key: "ai_track", label: "AI Recommended Type", width: 21 },
  { key: "source_track", label: "Source Profile Type", width: 19 },
  { key: "classification_confidence", label: "AI Classification Confidence (%)", width: 27 },
  { key: "classification_rationale", label: "AI Classification Rationale", width: 55 },
  { key: "role", label: "Role / Function", width: 30 },
  { key: "subjects", label: "Subjects", width: 36 },
  { key: "grades", label: "Grades / Levels", width: 34 },
  { key: "boards", label: "Boards", width: 30 },
  { key: "languages", label: "Languages", width: 28 },
  { key: "experience_months", label: "Experience (Months)", width: 19 },
  { key: "ai_teaching_experience_months", label: "AI Teaching Experience (Months)", width: 28 },
  { key: "education", label: "Education Qualification", width: 34 },
  { key: "college", label: "College / Institution", width: 34 },
  { key: "city", label: "Current City", width: 20 },
  { key: "state", label: "Current State", width: 20 },
  { key: "pincode", label: "Current Pincode", width: 16 },
  { key: "work_mode", label: "Preferred Work Mode", width: 23 },
  { key: "relocation", label: "Relocation Preference", width: 30 },
  { key: "experience_type", label: "Experience Type", width: 28 },
  { key: "opportunities", label: "Vedantu Opportunities", width: 38 },
  { key: "formats", label: "Teaching Formats", width: 28 },
  { key: "availability", label: "Availability", width: 22 },
  { key: "earliest_joining_date", label: "Earliest Joining Date", width: 21 },
  { key: "engagement_type", label: "Preferred Engagement Type", width: 27 },
  { key: "pay_model", label: "Preferred Pay Model", width: 24 },
  { key: "current_ctc_lakhs", label: "Current Annual CTC (Lakhs)", width: 26 },
  { key: "discovery_source", label: "How They Heard", width: 28 },
  { key: "referrer", label: "Referrer", width: 30 },
  { key: "consent", label: "Declaration and Consent", width: 32 },
  { key: "motivation", label: "Why Vedantu", width: 55 },
  { key: "latest_application", label: "Latest Application Date", width: 22 },
  { key: "application_history", label: "Application History", width: 54 },
  { key: "source_sheet", label: "Latest Source Sheet", width: 30 },
  { key: "resume_url", label: "Resume Link", width: 50 },
  { key: "demo_video_url", label: "Demo Teaching Video", width: 50 },
  { key: "portfolio_url", label: "Portfolio / Channel", width: 50 },
  { key: "resume_summary", label: "AI Resume Summary", width: 60 },
  { key: "resume_text", label: "Resume Text", width: 80 },
  { key: "resume_evidence", label: "Resume-backed Evidence", width: 70 },
  { key: "form_only_claims", label: "Form-only Claims", width: 60 },
  { key: "contradictions", label: "Contradictions", width: 60 },
  { key: "ai_warnings", label: "AI Warnings", width: 60 },
  { key: "resume_employment_history", label: "Resume Employment History", width: 65 },
  { key: "resume_education_history", label: "Resume Education History", width: 65 },
  { key: "ai_review_status", label: "AI Review Status", width: 18 },
  { key: "ai_processed_at", label: "AI Processed At", width: 22 },
  { key: "employment_status", label: "Vedantu Employment Status", width: 24 },
  { key: "times_hired", label: "Times Hired", width: 14 },
  { key: "views", label: "Profile Views", width: 14 },
  { key: "resume_opens", label: "Resume Opens", width: 14 },
  { key: "calls", label: "Calls Logged", width: 14 },
  { key: "interviewers", label: "Unique Interviewers", width: 18 },
  { key: "duplicates", label: "Duplicate Rows Merged", width: 21 },
  { key: "source_row_text", label: "Consolidated Source Row Text", width: 70 },
  { key: "standardized_json", label: "Standardized Form Data (JSON)", width: 70 },
  { key: "ai_profile_json", label: "AI Structured Profile (JSON)", width: 70 },
  { key: "updated_at", label: "Profile Last Updated", width: 22 },
];

export function buildSearchExportRows(candidates) {
  return (candidates || []).map((candidate) => {
    const details = json(candidate.details);
    const ai = json(candidate.ai_profile, null);
    return [
      percentCell(candidate.match_percent), textList(candidate.match_reasons), textList(candidate.missing_preferences), candidate.id,
      candidate.name, candidate.email, candidate.phone, candidate.effective_track, candidate.recommended_track, candidate.track,
      percentCell((Number(candidate.classification_confidence) || 0) * 100), candidate.classification_rationale, candidate.role,
      textList(candidate.subjects), textList(candidate.grades), textList(candidate.boards), textList(candidate.languages),
      Number(candidate.experience_months) || 0, Number(ai?.teaching_experience_months) || 0, candidate.education || details.education,
      candidate.college || details.college, candidate.city || details.city, candidate.state || details.state, details.pincode,
      candidate.work_mode || details.workMode, details.relocation, details.experienceType, details.opportunities, details.formats,
      details.availability, details.earliestJoiningDate, details.engagementType, details.payModel, details.currentCtcLakhs,
      details.discoverySource, details.referrer, details.consent, details.motivation, dateCell(candidate.applied_at),
      applicationHistoryText(candidate.application_history), candidate.source_sheet, candidate.resume_url || details.resumeUrl,
      details.demoVideoUrl, details.portfolioUrl, candidate.ai_summary || ai?.summary, candidate.resume_text || ai?.resume_text,
      factText(ai, ["supported"]), factText(ai, ["claim_only"]), factText(ai, ["contradicted"]), textList(ai?.warnings),
      historyText(ai?.employment_history, ["employer", "title", "start_date", "end_date", "evidence"]),
      historyText(ai?.education, ["qualification", "institution", "year", "evidence"]), candidate.ai_status,
      dateCell(candidate.ai_processed_at), candidate.employment_status, Number(candidate.employment_times_hired) || 0,
      Number(candidate.view_count) || 0, Number(candidate.resume_open_count) || 0, Number(candidate.call_count) || 0,
      Number(candidate.interviewer_count) || 0, Number(candidate.duplicate_count) || 0, candidate.row_text, JSON.stringify(details || {}),
      ai ? JSON.stringify(ai) : "", dateCell(candidate.updated_at),
    ];
  });
}

export function createSearchResultsWorkbook({ candidates, exportedBy, exportedAt, query, interpretation, criteria, filters }) {
  const results = buildSearchExportRows(candidates);
  const metadata = [
    ["Exported at", dateCell(exportedAt)], ["Exported by", exportedBy], ["Search query", query || "All profiles"],
    ["AI interpretation", interpretation || "All profiles"], ["Profiles exported", { value: results.length, type: "number" }],
    ["Search criteria", textList((criteria || []).map((item) => item.label || item))], ["Filters", JSON.stringify(filters || {})],
    ["Note", "Match scores and criteria reflect the Talent Desk search at the time of export. Activity, employment and AI evidence fields are a timestamped snapshot."],
  ];
  return createXlsx([
    { name: "Search Results", columns: SEARCH_EXPORT_COLUMNS, rows: results, freezeColumns: 4 },
    { name: "Export Details", columns: [{ label: "Field", width: 28 }, { label: "Value", width: 80 }], rows: metadata, freezeColumns: 1 },
  ]);
}
