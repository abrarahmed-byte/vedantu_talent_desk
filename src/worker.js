import { buildFtsQuery, describeIntent, parseSearchIntent, scoreCandidate } from "./search.js";

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

function candidateResponse(row, score) {
  return {
    ...row,
    subjects: list(row.subject_display),
    grades: list(row.grades_display),
    boards: list(row.boards_display),
    languages: list(row.languages_display),
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
  const intent = parseSearchIntent(query);
  const conditions = [];
  const bindings = [];
  const effectiveTrack = track && track !== "All" ? track : intent.track !== "All" ? intent.track : "";
  if (effectiveTrack) { conditions.push("c.track = ?"); bindings.push(effectiveTrack); }
  if (subject && subject !== "All subjects") { conditions.push("c.search_text LIKE ?"); bindings.push(`%${subject.toLowerCase()}%`); }
  if (language && language !== "All languages") { conditions.push("c.search_text LIKE ?"); bindings.push(`%${language.toLowerCase()}%`); }
  if (workMode && workMode !== "Any work mode") { conditions.push("c.work_mode = ?"); bindings.push(workMode); }
  const effectiveExperience = Math.max(minimumExperience, intent.minimumExperienceMonths || 0);
  if (effectiveExperience) { conditions.push("c.experience_months >= ?"); bindings.push(effectiveExperience); }
  const ftsQuery = buildFtsQuery(query);
  let sql = "SELECT c.* FROM candidates c";
  if (ftsQuery) {
    sql += " JOIN candidates_fts ON candidates_fts.candidate_id = c.id";
    conditions.unshift("candidates_fts MATCH ?");
    bindings.unshift(ftsQuery);
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY c.applied_at DESC LIMIT 120";
  let rows = (await env.DB.prepare(sql).bind(...bindings).all()).results || [];
  if (!rows.length && ftsQuery) {
    let fallbackSql = "SELECT c.* FROM candidates c";
    const fallbackConditions = conditions.slice(1);
    const fallbackBindings = bindings.slice(1);
    if (fallbackConditions.length) fallbackSql += ` WHERE ${fallbackConditions.join(" AND ")}`;
    fallbackSql += " ORDER BY c.applied_at DESC LIMIT 120";
    rows = (await env.DB.prepare(fallbackSql).bind(...fallbackBindings).all()).results || [];
  }
  const scored = rows
    .map((row) => candidateResponse(row, scoreCandidate(row, query, intent)))
    .sort((a, b) => b.match_percent - a.match_percent || String(b.applied_at).localeCompare(String(a.applied_at)))
    .slice(0, 40);
  return json({
    candidates: scored,
    total: scored.length,
    understoodAs: describeIntent(intent),
    responseTimeMs: Date.now() - started,
    mode: "Indexed D1 search · no paid AI call",
  });
}

async function getMeta(env) {
  const [candidateCounts, sourceCounts, activity, jobs, users] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS profiles, COALESCE(SUM(duplicate_count), 0) AS duplicates, COALESCE(SUM(view_count), 0) AS views, COALESCE(SUM(call_count), 0) AS calls FROM candidates").first(),
    env.DB.prepare("SELECT * FROM sources ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT a.*, c.name AS candidate_name FROM activity_logs a LEFT JOIN candidates c ON c.id = a.candidate_id ORDER BY a.created_at DESC LIMIT 40").all(),
    env.DB.prepare("SELECT j.*, s.label AS source_label FROM sync_jobs j JOIN sources s ON s.id = j.source_id ORDER BY j.updated_at DESC LIMIT 10").all(),
    env.DB.prepare("SELECT email, display_name, role, active FROM access_users ORDER BY role, display_name").all(),
  ]);
  return json({
    repository: candidateCounts || { profiles: 0, duplicates: 0, views: 0, calls: 0 },
    sources: sourceCounts.results || [],
    activity: activity.results || [],
    jobs: jobs.results || [],
    users: users.results || [],
    pilot: true,
    notice: "Fictional data only · zero-cost Cloudflare pilot",
  });
}

