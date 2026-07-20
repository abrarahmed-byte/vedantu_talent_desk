import { buildFtsQuery, describeIntent, matchesMandatoryIntent, parseSearchIntent, scoreCandidate } from "./search.js";
import { AuthError, authenticate, canManageSources, requireRole, roleAtLeast } from "./auth.js";
import { CANONICAL_FIELDS, EMPLOYMENT_FIELDS, parseSpreadsheetId, previewGoogleSheet, runSourceSync } from "./sync.js";
import { enqueueAiPilot, getAiMeta, processAiEnrichment, profileClassification, verificationForIntent } from "./ai.js";
import { EXPERIENCE_FILTERS, languageFilterValues, subjectFilterTerms, subjectFilterValues, workModeFilterValues } from "./filters.js";
import { exportSuperadminData, getSuperadminCandidate, getSuperadminDashboard, updateSuperadminCandidate } from "./superadmin.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function list(value) {
  return clean(value, 500).split("·").map((item) => item.trim()).filter(Boolean);
}

async function repositoryFilters(env) {
  const [subjects, languages, workModes] = await Promise.all([
    env.DB.prepare(`SELECT subject_display AS value FROM candidates WHERE trim(subject_display) <> ''
      UNION SELECT grades_display AS value FROM candidates WHERE trim(grades_display) <> ''
      UNION SELECT role AS value FROM candidates WHERE trim(role) <> ''`).all(),
    env.DB.prepare("SELECT DISTINCT languages_display AS value FROM candidates WHERE trim(languages_display) <> ''").all(),
    env.DB.prepare("SELECT DISTINCT work_mode AS value FROM candidates WHERE trim(work_mode) <> ''").all(),
  ]);
  return {
    subjects: subjectFilterValues(subjects.results),
    languages: languageFilterValues(languages.results),
    workModes: workModeFilterValues(workModes.results),
    experience: EXPERIENCE_FILTERS,
  };
}

function candidateResponse(row, score) {
  let details = {};
  let aiProfile = null;
  try { details = JSON.parse(row.standardized_json || "{}"); } catch { details = {}; }
  try { aiProfile = row.ai_canonical_json ? JSON.parse(row.ai_canonical_json) : null; } catch { aiProfile = null; }
  const classification = profileClassification(aiProfile, row.track);
  const { standardized_json: _standardizedJson, ai_canonical_json: _aiCanonicalJson, ...candidate } = row;
  return {
    ...candidate,
    subjects: list(row.subject_display),
    grades: list(row.grades_display),
    boards: list(row.boards_display),
    languages: list(row.languages_display),
    details,
    ai_profile: aiProfile,
    recommended_track: classification.recommendedTrack,
    effective_track: classification.effectiveTrack,
    classification_confidence: classification.confidence,
    classification_rationale: classification.rationale,
    classification_evidence: classification.evidence,
    classification_disagrees: classification.disagreesWithSource,
    match_percent: score,
  };
}

