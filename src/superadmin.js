import { requireRole } from "./auth.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvResponse(name, rows) {
  const keys = rows.length ? Object.keys(rows[0]) : ["message"];
  const body = [keys.map(csvCell).join(","), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

async function audit(env, user, action, detail, candidateId = null) {
  await env.DB.prepare(`INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), candidateId, user.displayName, action, detail, user.email).run();
}

function recommendationSql() {
  return `CASE WHEN ai.status='completed' THEN COALESCE(json_extract(ai.canonical_json,
    '$.profile_classification.recommended_track'), 'Pending') ELSE 'Pending' END`;
}

export async function getSuperadminDashboard(request, env, user) {
  requireRole(user, "Superadmin");
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"), 160).toLowerCase();
  const page = Math.max(1, Math.round(Number(url.searchParams.get("page")) || 1));
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = `%${query}%`;
  const where = query ? `WHERE lower(c.name) LIKE ? OR lower(c.email) LIKE ? OR lower(c.phone) LIKE ?
    OR lower(c.source_sheet) LIKE ? OR lower(c.role) LIKE ?` : "";
  const bindings = query ? [search, search, search, search, search] : [];
  const [metrics, employmentRows, userCount, total, candidates, usage, sources, classifications] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS profiles, COALESCE(SUM(duplicate_count),0) AS duplicates,
      COALESCE(SUM(view_count),0) AS views, COALESCE(SUM(call_count),0) AS calls,
      COALESCE(SUM(resume_open_count),0) AS resume_opens,
      SUM(CASE WHEN employment_status='Active employee' THEN 1 ELSE 0 END) AS active_profiles,
      SUM(CASE WHEN employment_status='Former employee' THEN 1 ELSE 0 END) AS former_profiles
      FROM candidates`).first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN employment_status='Active employee' THEN 1 ELSE 0 END) AS active_rows,
      SUM(CASE WHEN employment_status='Former employee' THEN 1 ELSE 0 END) AS former_rows,
      COUNT(*) AS total_rows FROM employment_records`).first(),
    env.DB.prepare("SELECT COUNT(*) AS active_users FROM access_users WHERE active=1").first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM candidates c ${where}`).bind(...bindings).first(),
    env.DB.prepare(`SELECT c.id, c.name, c.email, c.phone, c.track AS source_track, c.role, c.city, c.state,
      c.subject_display, c.grades_display, c.applied_at, c.source_sheet, c.employment_status, c.view_count,
      c.call_count, c.duplicate_count, ${recommendationSql()} AS recommended_track,
      COALESCE(json_extract(ai.canonical_json, '$.profile_classification.confidence'),0) AS classification_confidence
      FROM candidates c LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id=c.id ${where}
      ORDER BY c.applied_at DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(actor_email,''), actor) AS identity, MAX(actor) AS display_name,
      COUNT(*) AS actions, SUM(CASE WHEN action='searched' THEN 1 ELSE 0 END) AS searches,
      SUM(CASE WHEN action='viewed' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN action='resume_opened' THEN 1 ELSE 0 END) AS resume_opens,
      SUM(CASE WHEN action='called' THEN 1 ELSE 0 END) AS calls, MAX(created_at) AS last_active
      FROM activity_logs GROUP BY COALESCE(NULLIF(actor_email,''), actor) ORDER BY last_active DESC LIMIT 60`).all(),
    env.DB.prepare(`SELECT s.id, s.label, s.kind, s.status, s.connected, s.total_rows, s.synced_rows,
      s.failed_rows, s.duplicate_rows, s.last_sync, sc.sheet_url
      FROM sources s LEFT JOIN source_connections sc ON sc.source_id=s.id ORDER BY s.created_at DESC`).all(),
    env.DB.prepare(`SELECT ${recommendationSql()} AS recommendation, COUNT(*) AS count
      FROM candidate_ai_profiles ai GROUP BY ${recommendationSql()} ORDER BY count DESC`).all(),
  ]);
  return json({
    metrics: { ...(metrics || {}), ...(employmentRows || {}), ...(userCount || {}) },
    candidates: candidates.results || [],
    total: Number(total?.count || 0),
    page,
    pageSize: limit,
    usage: usage.results || [],
    sources: sources.results || [],
    classifications: classifications.results || [],
  });
}

export async function getSuperadminCandidate(env, user, candidateId) {
  requireRole(user, "Superadmin");
  const [candidate, rows] = await Promise.all([
    env.DB.prepare(`SELECT c.*, p.standardized_json, ai.canonical_json AS ai_canonical_json
      FROM candidates c LEFT JOIN candidate_profiles p ON p.candidate_id=c.id
      LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id=c.id WHERE c.id=?`).bind(candidateId).first(),
    env.DB.prepare(`SELECT sr.source_id, s.label AS source_label, sr.source_row_key, sr.duplicate_kind,
      sr.raw_json, sr.first_seen_at, sr.updated_at FROM source_records sr JOIN sources s ON s.id=sr.source_id
      WHERE sr.candidate_id=? ORDER BY sr.updated_at DESC`).bind(candidateId).all(),
  ]);
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  let standardized = {};
  let aiProfile = null;
  try { standardized = JSON.parse(candidate.standardized_json || "{}"); } catch { standardized = {}; }
  try { aiProfile = JSON.parse(candidate.ai_canonical_json || "null"); } catch { aiProfile = null; }
  return json({ candidate: { ...candidate, standardized_json: undefined, ai_canonical_json: undefined, standardized, ai_profile: aiProfile }, rows: rows.results || [] });
}

