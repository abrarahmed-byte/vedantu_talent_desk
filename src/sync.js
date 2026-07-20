export const CANONICAL_FIELDS = [
  { key: "appliedAt", label: "Timestamp / applied date", required: true, aliases: ["timestamp", "applied date", "application date"] },
  { key: "email", label: "Email address", required: false, aliases: ["email address", "email"] },
  { key: "fullName", label: "Full name", required: true, aliases: ["full name", "candidate name", "name"] },
  { key: "phone", label: "Phone number", required: false, aliases: ["phone number", "mobile number", "phone", "mobile"] },
  { key: "track", label: "Hiring track", required: false, aliases: ["track", "teacher vs non teacher", "hiring type"] },
  { key: "role", label: "Role / opportunity", required: false, aliases: ["role", "opportunity", "function"] },
  { key: "city", label: "Current city", required: false, aliases: ["current city", "city"] },
  { key: "state", label: "Current state", required: false, aliases: ["current state", "state"] },
  { key: "pincode", label: "Current pincode", required: false, aliases: ["current pincode", "pincode", "pin code"] },
  { key: "relocation", label: "Relocation preference", required: false, aliases: ["relocation", "open to relocation"] },
  { key: "subjects", label: "Subjects / function", required: false, aliases: ["subjects you can teach", "subjects", "subject", "function"] },
  { key: "levels", label: "Levels / grades", required: false, aliases: ["levels you can teach", "grades", "levels"] },
  { key: "boards", label: "Boards", required: false, aliases: ["boards you are comfortable with", "boards", "board"] },
  { key: "languages", label: "Teaching languages", required: false, aliases: ["teaching languages", "languages", "language"] },
  { key: "experienceMonths", label: "Experience in months", required: false, aliases: ["teaching experience in months", "experience in months", "experience months"] },
  { key: "experienceType", label: "Experience type", required: false, aliases: ["experience type"] },
  { key: "opportunities", label: "Vedantu opportunities", required: false, aliases: ["which vedantu opportunities", "opportunities"] },
  { key: "formats", label: "Teaching formats", required: false, aliases: ["teaching formats", "formats"] },
  { key: "resumeUrl", label: "Resume link", required: false, aliases: ["resume link", "resume url", "cv link"] },
  { key: "demoVideoUrl", label: "Demo teaching video", required: false, aliases: ["demo teaching video", "demo video"] },
  { key: "portfolioUrl", label: "Portfolio / channel", required: false, aliases: ["portfolio", "youtube channel", "instagram"] },
  { key: "motivation", label: "Why Vedantu", required: false, aliases: ["why you want to teach", "why vedantu", "motivation"] },
  { key: "earliestJoiningDate", label: "Earliest joining date", required: false, aliases: ["earliest joining date", "joining date"] },
  { key: "availability", label: "Availability", required: false, aliases: ["availability", "hours per week"] },
  { key: "engagementType", label: "Preferred engagement type", required: false, aliases: ["preferred engagement type", "engagement type"] },
  { key: "payModel", label: "Preferred pay model", required: false, aliases: ["preferred pay model", "pay model"] },
  { key: "currentCtcLakhs", label: "Current annual CTC", required: false, aliases: ["current annual ctc", "annual ctc", "ctc"] },
  { key: "discoverySource", label: "How they heard", required: false, aliases: ["how did you hear", "source"] },
  { key: "referrer", label: "Referrer", required: false, aliases: ["referrer name", "referred by", "referrer"] },
  { key: "consent", label: "Declaration and consent", required: false, aliases: ["declaration and consent", "consent"] },
  { key: "workMode", label: "Preferred work mode", required: false, aliases: ["preferred work mode", "work mode"] },
  { key: "education", label: "Education qualification", required: false, aliases: ["education qualification", "qualification", "education"] },
  { key: "college", label: "College / institution", required: false, aliases: ["college", "institution", "university"] },
];

export const EMPLOYMENT_FIELDS = [
  { key: "employeeId", label: "Employee number", required: false, aliases: ["employee number", "employee id", "emp id"] },
  { key: "fullName", label: "Employee name", required: false, aliases: ["employee name", "full name", "name"] },
  { key: "workEmail", label: "Work email", required: false, aliases: ["email", "work email", "official email"] },
  { key: "personalEmail", label: "Personal email", required: false, aliases: ["employee personal email", "personal email"] },
  { key: "phone", label: "Phone number", required: false, aliases: ["phone", "phone number", "mobile", "mobile number"] },
  { key: "joiningDate", label: "Date of joining", required: false, aliases: ["date of joining", "joining date", "doj"] },
  { key: "leavingDate", label: "Leaving date", required: false, aliases: ["leaving date", "date of leaving", "exit date"] },
  { key: "leavingReason", label: "Leaving reason", required: false, aliases: ["leaving reason", "exit reason"] },
  { key: "designation", label: "Designation", required: false, aliases: ["designation", "job title", "role"] },
  { key: "department", label: "Department", required: false, aliases: ["department"] },
  { key: "businessUnit", label: "Business unit", required: false, aliases: ["businessunit", "business unit", "division"] },
  { key: "location", label: "Work location", required: false, aliases: ["location", "work location"] },
  { key: "employeeType", label: "Employee type", required: false, aliases: ["employeetype", "employee type"] },
  { key: "employeeSubtype", label: "Employee subtype", required: false, aliases: ["employeesubtype", "employee subtype"] },
  { key: "contractEndDate", label: "Contract end date", required: false, aliases: ["contract end date"] },
];