async function getCandidates(request, env) {
  const started = Date.now();
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"), 300);
  const track = clean(url.searchParams.get("track"), 30);
  const subject = clean(url.searchParams.get("subject"), 80);
  const language = clean(url.searchParams.get("language"), 50);
  const workMode = clean(url.searchParams.get("workMode"), 30);
  const minimumExperience = Math.max(Number(url.searchParams.get("experience")) || 0, 0);
  const includeClaims = url.searchParams.get("includeClaims") === "1";
  const intent = parseSearchIntent(query);
  const conditions = [];
  const bindings = [];
  const effectiveTrack = track && track !== "All" ? track : intent.track !== "All" ? intent.track : "";
  if (effectiveTrack) {
    conditions.push(`(CASE WHEN ai.status='completed' AND json_extract(ai.canonical_json,
      '$.profile_classification.recommended_track') IN ('Teacher','Non-teaching')
      THEN json_extract(ai.canonical_json, '$.profile_classification.recommended_track') ELSE c.track END) = ?`);
    bindings.push(effectiveTrack);
  }
  if (subject && subject !== "All subjects") {
    const terms = subjectFilterTerms(subject).filter(Boolean).slice(0, 10);
    conditions.push(`(${terms.map(() => "c.search_text LIKE ?").join(" OR ")})`);
    bindings.push(...terms.map((term) => `%${term}%`));
  }
  if (language && language !== "All languages") { conditions.push("c.search_text LIKE ?"); bindings.push(`%${language.toLowerCase()}%`); }
  if (workMode === "Online / Remote") conditions.push("(lower(c.work_mode) LIKE '%online%' OR lower(c.work_mode) LIKE '%remote%')");
  else if (workMode === "Offline / On-site") conditions.push("(lower(c.work_mode) LIKE '%offline%' OR lower(c.work_mode) LIKE '%on-site%' OR lower(c.work_mode) LIKE '%onsite%')");
  else if (workMode && workMode !== "Any work mode") { conditions.push("lower(c.work_mode) LIKE ?"); bindings.push(`%${workMode.toLowerCase()}%`); }
  const effectiveExperience = Math.max(minimumExperience, intent.minimumExperienceMonths || 0);
  if (effectiveExperience) { conditions.push("c.experience_months >= ?"); bindings.push(effectiveExperience); }
  const ftsQuery = buildFtsQuery(query);
  let sql = `SELECT c.*, p.standardized_json, ai.status AS ai_status, ai.summary AS ai_summary,
    ai.canonical_json AS ai_canonical_json, ai.processed_at AS ai_processed_at
    FROM candidates c LEFT JOIN candidate_profiles p ON p.candidate_id = c.id
    LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id = c.id`;
  if (ftsQuery) {
    sql += " JOIN candidates_fts ON candidates_fts.candidate_id = c.id";
    conditions.unshift("candidates_fts MATCH ?");
    bindings.unshift(ftsQuery);
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY c.applied_at DESC LIMIT 800";
  let rows = (await env.DB.prepare(sql).bind(...bindings).all()).results || [];
  if (!rows.length && ftsQuery) {
    let fallbackSql = `SELECT c.*, p.standardized_json, ai.status AS ai_status, ai.summary AS ai_summary,
      ai.canonical_json AS ai_canonical_json, ai.processed_at AS ai_processed_at
      FROM candidates c LEFT JOIN candidate_profiles p ON p.candidate_id = c.id
      LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id = c.id`;
    const fallbackConditions = conditions.slice(1);
    const fallbackBindings = bindings.slice(1);
    if (fallbackConditions.length) fallbackSql += ` WHERE ${fallbackConditions.join(" AND ")}`;
    fallbackSql += " ORDER BY c.applied_at DESC LIMIT 800";
    rows = (await env.DB.prepare(fallbackSql).bind(...fallbackBindings).all()).results || [];
  }
  const scored = rows
    .filter((row) => matchesMandatoryIntent(row, intent))
    .filter((row) => row.ai_status !== "completed" || !verificationForIntent(row.ai_canonical_json, intent, includeClaims).rejected)
    .map((row) => candidateResponse(row, scoreCandidate(row, query, intent)))
    .sort((a, b) => b.match_percent - a.match_percent || String(b.applied_at).localeCompare(String(a.applied_at)))
    .slice(0, 40);
  return json({
    candidates: scored,
    total: scored.length,
    understoodAs: describeIntent(intent),
    responseTimeMs: Date.now() - started,
    mode: includeClaims ? "Indexed D1 search · AI profile type + verified evidence + claims" : "Indexed D1 search · AI profile type + verified evidence preferred",
  });
}

async function getMeta(env, user) {
  const [candidateCounts, employmentCounts, sourceCounts, activity, jobs, users, ai] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS profiles, COALESCE(SUM(duplicate_count), 0) AS duplicates,
      COALESCE(SUM(view_count), 0) AS views, COALESCE(SUM(call_count), 0) AS calls
      FROM candidates`).first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN employment_status='Active employee' THEN 1 ELSE 0 END) AS active_employees,
      SUM(CASE WHEN employment_status='Former employee' THEN 1 ELSE 0 END) AS former_employees
      FROM employment_records`).first(),
    env.DB.prepare(`SELECT s.*, c.spreadsheet_id, c.sheet_url, c.tab_name, c.last_cursor, c.last_row_count, c.last_error
      FROM sources s LEFT JOIN source_connections c ON c.source_id = s.id ORDER BY s.created_at DESC`).all(),
    env.DB.prepare("SELECT a.*, c.name AS candidate_name FROM activity_logs a LEFT JOIN candidates c ON c.id = a.candidate_id ORDER BY a.created_at DESC LIMIT 40").all(),
    env.DB.prepare(`SELECT j.*, s.label AS source_label, st.imported_rows, st.updated_rows, st.merged_rows,
      st.failed_rows AS detail_failed_rows, st.duplicates_within_source, st.duplicates_central, st.skipped_rows, st.error_json
      FROM sync_jobs j JOIN sources s ON s.id = j.source_id LEFT JOIN sync_job_stats st ON st.job_id = j.id
      ORDER BY j.updated_at DESC LIMIT 12`).all(),
    roleAtLeast(user.role, "Admin")
      ? env.DB.prepare("SELECT email, display_name, role, active FROM access_users WHERE active=1 ORDER BY role, display_name").all()
      : Promise.resolve({ results: [] }),
    getAiMeta(env),
  ]);
  return json({
    repository: { ...(candidateCounts || {}), ...(employmentCounts || {}) },
    sources: sourceCounts.results || [],
    activity: activity.results || [],
    jobs: jobs.results || [],
    users: users.results || [],
    ai,
    user,
    pilot: !user.protected,
    notice: user.protected ? "Private Vedantu workspace" : "Fictional data only · zero-cost Cloudflare pilot",
  });
}

