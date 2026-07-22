import { buildFtsQuery, describeIntent, locationSearchTerms, parseSearchIntent, scoreCandidate } from "./search.js";
import {
  AuthError,
  authenticate,
  canManageSources,
  clearWorkspaceCookies,
  completeWorkspaceLogin,
  requireRole,
  roleAtLeast,
  workspaceLoginUrl,
} from "./auth.js";
import { backfillApplicationDates, CANONICAL_FIELDS, EMPLOYMENT_FIELDS, parseSpreadsheetId, previewGoogleSheet, runSourceSync } from "./sync.js";
import { enqueueAiBatch, getAiMeta, processAiEnrichment, profileClassification, retryAiFailures, setAiAutomation } from "./ai.js";
import { EXPERIENCE_FILTERS, languageFilterValues, subjectFilterTerms, subjectFilterValues, workModeFilterValues } from "./filters.js";
import { exportSuperadminData, getSuperadminCandidate, getSuperadminDashboard, updateSuperadminCandidate } from "./superadmin.js";
import { storeConnectorSecret } from "./connector-secret.js";
import {
  createAiSearchPlan,
  describeSearchPlan,
  fallbackSearchPlan,
  parseClientSearchPlan,
  scoreSearchPlanPreferences,
  searchPlanToIntent,
} from "./query-planner.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function redirect(location, cookies = []) {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}

function connectorSecretSetupPage(updated = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Secure Google connector · Vedantu Talent Desk</title><style>
  :root{font-family:Inter,Arial,sans-serif;color:#092d35;background:#f4f7f7}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 12%,#ff684525 0 15%,transparent 16%),#f4f7f7}.card{width:min(520px,100%);background:#fff;border:1px solid #dce6e7;border-radius:24px;padding:32px;box-shadow:0 18px 45px #082b3414}.brand{display:flex;gap:12px;align-items:center;font-weight:800;font-size:20px}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#ff6845;color:#fff}h1{font-size:30px;line-height:1.1;margin:28px 0 10px}p{color:#547078;line-height:1.6}.success{padding:12px 14px;border-radius:12px;background:#e8fbf4;color:#087a56;font-weight:700}label{display:block;margin:22px 0 8px;font-size:13px;font-weight:800}input{width:100%;border:1px solid #bfd0d3;border-radius:12px;padding:14px;font:inherit;outline:none}input:focus{border-color:#ff6845;box-shadow:0 0 0 3px #ff684522}button{width:100%;margin-top:16px;border:0;border-radius:12px;padding:14px;background:#ff6845;color:#fff;font:800 15px inherit;cursor:pointer}.note{font-size:12px;margin-bottom:0}.back{display:block;text-align:center;margin-top:18px;color:#0c6070;font-weight:700;text-decoration:none}</style></head><body><main class="card"><div class="brand"><span class="mark">V</span>vedantu <small>TALENT DESK</small></div><h1>Secure the Google connector</h1><p>This Superadmin-only step stores the connector key encrypted in the Talent Desk database. The key is never saved in GitHub or shown again.</p>${updated ? '<p class="success">Connector key updated successfully.</p>' : ''}<form method="post" action="/admin/connector-secret"><label for="secret">New connector key</label><input id="secret" name="secret" type="password" minlength="32" maxlength="256" autocomplete="new-password" required><button type="submit">Save encrypted key</button></form><p class="note">Only active Talent Desk Superadmins can open or submit this page.</p><a class="back" href="/">Back to Talent Desk</a></main></body></html>`;
}

async function authRoute(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/auth/login") {
    const login = workspaceLoginUrl(request, env);
    return redirect(login.loginUrl, [login.nonceCookie]);
  }
  if (url.pathname === "/auth/logout") {
    return redirect(`${url.origin}/?signed_out=1`, clearWorkspaceCookies());
  }
  if (url.pathname !== "/auth/callback") return null;

  try {
    const login = await completeWorkspaceLogin(request, env);
    const user = await env.DB.prepare("SELECT active FROM access_users WHERE lower(email)=? LIMIT 1").bind(login.email).first();
    if (!user || !Number(user.active)) {
      return redirect(`${url.origin}/?auth=not-approved`, clearWorkspaceCookies());
    }
    return redirect(`${url.origin}/?signed_in=1`, [login.sessionCookie, login.clearNonceCookie]);
  } catch (error) {
    const reason = error instanceof AuthError && error.status === 403 ? "wrong-account" : "failed";
    return redirect(`${url.origin}/?auth=${reason}`, clearWorkspaceCookies());
  }
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

function candidateResponse(row, score, searchFit = null) {
  let details = {};
  let aiProfile = null;
  try { details = JSON.parse(row.standardized_json || "{}"); } catch { details = {}; }
  try { aiProfile = row.ai_canonical_json ? JSON.parse(row.ai_canonical_json) : null; } catch { aiProfile = null; }
  const classification = profileClassification(aiProfile, row.track);
  const {
    standardized_json: _standardizedJson,
    ai_canonical_json: _aiCanonicalJson,
    search_text: _searchText,
    row_text: _rowText,
    resume_text: _resumeText,
    ...candidate
  } = row;
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
    match_reasons: searchFit?.reasons || [],
    missing_preferences: searchFit?.missing || [],
    match_percent: score,
  };
}

