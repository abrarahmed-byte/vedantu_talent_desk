import { connectorRequest } from "./sync.js";

export const AI_PROMPT_VERSION = "resume-profile-classification-v3";
export const AI_SCHEMA_VERSION = "candidate-evidence-v3";
export const DEFAULT_AI_MODEL = "gpt-5-nano";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_BATCH_SIZE = 20;
const MAX_PREPARE_PER_RUN = 4;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "string" },
    resume_text: { type: "string" },
    summary: { type: "string" },
    profile_classification: {
      type: "object",
      additionalProperties: false,
      properties: {
        recommended_track: { type: "string", enum: ["Teacher", "Non-teaching", "Unclear"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              quote: { type: "string" },
              page: { type: "integer", minimum: 0 },
            },
            required: ["quote", "page"],
          },
        },
      },
      required: ["recommended_track", "confidence", "rationale", "evidence"],
    },
    teaching_experience_months: { type: "integer", minimum: 0 },
    needs_human_review: { type: "boolean" },
    warnings: { type: "array", items: { type: "string" } },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: ["subject", "exam", "grade", "board", "language", "qualification", "college", "role", "skill", "city", "employer"],
          },
          value: { type: "string" },
          normalized_value: { type: "string" },
          form_claimed: { type: "boolean" },
          resume_status: { type: "string", enum: ["supported", "claim_only", "contradicted"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                quote: { type: "string" },
                page: { type: "integer", minimum: 0 },
              },
              required: ["quote", "page"],
            },
          },
        },
        required: ["category", "value", "normalized_value", "form_claimed", "resume_status", "confidence", "evidence"],
      },
    },
    employment_history: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          employer: { type: "string" },
          title: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["employer", "title", "start_date", "end_date", "evidence"],
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          qualification: { type: "string" },
          institution: { type: "string" },
          year: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["qualification", "institution", "year", "evidence"],
      },
    },
  },
  required: ["schema_version", "resume_text", "summary", "profile_classification", "teaching_experience_months", "needs_human_review", "warnings", "facts", "employment_history", "education"],
};

const SYSTEM_PROMPT = `You reconcile a candidate's application form claims with evidence in their resume for a recruitment repository.

Rules:
- The form row contains candidate-provided claims. The resume is evidence, not necessarily a complete history.
- Put the readable plain text from the entire resume in resume_text. Preserve names, employers, job titles, institutions, subjects, skills and dates. Remove repeated headers or decorative characters, do not summarize this field, and keep it within 20,000 characters.
- Independently recommend Teacher, Non-teaching, or Unclear using resume text only. Do not use the form's profile type, subject selections, opportunity selections, or stated interest to make this classification.
- Recommend Teacher only when the resume directly evidences teaching, tutoring, faculty work, classroom or online instruction, lesson delivery, student assessment, or comparable educator experience.
- A degree, subject knowledge, software skills, exam preparation, or an interest in teaching is not teaching experience by itself.
- Recommend Non-teaching when the resume primarily evidences functional work such as operations, sales, marketing, design, engineering, finance, HR, support, or product work and contains no clear teaching history.
- Recommend Unclear when evidence is missing, ambiguous, or balanced. Keep classification confidence below 0.75 and set needs_human_review when unclear, low-confidence, or when the resume recommendation conflicts with the form-derived track.
- Classification evidence must contain short exact quotes from the resume. A recommendation is a routing aid, not a hiring decision.
- Use "supported" only when the resume directly supports the fact.
- Use "claim_only" when the form claims it but the resume does not evidence it. Absence is not proof the claim is false.
- Use "contradicted" only when the resume contains direct conflicting evidence. Explain the conflict in warnings.
- Include every material teaching claim from the form, especially subjects, competitive exams such as JEE/NEET/Olympiad, grades, boards, languages and experience.
- Also include useful resume facts that were not claimed in the form.
- Evidence quotes must be short and copied from the resume. Use page 0 when a page number is unavailable.
- Normalize equivalent names (for example IIT-JEE to JEE, Maths to Mathematics), but never invent experience.
- Do not infer protected or sensitive traits. Confidence measures extraction confidence, not candidate quality or hiring suitability.
- Return only the requested structured data.`;

function compactString(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function compactObject(value, depth = 0) {
  if (depth > 4) return compactString(value, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => compactObject(item, depth + 1));
  if (!value || typeof value !== "object") return compactString(value);
  return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [compactString(key, 200), compactObject(item, depth + 1)]));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function model(env) {
  return compactString(env.AI_MODEL || DEFAULT_AI_MODEL, 120);
}