async function getCandidateHistory(candidateId, env) {
  const candidate = await env.DB.prepare(`SELECT c.*, p.standardized_json, ai.status AS ai_status,
    ai.summary AS ai_summary, ai.canonical_json AS ai_canonical_json, ai.processed_at AS ai_processed_at
    FROM candidates c LEFT JOIN candidate_profiles p ON p.candidate_id = c.id
    LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id = c.id WHERE c.id = ?`).bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const [activity, calls] = await Promise.all([
    env.DB.prepare("SELECT * FROM activity_logs WHERE candidate_id = ? AND action <> 'called' ORDER BY created_at DESC LIMIT 50").bind(candidateId).all(),
    env.DB.prepare("SELECT * FROM calls WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 30").bind(candidateId).all(),
  ]);
  return json({ candidate: candidateResponse(candidate, 0), activity: activity.results || [], calls: calls.results || [] });
}

async function logCandidateEvent(env, candidateId, action, user) {
  const candidate = await env.DB.prepare("SELECT id FROM candidates WHERE id = ?").bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const actor = clean(user.displayName, 100);
  const actorEmail = clean(user.email, 320).toLowerCase();
  const existingActor = action === "viewed"
    ? await env.DB.prepare("SELECT id FROM activity_logs WHERE candidate_id = ? AND (actor_email = ? OR (actor_email = '' AND actor = ?)) AND action = 'viewed' LIMIT 1").bind(candidateId, actorEmail, actor).first()
    : null;
  const activity = env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), candidateId, actor, action, action === "viewed" ? "Viewed candidate profile" : "Opened resume link", actorEmail);
  let updateSql = "UPDATE candidates SET updated_at = CURRENT_TIMESTAMP";
  if (action === "viewed") updateSql += ", view_count = view_count + 1" + (existingActor ? "" : ", interviewer_count = interviewer_count + 1");
  if (action === "resume_opened") updateSql += ", resume_open_count = resume_open_count + 1";
  updateSql += " WHERE id = ?";
  await env.DB.batch([activity, env.DB.prepare(updateSql).bind(candidateId)]);
  return json({ ok: true });
}