async function getSearchPlan(request, env) {
  const started = Date.now();
  const payload = await request.json().catch(() => ({}));
  const query = clean(payload.query, 500);
  if (!query) {
    const plan = fallbackSearchPlan("");
    return json({ plan, criteria: [], mode: "manual", responseTimeMs: Date.now() - started });
  }
  try {
    const plan = await createAiSearchPlan(env, query);
    return json({ plan, criteria: describeSearchPlan(plan), mode: "ai", responseTimeMs: Date.now() - started });
  } catch (error) {
    const plan = fallbackSearchPlan(query);
    return json({
      plan,
      criteria: describeSearchPlan(plan),
      mode: "fallback",
      warning: "AI interpretation was temporarily unavailable, so the current indexed search was used.",
      responseTimeMs: Date.now() - started,
      diagnostic: env.ENVIRONMENT === "development" ? clean(error instanceof Error ? error.message : error, 300) : undefined,
    });
  }
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
  const minimumViews = Math.max(0, Math.round(Number(url.searchParams.get("minViews")) || 0));
  const minimumCalls = Math.max(0, Math.round(Number(url.searchParams.get("minCalls")) || 0));
  const maximumAgeDays = Math.max(0, Math.min(3650, Math.round(Number(url.searchParams.get("maxAgeDays")) || 0)));
  const freshnessDecayDays = Math.max(0, Math.min(3650, Math.round(Number(url.searchParams.get("freshnessDecayDays")) || 120)));
  const freshnessWeight = Math.max(0, Math.min(3, Number(url.searchParams.get("freshnessWeight")) || 1));
  const page = Math.max(1, Math.round(Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.max(10, Math.min(100, Math.round(Number(url.searchParams.get("pageSize")) || 40)));
  const offset = (page - 1) * pageSize;
  const includeClaims = url.searchParams.get("includeClaims") === "1";
  const clientPlan = clean(url.searchParams.get("plan"), 6000);
  const searchPlan = clientPlan ? parseClientSearchPlan(clientPlan, query) : fallbackSearchPlan(query);
  const intent = clientPlan ? searchPlanToIntent(searchPlan, query) : parseSearchIntent(query);
  const required = searchPlan.required;
  const excluded = searchPlan.excluded;
  const conditions = [];
  const bindings = [];
  const addLikeAny = (column, terms) => {
    const usable = [...new Set((terms || []).filter(Boolean))].slice(0, 16);
    if (!usable.length) return;
    conditions.push(`(${usable.map(() => `${column} LIKE ?`).join(" OR ")})`);
    bindings.push(...usable.map((term) => `%${String(term).toLowerCase()}%`));
  };
  const addEvidenceRequirement = (category, terms) => {
    const usable = [...new Set((terms || []).filter(Boolean))].slice(0, 16);
    if (!usable.length) return;
    const statuses = includeClaims ? "('supported','claim_only')" : "('supported')";
    conditions.push(`(ai.status IS NULL OR ai.status <> 'completed' OR EXISTS (
      SELECT 1 FROM candidate_ai_facts f WHERE f.candidate_id=c.id AND f.category=?
      AND f.verification_status IN ${statuses} AND (${usable.map(() => "lower(f.normalized_value) LIKE ?").join(" OR ")})
    ))`);
    bindings.push(category, ...usable.map((term) => `%${String(term).toLowerCase()}%`));
  };
  const addNotLikeAny = (column, terms) => {
    const usable = [...new Set((terms || []).filter(Boolean))].slice(0, 16);
    for (const term of usable) {
      conditions.push(`lower(${column}) NOT LIKE ?`);
      bindings.push(`%${String(term).toLowerCase()}%`);
    }
  };
  const effectiveTrack = track && track !== "All" ? track : intent.track !== "All" ? intent.track : "";
  if (effectiveTrack) {
    conditions.push(`(CASE WHEN ai.status='completed' AND json_extract(ai.canonical_json,
      '$.profile_classification.recommended_track') IN ('Teacher','Non-teaching')
      THEN json_extract(ai.canonical_json, '$.profile_classification.recommended_track') ELSE c.track END) = ?`);
    bindings.push(effectiveTrack);
  }
  if (subject && subject !== "All subjects") {
    const terms = subjectFilterTerms(subject).filter(Boolean).slice(0, 10);
    addLikeAny("c.search_text", terms);
  }
  if (intent.subjects.length) {
    const terms = intent.subjects.flatMap((value) => subjectFilterTerms(value));
    addLikeAny("c.search_text", terms);
    addEvidenceRequirement("subject", terms);
  }
  for (const exam of intent.exams) {
    const terms = exam === "JEE" ? ["jee", "jee main", "jee advanced", "iit jee"]
      : exam === "NEET UG" ? ["neet", "neet ug"]
        : exam === "Olympiad / NTSE" ? ["olympiad", "ntse"]
          : [exam.toLowerCase()];
    addLikeAny("c.search_text", terms);
    addEvidenceRequirement("exam", terms);
  }
  if (language && language !== "All languages") addLikeAny("c.search_text", [language]);
  for (const intentLanguage of intent.languages) addLikeAny("c.search_text", [intentLanguage]);
  if (intent.locations.length) {
    const terms = locationSearchTerms(intent.locations).slice(0, 16);
    conditions.push(`(${terms.map(() => "(lower(c.city) LIKE ? OR lower(c.state) LIKE ?)").join(" OR ")})`);
    terms.forEach((term) => bindings.push(`%${term}%`, `%${term}%`));
  }
  if (intent.pincodes.length) {
    addLikeAny("c.search_text", intent.pincodes);
  }
  for (const keyword of (intent.keywords || []).slice(0, 12)) {
    conditions.push("lower(c.search_text) LIKE ?");
    bindings.push(`%${keyword}%`);
  }
  if (intent.grades.length) addLikeAny("c.search_text", [Math.min(...intent.grades), Math.max(...intent.grades)]);
  const effectiveWorkMode = workMode && workMode !== "Any work mode" ? workMode : required.work_mode;
  if (effectiveWorkMode === "Online / Remote") conditions.push("(lower(c.work_mode) LIKE '%online%' OR lower(c.work_mode) LIKE '%remote%')");
  else if (effectiveWorkMode === "Offline / On-site") conditions.push("(lower(c.work_mode) LIKE '%offline%' OR lower(c.work_mode) LIKE '%on-site%' OR lower(c.work_mode) LIKE '%onsite%')");
  else if (effectiveWorkMode) { conditions.push("lower(c.work_mode) LIKE ?"); bindings.push(`%${effectiveWorkMode.toLowerCase()}%`); }
  const effectiveExperience = Math.max(minimumExperience, intent.minimumExperienceMonths || 0);
  if (effectiveExperience) { conditions.push("c.experience_months >= ?"); bindings.push(effectiveExperience); }
  const effectiveMinimumViews = Math.max(minimumViews, required.minimum_views || 0);
  const effectiveMinimumCalls = Math.max(minimumCalls, required.minimum_calls || 0);
  if (effectiveMinimumViews) { conditions.push("c.view_count >= ?"); bindings.push(effectiveMinimumViews); }
  if (effectiveMinimumCalls) { conditions.push("c.call_count >= ?"); bindings.push(effectiveMinimumCalls); }
  const planMaximumCalls = required.maximum_calls >= 0 ? required.maximum_calls : excluded.maximum_calls;
  if (planMaximumCalls >= 0) { conditions.push("c.call_count <= ?"); bindings.push(planMaximumCalls); }
  const ageOptions = [maximumAgeDays, required.maximum_age_days].filter((value) => Number(value) > 0);
  const effectiveMaximumAgeDays = ageOptions.length ? Math.min(...ageOptions) : 0;
  if (effectiveMaximumAgeDays) { conditions.push("c.applied_at >= datetime('now', ?)"); bindings.push(`-${effectiveMaximumAgeDays} days`); }
  if (required.employment_statuses.length) {
    conditions.push(`c.employment_status IN (${required.employment_statuses.map(() => "?").join(",")})`);
    bindings.push(...required.employment_statuses);
  }
  if (excluded.track !== "All") { conditions.push("c.track <> ?"); bindings.push(excluded.track); }
  addNotLikeAny("c.search_text", [...excluded.subjects, ...excluded.exams, ...excluded.languages, ...excluded.keywords]);
  if (excluded.locations.length) {
    const terms = locationSearchTerms(excluded.locations).slice(0, 16);
    for (const term of terms) {
      conditions.push("(lower(c.city) NOT LIKE ? AND lower(c.state) NOT LIKE ?)");
      bindings.push(`%${term}%`, `%${term}%`);
    }
  }
  if (excluded.employment_statuses.length) {
    conditions.push(`c.employment_status NOT IN (${excluded.employment_statuses.map(() => "?").join(",")})`);
    bindings.push(...excluded.employment_statuses);
  }
  const ftsQuery = buildFtsQuery(clientPlan ? searchPlan.semantic_query : query);
  const execute = async (withFts) => {
    const allConditions = [...conditions];
    const allBindings = [...bindings];
    const ftsJoin = withFts ? " JOIN candidates_fts ON candidates_fts.candidate_id=c.id" : "";
    if (withFts) { allConditions.unshift("candidates_fts MATCH ?"); allBindings.unshift(ftsQuery); }
    const whereSql = allConditions.length ? ` WHERE ${allConditions.join(" AND ")}` : "";
    const tokens = (intent.tokens || []).slice(0, 18);
    const tokenExpression = tokens.length ? tokens.map(() => "CASE WHEN c.search_text LIKE ? THEN 1 ELSE 0 END").join(" + ") : "0";
    const rankBindings = tokens.map((token) => `%${token}%`);
    const freshnessExpression = `CASE WHEN ?<=0 OR ?<=0 THEN 0 ELSE MAX(0, 10-(MAX(0,julianday('now')-julianday(c.applied_at))/?)*10)*? END`;
    const fromSql = `FROM candidates c LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id=c.id${ftsJoin}`;
    const [totalRow, rows] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS count ${fromSql}${whereSql}`).bind(...allBindings).first(),
      env.DB.prepare(`SELECT c.*, p.standardized_json, ai.status AS ai_status, ai.summary AS ai_summary,
        ai.canonical_json AS ai_canonical_json, ai.processed_at AS ai_processed_at,
        ((${tokenExpression})*20 + ${freshnessExpression}) AS search_rank
        ${fromSql} LEFT JOIN candidate_profiles p ON p.candidate_id=c.id${whereSql}
        ORDER BY search_rank DESC, c.applied_at DESC LIMIT ? OFFSET ?`)
        .bind(...rankBindings, freshnessDecayDays, freshnessWeight, Math.max(1, freshnessDecayDays), freshnessWeight,
          ...allBindings, pageSize, offset).all(),
    ]);
    return { total: Number(totalRow?.count || 0), rows: rows.results || [] };
  };
  let result = await execute(Boolean(ftsQuery && !clientPlan));
  if (!result.total && ftsQuery && !clientPlan) result = await execute(false);
  const scored = result.rows.map((row) => {
    const fit = scoreSearchPlanPreferences(row, searchPlan);
    const base = scoreCandidate(row, query, intent, Date.now(), { freshnessDecayDays, freshnessWeight });
    return candidateResponse(row, Math.min(99, base + fit.bonus), fit);
  }).sort((left, right) => right.match_percent - left.match_percent || String(right.applied_at).localeCompare(String(left.applied_at)));
  const evaluatedRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM candidates").first();
  return json({
    candidates: scored,
    total: result.total,
    evaluated: Number(evaluatedRow?.count || 0),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    understoodAs: clientPlan ? searchPlan.interpretation : describeIntent(intent),
    searchPlan,
    criteria: describeSearchPlan(searchPlan),
    responseTimeMs: Date.now() - started,
    mode: `${clientPlan ? "AI-planned search" : "Indexed search"} · ${includeClaims ? "AI evidence + claims" : "verified résumé evidence preferred"}`,
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
    env.DB.prepare(`SELECT s.*, c.spreadsheet_id, c.sheet_url, c.tab_name, c.last_cursor, c.last_row_count, c.last_error,
      (SELECT COUNT(*) FROM source_records sr WHERE sr.source_id=s.id AND sr.applied_at='1970-01-01T00:00:00.000Z') AS application_history_pending
      FROM sources s LEFT JOIN source_connections c ON c.source_id = s.id ORDER BY s.created_at DESC`).all(),
    env.DB.prepare("SELECT a.*, c.name AS candidate_name FROM activity_logs a LEFT JOIN candidates c ON c.id = a.candidate_id ORDER BY a.created_at DESC LIMIT 40").all(),
    env.DB.prepare(`SELECT j.*, s.label AS source_label, st.imported_rows, st.updated_rows, st.merged_rows,
      st.failed_rows AS detail_failed_rows, st.duplicates_within_source, st.duplicates_central, st.skipped_rows, st.error_json
      FROM sync_jobs j JOIN sources s ON s.id = j.source_id LEFT JOIN sync_job_stats st ON st.job_id = j.id
      ORDER BY j.updated_at DESC LIMIT 12`).all(),
    roleAtLeast(user.role, "Admin")
      ? env.DB.prepare("SELECT email, display_name, role, active FROM access_users WHERE active=1 ORDER BY role, display_name").all()
      : Promise.resolve({ results: [] }),
    getAiMeta(env, roleAtLeast(user.role, "Admin")),
  ]);
  return json({
    repository: { ...(candidateCounts || {}), ...(employmentCounts || {}) },
    sources: sourceCounts.results || [],
    activity: activity.results || [],
    jobs: jobs.results || [],
    users: users.results || [],
    ai,
    user,
    local: !user.protected,
    notice: user.protected ? "Private Vedantu workspace" : "Local development workspace",
  });
}

async function getCandidateHistory(candidateId, env) {
  const candidate = await env.DB.prepare(`SELECT c.*, p.standardized_json, ai.status AS ai_status,
    ai.summary AS ai_summary, ai.canonical_json AS ai_canonical_json, ai.processed_at AS ai_processed_at
    FROM candidates c LEFT JOIN candidate_profiles p ON p.candidate_id = c.id
    LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id = c.id WHERE c.id = ?`).bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const [activity, calls, applications] = await Promise.all([
    env.DB.prepare("SELECT * FROM activity_logs WHERE candidate_id = ? AND action <> 'called' ORDER BY created_at DESC LIMIT 50").bind(candidateId).all(),
    env.DB.prepare("SELECT * FROM calls WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 30").bind(candidateId).all(),
    env.DB.prepare(`SELECT sr.source_id, s.label AS source_label, sr.source_row_key, sr.applied_at,
      sr.duplicate_kind, sr.first_seen_at, sr.updated_at,
      CASE WHEN sr.applied_at=c.applied_at THEN 1 ELSE 0 END AS is_latest
      FROM source_records sr JOIN sources s ON s.id=sr.source_id JOIN candidates c ON c.id=sr.candidate_id
      WHERE sr.candidate_id=? ORDER BY sr.applied_at DESC, sr.updated_at DESC LIMIT 100`).bind(candidateId).all(),
  ]);
  return json({ candidate: candidateResponse(candidate, 0), activity: activity.results || [], calls: calls.results || [], applications: applications.results || [] });
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

async function connectorSecretSetup(request, env) {
  const user = await authenticate(request, env);
  requireRole(user, "Superadmin");
  if (!user.protected) throw new AuthError("Vedantu sign-in is required to change the connector key", 403);
  const url = new URL(request.url);
  if (request.method === "GET") return html(connectorSecretSetupPage(url.searchParams.get("updated") === "1"));
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== "null" && requestOrigin !== url.origin) {
    throw new AuthError("This connector-key request was not accepted", 403);
  }
  const form = await request.formData();
  const secret = String(form.get("secret") || "");
  if (secret.length < 32 || secret.length > 256) return html(connectorSecretSetupPage(false), 400);
  await storeConnectorSecret(env, secret, user.email);
  await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'connector_secret_rotated', 'Google connector key rotated securely', ?)")
    .bind(crypto.randomUUID(), user.displayName, clean(user.email, 320).toLowerCase()).run();
  return redirect(`${url.origin}/api/admin/connector-secret/setup?updated=1`);
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

async function startAiBatch(request, env, user, ctx) {
  requireSecureAdmin(user, env);
  if (!env.OPENAI_API_KEY) return json({ error: "Add OPENAI_API_KEY in Cloudflare before starting résumé processing" }, 409);
  const payload = await request.json().catch(() => ({}));
  const result = await enqueueAiBatch(env, payload.limit || 20);
  await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'ai_batch_started', ?, ?)")
    .bind(crypto.randomUUID(), user.displayName, `${result.queued} résumés queued for evidence extraction`, clean(user.email, 320).toLowerCase()).run();
  if (ctx?.waitUntil) ctx.waitUntil(processAiEnrichment(env));
  return json({ ok: true, ...result, message: result.queued ? "Résumé evidence batch queued" : "These recent résumés are already current" }, 202);
}

async function retryAiJobs(request, env, user, ctx) {
  requireSecureAdmin(user, env);
  const payload = await request.json().catch(() => ({}));
  const retried = await retryAiFailures(env, clean(payload.jobId, 100), Boolean(payload.retryableOnly));
  await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'ai_failures_retried', ?, ?)")
    .bind(crypto.randomUUID(), user.displayName, `${retried} AI profile${retried === 1 ? "" : "s"} queued again`, clean(user.email, 320).toLowerCase()).run();
  if (retried && ctx?.waitUntil) ctx.waitUntil(processAiEnrichment(env));
  return json({ ok: true, retried }, retried ? 202 : 200);
}

async function updateAiAutomation(request, env, user, ctx) {
  requireSecureAdmin(user, env);
  const payload = await request.json().catch(() => ({}));
  const automatic = await setAiAutomation(env, Boolean(payload.enabled), user);
  await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email) VALUES (?, NULL, ?, 'ai_automation_changed', ?, ?)")
    .bind(crypto.randomUUID(), user.displayName, automatic ? "Automatic résumé classification enabled" : "Automatic résumé classification paused", clean(user.email, 320).toLowerCase()).run();
  if (automatic && ctx?.waitUntil) ctx.waitUntil(processAiEnrichment(env));
  return json({ ok: true, automatic });
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
  if (request.method === "POST" && url.pathname === "/api/search/plan") return getSearchPlan(request, env);
  if (request.method === "GET" && url.pathname === "/api/candidates") return getCandidates(request, env);
  if (request.method === "GET" && url.pathname === "/api/superadmin") return getSuperadminDashboard(request, env, user);
  if (request.method === "GET" && url.pathname === "/api/superadmin/export") return exportSuperadminData(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/searches") return logSearch(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/admin/sources/preview") return previewSource(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/admin/sources") return createSource(request, env, user, ctx);
  if (request.method === "POST" && url.pathname === "/api/admin/users") return addAccessUser(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/admin/ai/batch") return startAiBatch(request, env, user, ctx);
  if (request.method === "POST" && url.pathname === "/api/admin/ai/retry") return retryAiJobs(request, env, user, ctx);
  if (request.method === "POST" && url.pathname === "/api/admin/ai/automation") return updateAiAutomation(request, env, user, ctx);

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
      if (url.pathname.startsWith("/auth/")) {
        const response = await authRoute(request, env);
        if (response) return response;
      }
      if (["/admin/connector-secret", "/api/admin/connector-secret/setup"].includes(url.pathname)) {
        return await connectorSecretSetup(request, env);
      }
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env, ctx);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 500;
      return json({ error: error instanceof Error ? error.message : "Unexpected Talent Desk error" }, status);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processAiEnrichment(env));
    ctx.waitUntil(backfillApplicationDates(env));
    const sources = await env.DB.prepare(`SELECT id FROM sources
      WHERE connected=1 AND id IN (SELECT source_id FROM source_connections)
      AND (last_sync <= datetime('now', '-15 minutes') OR EXISTS (
        SELECT 1 FROM sync_jobs WHERE source_id=sources.id AND status IN ('Queued', 'Running')
      ))
      ORDER BY CASE WHEN status='Syncing' THEN 0 ELSE 1 END, last_sync LIMIT 3`).all();
    for (const source of sources.results || []) await startSourceSync(env, source.id, "System", ctx, false);
  },
};