async function openAiFetch(env, path, options = {}) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Cloudflare");
  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error?.message || `OpenAI request failed (${response.status})`;
    const error = new Error(message);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return response;
}

async function uploadFile(env, bytes, filename, mimeType, purpose) {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File([bytes], filename, { type: mimeType }));
  return openAiFetch(env, "/files", { method: "POST", body: form }).then((response) => response.json());
}

async function deleteOpenAiFile(env, fileId) {
  if (!fileId) return;
  await openAiFetch(env, `/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }).catch(() => null);
}

async function candidateClaims(env, candidateId) {
  const [profile, records] = await Promise.all([
    env.DB.prepare("SELECT standardized_json FROM candidate_profiles WHERE candidate_id=?").bind(candidateId).first(),
    env.DB.prepare("SELECT raw_json FROM source_records WHERE candidate_id=? ORDER BY updated_at DESC LIMIT 5").bind(candidateId).all(),
  ]);
  let standardized = {};
  try { standardized = JSON.parse(profile?.standardized_json || "{}"); } catch { standardized = {}; }
  const sourceRows = (records.results || []).map((record) => {
    try { return JSON.parse(record.raw_json || "{}"); } catch { return {}; }
  });
  return compactObject({ standardized, sourceRows });
}

export async function enqueueAiBatch(env, requestedLimit = MAX_BATCH_SIZE) {
  if (!env.OPENAI_API_KEY) throw new Error("Add the OpenAI API key in Cloudflare before starting a batch");
  if (!env.APPS_SCRIPT_CONNECTOR_URL || !env.CONNECTOR_SECRET) throw new Error("The Google Drive connector is not configured");
  const limit = Math.min(MAX_BATCH_SIZE, Math.max(1, Math.round(Number(requestedLimit) || MAX_BATCH_SIZE)));
  const rows = (await env.DB.prepare(`SELECT c.id, c.resume_url FROM candidates c
    WHERE trim(c.resume_url) <> '' AND NOT EXISTS (
      SELECT 1 FROM ai_extraction_jobs j WHERE j.candidate_id=c.id AND j.prompt_version=?
    ) ORDER BY c.applied_at DESC LIMIT ?`).bind(AI_PROMPT_VERSION, limit).all()).results || [];
  let queued = 0;
  for (const row of rows) {
    const dedupeKey = await sha256(`${row.id}|${row.resume_url}|${AI_PROMPT_VERSION}`);
    const claims = await candidateClaims(env, row.id);
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO ai_extraction_jobs(
      id, candidate_id, dedupe_key, status, model, prompt_version, schema_version, resume_url, claims_json
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), row.id, dedupeKey, model(env), AI_PROMPT_VERSION, AI_SCHEMA_VERSION, row.resume_url, JSON.stringify(claims),
    ).run();
    queued += Number(result.meta?.changes || 0);
  }
  return { selected: rows.length, queued, alreadyCurrent: rows.length - queued, limit };
}

async function prepareOneJob(env, job) {
  await env.DB.prepare(`UPDATE ai_extraction_jobs SET status='preparing', attempt_count=attempt_count+1,
    error_message='', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(job.id).run();
  try {
    const resume = await connectorRequest(env, { action: "readResume", resumeUrl: job.resume_url, maxBytes: MAX_RESUME_BYTES });
    if (!resume?.base64 || !resume?.fileName) throw new Error("The résumé could not be read from Google Drive");
    const bytes = decodeBase64(resume.base64);
    if (bytes.byteLength > MAX_RESUME_BYTES) throw new Error("The résumé is larger than the 5 MB processing limit");
    const uploaded = await uploadFile(env, bytes, compactString(resume.fileName, 240), compactString(resume.mimeType, 160) || "application/pdf", "user_data");
    await env.DB.prepare(`UPDATE ai_extraction_jobs SET status='prepared', resume_file_id=?, resume_filename=?,
      resume_mime_type=?, resume_fingerprint=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      uploaded.id, compactString(resume.fileName, 240), compactString(resume.mimeType, 160), compactString(resume.fingerprint, 300), job.id,
    ).run();
    return true;
  } catch (error) {
    const attempt = Number(job.attempt_count || 0) + 1;
    const retry = Boolean(error?.retryable) && attempt < 3;
    const message = compactString(error instanceof Error ? error.message : error, 800);
    const noResume = /not found|access|permission|résumé|resume|unsupported|larger/i.test(message) && !retry;
    await env.DB.prepare(`UPDATE ai_extraction_jobs SET status=?, error_message=?, updated_at=CURRENT_TIMESTAMP,
      completed_at=CASE WHEN ?='queued' THEN NULL ELSE CURRENT_TIMESTAMP END WHERE id=?`).bind(
      retry ? "queued" : noResume ? "no_resume" : "failed", message, retry ? "queued" : "failed", job.id,
    ).run();
    return false;
  }
}

async function prepareQueuedJobs(env) {
  const jobs = (await env.DB.prepare(`SELECT * FROM ai_extraction_jobs WHERE status='queued'
    ORDER BY created_at LIMIT ?`).bind(Number(env.AI_PREPARE_PER_RUN) || MAX_PREPARE_PER_RUN).all()).results || [];
  for (const job of jobs) await prepareOneJob(env, job);
  return jobs.length;
}

function buildBatchRequest(job) {
  const fileInput = { type: "input_file", file_id: job.resume_file_id };
  if (job.resume_mime_type === "application/pdf") fileInput.detail = "low";
  return {
    custom_id: job.id,
    method: "POST",
    url: "/v1/responses",
    body: {
      model: job.model,
      store: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [
          { type: "input_text", text: `Application-form data (candidate claims):\n${job.claims_json}` },
          fileInput,
        ] },
      ],
      text: { format: { type: "json_schema", name: "candidate_evidence", strict: true, schema: EVIDENCE_SCHEMA } },
    },
  };
}

export function buildBatchJsonl(jobs) {
  return jobs.map((job) => JSON.stringify(buildBatchRequest(job))).join("\n") + "\n";
}

async function submitPreparedBatch(env) {
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Number(env.AI_BATCH_SIZE) || MAX_BATCH_SIZE));
  const readiness = await env.DB.prepare(`SELECT
    SUM(CASE WHEN status='prepared' AND batch_id='' THEN 1 ELSE 0 END) AS prepared,
    SUM(CASE WHEN status IN ('queued','preparing') THEN 1 ELSE 0 END) AS waiting
    FROM ai_extraction_jobs`).first();
  if (Number(readiness?.prepared || 0) < batchSize && Number(readiness?.waiting || 0) > 0) return null;
  const first = await env.DB.prepare(`SELECT model FROM ai_extraction_jobs WHERE status='prepared' AND batch_id=''
    ORDER BY created_at LIMIT 1`).first();
  if (!first?.model) return null;
  const jobs = (await env.DB.prepare(`SELECT * FROM ai_extraction_jobs WHERE status='prepared' AND batch_id='' AND model=?
    ORDER BY created_at LIMIT ?`).bind(first.model, batchSize).all()).results || [];
  if (!jobs.length) return null;
  const jsonl = buildBatchJsonl(jobs);
  const input = await uploadFile(env, new TextEncoder().encode(jsonl), `vedantu-candidate-batch-${Date.now()}.jsonl`, "application/jsonl", "batch");
  let remote;
  try {
    remote = await openAiFetch(env, "/batches", {
      method: "POST",
      body: JSON.stringify({
        input_file_id: input.id,
        endpoint: "/v1/responses",
        completion_window: "24h",
        metadata: { workflow: "vedantu_candidate_evidence", schema: AI_SCHEMA_VERSION },
      }),
    }).then((response) => response.json());
  } catch (error) {
    await deleteOpenAiFile(env, input.id);
    throw error;
  }
  const localId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(`INSERT INTO ai_batches(id, openai_batch_id, input_file_id, model, status, request_count)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(localId, remote.id, input.id, jobs[0].model, remote.status || "validating", jobs.length),
    ...jobs.map((job) => env.DB.prepare(`UPDATE ai_extraction_jobs SET status='batched', batch_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(localId, job.id)),
  ];
  await env.DB.batch(statements);
  return localId;
}

export function extractResponseText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const output of body?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
      if (content?.type === "refusal") throw new Error(content.refusal || "The model refused this résumé");
    }
  }
  throw new Error("The batch response did not contain structured output");
}

function normalizedFactValue(fact) {
  return compactString(fact?.normalized_value || fact?.value, 300).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

async function persistAiResult(env, job, result) {
  if (!result || !Array.isArray(result.facts)) throw new Error("The structured résumé result is incomplete");
  const facts = result.facts.slice(0, 120).filter((fact) => normalizedFactValue(fact));
  const resumeText = compactString(result.resume_text, 20000);
  const statements = [
    env.DB.prepare("DELETE FROM candidate_ai_facts WHERE candidate_id=?").bind(job.candidate_id),
    env.DB.prepare(`INSERT INTO candidate_ai_profiles(candidate_id, status, model, prompt_version, schema_version,
      resume_fingerprint, summary, canonical_json, processed_at) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(candidate_id) DO UPDATE SET status='completed', model=excluded.model, prompt_version=excluded.prompt_version,
      schema_version=excluded.schema_version, resume_fingerprint=excluded.resume_fingerprint, summary=excluded.summary,
      canonical_json=excluded.canonical_json, processed_at=CURRENT_TIMESTAMP`).bind(
      job.candidate_id, job.model, job.prompt_version, job.schema_version, job.resume_fingerprint,
      compactString(result.summary, 2000), JSON.stringify(result),
    ),
    ...facts.map((fact) => env.DB.prepare(`INSERT INTO candidate_ai_facts(id, candidate_id, category, normalized_value,
      display_value, verification_status, form_claimed, confidence, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), job.candidate_id, compactString(fact.category, 40), normalizedFactValue(fact), compactString(fact.value, 300),
      ["supported", "contradicted"].includes(fact.resume_status) ? fact.resume_status : "claim_only",
      fact.form_claimed ? 1 : 0, Math.max(0, Math.min(1, Number(fact.confidence) || 0)), JSON.stringify(fact.evidence || []),
    )),
    ...(resumeText ? [env.DB.prepare(`UPDATE candidates SET resume_text=?,
      search_text=substr(trim(row_text || ' ' || ?), 1, 50000), updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(resumeText, resumeText, job.candidate_id)] : []),
    env.DB.prepare(`UPDATE ai_extraction_jobs SET status='completed', error_message='', completed_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(job.id),
  ];
  await env.DB.batch(statements);
}

async function markJobFailed(env, jobId, message) {
  await env.DB.prepare(`UPDATE ai_extraction_jobs SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(compactString(message, 800), jobId).run();
}

async function ingestJsonl(env, text, isErrorFile = false) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const jobId = compactString(entry.custom_id, 100);
    if (!jobId) continue;
    const job = await env.DB.prepare("SELECT * FROM ai_extraction_jobs WHERE id=?").bind(jobId).first();
    if (!job) continue;
    try {
      if (isErrorFile || entry.error || Number(entry.response?.status_code || 0) >= 400) {
        const message = entry.error?.message || entry.response?.body?.error?.message || "OpenAI batch request failed";
        await markJobFailed(env, jobId, message);
        continue;
      }
      const output = JSON.parse(extractResponseText(entry.response?.body));
      await persistAiResult(env, job, output);
    } catch (error) {
      await markJobFailed(env, jobId, error instanceof Error ? error.message : "Could not save the résumé result");
    }
  }
}

async function finishBatch(env, local, remote) {
  if (remote.output_file_id) {
    const output = await openAiFetch(env, `/files/${encodeURIComponent(remote.output_file_id)}/content`).then((response) => response.text());
    await ingestJsonl(env, output, false);
  }
  if (remote.error_file_id) {
    const errors = await openAiFetch(env, `/files/${encodeURIComponent(remote.error_file_id)}/content`).then((response) => response.text());
    await ingestJsonl(env, errors, true);
  }
  const jobs = (await env.DB.prepare("SELECT id, resume_file_id, status FROM ai_extraction_jobs WHERE batch_id=?").bind(local.id).all()).results || [];
  for (const job of jobs) {
    if (job.status === "batched") await markJobFailed(env, job.id, "No result was returned for this résumé");
    await deleteOpenAiFile(env, job.resume_file_id);
  }
  await Promise.all([
    deleteOpenAiFile(env, local.input_file_id),
    deleteOpenAiFile(env, remote.output_file_id),
    deleteOpenAiFile(env, remote.error_file_id),
  ]);
}

async function pollBatches(env) {
  const active = (await env.DB.prepare(`SELECT * FROM ai_batches WHERE status IN
    ('validating','in_progress','finalizing','cancelling') ORDER BY created_at LIMIT 3`).all()).results || [];
  for (const local of active) {
    const remote = await openAiFetch(env, `/batches/${encodeURIComponent(local.openai_batch_id)}`).then((response) => response.json());
    await env.DB.prepare(`UPDATE ai_batches SET status=?, output_file_id=?, error_file_id=?, completed_count=?, failed_count=?,
      updated_at=CURRENT_TIMESTAMP, completed_at=CASE WHEN ? IN ('completed','failed','expired','cancelled') THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id=?`).bind(remote.status, remote.output_file_id || "", remote.error_file_id || "", Number(remote.request_counts?.completed || 0),
      Number(remote.request_counts?.failed || 0), remote.status, local.id).run();
    if (remote.status === "completed") await finishBatch(env, local, remote);
    if (["failed", "expired", "cancelled"].includes(remote.status)) {
      const message = `OpenAI batch ${remote.status}`;
      await env.DB.prepare(`UPDATE ai_extraction_jobs SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE batch_id=? AND status='batched'`).bind(message, local.id).run();
      const jobs = (await env.DB.prepare("SELECT resume_file_id FROM ai_extraction_jobs WHERE batch_id=?").bind(local.id).all()).results || [];
      for (const job of jobs) await deleteOpenAiFile(env, job.resume_file_id);
      await deleteOpenAiFile(env, local.input_file_id);
    }
  }
}

export function classifyAiFailure(status, message) {
  const text = compactString(message, 800).toLowerCase();
  if (/permission to call driveapp|authorization[_ -]is[_ -]required|drive\.readonly/.test(text)) {
    return { category: "Connector authorization", autoRetry: false, guidance: "Run authorizeTalentDeskAccess as the Apps Script deployment owner, approve Drive read access, deploy a new version, then retry all." };
  }
  if (status === "no_resume" || /not found|permission|access denied|not accessible|unsupported|larger than|invalid.*(?:drive|resume|link)/.test(text)) {
    return { category: "Resume access", autoRetry: false, guidance: "Check that the resume link is valid and shared with the Apps Script owner, then retry." };
  }
  if (/model|project.*access|api key|authentication|unauthorized|forbidden|quota|billing/.test(text)) {
    return { category: "OpenAI setup", autoRetry: false, guidance: "Review the OpenAI model, project access, API key, quota, or billing setup before retrying." };
  }
  if (/schema|json|structured output|incomplete|refused/.test(text)) {
    return { category: "AI response", autoRetry: false, guidance: "The AI response could not be saved. Retry this profile; repeated failures need review." };
  }
  if (/timeout|timed out|429|rate limit|network|temporar|5\d\d|batch (?:failed|expired|cancelled)|no result was returned/.test(text)) {
    return { category: "Temporary service issue", autoRetry: true, guidance: "This will retry automatically up to three attempts." };
  }
  return { category: "Needs review", autoRetry: false, guidance: "Review the message and retry after correcting the underlying issue." };
}

async function retryStatements(env, jobs) {
  if (!jobs.length) return 0;
  await env.DB.batch(jobs.map((job) => env.DB.prepare(`UPDATE ai_extraction_jobs SET status='queued', batch_id='',
    resume_file_id='', resume_filename='', resume_mime_type='', error_message='', completed_at=NULL,
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('failed','no_resume')`).bind(job.id)));
  return jobs.length;
}

export async function retryAiFailures(env, jobId = "", retryableOnly = false) {
  const rows = (await env.DB.prepare(`SELECT id, status, error_message, attempt_count FROM ai_extraction_jobs
    WHERE status IN ('failed','no_resume') ${jobId ? "AND id=?" : ""} ORDER BY updated_at LIMIT 100`)
    .bind(...(jobId ? [jobId] : [])).all()).results || [];
  const selected = rows.filter((job) => !retryableOnly || classifyAiFailure(job.status, job.error_message).autoRetry);
  return retryStatements(env, selected);
}

async function autoRetryAiFailures(env) {
  const rows = (await env.DB.prepare(`SELECT id, status, error_message, attempt_count FROM ai_extraction_jobs
    WHERE status='failed' AND attempt_count<3 AND updated_at <= datetime('now','-10 minutes')
    ORDER BY updated_at LIMIT 20`).all()).results || [];
  return retryStatements(env, rows.filter((job) => classifyAiFailure(job.status, job.error_message).autoRetry));
}

export async function aiAutomationEnabled(env) {
  const setting = await env.DB.prepare("SELECT value FROM workspace_settings WHERE key='auto_classify_new_profiles'").first();
  return String(setting?.value || "0") === "1";
}

export async function setAiAutomation(env, enabled, user) {
  await env.DB.prepare(`INSERT INTO workspace_settings(key, value, updated_by, updated_at)
    VALUES ('auto_classify_new_profiles', ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
    .bind(enabled ? "1" : "0", compactString(user?.email, 320)).run();
  return Boolean(enabled);
}

export async function processAiEnrichment(env) {
  if (!env.OPENAI_API_KEY || !env.APPS_SCRIPT_CONNECTOR_URL || !env.CONNECTOR_SECRET) return { configured: false };
  await pollBatches(env);
  const retried = await autoRetryAiFailures(env);
  let automaticallyQueued = 0;
  if (await aiAutomationEnabled(env)) {
    const active = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_extraction_jobs
      WHERE status IN ('queued','preparing','prepared','batched')`).first();
    if (!Number(active?.count || 0)) automaticallyQueued = (await enqueueAiBatch(env, MAX_BATCH_SIZE)).queued;
  }
  const prepared = await prepareQueuedJobs(env);
  const batchId = await submitPreparedBatch(env);
  return { configured: true, prepared, batchId, retried, automaticallyQueued };
}

export async function getAiMeta(env, includeFailures = false) {
  const [counts, recentBatch, automatic, failureRows] = await Promise.all([
    env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('queued','preparing','prepared') THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='batched' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('failed','no_resume') THEN 1 ELSE 0 END) AS failed
      FROM ai_extraction_jobs`).first(),
    env.DB.prepare("SELECT * FROM ai_batches ORDER BY created_at DESC LIMIT 1").first(),
    aiAutomationEnabled(env),
    includeFailures
      ? env.DB.prepare(`SELECT j.id, j.candidate_id, j.status, j.error_message, j.attempt_count, j.updated_at,
          c.name AS candidate_name, c.source_sheet, c.resume_url FROM ai_extraction_jobs j
          JOIN candidates c ON c.id=j.candidate_id WHERE j.status IN ('failed','no_resume')
          ORDER BY j.updated_at DESC LIMIT 50`).all()
      : Promise.resolve({ results: [] }),
  ]);
  const failures = (failureRows.results || []).map((failure) => ({ ...failure, ...classifyAiFailure(failure.status, failure.error_message) }));
  return {
    configured: Boolean(env.OPENAI_API_KEY && env.APPS_SCRIPT_CONNECTOR_URL && env.CONNECTOR_SECRET),
    model: model(env),
    batchSize: Math.min(MAX_BATCH_SIZE, Math.max(1, Number(env.AI_BATCH_SIZE) || MAX_BATCH_SIZE)),
    counts: counts || { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
    latestBatch: recentBatch || null,
    automatic,
    failures,
  };
}

function factMatches(fact, expected) {
  const value = compactString(fact?.normalized_value || fact?.value, 300).toLowerCase();
  const term = compactString(expected, 100).toLowerCase();
  if (term === "jee") return /\bjee\b|iit jee/.test(value);
  if (term === "neet") return /\bneet\b/.test(value);
  if (term === "olympiad") return /olympiad/.test(value);
  return value.includes(term);
}

export function verificationForIntent(canonicalJson, intent, includeClaims = false) {
  let profile;
  try { profile = typeof canonicalJson === "string" ? JSON.parse(canonicalJson || "{}") : canonicalJson || {}; } catch { return { verified: false, rejected: false }; }
  if (!Array.isArray(profile.facts)) return { verified: false, rejected: false };
  const required = [
    ...(intent?.subjects || []).map((value) => ({ category: "subject", value })),
    ...(intent?.exams || []).map((value) => ({ category: "exam", value })),
  ];
  if (!required.length) return { verified: true, rejected: false };
  const satisfied = required.every((requirement) => profile.facts.some((fact) =>
    fact.category === requirement.category && factMatches(fact, requirement.value)
      && (fact.resume_status === "supported" || (includeClaims && fact.resume_status === "claim_only")),
  ));
  return { verified: satisfied, rejected: !satisfied };
}

export function profileClassification(canonicalJson, sourceTrack = "") {
  let profile;
  try { profile = typeof canonicalJson === "string" ? JSON.parse(canonicalJson || "{}") : canonicalJson || {}; } catch { profile = {}; }
  const value = profile?.profile_classification || {};
  const recommended = ["Teacher", "Non-teaching", "Unclear"].includes(value.recommended_track) ? value.recommended_track : "";
  const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
  const effectiveTrack = ["Teacher", "Non-teaching"].includes(recommended) ? recommended : sourceTrack;
  return {
    recommendedTrack: recommended,
    effectiveTrack,
    confidence,
    rationale: compactString(value.rationale, 1000),
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(0, 6) : [],
    disagreesWithSource: Boolean(recommended && recommended !== "Unclear" && sourceTrack && recommended !== sourceTrack),
  };
}
