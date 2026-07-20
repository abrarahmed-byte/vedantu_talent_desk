const $ = (id) => document.getElementById(id);
const state = {
  page: "discover",
  track: "Teacher",
  candidates: [],
  meta: null,
  selected: null,
  toastTimer: null,
  session: null,
  sourcePreview: null,
  syncPoller: null,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function formatDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unavailable";
  return new Intl.DateTimeFormat("en-IN", includeTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function initials(value) {
  return String(value || "System").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function loadSession() {
  state.session = await api("/api/session");
  const user = state.session.user || {};
  $("signedUserInitials").textContent = initials(user.displayName);
  $("signedUserName").textContent = user.displayName || "Talent Desk user";
  $("signedUserRole").textContent = `${user.role || "Recruiter"} · ${user.protected ? "Vedantu workspace" : "fictional pilot"}`;
  $("topbarRole").textContent = user.protected ? user.role : `${user.role || "Admin"} pilot`;
  if (user.protected) {
    $("pilotRibbonTitle").textContent = "VEDANTU PRIVATE PILOT";
    $("pilotRibbonText").textContent = "Access-controlled workspace · recruitment data stays inside approved accounts";
    $("healthProfileLabel").textContent = "repository profiles";
    $("heroRecordLabel").textContent = "central repository records";
    $("activitySafeNote").innerHTML = "<i></i>Server-attributed workspace audit trail.";
  }
  const enabled = Boolean(state.session.canManageSources);
  $("connectSource").disabled = !enabled;
  $("addRecruiter").disabled = !enabled;
  const banner = $("readinessBanner");
  if (!user.protected) {
    banner.className = "readiness-banner warning";
    banner.innerHTML = "<span>!</span><div><b>Private source connections are safely locked</b><p>Cloudflare Access must be enabled before an Admin can connect a real Google Sheet or add users.</p></div>";
  } else if (!state.session.connectorConfigured) {
    banner.className = "readiness-banner warning";
    banner.innerHTML = "<span>2</span><div><b>Sign-in protection is ready; Google connector setup remains</b><p>Add the Apps Script connector URL and secret in Cloudflare to unlock Sheet previews and sync.</p></div>";
  } else {
    banner.className = "readiness-banner ready";
    banner.innerHTML = "<span>✓</span><div><b>Secure source connection is ready</b><p>Only Admins can connect Sheets. Imports run as background jobs with progress and ETA.</p></div>";
  }
}

function toast(message) {
  const element = $("toast");
  element.querySelector("p").textContent = message;
  element.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.add("hidden"), 3200);
}

function showPage(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((element) => element.classList.toggle("active", element.id === `page-${page}`));
  document.querySelectorAll("[data-page-link]").forEach((button) => button.classList.toggle("active", button.dataset.pageLink === page));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page !== "discover") loadMeta();
}

function employmentClass(value) {
  if (value === "Active employee") return "active";
  if (value === "Former employee") return "former";
  return "";
}

function renderCandidates() {
  const list = $("candidateList");
  if (!state.candidates.length) {
    list.innerHTML = `<div class="empty-state"><h3>No fictional profiles match every filter</h3><p>Try clearing a filter or using fewer requirements.</p><button class="outline-button" id="emptyClear">Clear filters</button></div>`;
    $("emptyClear").onclick = clearFilters;
    return;
  }
  list.innerHTML = state.candidates.map((candidate) => {
    const trackClass = candidate.track.toLowerCase().replace(/\s+/g, "-");
    const experience = `${candidate.experience_months || 0} months experience`;
    const hires = Number(candidate.employment_times_hired) ? ` · hired ${candidate.employment_times_hired} time(s)` : "";
    return `<article class="candidate-card">
      <div class="identity">
        <span class="avatar large ${candidate.track === "Teacher" ? "orange" : "purple"}">${escapeHtml(candidate.initials)}</span>
        <button data-open-profile="${escapeHtml(candidate.id)}">
          <b>${escapeHtml(candidate.name)}</b>
          <span>${escapeHtml([candidate.city, candidate.state].filter(Boolean).join(", "))} · ${escapeHtml(candidate.phone)}</span>
          <small>Applied ${escapeHtml(formatDate(candidate.applied_at))} · ${escapeHtml(candidate.source_sheet)}</small>
        </button>
      </div>
      <div class="profile-fit">
        <span class="track-pill ${trackClass}">${escapeHtml(candidate.track)}</span>
        <b>${escapeHtml(candidate.subject_display || candidate.role)}</b>
        <span>${candidate.track === "Teacher" ? "Grades / levels: " : "Focus: "}${escapeHtml(candidate.grades_display || candidate.role)}</span>
        <em class="employment-pill ${employmentClass(candidate.employment_status)}">${escapeHtml(candidate.employment_status)}${escapeHtml(hires)}</em>
      </div>
      <div class="engagement">
        <p><b>${candidate.interviewer_count || 0}</b> interviewers · <b>${candidate.call_count || 0}</b> calls<br><b>${candidate.view_count || 0}</b> views · ${escapeHtml(experience)}</p>
        <div class="card-actions"><button class="text-button" data-resume="${escapeHtml(candidate.id)}">Resume preview</button><button class="text-button" data-history="${escapeHtml(candidate.id)}">View Log History</button><button class="text-button" data-call="${escapeHtml(candidate.id)}">I called</button></div>
      </div>
      <button class="score-button" data-open-profile="${escapeHtml(candidate.id)}"><b>${candidate.match_percent}%</b><small>match</small></button>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-open-profile]").forEach((button) => button.onclick = () => openCandidate(button.dataset.openProfile));
  document.querySelectorAll("[data-history]").forEach((button) => button.onclick = () => openCandidate(button.dataset.history, "history"));
  document.querySelectorAll("[data-resume]").forEach((button) => button.onclick = () => openCandidate(button.dataset.resume, "resume"));
  document.querySelectorAll("[data-call]").forEach((button) => button.onclick = () => openCallModal(button.dataset.call));
}

async function runSearch(logSearch = true) {
  const params = new URLSearchParams({
    q: $("searchInput").value.trim(),
    track: state.track,
    subject: $("subjectFilter").value,
    language: $("languageFilter").value,
    experience: $("experienceFilter").value,
    workMode: $("workModeFilter").value,
  });
  $("searchButton").disabled = true;
  $("searchButton").textContent = "Searching…";
  try {
    const result = await api(`/api/candidates?${params}`);
    state.candidates = result.candidates || [];
    renderCandidates();
    $("resultSummary").textContent = `${result.total} matches · ${result.mode}`;
    $("latency").textContent = `Results in ${result.responseTimeMs} ms`;
    $("understood").classList.add("show");
    $("understood").querySelector("p").textContent = `Understood as: ${result.understoodAs}`;
    if (logSearch && $("searchInput").value.trim()) api("/api/searches", { method: "POST", body: JSON.stringify({ query: $("searchInput").value.trim() }) }).catch(() => {});
  } catch (error) {
    $("candidateList").innerHTML = `<div class="empty-state"><h3>The pilot database could not be reached</h3><p>${escapeHtml(error.message)}</p></div>`;
    $("resultSummary").textContent = "Database check required";
  } finally {
    $("searchButton").disabled = false;
    $("searchButton").textContent = "Find matches →";
  }
}

function clearFilters() {
  state.track = "All";
  document.querySelectorAll("[data-track]").forEach((button) => button.classList.toggle("active", button.dataset.track === "All"));
  $("searchInput").value = "";
  $("subjectFilter").value = "All subjects";
  $("languageFilter").value = "All languages";
  $("experienceFilter").value = "0";
  $("workModeFilter").value = "Any work mode";
  runSearch(false);
}

function fact(label, value) {
  return `<div class="fact"><span>${escapeHtml(label)}</span><b>${escapeHtml(value || "Not provided")}</b></div>`;
}

function additionalFacts(candidate) {
  const details = candidate.details || {};
  const fields = [
    ["Pincode", details.pincode], ["Relocation", details.relocation], ["Experience type", details.experienceType],
    ["Teaching formats", details.formats], ["Availability", details.availability], ["Earliest joining", details.earliestJoiningDate],
    ["Engagement", details.engagementType], ["Pay model", details.payModel], ["Current CTC", details.currentCtcLakhs],
    ["How they heard", details.discoverySource], ["Referrer", details.referrer], ["Consent", details.consent],
  ].filter(([, value]) => String(value || "").trim());
  return fields.length ? `<section class="drawer-section"><h3>Application preferences</h3><div class="fact-grid">${fields.map(([label, value]) => fact(label, value)).join("")}</div></section>` : "";
}

function historyEntry(entry) {
  const detail = entry.detail || entry.outcome || entry.note || "Activity recorded";
  const actor = entry.actor || entry.recruiter || "System";
  return `<div class="history-entry"><span class="avatar purple">${escapeHtml(initials(actor))}</span><div><p><b>${escapeHtml(actor)}</b> · ${escapeHtml((entry.action || "called").replaceAll("_", " "))}</p><small>${escapeHtml(detail)}</small></div><time>${escapeHtml(formatDate(entry.created_at, true))}</time></div>`;
}

async function openCandidate(candidateId, focus = "profile") {
  $("profileBackdrop").classList.remove("hidden");
  $("drawerName").textContent = "Loading profile…";
  $("drawerContent").innerHTML = `<div class="loading-card" style="margin:24px"></div>`;
  try {
    if (focus !== "history") await api(`/api/candidates/${encodeURIComponent(candidateId)}/view`, { method: "POST", body: "{}" });
    const result = await api(`/api/candidates/${encodeURIComponent(candidateId)}/history`);
    const candidate = result.candidate;
    candidate.match_percent = state.candidates.find((item) => item.id === candidateId)?.match_percent || 85;
    state.selected = candidate;
    $("drawerName").textContent = candidate.name;
    const activity = [...(result.activity || []), ...(result.calls || []).map((call) => ({ ...call, action: "called", actor: call.recruiter, detail: `${call.outcome} · ${call.role}${call.note ? ` · ${call.note}` : ""}` }))]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    $("drawerContent").innerHTML = `
      <div class="drawer-hero"><span class="avatar xlarge ${candidate.track === "Teacher" ? "orange" : "purple"}">${escapeHtml(candidate.initials)}</span><div><h2>${escapeHtml(candidate.name)}</h2><p>${escapeHtml(candidate.role)}</p><small>${escapeHtml(candidate.city)}, ${escapeHtml(candidate.state)} · ${escapeHtml(candidate.work_mode)}</small></div><div class="drawer-score"><b>${candidate.match_percent}%</b><span>pilot match</span></div></div>
      <div class="drawer-actions"><button class="primary-button" id="drawerResume">Resume preview</button><button class="outline-button" id="drawerCall">I called this profile</button><button class="outline-button" id="drawerHistory">View Log History</button></div>
      <section class="drawer-section"><h3>Candidate information</h3><div class="fact-grid">${fact("Applied", formatDate(candidate.applied_at, true))}${fact("Location", `${candidate.city}, ${candidate.state}`)}${fact("Phone", candidate.phone)}${fact("Email", candidate.email)}${fact("Source Sheet", candidate.source_sheet)}${fact("Work mode", candidate.work_mode)}</div></section>
      <section class="drawer-section"><h3>${candidate.track === "Teacher" ? "Teaching profile" : "Professional profile"}</h3><div class="fact-grid">${fact("Subject / function", candidate.subject_display)}${fact("Grades / levels", candidate.grades_display)}${fact("Boards", candidate.boards_display || "Not applicable")}${fact("Languages", candidate.languages_display)}${fact("Experience", `${candidate.experience_months} months`)}${fact("Education", `${candidate.education} · ${candidate.college}`)}</div></section>
      ${additionalFacts(candidate)}
      <section class="drawer-section"><h3>Employment and duplicate checks</h3><div class="fact-grid">${fact("Employment status", candidate.employment_status)}${fact("Times hired", candidate.employment_times_hired)}${fact("Duplicate source rows merged", candidate.duplicate_count)}${fact("Canonical identity", "Email / phone exact match")}</div></section>
      <section class="drawer-section hidden" id="resumeSection"><h3>Resume</h3><div class="resume-preview">${escapeHtml(candidate.resume_summary || "Resume link captured from the source Sheet.")}</div>${safeExternalUrl(candidate.resume_url) ? `<a class="resume-link" href="${escapeHtml(safeExternalUrl(candidate.resume_url))}" target="_blank" rel="noopener">Open resume in Google Drive ↗</a>` : ""}</section>
      <section class="drawer-section" id="historySection"><h3>View and call history</h3>${activity.length ? activity.map(historyEntry).join("") : "<p>No activity yet.</p>"}</section>`;
    $("drawerResume").onclick = () => showResumePreview(candidateId);
    $("drawerCall").onclick = () => openCallModal(candidateId);
    $("drawerHistory").onclick = () => $("historySection").scrollIntoView({ behavior: "smooth" });
    if (focus === "resume") showResumePreview(candidateId);
    if (focus === "history") $("historySection").scrollIntoView({ behavior: "smooth" });
    runSearch(false);
    loadMeta();
  } catch (error) {
    $("drawerContent").innerHTML = `<div class="empty-state"><h3>Profile unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function showResumePreview(candidateId) {
  const section = $("resumeSection");
  section.classList.remove("hidden");
  section.scrollIntoView({ behavior: "smooth" });
  try {
    await api(`/api/candidates/${encodeURIComponent(candidateId)}/resume-open`, { method: "POST", body: "{}" });
    toast("Resume open recorded in profile history");
    loadMeta();
  } catch (error) { toast(error.message); }
}

function closeDrawer() {
  $("profileBackdrop").classList.add("hidden");
  state.selected = null;
}

function openCallModal(candidateId) {
  const candidate = state.candidates.find((item) => item.id === candidateId) || state.selected;
  if (!candidate) return;
  state.selected = candidate;
  $("callCandidateName").textContent = `${candidate.name}${state.session?.user?.protected ? "" : " · fictional pilot profile"}`;
  $("callRole").value = candidate.role || "";
  $("callOutcome").value = "";
  $("callNote").value = "";
  $("callBackdrop").classList.remove("hidden");
}

function closeCallModal() { $("callBackdrop").classList.add("hidden"); }

async function saveCall(event) {
  event.preventDefault();
  if (!state.selected) return;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await api(`/api/candidates/${encodeURIComponent(state.selected.id)}/calls`, { method: "POST", body: JSON.stringify({ role: $("callRole").value, outcome: $("callOutcome").value, note: $("callNote").value }) });
    closeCallModal();
    toast("Call update saved to the central activity thread");
    await Promise.all([runSearch(false), loadMeta()]);
    if (!$("profileBackdrop").classList.contains("hidden")) openCandidate(state.selected.id, "history");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Save call update"; }
}

function renderMeta() {
  if (!state.meta) return;
  const repository = state.meta.repository || {};
  const profiles = Number(repository.profiles) || 0;
  const duplicates = Number(repository.duplicates) || 0;
  const views = Number(repository.views) || 0;
  const calls = Number(repository.calls) || 0;
  ["navCandidateCount", "healthProfiles", "heroProfiles", "metricProfiles", "activityProfiles"].forEach((id) => $(id).textContent = profiles);
  ["healthDuplicates", "metricDuplicates"].forEach((id) => $(id).textContent = duplicates);
  ["metricViews", "activityViews"].forEach((id) => $(id).textContent = views);
  ["metricCalls", "activityCalls"].forEach((id) => $(id).textContent = calls);
  $("navSourceCount").textContent = (state.meta.sources || []).length;
  $("navActivityCount").textContent = (state.meta.activity || []).length;
  const canManage = Boolean(state.session?.canManageSources);
  $("sourceGrid").innerHTML = (state.meta.sources || []).map((source) => {
    const connectedSheet = Boolean(source.spreadsheet_id);
    const action = source.connected ? "disconnect" : "reconnect";
    return `<article class="source-card"><header><h3>${escapeHtml(source.label)}</h3><span class="status-${escapeHtml(String(source.status).toLowerCase())}">● ${escapeHtml(source.status)}</span></header><p>${escapeHtml(source.kind)}${connectedSheet ? ` · ${escapeHtml(source.tab_name || "first tab")}` : " · fictional pilot connector"}</p><div class="source-stats"><div><b>${source.total_rows}</b><small>source rows</small></div><div><b>${source.synced_rows}</b><small>synced</small></div><div><b>${source.failed_rows}</b><small>failed</small></div><div><b>${source.duplicate_rows}</b><small>duplicates</small></div></div><footer><span>${source.connected ? "Connected" : "Disconnected"}</span><span>Last sync ${escapeHtml(formatDate(source.last_sync, true))}</span></footer>${connectedSheet && canManage ? `<div class="source-actions"><button class="text-button" data-source-action="sync" data-source-id="${escapeHtml(source.id)}">Sync now</button><button class="text-button" data-source-action="${action}" data-source-id="${escapeHtml(source.id)}">${action === "disconnect" ? "Disconnect" : "Reconnect"}</button></div>` : ""}${source.last_error ? `<p class="source-error">${escapeHtml(source.last_error)}</p>` : ""}</article>`;
  }).join("") || "<div class='empty-state'><h3>No sources connected</h3><p>An Admin can connect the first response Sheet when setup is ready.</p></div>";
  $("jobList").innerHTML = (state.meta.jobs || []).map((job) => {
    const percent = job.total_rows ? Math.min(100, Math.round(job.processed_rows / job.total_rows * 100)) : (job.status === "Complete" ? 100 : 0);
    const eta = job.status === "Running" && Number(job.eta_seconds) ? ` · about ${job.eta_seconds}s left` : "";
    const details = `${Number(job.imported_rows) || 0} new · ${Number(job.updated_rows) || 0} updated · ${Number(job.merged_rows) || 0} merged · ${Number(job.detail_failed_rows) || 0} failed`;
    return `<div class="job-row"><div><b>${escapeHtml(job.source_label)}</b><small>${escapeHtml(job.stage)} · ${escapeHtml(job.message)}</small><small class="job-detail">${escapeHtml(details)}</small></div><div><div class="progress"><i style="width:${percent}%"></i></div><small>${job.processed_rows || 0} of ${job.total_rows || "?"} rows${escapeHtml(eta)}</small></div><span class="job-status status-${escapeHtml(String(job.status).toLowerCase())}">${escapeHtml(job.status)} · ${percent}%</span></div>`;
  }).join("") || "<div class='job-row'>No background jobs yet.</div>";
  $("accessList").innerHTML = (state.meta.users || []).map((user) => `<div class="access-row"><div><b>${escapeHtml(user.display_name)}</b><small>${escapeHtml(user.email)}</small></div><span class="role-pill">${escapeHtml(user.role)}</span><span>${user.active ? "Active" : "Disabled"}</span></div>`).join("");
  document.querySelectorAll("[data-source-action]").forEach((button) => button.onclick = () => manageSource(button.dataset.sourceId, button.dataset.sourceAction));
  scheduleSyncPolling((state.meta.jobs || []).some((job) => ["Queued", "Running"].includes(job.status)));
  renderActivity();
}

function renderActivity() {
  const actionCopy = { viewed: "viewed profile", resume_opened: "opened resume preview", called: "logged a call", searched: "searched", synced: "synchronized source" };
  $("activityList").innerHTML = (state.meta?.activity || []).map((entry) => `<div class="activity-row"><span class="avatar orange">${escapeHtml(initials(entry.actor))}</span><span class="event-icon ${escapeHtml(entry.action)}">${entry.action === "synced" ? "↻" : entry.action === "called" ? "☎" : entry.action === "searched" ? "⌕" : "◉"}</span><div><p><b>${escapeHtml(entry.actor)}</b> ${escapeHtml(actionCopy[entry.action] || entry.action)}${entry.candidate_name ? ` <b>${escapeHtml(entry.candidate_name)}</b>` : ""}</p><small>${escapeHtml(entry.detail)}</small></div><time>${escapeHtml(formatDate(entry.created_at, true))}</time></div>`).join("") || "<div class='empty-state'><h3>No activity yet</h3></div>";
}

async function loadMeta() {
  try {
    state.meta = await api("/api/meta");
    renderMeta();
  } catch (error) {
    if (state.page !== "discover") toast(`Pilot health unavailable: ${error.message}`);
  }
}

function scheduleSyncPolling(active) {
  clearTimeout(state.syncPoller);
  state.syncPoller = null;
  if (!active) return;
  state.syncPoller = setTimeout(() => loadMeta(), 2500);
}

function normalizeHeading(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function suggestedHeader(field, headers) {
  const choices = [field.label, ...(field.aliases || [])].map(normalizeHeading).filter(Boolean);
  const normalized = headers.map((header) => ({ header, value: normalizeHeading(header) }));
  return normalized.find((item) => choices.includes(item.value))?.header
    || normalized.find((item) => choices.some((choice) => item.value.includes(choice) || choice.includes(item.value)))?.header
    || "";
}

function renderMapping() {
  const fields = state.session?.canonicalFields || [];
  const headers = state.sourcePreview?.headers || [];
  $("mappingGrid").innerHTML = fields.map((field) => {
    const suggestion = suggestedHeader(field, headers);
    const options = [`<option value="">Do not import</option>`, ...headers.map((header) => `<option value="${escapeHtml(header)}" ${header === suggestion ? "selected" : ""}>${escapeHtml(header)}</option>`)].join("");
    return `<label><span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span><select data-map-field="${escapeHtml(field.key)}">${options}</select></label>`;
  }).join("");
  document.querySelectorAll("[data-map-field]").forEach((select) => select.addEventListener("change", validateMapping));
  validateMapping();
}

function currentMapping() {
  return Object.fromEntries([...document.querySelectorAll("[data-map-field]")]
    .map((select) => [select.dataset.mapField, select.value]).filter(([, value]) => value));
}

function validateMapping() {
  const mapping = currentMapping();
  const valid = Boolean(mapping.fullName && mapping.appliedAt && (mapping.email || mapping.phone));
  $("saveSource").disabled = !valid;
  $("mappingCoverage").textContent = `${Object.keys(mapping).length} mapped`;
  $("mappingSummary").textContent = valid
    ? "Required identity fields are ready. Review the optional matches, then start the background sync."
    : "Map Full name, Timestamp, and either Email or Phone to continue.";
}

function openSourceModal() {
  if (!state.session?.canManageSources) {
    toast("Source connection unlocks after Cloudflare Access protection is enabled");
    return;
  }
  if (!state.session.connectorConfigured) {
    toast("Finish the Apps Script connector setup in Cloudflare first");
    return;
  }
  state.sourcePreview = null;
  $("sourceForm").reset();
  $("mappingPanel").classList.add("hidden");
  $("saveSource").disabled = true;
  $("sourceBackdrop").classList.remove("hidden");
}

function closeSourceModal() { $("sourceBackdrop").classList.add("hidden"); }

async function readSourceColumns() {
  const button = $("readColumns");
  button.disabled = true;
  button.textContent = "Reading private Sheet…";
  try {
    state.sourcePreview = await api("/api/admin/sources/preview", {
      method: "POST",
      body: JSON.stringify({ sheetUrl: $("sourceUrl").value, tabName: $("sourceTab").value }),
    });
    $("sourceTab").value = state.sourcePreview.tabName || $("sourceTab").value;
    $("mappingPanel").classList.remove("hidden");
    $("mappingStep").classList.add("active");
    renderMapping();
    toast(`${state.sourcePreview.headers.length} columns found · ${state.sourcePreview.totalRows} response rows`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Read columns"; }
}

async function saveSource(event) {
  event.preventDefault();
  const button = $("saveSource");
  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    await api("/api/admin/sources", {
      method: "POST",
      body: JSON.stringify({ label: $("sourceLabel").value, sheetUrl: $("sourceUrl").value, tabName: $("sourceTab").value, mapping: currentMapping() }),
    });
    closeSourceModal();
    toast("Source connected · background sync started");
    await loadMeta();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Connect and start sync"; }
}

async function manageSource(sourceId, action) {
  try {
    await api(`/api/admin/sources/${encodeURIComponent(sourceId)}/${action}`, { method: "POST", body: "{}" });
    toast(action === "disconnect" ? "Source disconnected; copied profiles were kept" : `${action === "reconnect" ? "Reconnect" : "Sync"} started in the background`);
    await loadMeta();
  } catch (error) { toast(error.message); }
}

function openUserModal() {
  if (!state.session?.canManageSources) {
    toast("User management unlocks after workspace protection is enabled");
    return;
  }
  $("userForm").reset();
  $("userBackdrop").classList.remove("hidden");
}

function closeUserModal() { $("userBackdrop").classList.add("hidden"); }

async function saveAccessUser(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    await api("/api/admin/users", { method: "POST", body: JSON.stringify({ displayName: $("accessName").value, email: $("accessEmail").value, role: $("accessRole").value }) });
    closeUserModal();
    toast("Workspace access added");
    await loadMeta();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Give access"; }
}

document.querySelectorAll("[data-page-link]").forEach((button) => button.onclick = () => showPage(button.dataset.pageLink));
document.querySelectorAll("[data-track]").forEach((button) => button.onclick = () => {
  state.track = button.dataset.track;
  document.querySelectorAll("[data-track]").forEach((item) => item.classList.toggle("active", item === button));
  runSearch(false);
});
$("searchButton").onclick = () => runSearch(true);
$("searchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") runSearch(true); });
["subjectFilter", "languageFilter", "experienceFilter", "workModeFilter"].forEach((id) => $(id).addEventListener("change", () => runSearch(false)));
$("clearFilters").onclick = clearFilters;
$("refreshMeta").onclick = () => loadMeta().then(() => toast("Pilot health refreshed"));
$("refreshActivity").onclick = () => loadMeta().then(() => toast("Activity log refreshed"));
$("connectSource").onclick = openSourceModal;
$("addRecruiter").onclick = openUserModal;
$("readColumns").onclick = readSourceColumns;
$("sourceForm").addEventListener("submit", saveSource);
$("userForm").addEventListener("submit", saveAccessUser);
document.querySelectorAll("[data-close-drawer]").forEach((button) => button.onclick = closeDrawer);
document.querySelectorAll("[data-close-call]").forEach((button) => button.onclick = closeCallModal);
document.querySelectorAll("[data-close-source]").forEach((button) => button.onclick = closeSourceModal);
document.querySelectorAll("[data-close-user]").forEach((button) => button.onclick = closeUserModal);
$("profileBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeDrawer(); });
$("callBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeCallModal(); });
$("sourceBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeSourceModal(); });
$("userBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeUserModal(); });
$("callForm").addEventListener("submit", saveCall);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("callBackdrop").classList.contains("hidden")) closeCallModal();
  else if (!$("sourceBackdrop").classList.contains("hidden")) closeSourceModal();
  else if (!$("userBackdrop").classList.contains("hidden")) closeUserModal();
  else if (!$("profileBackdrop").classList.contains("hidden")) closeDrawer();
});

async function initialize() {
  try { await loadSession(); }
  catch (error) { toast(error.message); }
  await Promise.all([loadMeta(), runSearch(false)]);
}

initialize();