async function logCall(request, env, candidateId, user) {
  const payload = await request.json().catch(() => ({}));
  const recruiter = clean(user.displayName, 100);
  const role = clean(payload.role, 120);
  const outcome = clean(payload.outcome, 40);
  const note = clean(payload.note, 500);
  if (!["DNP", "Interested", "Not Interested", "Call Back"].includes(outcome)) return json({ error: "Choose a call outcome" }, 400);
  const candidate = await env.DB.prepare("SELECT id, name FROM candidates WHERE id = ?").bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const callId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO calls(id, candidate_id, recruiter, role, outcome, note) VALUES (?, ?, ?, ?, ?, ?)").bind(callId, candidateId, recruiter, role, outcome, note),
    env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, ?, ?, 'called', ?, ?)").bind(crypto.randomUUID(), candidateId, recruiter, `${outcome}${role ? ` · ${role}` : ""}${note ? ` · ${note}` : ""}`, clean(user.email, 320).toLowerCase()),
    env.DB.prepare("UPDATE candidates SET call_count = call_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(candidateId),
  ]);
  return json({ ok: true, id: callId });
}

async function logSearch(request, env, user) {
  const payload = await request.json().catch(() => ({}));
  const actor = clean(user.displayName, 100);
  const query = clean(payload.query, 300);
  if (query) await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'searched', ?, ?)").bind(crypto.randomUUID(), actor, query, clean(user.email, 320).toLowerCase()).run();
  return json({ ok: true });
}

function requireSecureAdmin(user, env) {
  requireRole(user, "Admin");
  if (!canManageSources(user, env)) {
    throw new AuthError("Protect this Worker with Vedantu sign-in before connecting Google Sheets or changing access", 409);
  }
}

async function sessionResponse(env, user) {
  const filters = await repositoryFilters(env);
  return json({
    user,
    canManageSources: canManageSources(user, env),
    isSuperadmin: user.role === "Superadmin",
    connectorConfigured: Boolean(env.APPS_SCRIPT_CONNECTOR_URL && env.CONNECTOR_SECRET),
    aiConfigured: Boolean(env.OPENAI_API_KEY),
    aiModel: clean(env.AI_MODEL || "gpt-5-nano", 120),
    filters,
    canonicalFields: CANONICAL_FIELDS,
    employmentFields: EMPLOYMENT_FIELDS,
  });
}

async function startAiPilot(request, env, user, ctx) {
  requireSecureAdmin(user, env);
  if (!env.OPENAI_API_KEY) return json({ error: "Add OPENAI_API_KEY in Cloudflare before starting the résumé pilot" }, 409);
  const payload = await request.json().catch(() => ({}));
  const result = await enqueueAiPilot(env, payload.limit || 20);
  await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'ai_pilot_started', ?, ?)")
    .bind(crypto.randomUUID(), user.displayName, `${result.queued} résumés queued for evidence extraction`, clean(user.email, 320).toLowerCase()).run();
  if (ctx?.waitUntil) ctx.waitUntil(processAiEnrichment(env));
  return json({ ok: true, ...result, message: result.queued ? "Résumé evidence pilot queued" : "These recent résumés are already current" }, 202);
}

async function previewSource(request, env, user) {
  requireSecureAdmin(user, env);
  const payload = await request.json().catch(() => ({}));
  const result = await previewGoogleSheet(env, payload.sheetUrl, payload.tabName, payload.headerRow);
  return json(result);
}