async function getCandidateHistory(candidateId, env) {
  const candidate = await env.DB.prepare("SELECT * FROM candidates WHERE id = ?").bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const [activity, calls] = await Promise.all([
    env.DB.prepare("SELECT * FROM activity_logs WHERE candidate_id = ? AND action <> 'called' ORDER BY created_at DESC LIMIT 50").bind(candidateId).all(),
    env.DB.prepare("SELECT * FROM calls WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 30").bind(candidateId).all(),
  ]);
  return json({ candidate: candidateResponse(candidate, 0), activity: activity.results || [], calls: calls.results || [] });
}

async function logCandidateEvent(request, env, candidateId, action) {
  const candidate = await env.DB.prepare("SELECT id FROM candidates WHERE id = ?").bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const payload = await request.json().catch(() => ({}));
  const actor = clean(payload.actor, 100) || "Pilot Recruiter";
  const existingActor = action === "viewed"
    ? await env.DB.prepare("SELECT id FROM activity_logs WHERE candidate_id = ? AND actor = ? AND action = 'viewed' LIMIT 1").bind(candidateId, actor).first()
    : null;
  const activity = env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), candidateId, actor, action, action === "viewed" ? "Viewed candidate profile" : "Opened fictional resume preview");
  let updateSql = "UPDATE candidates SET updated_at = CURRENT_TIMESTAMP";
  if (action === "viewed") updateSql += ", view_count = view_count + 1" + (existingActor ? "" : ", interviewer_count = interviewer_count + 1");
  if (action === "resume_opened") updateSql += ", resume_open_count = resume_open_count + 1";
  updateSql += " WHERE id = ?";
  await env.DB.batch([activity, env.DB.prepare(updateSql).bind(candidateId)]);
  return json({ ok: true });
}

async function logCall(request, env, candidateId) {
  const payload = await request.json().catch(() => ({}));
  const recruiter = clean(payload.recruiter, 100) || "Pilot Recruiter";
  const role = clean(payload.role, 120);
  const outcome = clean(payload.outcome, 40);
  const note = clean(payload.note, 500);
  if (!["DNP", "Interested", "Not Interested", "Call Back"].includes(outcome)) return json({ error: "Choose a call outcome" }, 400);
  const candidate = await env.DB.prepare("SELECT id, name FROM candidates WHERE id = ?").bind(candidateId).first();
  if (!candidate) return json({ error: "Candidate not found" }, 404);
  const callId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO calls(id, candidate_id, recruiter, role, outcome, note) VALUES (?, ?, ?, ?, ?, ?)").bind(callId, candidateId, recruiter, role, outcome, note),
    env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail) VALUES (?, ?, ?, 'called', ?)").bind(crypto.randomUUID(), candidateId, recruiter, `${outcome}${role ? ` · ${role}` : ""}${note ? ` · ${note}` : ""}`),
    env.DB.prepare("UPDATE candidates SET call_count = call_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(candidateId),
  ]);
  return json({ ok: true, id: callId });
}

async function logSearch(request, env) {
  const payload = await request.json().catch(() => ({}));
  const actor = clean(payload.actor, 100) || "Pilot Recruiter";
  const query = clean(payload.query, 300);
  if (query) await env.DB.prepare("INSERT INTO activity_logs(id, candidate_id, actor, action, detail) VALUES (?, NULL, ?, 'searched', ?)").bind(crypto.randomUUID(), actor, query).run();
  return json({ ok: true });
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const result = await env.DB.prepare("SELECT COUNT(*) AS candidates FROM candidates").first();
    return json({ ok: true, database: "vedantu_talent_desk_db", ...result });
  }
  if (request.method === "GET" && url.pathname === "/api/meta") return getMeta(env);
  if (request.method === "GET" && url.pathname === "/api/candidates") return getCandidates(request, env);
  if (request.method === "POST" && url.pathname === "/api/searches") return logSearch(request, env);
  const match = url.pathname.match(/^\/api\/candidates\/([^/]+)(?:\/(history|view|resume-open|calls))?$/);
  if (!match) return json({ error: "API route not found" }, 404);
  const candidateId = decodeURIComponent(match[1]);
  const action = match[2];
  if (request.method === "GET" && action === "history") return getCandidateHistory(candidateId, env);
  if (request.method === "POST" && action === "view") return logCandidateEvent(request, env, candidateId, "viewed");
  if (request.method === "POST" && action === "resume-open") return logCandidateEvent(request, env, candidateId, "resume_opened");
  if (request.method === "POST" && action === "calls") return logCall(request, env, candidateId);
  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unexpected pilot error" }, 500);
    }
  },
};