export async function updateSuperadminCandidate(request, env, user, candidateId) {
  requireRole(user, "Superadmin");
  const payload = await request.json().catch(() => ({}));
  const current = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(candidateId).first();
  if (!current) return json({ error: "Candidate not found" }, 404);
  const next = {
    name: clean(payload.name, 200) || current.name,
    track: ["Teacher", "Non-teaching"].includes(payload.track) ? payload.track : current.track,
    role: clean(payload.role, 240), city: clean(payload.city, 160), state: clean(payload.state, 160),
    subject_display: clean(payload.subject_display, 600), grades_display: clean(payload.grades_display, 600),
    boards_display: clean(payload.boards_display, 600), languages_display: clean(payload.languages_display, 600),
    experience_months: Math.max(0, Math.round(Number(payload.experience_months) || 0)),
    work_mode: clean(payload.work_mode, 160),
  };
  const initials = next.name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  const searchText = [next.name, current.email, current.phone, next.track, next.role, next.city, next.state,
    next.subject_display, next.grades_display, next.boards_display, next.languages_display, next.work_mode,
    current.education, current.college].join(" ").toLowerCase().slice(0, 5000);
  const changed = Object.keys(next).filter((key) => String(next[key]) !== String(current[key]));
  await env.DB.batch([
    env.DB.prepare(`UPDATE candidates SET name=?, initials=?, track=?, role=?, city=?, state=?, subject_display=?,
      grades_display=?, boards_display=?, languages_display=?, experience_months=?, work_mode=?, search_text=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(next.name, initials, next.track, next.role, next.city, next.state,
      next.subject_display, next.grades_display, next.boards_display, next.languages_display, next.experience_months,
      next.work_mode, searchText, candidateId),
    env.DB.prepare(`INSERT INTO activity_logs(id, candidate_id, actor, action, detail, actor_email)
      VALUES (?, ?, ?, 'superadmin_edited', ?, ?)`).bind(crypto.randomUUID(), candidateId, user.displayName,
      changed.length ? `Edited canonical fields: ${changed.join(", ")}` : "Reviewed canonical row; no changes", user.email),
  ]);
  return json({ ok: true, changed });
}

export async function exportSuperadminData(request, env, user) {
  requireRole(user, "Superadmin");
  const type = clean(new URL(request.url).searchParams.get("type"), 40);
  const queries = {
    candidates: `SELECT c.id, c.name, c.email, c.phone, c.track AS source_track, c.role, c.city, c.state,
      c.subject_display, c.grades_display, c.boards_display, c.languages_display, c.education, c.college,
      c.experience_months, c.work_mode, c.applied_at, c.source_sheet, c.resume_url, c.employment_status,
      c.employment_times_hired, c.view_count, c.resume_open_count, c.call_count, c.duplicate_count,
      ${recommendationSql()} AS ai_recommended_track,
      COALESCE(json_extract(ai.canonical_json, '$.profile_classification.confidence'),0) AS ai_confidence
      FROM candidates c LEFT JOIN candidate_ai_profiles ai ON ai.candidate_id=c.id ORDER BY c.applied_at DESC`,
    employment: `SELECT er.*, s.label AS source_label FROM employment_records er JOIN sources s ON s.id=er.source_id
      ORDER BY er.updated_at DESC LIMIT 20000`,
    raw: `SELECT s.label AS source_label, sr.source_row_key, sr.candidate_id, c.name AS candidate_name,
      sr.duplicate_kind, sr.raw_json, sr.first_seen_at, sr.updated_at FROM source_records sr
      JOIN sources s ON s.id=sr.source_id LEFT JOIN candidates c ON c.id=sr.candidate_id
      ORDER BY sr.updated_at DESC LIMIT 20000`,
    usage: `SELECT COALESCE(NULLIF(actor_email,''), actor) AS identity, MAX(actor) AS display_name,
      COUNT(*) AS actions, SUM(CASE WHEN action='searched' THEN 1 ELSE 0 END) AS searches,
      SUM(CASE WHEN action='viewed' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN action='resume_opened' THEN 1 ELSE 0 END) AS resume_opens,
      SUM(CASE WHEN action='called' THEN 1 ELSE 0 END) AS calls, MAX(created_at) AS last_active
      FROM activity_logs GROUP BY COALESCE(NULLIF(actor_email,''), actor) ORDER BY last_active DESC`,
    sources: `SELECT s.*, sc.sheet_url, sc.tab_name, sc.last_cursor, sc.last_row_count, sc.last_error,
      sc.created_by, sc.created_at AS connected_at FROM sources s LEFT JOIN source_connections sc ON sc.source_id=s.id
      ORDER BY s.created_at DESC`,
  };
  if (!queries[type]) return json({ error: "Unknown export type" }, 400);
  const rows = (await env.DB.prepare(queries[type]).all()).results || [];
  await audit(env, user, "superadmin_exported", `${type} report · ${rows.length} rows`);
  return csvResponse(`vedantu-talent-desk-${type}-${new Date().toISOString().slice(0, 10)}.csv`, rows.length ? rows : [{ message: "No rows" }]);
}