async function startSourceSync(env, sourceId, user, ctx, fullRefresh = false) {
  const actor = clean(user.displayName, 100);
  const actorEmail = clean(user.email, 320).toLowerCase();
  const source = await env.DB.prepare("SELECT id, label FROM sources WHERE id = ?").bind(sourceId).first();
  if (!source) throw new AuthError("Hiring source not found", 404);
  const activeJob = await env.DB.prepare(`SELECT id, status,
    CAST(unixepoch('now') - unixepoch(updated_at) AS INTEGER) AS age_seconds
    FROM sync_jobs WHERE source_id = ? AND status IN ('Queued', 'Running') ORDER BY updated_at DESC LIMIT 1`)
    .bind(sourceId).first();
  if (activeJob?.id) {
    if (activeJob.status === "Running" && Number(activeJob.age_seconds || 0) < 20) return activeJob.id;
    await env.DB.prepare(`UPDATE sync_jobs SET status='Running', stage='Starting next batch',
      message='Background continuation accepted', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(activeJob.id).run();
    const resumedWork = runSourceSync(env, sourceId, activeJob.id, false, true);
    if (ctx?.waitUntil) ctx.waitUntil(resumedWork);
    else await resumedWork;
    return activeJob.id;
  }
  const jobId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sync_jobs(id, source_id, status, stage, processed_rows, total_rows, eta_seconds, message)
      VALUES (?, ?, 'Queued', 'Waiting to start', 0, 0, 20, 'Background sync queued')`).bind(jobId, sourceId),
    env.DB.prepare("INSERT INTO sync_job_stats(job_id) VALUES (?)").bind(jobId),
    env.DB.prepare("UPDATE sources SET status='Syncing', connected=1 WHERE id=?").bind(sourceId),
    env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'sync_started', ?, ?)")
      .bind(crypto.randomUUID(), actor, `${source.label}: ${fullRefresh ? "full refresh" : "incremental sync"} queued`, actorEmail),
  ]);
  const work = runSourceSync(env, sourceId, jobId, fullRefresh);
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
  return jobId;
}

async function createSource(request, env, user, ctx) {
  requireSecureAdmin(user, env);
  const payload = await request.json().catch(() => ({}));
  const label = clean(payload.label, 180);
  const sheetUrl = clean(payload.sheetUrl, 1200);
  const spreadsheetId = parseSpreadsheetId(sheetUrl);
  const tabName = clean(payload.tabName, 180);
  const mapping = payload.mapping && typeof payload.mapping === "object" ? payload.mapping : {};
  const employmentSource = payload.sourceType === "employment";
  mapping._headerRow = Math.max(1, Math.round(Number(mapping._headerRow) || 1));
  if (employmentSource) mapping._employmentStatus = payload.employmentStatus === "Active employee" ? "Active employee" : "Former employee";
  if (!label || !spreadsheetId) return json({ error: "Source name and a valid Google Sheets URL are required" }, 400);
  if (employmentSource && !mapping.workEmail && !mapping.personalEmail && !mapping.phone) {
    return json({ error: "Map a work email, personal email, or phone before connecting the employment master" }, 400);
  }
  if (!employmentSource && (!mapping.fullName || !mapping.appliedAt || (!mapping.email && !mapping.phone))) {
    return json({ error: "Map Full name, Timestamp, and either Email or Phone before connecting" }, 400);
  }
  const duplicate = await env.DB.prepare("SELECT source_id FROM source_connections WHERE spreadsheet_id = ? AND tab_name = ?")
    .bind(spreadsheetId, tabName).first();
  if (duplicate) return json({ error: "This Sheet tab is already connected. Refresh or reconnect the existing source." }, 409);

  const sourceId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sources(id, label, kind, connected, status, total_rows, synced_rows, failed_rows, duplicate_rows)
      VALUES (?, ?, ?, 1, 'Queued', 0, 0, 0, 0)`).bind(sourceId, label, employmentSource ? "Employment master" : "Google Sheet"),
    env.DB.prepare(`INSERT INTO source_connections(source_id, spreadsheet_id, sheet_url, tab_name, mapping_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(sourceId, spreadsheetId, sheetUrl, tabName, JSON.stringify(mapping), user.email),
  ]);
  const jobId = await startSourceSync(env, sourceId, user, ctx, true);
  return json({ ok: true, sourceId, jobId }, 202);
}