const SYNC_BATCH_SIZE = 50;
const SYNC_BATCHES_PER_RUN = 1;

function text(value, max = 1000) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join(" · ").slice(0, max);
  return String(value ?? "").trim().slice(0, max);
}

function mapped(row, mapping, key, max = 1000) {
  const header = text(mapping?.[key], 300);
  return header ? text(row?.[header], max) : "";
}

export function normalizeEmail(value) {
  return text(value, 320).toLowerCase().replace(/^mailto:/, "");
}

export function normalizePhone(value) {
  return text(value, 80).replace(/\D/g, "");
}

export function parseSpreadsheetId(value) {
  const input = text(value, 1000);
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(input) ? input : "";
}

function isoDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "1970-01-01T00:00:00.000Z" : parsed.toISOString();
}

function initials(name) {
  return text(name, 160).split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function meaningful(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

export function mergeStandardized(existing, incoming) {
  return { ...(existing || {}), ...meaningful(incoming || {}) };
}

export function standardizeRow(row, mapping, sourceLabel) {
  const fullName = mapped(row, mapping, "fullName", 200);
  const email = normalizeEmail(mapped(row, mapping, "email", 320));
  const phone = normalizePhone(mapped(row, mapping, "phone", 80));
  if (!fullName) throw new Error("Full name is missing");
  if (!email && !phone) throw new Error("Email or phone is required for deduplication");

  const subjects = mapped(row, mapping, "subjects", 600);
  const levels = mapped(row, mapping, "levels", 600);
  const boards = mapped(row, mapping, "boards", 600);
  const languages = mapped(row, mapping, "languages", 600);
  const opportunities = mapped(row, mapping, "opportunities", 600);
  const explicitTrack = mapped(row, mapping, "track", 80).toLowerCase();
  const teacherSignals = [subjects, levels, boards, languages].join(" ").trim();
  const track = explicitTrack.includes("non") ? "Non-teaching" : explicitTrack.includes("teach") || teacherSignals ? "Teacher" : "Non-teaching";
  const role = mapped(row, mapping, "role", 240) || opportunities || (track === "Teacher" && subjects ? `${subjects.split("·")[0].trim()} Teacher` : "");
  const experienceMonths = Math.max(0, Math.round(Number(mapped(row, mapping, "experienceMonths", 40).replace(/[^0-9.]/g, "")) || 0));
  const appliedAt = isoDate(mapped(row, mapping, "appliedAt", 120));
  const details = meaningful({
    appliedAt,
    email,
    fullName,
    phone,
    track,
    role,
    city: mapped(row, mapping, "city", 160),
    state: mapped(row, mapping, "state", 160),
    pincode: mapped(row, mapping, "pincode", 40),
    relocation: mapped(row, mapping, "relocation", 300),
    subjects,
    levels,
    boards,
    languages,
    experienceMonths,
    experienceType: mapped(row, mapping, "experienceType", 300),
    opportunities,
    formats: mapped(row, mapping, "formats", 300),
    resumeUrl: mapped(row, mapping, "resumeUrl", 1200),
    demoVideoUrl: mapped(row, mapping, "demoVideoUrl", 1200),
    portfolioUrl: mapped(row, mapping, "portfolioUrl", 1200),
    motivation: mapped(row, mapping, "motivation", 1200),
    earliestJoiningDate: mapped(row, mapping, "earliestJoiningDate", 120),
    availability: mapped(row, mapping, "availability", 160),
    engagementType: mapped(row, mapping, "engagementType", 240),
    payModel: mapped(row, mapping, "payModel", 240),
    currentCtcLakhs: mapped(row, mapping, "currentCtcLakhs", 80),
    discoverySource: mapped(row, mapping, "discoverySource", 300),
    referrer: mapped(row, mapping, "referrer", 300),
    consent: mapped(row, mapping, "consent", 300),
    workMode: mapped(row, mapping, "workMode", 100),
    education: mapped(row, mapping, "education", 500),
    college: mapped(row, mapping, "college", 300),
    sourceLabel: text(sourceLabel, 200),
  });

  const rowText = [fullName, role, subjects, levels, boards, languages, details.city, details.state, details.education, details.college, details.workMode, opportunities, ...Object.values(row || {})]
    .map((value) => text(value, 2000).toLowerCase()).filter(Boolean).join(" ").slice(0, 30000);

  return {
    fullName,
    initials: initials(fullName),
    email,
    phone,
    track,
    role,
    city: details.city || "",
    state: details.state || "",
    subjects,
    levels,
    boards,
    languages,
    education: details.education || "",
    college: details.college || "",
    experienceMonths,
    workMode: details.workMode || "",
    appliedAt,
    resumeUrl: details.resumeUrl || "",
    resumeSummary: details.motivation || "",
    rowText,
    searchText: rowText,
    details,
    identities: [email ? { type: "email", value: email } : null, phone ? { type: "phone", value: phone } : null].filter(Boolean),
  };
}

export function standardizeEmploymentRow(row, mapping, sourceLabel) {
  const workEmail = normalizeEmail(mapped(row, mapping, "workEmail", 320));
  const personalEmail = normalizeEmail(mapped(row, mapping, "personalEmail", 320));
  const phone = normalizePhone(mapped(row, mapping, "phone", 80));
  if (!workEmail && !personalEmail && !phone) throw new Error("Work email, personal email, or phone is required for employment matching");
  const employmentStatus = mapping?._employmentStatus === "Active employee" ? "Active employee" : "Former employee";
  return {
    employeeId: mapped(row, mapping, "employeeId", 120),
    fullName: mapped(row, mapping, "fullName", 200),
    workEmail,
    personalEmail,
    phone,
    joiningDate: mapped(row, mapping, "joiningDate", 120),
    leavingDate: mapped(row, mapping, "leavingDate", 120),
    leavingReason: mapped(row, mapping, "leavingReason", 500),
    designation: mapped(row, mapping, "designation", 240),
    department: mapped(row, mapping, "department", 240),
    businessUnit: mapped(row, mapping, "businessUnit", 240),
    location: mapped(row, mapping, "location", 240),
    employeeType: mapped(row, mapping, "employeeType", 160),
    employeeSubtype: mapped(row, mapping, "employeeSubtype", 160),
    contractEndDate: mapped(row, mapping, "contractEndDate", 120),
    employmentStatus,
    sourceLabel: text(sourceLabel, 200),
    identities: [
      workEmail ? { type: "email", value: workEmail } : null,
      personalEmail ? { type: "email", value: personalEmail } : null,
      phone ? { type: "phone", value: phone } : null,
    ].filter(Boolean),
  };
}

async function hashRow(row) {
  const bytes = new TextEncoder().encode(JSON.stringify(row));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function withIdentityLocks(locks, identities, task) {
  const keys = identities.map((identity) => `${identity.type}:${identity.value}`).sort();
  const predecessors = keys.map((key) => locks.get(key) || Promise.resolve());
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const gate = Promise.all(predecessors).then(() => current);
  keys.forEach((key) => locks.set(key, gate));
  await Promise.all(predecessors);
  try {
    return await task();
  } finally {
    release();
    keys.forEach((key) => { if (locks.get(key) === gate) locks.delete(key); });
  }
}

async function resolveCandidate(env, identities) {
  const candidateIds = new Set();
  for (const identity of identities) {
    const found = await env.DB.prepare("SELECT candidate_id FROM candidate_identities WHERE identity_type = ? AND identity_value = ? LIMIT 1")
      .bind(identity.type, identity.value).first();
    if (found?.candidate_id) candidateIds.add(found.candidate_id);
  }
  if (candidateIds.size > 1) throw new Error("Email and phone match different existing profiles; manual duplicate review is required");
  return [...candidateIds][0] || "";
}

async function candidateIdentities(env, candidateId) {
  const result = await env.DB.prepare(
    "SELECT identity_type AS type, identity_value AS value FROM candidate_identities WHERE candidate_id = ?",
  ).bind(candidateId).all();
  return result.results || [];
}

export async function reconcileCandidateEmployment(env, candidateId, identities) {
  const usable = (identities || []).filter((identity) => identity?.value && ["email", "phone"].includes(identity.type));
  if (!candidateId || !usable.length) return;
  const clauses = [];
  const bindings = [];
  for (const identity of usable) {
    if (identity.type === "email") {
      clauses.push("(work_email = ? OR personal_email = ?)");
      bindings.push(identity.value, identity.value);
    } else {
      clauses.push("phone = ?");
      bindings.push(identity.value);
    }
  }
  const result = await env.DB.prepare(`SELECT source_id, source_row_key, employee_id, work_email, personal_email, phone,
    joining_date, employment_status FROM employment_records WHERE ${clauses.join(" OR ")}`).bind(...bindings).all();
  const records = result.results || [];
  let status = "No employment match";
  if (records.some((record) => record.employment_status === "Active employee")) status = "Active employee";
  else if (records.length) status = "Former employee";
  const hiringEvents = new Set(records.map((record) => {
    const identity = record.employee_id || record.work_email || record.personal_email || record.phone || `${record.source_id}:${record.source_row_key}`;
    const joined = record.joining_date || `${record.source_id}:${record.source_row_key}`;
    return `${identity}:${joined}`;
  }));
  await env.DB.prepare(`UPDATE candidates SET employment_status = ?, employment_times_hired = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(status, hiringEvents.size, candidateId).run();
}

async function saveIdentities(env, candidateId, identities) {
  if (!identities.length) return;
  await env.DB.batch(identities.map((identity) => env.DB.prepare(
    "INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id) VALUES (?, ?, ?)",
  ).bind(identity.type, identity.value, candidateId)));
}

async function saveProfile(env, candidateId, details, isLatest = true) {
  const current = await env.DB.prepare("SELECT standardized_json FROM candidate_profiles WHERE candidate_id = ?").bind(candidateId).first();
  let existing = {};
  try { existing = JSON.parse(current?.standardized_json || "{}"); } catch { existing = {}; }
  const merged = isLatest ? mergeStandardized(existing, details) : mergeStandardized(details, existing);
  await env.DB.prepare(
    "INSERT INTO candidate_profiles(candidate_id, standardized_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(candidate_id) DO UPDATE SET standardized_json = excluded.standardized_json, updated_at = CURRENT_TIMESTAMP",
  ).bind(candidateId, JSON.stringify(merged)).run();
}

async function insertCandidate(env, candidateId, canonicalKey, item, sourceLabel) {
  await env.DB.prepare(`INSERT INTO candidates(
    id, canonical_key, name, initials, track, email, phone, city, state, role,
    subject_display, grades_display, boards_display, languages_display, education, college,
    experience_months, work_mode, applied_at, source_sheet, resume_url, resume_summary, row_text, resume_text, search_text
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`)
    .bind(candidateId, canonicalKey, item.fullName, item.initials, item.track, item.email, item.phone, item.city, item.state, item.role,
      item.subjects, item.levels, item.boards, item.languages, item.education, item.college, item.experienceMonths, item.workMode,
      item.appliedAt, sourceLabel, item.resumeUrl, item.resumeSummary, item.rowText, item.searchText).run();
}

async function updateCandidate(env, candidateId, item, sourceLabel, incrementDuplicate, isLatest = true) {
  if (!isLatest) {
    await env.DB.prepare(`UPDATE candidates SET
      row_text=substr(trim(row_text || ' ' || ?), 1, 30000),
      search_text=substr(trim(row_text || ' ' || ? || ' ' || resume_text), 1, 50000),
      duplicate_count=duplicate_count+?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(item.rowText, item.rowText, incrementDuplicate ? 1 : 0, candidateId).run();
    return;
  }
  await env.DB.prepare(`UPDATE candidates SET
    name = COALESCE(NULLIF(?, ''), name), initials = COALESCE(NULLIF(?, ''), initials),
    track = COALESCE(NULLIF(?, ''), track), email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone),
    city = COALESCE(NULLIF(?, ''), city), state = COALESCE(NULLIF(?, ''), state), role = COALESCE(NULLIF(?, ''), role),
    subject_display = COALESCE(NULLIF(?, ''), subject_display), grades_display = COALESCE(NULLIF(?, ''), grades_display),
    boards_display = COALESCE(NULLIF(?, ''), boards_display), languages_display = COALESCE(NULLIF(?, ''), languages_display),
    education = COALESCE(NULLIF(?, ''), education), college = COALESCE(NULLIF(?, ''), college),
    experience_months = MAX(experience_months, ?), work_mode = COALESCE(NULLIF(?, ''), work_mode),
    applied_at = MAX(applied_at, ?), source_sheet = COALESCE(NULLIF(?, ''), source_sheet),
    resume_url = COALESCE(NULLIF(?, ''), resume_url), resume_summary = COALESCE(NULLIF(?, ''), resume_summary),
    row_text = substr(trim(row_text || ' ' || ?), 1, 30000),
    search_text = substr(trim(row_text || ' ' || ? || ' ' || resume_text), 1, 50000),
    duplicate_count = duplicate_count + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`)
    .bind(item.fullName, item.initials, item.track, item.email, item.phone, item.city, item.state, item.role,
      item.subjects, item.levels, item.boards, item.languages, item.education, item.college, item.experienceMonths, item.workMode,
      item.appliedAt, sourceLabel, item.resumeUrl, item.resumeSummary, item.rowText, item.rowText, incrementDuplicate ? 1 : 0, candidateId).run();
}

export async function importMappedRows(env, source, rows, mapping) {
  const stats = { processed: 0, successful: 0, imported: 0, updated: 0, merged: 0, skipped: 0, failed: 0, duplicatesWithinSource: 0, duplicatesCentral: 0, errors: [] };

  const identityLocks = new Map();
  let nextIndex = 0;
  async function processNextRow() {
    while (nextIndex < rows.length) {
      const index = nextIndex;
      nextIndex += 1;
    const row = rows[index] || {};
    stats.processed += 1;
    try {
      const item = standardizeRow(row, mapping, source.label);
      await withIdentityLocks(identityLocks, item.identities, async () => {
      const rowKey = text(row._sheetRow || row.__rowNumber || `${item.appliedAt}:${item.email || item.phone}:${index}`, 400);
      const fingerprint = await hashRow(row);
      const sourceRecord = await env.DB.prepare(
        "SELECT candidate_id, row_fingerprint, duplicate_kind, applied_at FROM source_records WHERE source_id = ? AND source_row_key = ?",
      ).bind(source.id, rowKey).first();

      if (sourceRecord?.row_fingerprint === fingerprint) {
        if (!sourceRecord.applied_at || sourceRecord.applied_at.startsWith("1970-")) {
          await env.DB.prepare("UPDATE source_records SET applied_at=?, updated_at=CURRENT_TIMESTAMP WHERE source_id=? AND source_row_key=?")
            .bind(item.appliedAt, source.id, rowKey).run();
        }
        stats.successful += 1;
        stats.skipped += 1;
        return;
      }

      let candidateId = sourceRecord?.candidate_id || await resolveCandidate(env, item.identities);
      const existed = Boolean(candidateId);
      let isLatest = true;
      await withIdentityLocks(identityLocks, candidateId ? [{ type: "candidate", value: candidateId }] : [], async () => {
      let duplicateKind = sourceRecord?.duplicate_kind || "";
      if (!candidateId) {
        candidateId = crypto.randomUUID();
        const canonical = item.identities[0];
        await insertCandidate(env, candidateId, `${canonical.type}:${canonical.value}`, item, source.label);
        stats.imported += 1;
      } else {
        const current = await env.DB.prepare("SELECT applied_at FROM candidates WHERE id=?").bind(candidateId).first();
        isLatest = !current?.applied_at || item.appliedAt >= current.applied_at;
        let incrementDuplicate = false;
        if (!sourceRecord) {
          const sameSource = await env.DB.prepare("SELECT 1 AS found FROM source_records WHERE source_id = ? AND candidate_id = ? LIMIT 1")
            .bind(source.id, candidateId).first();
          duplicateKind = sameSource ? "within_source" : "central";
          incrementDuplicate = true;
          if (sameSource) stats.duplicatesWithinSource += 1;
          else stats.duplicatesCentral += 1;
          stats.merged += 1;
        } else {
          stats.updated += 1;
        }
        await updateCandidate(env, candidateId, item, source.label, incrementDuplicate, isLatest);
      }

      await saveIdentities(env, candidateId, item.identities);
      await saveProfile(env, candidateId, item.details, isLatest);
      await reconcileCandidateEmployment(env, candidateId, item.identities);
      await env.DB.prepare(`INSERT INTO source_records(
        source_id, source_row_key, candidate_id, row_fingerprint, duplicate_kind, raw_json, applied_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(source_id, source_row_key) DO UPDATE SET
        candidate_id = excluded.candidate_id, row_fingerprint = excluded.row_fingerprint,
        duplicate_kind = excluded.duplicate_kind, raw_json = excluded.raw_json, applied_at=excluded.applied_at,
        updated_at = CURRENT_TIMESTAMP`)
        .bind(source.id, rowKey, candidateId, fingerprint, duplicateKind, JSON.stringify(row), item.appliedAt).run();
      stats.successful += 1;
      if (existed && !sourceRecord && !duplicateKind) stats.merged += 1;
      });
      });
    } catch (error) {
      stats.failed += 1;
      if (stats.errors.length < 12) stats.errors.push({ row: row._sheetRow || index + 2, message: error instanceof Error ? error.message : "Row could not be imported" });
    }
    }
  }
  const workerCount = Math.min(8, rows.length);
  await Promise.all(Array.from({ length: workerCount }, () => processNextRow()));
  return stats;
}

export async function importEmploymentRows(env, source, rows, mapping, syncToken) {
  const stats = { processed: 0, successful: 0, imported: 0, updated: 0, merged: 0, skipped: 0, failed: 0, duplicatesWithinSource: 0, duplicatesCentral: 0, errors: [] };
  const identityLocks = new Map();
  let nextIndex = 0;
  async function processNextRow() {
    while (nextIndex < rows.length) {
      const index = nextIndex;
      nextIndex += 1;
      const row = rows[index] || {};
      stats.processed += 1;
      try {
        const item = standardizeEmploymentRow(row, mapping, source.label);
        await withIdentityLocks(identityLocks, item.identities, async () => {
          const rowKey = text(row._sheetRow || row.__rowNumber || `${item.employeeId}:${item.workEmail || item.personalEmail || item.phone}:${index}`, 400);
          const fingerprint = await hashRow(row);
          const existing = await env.DB.prepare(
            "SELECT row_fingerprint, candidate_id FROM employment_records WHERE source_id = ? AND source_row_key = ?",
          ).bind(source.id, rowKey).first();
          if (existing?.row_fingerprint === fingerprint) {
            await env.DB.prepare("UPDATE employment_records SET sync_token = ?, updated_at = CURRENT_TIMESTAMP WHERE source_id = ? AND source_row_key = ?")
              .bind(syncToken, source.id, rowKey).run();
            stats.successful += 1;
            stats.skipped += 1;
            return;
          }

          const candidateId = await resolveCandidate(env, item.identities);
          const duplicate = await env.DB.prepare(`SELECT 1 AS found FROM employment_records WHERE source_id = ? AND source_row_key <> ?
            AND ((employee_id <> '' AND employee_id = ?) OR (work_email <> '' AND work_email IN (?, ?))
              OR (personal_email <> '' AND personal_email IN (?, ?)) OR (phone <> '' AND phone = ?)) LIMIT 1`)
            .bind(source.id, rowKey, item.employeeId, item.workEmail, item.personalEmail, item.workEmail, item.personalEmail, item.phone).first();
          if (duplicate) stats.duplicatesWithinSource += 1;
          await env.DB.prepare(`INSERT INTO employment_records(
            source_id, source_row_key, employee_id, full_name, work_email, personal_email, phone, joining_date,
            leaving_date, leaving_reason, designation, department, business_unit, location, employee_type,
            employee_subtype, contract_end_date, employment_status, candidate_id, row_fingerprint, raw_json, sync_token, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(source_id, source_row_key) DO UPDATE SET employee_id=excluded.employee_id, full_name=excluded.full_name,
            work_email=excluded.work_email, personal_email=excluded.personal_email, phone=excluded.phone,
            joining_date=excluded.joining_date, leaving_date=excluded.leaving_date, leaving_reason=excluded.leaving_reason,
            designation=excluded.designation, department=excluded.department, business_unit=excluded.business_unit,
            location=excluded.location, employee_type=excluded.employee_type, employee_subtype=excluded.employee_subtype,
            contract_end_date=excluded.contract_end_date, employment_status=excluded.employment_status,
            candidate_id=excluded.candidate_id, row_fingerprint=excluded.row_fingerprint, raw_json=excluded.raw_json,
            sync_token=excluded.sync_token, updated_at=CURRENT_TIMESTAMP`)
            .bind(source.id, rowKey, item.employeeId, item.fullName, item.workEmail, item.personalEmail, item.phone,
              item.joiningDate, item.leavingDate, item.leavingReason, item.designation, item.department, item.businessUnit,
              item.location, item.employeeType, item.employeeSubtype, item.contractEndDate, item.employmentStatus,
              candidateId || null, fingerprint, JSON.stringify(row), syncToken).run();
          if (existing) stats.updated += 1;
          else stats.imported += 1;
          if (candidateId) await reconcileCandidateEmployment(env, candidateId, item.identities);
          stats.successful += 1;
        });
      } catch (error) {
        stats.failed += 1;
        if (stats.errors.length < 12) stats.errors.push({ row: row._sheetRow || index + 2, message: error instanceof Error ? error.message : "Employment row could not be imported" });
      }
    }
  }
  const workerCount = Math.min(8, rows.length);
  await Promise.all(Array.from({ length: workerCount }, () => processNextRow()));
  return stats;
}

async function sweepEmploymentSource(env, sourceId, syncToken) {
  const affected = await env.DB.prepare(`SELECT DISTINCT candidate_id FROM employment_records
    WHERE source_id = ? AND sync_token <> ? AND candidate_id IS NOT NULL`).bind(sourceId, syncToken).all();
  await env.DB.prepare("DELETE FROM employment_records WHERE source_id = ? AND sync_token <> ?").bind(sourceId, syncToken).run();
  for (const record of affected.results || []) {
    const identities = await candidateIdentities(env, record.candidate_id);
    await reconcileCandidateEmployment(env, record.candidate_id, identities);
  }
}

export async function connectorRequest(env, payload) {
  if (!env.APPS_SCRIPT_CONNECTOR_URL || !env.CONNECTOR_SECRET) throw new Error("The Google Sheets connector has not been configured yet");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(env.APPS_SCRIPT_CONNECTOR_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, secret: env.CONNECTOR_SECRET }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.error || `Google connector failed (${response.status})`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Google connector timed out; the batch will retry automatically");
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function previewGoogleSheet(env, sheetUrl, tabName, headerRow = 1) {
  const spreadsheetId = parseSpreadsheetId(sheetUrl);
  if (!spreadsheetId) throw new Error("Paste a valid Google Sheets URL");
  const normalizedHeaderRow = Math.max(1, Math.round(Number(headerRow) || 1));
  const result = await connectorRequest(env, { action: "preview", spreadsheetId, tabName: text(tabName, 200), headerRow: normalizedHeaderRow });
  return { spreadsheetId, tabName: result.tabName || tabName || "", headerRow: Number(result.headerRow) || normalizedHeaderRow, headers: result.headers || [], totalRows: Math.max(0, (Number(result.totalRows) || 0) - normalizedHeaderRow) };
}

export async function backfillApplicationDates(env, limit = 200) {
  const records = (await env.DB.prepare(`SELECT sr.source_id, sr.source_row_key, sr.raw_json, sr.first_seen_at,
    sc.mapping_json FROM source_records sr JOIN source_connections sc ON sc.source_id=sr.source_id
    WHERE sr.applied_at='1970-01-01T00:00:00.000Z' ORDER BY sr.first_seen_at LIMIT ?`).bind(limit).all()).results || [];
  if (!records.length) return 0;
  const statements = records.map((record) => {
    let row = {};
    let mapping = {};
    try { row = JSON.parse(record.raw_json || "{}"); } catch { row = {}; }
    try { mapping = JSON.parse(record.mapping_json || "{}"); } catch { mapping = {}; }
    const rawAppliedAt = mapping.appliedAt ? row[mapping.appliedAt] : "";
    const appliedAt = isoDate(rawAppliedAt);
    const usableDate = appliedAt.startsWith("1970-") ? isoDate(record.first_seen_at) : appliedAt;
    return env.DB.prepare(`UPDATE source_records SET applied_at=?, updated_at=CURRENT_TIMESTAMP
      WHERE source_id=? AND source_row_key=? AND applied_at='1970-01-01T00:00:00.000Z'`)
      .bind(usableDate, record.source_id, record.source_row_key);
  });
  await env.DB.batch(statements);
  return statements.length;
}

function addStats(total, next) {
  for (const key of ["processed", "successful", "imported", "updated", "merged", "skipped", "failed", "duplicatesWithinSource", "duplicatesCentral"]) total[key] += Number(next[key]) || 0;
  total.errors.push(...(next.errors || []).slice(0, Math.max(0, 12 - total.errors.length)));
}

async function persistJob(env, jobId, state, stats) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE sync_jobs SET status = ?, stage = ?, processed_rows = ?, total_rows = ?, eta_seconds = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(state.status, state.stage, state.processed, state.total, state.eta, state.message, jobId),
    env.DB.prepare(`INSERT INTO sync_job_stats(job_id, imported_rows, updated_rows, merged_rows, failed_rows, duplicates_within_source, duplicates_central, skipped_rows, error_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET imported_rows=excluded.imported_rows, updated_rows=excluded.updated_rows,
      merged_rows=excluded.merged_rows, failed_rows=excluded.failed_rows, duplicates_within_source=excluded.duplicates_within_source,
      duplicates_central=excluded.duplicates_central, skipped_rows=excluded.skipped_rows, error_json=excluded.error_json, updated_at=CURRENT_TIMESTAMP`)
      .bind(jobId, stats.imported, stats.updated, stats.merged, stats.failed, stats.duplicatesWithinSource, stats.duplicatesCentral, stats.skipped, JSON.stringify(stats.errors)),
  ]);
}

export async function runSourceSync(env, sourceId, jobId, fullRefresh = false, resumeJob = false) {
  const source = await env.DB.prepare(`SELECT s.*, c.spreadsheet_id, c.tab_name, c.mapping_json, c.last_cursor, c.last_row_count
    FROM sources s JOIN source_connections c ON c.source_id = s.id WHERE s.id = ?`).bind(sourceId).first();
  if (!source) return;
  const savedStats = resumeJob
    ? await env.DB.prepare("SELECT * FROM sync_job_stats WHERE job_id = ?").bind(jobId).first()
    : null;
  let savedErrors = [];
  try { savedErrors = JSON.parse(savedStats?.error_json || "[]"); } catch { savedErrors = []; }
  const stats = {
    processed: 0,
    successful: Number(savedStats?.imported_rows || 0) + Number(savedStats?.updated_rows || 0) + Number(savedStats?.merged_rows || 0) + Number(savedStats?.skipped_rows || 0),
    imported: Number(savedStats?.imported_rows || 0),
    updated: Number(savedStats?.updated_rows || 0),
    merged: Number(savedStats?.merged_rows || 0),
    skipped: Number(savedStats?.skipped_rows || 0),
    failed: Number(savedStats?.failed_rows || 0),
    duplicatesWithinSource: Number(savedStats?.duplicates_within_source || 0),
    duplicatesCentral: Number(savedStats?.duplicates_central || 0),
    errors: Array.isArray(savedErrors) ? savedErrors.slice(0, 12) : [],
  };
  let mapping = {};
  try { mapping = JSON.parse(source.mapping_json || "{}"); } catch { mapping = {}; }
  const headerRow = Math.max(1, Math.round(Number(mapping._headerRow) || 1));
  const dataStartRow = headerRow + 1;
  const employmentSource = source.kind === "Employment master";
  const effectiveFullRefresh = fullRefresh || (employmentSource && !resumeJob);
  let cursor = effectiveFullRefresh
    ? dataStartRow
    : resumeJob
      ? Math.max(dataStartRow, Number(source.last_cursor || dataStartRow))
      : Math.max(dataStartRow, Number(source.last_cursor || dataStartRow) - 50);
  const started = Date.now();
  let totalRows = Math.max(0, Number(source.last_row_count || 0));
  let sourceComplete = false;

  try {
    await persistJob(env, jobId, {
      status: "Running",
      stage: "Reading Google Sheet",
      processed: Math.max(0, cursor - dataStartRow),
      total: totalRows,
      eta: 20,
      message: resumeJob ? "Resuming the next safe batch" : "Fetching the first batch",
    }, stats);
    for (let batch = 0; batch < SYNC_BATCHES_PER_RUN; batch += 1) {
      const page = await connectorRequest(env, { action: "readRows", spreadsheetId: source.spreadsheet_id, tabName: source.tab_name, headerRow, startRow: cursor, limit: SYNC_BATCH_SIZE });
      const rows = Array.isArray(page.rows) ? page.rows : [];
      totalRows = Math.max(0, Number(page.totalRows || 0) - headerRow);
      const batchStats = employmentSource
        ? await importEmploymentRows(env, source, rows, mapping, jobId)
        : await importMappedRows(env, source, rows, mapping);
      addStats(stats, batchStats);
      cursor = Number(page.nextRow) || cursor + rows.length;
      sourceComplete = Boolean(page.done || !rows.length);
      const processed = Math.min(totalRows, Math.max(0, cursor - dataStartRow));
      const elapsedSeconds = Math.max(1, (Date.now() - started) / 1000);
      const rowsPerSecond = Math.max(1, stats.processed / elapsedSeconds);
      const eta = Math.max(0, Math.ceil((totalRows - processed) / rowsPerSecond));
      await persistJob(env, jobId, {
        status: page.done ? "Complete" : "Running",
        stage: page.done ? "Repository reconciled" : "Standardizing and deduplicating",
        processed,
        total: totalRows,
        eta,
        message: `${stats.successful} synced · ${stats.failed} failed · ${stats.duplicatesWithinSource + stats.duplicatesCentral} duplicates merged`,
      }, stats);
      const progressCounts = employmentSource
        ? await env.DB.prepare(`SELECT COUNT(*) AS synced, COUNT(DISTINCT candidate_id) AS matched
          FROM employment_records WHERE source_id = ?`).bind(sourceId).first()
        : await env.DB.prepare(`SELECT COUNT(*) AS synced,
          SUM(CASE WHEN duplicate_kind <> '' THEN 1 ELSE 0 END) AS duplicates, 0 AS matched FROM source_records WHERE source_id = ?`).bind(sourceId).first();
      await env.DB.batch([
        env.DB.prepare(`UPDATE sources SET status=?, connected=1, total_rows=?, synced_rows=?, failed_rows=?, duplicate_rows=?, matched_rows=?, last_sync=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(page.done ? "Connected" : "Syncing", totalRows, Number(progressCounts?.synced) || 0, stats.failed,
            employmentSource ? stats.duplicatesWithinSource : Number(progressCounts?.duplicates) || 0, Number(progressCounts?.matched) || 0, sourceId),
        env.DB.prepare("UPDATE source_connections SET last_cursor=?, last_row_count=?, last_error='', updated_at=CURRENT_TIMESTAMP WHERE source_id=?")
          .bind(cursor, totalRows, sourceId),
      ]);
      if (page.done || !rows.length) break;
    }

    if (!sourceComplete) {
      const processed = Math.min(totalRows, Math.max(0, cursor - dataStartRow));
      await persistJob(env, jobId, {
        status: "Queued",
        stage: "Continuing in background",
        processed,
        total: totalRows,
        eta: 60,
        message: `${stats.successful} synced in this run · remaining rows continue in the next background sync`,
      }, stats);
      return;
    }

    if (employmentSource) await sweepEmploymentSource(env, sourceId, jobId);
    const recordCounts = employmentSource
      ? await env.DB.prepare(`SELECT COUNT(*) AS synced, COUNT(DISTINCT candidate_id) AS matched
        FROM employment_records WHERE source_id = ?`).bind(sourceId).first()
      : await env.DB.prepare(`SELECT COUNT(*) AS synced,
        SUM(CASE WHEN duplicate_kind <> '' THEN 1 ELSE 0 END) AS duplicates, 0 AS matched FROM source_records WHERE source_id = ?`).bind(sourceId).first();
    await env.DB.batch([
      env.DB.prepare(`UPDATE sources SET status='Connected', connected=1, total_rows=?, synced_rows=?, failed_rows=?, duplicate_rows=?, matched_rows=?, last_sync=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(totalRows, Number(recordCounts?.synced) || 0, stats.failed,
          employmentSource ? stats.duplicatesWithinSource : Number(recordCounts?.duplicates) || 0, Number(recordCounts?.matched) || 0, sourceId),
      env.DB.prepare(`UPDATE source_connections SET last_cursor=?, last_row_count=?, last_error='', updated_at=CURRENT_TIMESTAMP WHERE source_id=?`)
        .bind(cursor, totalRows, sourceId),
      env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail) VALUES (?, NULL, 'System', 'synced', ?)")
        .bind(crypto.randomUUID(), `${source.label}: ${stats.successful} synced · ${stats.failed} failed · ${stats.duplicatesWithinSource} duplicates within source · ${stats.duplicatesCentral} central duplicates`),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source sync failed";
    if (error?.retryable) {
      await persistJob(env, jobId, { status: "Queued", stage: "Connector retry queued", processed: Math.max(0, cursor - 2), total: totalRows, eta: 30, message }, stats);
      await env.DB.batch([
        env.DB.prepare("UPDATE sources SET status='Syncing' WHERE id=?").bind(sourceId),
        env.DB.prepare("UPDATE source_connections SET last_error=?, updated_at=CURRENT_TIMESTAMP WHERE source_id=?").bind(message, sourceId),
      ]);
      return;
    }
    stats.failed += 1;
    stats.errors.push({ row: "connector", message });
    await persistJob(env, jobId, { status: "Failed", stage: "Needs attention", processed: Math.max(0, cursor - dataStartRow), total: totalRows, eta: 0, message }, stats);
    await env.DB.batch([
      env.DB.prepare("UPDATE sources SET status='Error', failed_rows=failed_rows+1 WHERE id=?").bind(sourceId),
      env.DB.prepare("UPDATE source_connections SET last_error=?, updated_at=CURRENT_TIMESTAMP WHERE source_id=?").bind(message, sourceId),
    ]);
  }
}