async function manageSourceAction(request, env, user, ctx, sourceId, action) {
  requireSecureAdmin(user, env);
  if (action === "disconnect") {
    await env.DB.prepare("UPDATE sources SET connected=0, status='Disconnected' WHERE id=?").bind(sourceId).run();
    return json({ ok: true });
  }
  if (action === "reconnect") await env.DB.prepare("UPDATE sources SET connected=1, status='Connected' WHERE id=?").bind(sourceId).run();
  const payload = await request.json().catch(() => ({}));
  const jobId = await startSourceSync(env, sourceId, user, ctx, Boolean(payload.fullRefresh || action === "reconnect"));
  return json({ ok: true, jobId }, 202);
}

async function addAccessUser(request, env, user) {
  requireSecureAdmin(user, env);
  const payload = await request.json().catch(() => ({}));
  const email = clean(payload.email, 320).toLowerCase();
  const displayName = clean(payload.displayName, 160) || email.split("@")[0];
  const requestedRole = ["Superadmin", "Admin", "Recruiter"].includes(payload.role) ? payload.role : "Recruiter";
  if (requestedRole === "Superadmin") requireRole(user, "Superadmin");
  const role = requestedRole;
  if (!/@vedantu\.com$/.test(email)) return json({ error: "Use a Vedantu email address" }, 400);
  const existing = await env.DB.prepare("SELECT role, active FROM access_users WHERE lower(email)=? LIMIT 1").bind(email).first();
  if (existing?.role === "Superadmin" && user.role !== "Superadmin") {
    return json({ error: "Only a Superadmin can change Superadmin access" }, 403);
  }
  if (existing?.role === "Superadmin" && role !== "Superadmin") {
    const superadminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM access_users WHERE role='Superadmin' AND active=1").first();
    if (Number(superadminCount?.count || 0) <= 1) return json({ error: "Keep at least one active Superadmin in the workspace" }, 409);
  }
  await env.DB.prepare(`INSERT INTO access_users(email, display_name, role, active) VALUES (?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name, role=excluded.role, active=1`)
    .bind(email, displayName, role).run();
  await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'access_granted', ?, ?)")
    .bind(crypto.randomUUID(), user.displayName, `${displayName} · ${email} · ${role}`, clean(user.email, 320).toLowerCase()).run();
  return json({ ok: true });
}

async function revokeAccessUser(env, user, targetEmail) {
  requireSecureAdmin(user, env);
  const email = clean(targetEmail, 320).toLowerCase();
  if (!email) return json({ error: "User email is required" }, 400);
  if (email === user.email) return json({ error: "You cannot revoke your own access while signed in" }, 400);
  const target = await env.DB.prepare("SELECT email, display_name, role, active FROM access_users WHERE lower(email)=? LIMIT 1").bind(email).first();
  if (!target || !Number(target.active)) return json({ error: "This user does not have active Talent Desk access" }, 404);
  if (target.role === "Superadmin" && user.role !== "Superadmin") return json({ error: "Only a Superadmin can remove Superadmin access" }, 403);
  if (target.role === "Superadmin") {
    const superadminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM access_users WHERE role='Superadmin' AND active=1").first();
    if (Number(superadminCount?.count || 0) <= 1) return json({ error: "Keep at least one active Superadmin in the workspace" }, 409);
  }
  if (target.role === "Admin") {
    const managerCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM access_users WHERE role IN ('Superadmin','Admin') AND active=1").first();
    if (Number(managerCount?.count || 0) <= 1) return json({ error: "Keep at least one active Admin or Superadmin in the workspace" }, 409);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE access_users SET active=0 WHERE lower(email)=?").bind(email),
    env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'access_revoked', ?, ?)")
      .bind(crypto.randomUUID(), user.displayName, `${target.display_name} · ${email}`, clean(user.email, 320).toLowerCase()),
  ]);
  return json({ ok: true });
}

async function routeApi(request, env, ctx) {
  const url = new URL(request.url);
  const user = await authenticate(request, env);
  if (request.method === "GET" && url.pathname === "/api/session") return sessionResponse(env, user);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const result = await env.DB.prepare("SELECT COUNT(*) AS candidates FROM candidates").first();
    return json({ ok: true, database: "vedantu_talent_desk_db", protected: user.protected, ...result });
  }
  if (request.method === "GET" && url.pathname === "/api/meta") return getMeta(env, user);
  if (request.method === "GET" && url.pathname === "/api/candidates") return getCandidates(request, env);
  if (request.method === "GET" && url.pathname === "/api/superadmin") return getSuperadminDashboard(request, env, user);
  if (request.method === "GET" && url.pathname === "/api/superadmin/export") return exportSuperadminData(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/searches") return logSearch(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/admin/sources/preview") return previewSource(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/admin/sources") return createSource(request, env, user, ctx);
  if (request.method === "POST" && url.pathname === "/api/admin/users") return addAccessUser(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/admin/ai/pilot") return startAiPilot(request, env, user, ctx);

  const superadminCandidateMatch = url.pathname.match(/^\/api\/superadmin\/candidates\/([^/]+)$/);
  if (superadminCandidateMatch && request.method === "GET") return getSuperadminCandidate(env, user, decodeURIComponent(superadminCandidateMatch[1]));
  if (superadminCandidateMatch && request.method === "POST") return updateSuperadminCandidate(request, env, user, decodeURIComponent(superadminCandidateMatch[1]));

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/(.+)$/);
  if (userMatch && request.method === "DELETE") return revokeAccessUser(env, user, decodeURIComponent(userMatch[1]));

  const sourceMatch = url.pathname.match(/^\/api\/admin\/sources\/([^/]+)\/(sync|disconnect|reconnect)$/);
  if (sourceMatch && request.method === "POST") {
    return manageSourceAction(request, env, user, ctx, decodeURIComponent(sourceMatch[1]), sourceMatch[2]);
  }

  const match = url.pathname.match(/^\/api\/candidates\/([^/]+)(?:\/(history|view|resume-open|calls))?$/);
  if (!match) return json({ error: "API route not found" }, 404);
  const candidateId = decodeURIComponent(match[1]);
  const action = match[2];
  if (request.method === "GET" && action === "history") return getCandidateHistory(candidateId, env);
  if (request.method === "POST" && action === "view") return logCandidateEvent(env, candidateId, "viewed", user);
  if (request.method === "POST" && action === "resume-open") return logCandidateEvent(env, candidateId, "resume_opened", user);
  if (request.method === "POST" && action === "calls") return logCall(request, env, candidateId, user);
  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env, ctx);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 500;
      return json({ error: error instanceof Error ? error.message : "Unexpected Talent Desk error" }, status);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processAiEnrichment(env));
    const sources = await env.DB.prepare(`SELECT id FROM sources
      WHERE connected=1 AND id IN (SELECT source_id FROM source_connections)
      AND (last_sync <= datetime('now', '-15 minutes') OR EXISTS (
        SELECT 1 FROM sync_jobs WHERE source_id=sources.id AND status IN ('Queued', 'Running')
      ))
      ORDER BY CASE WHEN status='Syncing' THEN 0 ELSE 1 END, last_sync LIMIT 3`).all();
    for (const source of sources.results || []) await startSourceSync(env, source.id, "System", ctx, false);
  },
};
