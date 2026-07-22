const $ = (id) => document.getElementById(id);
const state = {
  page: "discover",
  track: "All",
  candidates: [],
  searchPage: 1,
  searchTotal: 0,
  searchPageSize: 40,
  searchTotalPages: 1,
  searchPlan: null,
  searchPlanQuery: "",
  searchPlanMode: "",
  searchCriteria: [],
  meta: null,
  selected: null,
  toastTimer: null,
  session: null,
  sourcePreview: null,
  sourceMode: "candidate",
  syncPoller: null,
  syncKickInFlight: false,
  superadmin: null,
  superadminPage: 1,
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
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showLogin(error) {
  const reason = new URLSearchParams(window.location.search).get("auth");
  const denied = reason === "not-approved" || Number(error?.status) === 403;
  const wrongAccount = reason === "wrong-account";
  const failed = reason === "failed";
  $("authLoader").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  document.body.classList.remove("auth-pending");
  document.body.classList.add("auth-login");
  if (denied) {
    $("loginTitle").textContent = "Your account is not approved yet";
    $("loginMessage").textContent = "Google verified your Vedantu account, but an Admin must add it under Workspace access before you can open candidate data.";
    $("googleSignIn").querySelector("b").textContent = "Try again with Google";
  } else if (wrongAccount) {
    $("loginTitle").textContent = "Use your Vedantu Google account";
    $("loginMessage").textContent = "Talent Desk accepts approved @vedantu.com accounts only. Switch to your work account and try again.";
  } else if (failed) {
    $("loginTitle").textContent = "Let’s try that sign-in again";
    $("loginMessage").textContent = "The sign-in link expired or could not be verified. No candidate data was opened.";
  } else if (Number(error?.status) === 503) {
    $("loginTitle").textContent = "Workspace sign-in is being connected";
    $("loginMessage").textContent = error.message;
  }
}

function replaceSelectOptions(id, leadingLabel, values) {
  const select = $(id);
  const current = select.value;
  const options = [`<option>${escapeHtml(leadingLabel)}</option>`, ...(values || []).map((value) => `<option>${escapeHtml(value)}</option>`)].join("");
  select.innerHTML = options;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function populateRepositoryFilters() {
  const filters = state.session?.filters || {};
  replaceSelectOptions("subjectFilter", "All subjects", filters.subjects);
  replaceSelectOptions("languageFilter", "All languages", filters.languages);
  replaceSelectOptions("workModeFilter", "Any work mode", filters.workModes);
  if (filters.experience?.length) {
    const current = $("experienceFilter").value;
    $("experienceFilter").innerHTML = filters.experience.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
    if ([...$("experienceFilter").options].some((option) => option.value === current)) $("experienceFilter").value = current;
  }
}

async function loadSession() {
  state.session = await api("/api/session");
  populateRepositoryFilters();
  const user = state.session.user || {};
  const firstName = String(user.displayName || "team").trim().split(/\s+/)[0] || "team";
  $("heroUserName").textContent = `${firstName}.`;
  $("signedUserInitials").textContent = initials(user.displayName);
  $("signedUserName").textContent = user.displayName || "Talent Desk user";
  $("signedUserRole").textContent = `${user.role || "Recruiter"} · ${user.protected ? "Vedantu workspace" : "local workspace"}`;
  $("topbarRole").textContent = user.protected ? user.role : `${user.role || "Admin"} local`;
  $("superadminNav").classList.toggle("hidden", !state.session.isSuperadmin);
  $("superadminRoleOption").classList.toggle("hidden", !state.session.isSuperadmin);
  if (user.protected) {
    $("workspaceRibbonTitle").textContent = "VEDANTU TALENT DESK";
    $("workspaceRibbonText").textContent = "Access-controlled workspace · recruitment data stays inside approved accounts";
    $("healthProfileLabel").textContent = "repository profiles";
    $("heroRecordLabel").textContent = "central repository records";
    $("activitySafeNote").innerHTML = "<i></i>Server-attributed workspace audit trail.";
  }
  const enabled = Boolean(state.session.canManageSources);
  $("connectSource").disabled = !enabled;
  $("connectEmploymentSource").disabled = !enabled;
  $("addRecruiter").disabled = !enabled;
  $("startAiBatch").disabled = !enabled || !state.session.aiConfigured;
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
  if (page === "superadmin" && !state.session?.isSuperadmin) return;
  state.page = page;
  document.querySelectorAll(".page").forEach((element) => element.classList.toggle("active", element.id === `page-${page}`));
  document.querySelectorAll("[data-page-link]").forEach((button) => button.classList.toggle("active", button.dataset.pageLink === page));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page !== "discover") loadMeta();
  if (page === "superadmin") loadSuperadmin();
}

function employmentClass(value) {
  if (value === "Active employee") return "active";
  if (value === "Former employee") return "former";
  return "";
}

function aiBadge(candidate) {
  if (candidate.ai_status !== "completed" || !candidate.ai_profile) return `<span class="ai-badge pending">AI type pending</span>`;
  const facts = candidate.ai_profile.facts || [];
  const supported = facts.filter((fact) => fact.resume_status === "supported").length;
  const claims = facts.filter((fact) => fact.resume_status === "claim_only").length;
  return `<span class="ai-badge verified">✦ ${supported} resume-backed</span>${claims ? `<span class="ai-badge claim">${claims} claim-only</span>` : ""}`;
}

function renderSearchPlan(plan = state.searchPlan, criteria = state.searchCriteria, mode = state.searchPlanMode, warning = "") {
  const panel = $("understood");
  if (!plan) {
    panel.classList.remove("show", "planning");
    panel.innerHTML = "";
    return;
  }
  const groups = [
    ["required", "Required", "must match"],
    ["preferred", "Preferred", "ranking boost only"],
    ["excluded", "Excluded", "must not match"],
  ].map(([importance, label, meaning]) => {
    const items = (criteria || []).filter((item) => item.importance === importance);
    const chips = items.map((item) => `<button class="criteria-chip ${importance}" data-plan-importance="${importance}" data-plan-field="${escapeHtml(item.field)}" data-plan-value="${escapeHtml(item.value)}" title="Remove this ${importance} criterion">${escapeHtml(item.label)} <span>&times;</span></button>`).join("");
    return `<div class="criteria-group ${importance}"><b>${label}<small>${meaning}</small></b><div>${chips || `<span class="criteria-none">None</span>`}</div></div>`;
  }).join("");
  const modeLabel = mode === "ai" ? "AI interpreted" : mode === "fallback" ? "Fast fallback" : "Search plan";
  const verificationLabel = plan.grounded ? "Checked against your words" : `${Math.round((Number(plan.confidence) || 0) * 100)}% confidence`;
  panel.classList.add("show");
  panel.classList.remove("planning");
  panel.innerHTML = `<div class="understood-heading"><span>&#10022;</span><div><b>${escapeHtml(modeLabel)}</b><p>${escapeHtml(plan.interpretation || "Search criteria prepared")}</p></div><em>${escapeHtml(verificationLabel)}</em></div>${groups}<small>${warning ? `${escapeHtml(warning)} ` : ""}Required filters the list. Preferred changes ranking only. Excluded removes profiles and is used only when your request explicitly says not, exclude, without or similar.</small>`;
  panel.querySelectorAll("[data-plan-field]").forEach((button) => button.onclick = () => removeSearchCriterion(button.dataset.planImportance, button.dataset.planField, button.dataset.planValue));
}

function showSearchProgress(message) {
  const panel = $("understood");
  panel.classList.add("show", "planning");
  panel.innerHTML = `<div class="understood-heading"><span class="ai-thinking">&#10022;</span><div><b>Understanding your request</b><p>${escapeHtml(message)}</p></div><em>AI planner</em></div><div class="plan-progress"><i></i></div>`;
}

function removeSearchCriterion(importance, field, value) {
  if (!state.searchPlan) return;
  if (field === "freshest_first") state.searchPlan.freshest_first = false;
  else {
    const bucket = state.searchPlan[importance];
    if (!bucket) return;
    if (Array.isArray(bucket[field])) bucket[field] = bucket[field].filter((item) => String(item) !== String(value));
    else if (field === "track") bucket[field] = "All";
    else if (field === "work_mode") bucket[field] = "";
    else if (field === "maximum_calls") bucket[field] = -1;
    else bucket[field] = 0;
  }
  runSearch(false, 1);
}

function profileTypeInfo(candidate) {
  const recommendation = candidate.recommended_track || "";
  const effective = candidate.effective_track || candidate.track || "Unclear";
  const confidence = Math.round((Number(candidate.classification_confidence) || 0) * 100);
  const reviewed = candidate.ai_status === "completed" && recommendation;
  const label = reviewed
    ? recommendation === "Unclear" ? `AI: unclear${confidence ? ` · ${confidence}%` : ""}` : `AI: ${recommendation}${confidence ? ` · ${confidence}%` : ""}`
    : "Awaiting AI classification";
  const css = reviewed ? recommendation.toLowerCase().replace(/\s+/g, "-") : "pending";
  return { recommendation, effective, confidence, reviewed, label, css };
}

function renderCandidates() {
  const list = $("candidateList");
  if (!state.candidates.length) {
    list.innerHTML = `<div class="empty-state"><h3>No profiles match every filter</h3><p>Try clearing a filter or using fewer requirements.</p><button class="outline-button" id="emptyClear">Clear filters</button></div>`;
    $("emptyClear").onclick = clearFilters;
    return;
  }
  list.innerHTML = state.candidates.map((candidate) => {
    const profileType = profileTypeInfo(candidate);
    const experience = `${candidate.experience_months || 0} months experience`;
    const hires = Number(candidate.employment_times_hired) ? ` · hired ${candidate.employment_times_hired} time(s)` : "";
    return `<article class="candidate-card">
      <div class="identity">
        <span class="avatar large ${profileType.effective === "Teacher" ? "orange" : "purple"}">${escapeHtml(candidate.initials)}</span>
        <button data-open-profile="${escapeHtml(candidate.id)}">
          <b>${escapeHtml(candidate.name)}</b>
          <span>${escapeHtml([candidate.city, candidate.state].filter(Boolean).join(", "))} · ${escapeHtml(candidate.phone)}</span>
          <small>Latest application ${escapeHtml(formatDate(candidate.applied_at))} · ${escapeHtml(candidate.source_sheet)}</small>
        </button>
      </div>
      <div class="profile-fit">
        <div class="profile-labels"><span class="track-pill ${escapeHtml(profileType.css)}">${escapeHtml(profileType.label)}</span>${aiBadge(candidate)}</div>
        <b>${escapeHtml(candidate.subject_display || candidate.role)}</b>
        <span>${profileType.effective === "Teacher" ? "Grades / levels: " : "Focus: "}${escapeHtml(candidate.grades_display || candidate.role)}</span>
        ${(candidate.match_reasons || []).length ? `<small class="match-reasons">AI preference match: ${escapeHtml(candidate.match_reasons.slice(0, 2).join(" / "))}</small>` : ""}
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

function renderSearchPager() {
  const pager = $("resultPager");
  const totalPages = state.searchTotalPages;
  if (totalPages <= 1) {
    pager.classList.add("hidden");
    pager.innerHTML = "";
    return;
  }
  const page = state.searchPage;
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  let previous = 0;
  const numbered = pageNumbers.map((value) => {
    const gap = previous && value > previous + 1 ? `<span class="pager-gap">…</span>` : "";
    previous = value;
    return `${gap}<button class="${value === page ? "active" : ""}" data-search-page="${value}" aria-label="Page ${value}" ${value === page ? 'aria-current="page"' : ""}>${value}</button>`;
  }).join("");
  pager.innerHTML = `<button data-search-page="${page - 1}" ${page === 1 ? "disabled" : ""}>← Previous</button><div>${numbered}</div><button data-search-page="${page + 1}" ${page === totalPages ? "disabled" : ""}>Next →</button>`;
  pager.classList.remove("hidden");
  pager.querySelectorAll("[data-search-page]").forEach((button) => button.onclick = () => {
    if (button.disabled) return;
    runSearch(false, Number(button.dataset.searchPage));
    document.querySelector(".results-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function runSearch(logSearch = true, page = 1) {
  const query = $("searchInput").value.trim();
  const needsPlan = Boolean(query) && (!state.searchPlan || state.searchPlanQuery !== query);
  if (needsPlan) {
    $("searchButton").disabled = true;
    $("searchButton").textContent = "Understanding…";
    showSearchProgress("Identifying required, preferred and excluded criteria…");
    try {
      const planned = await api("/api/search/plan", { method: "POST", body: JSON.stringify({ query }) });
      state.searchPlan = planned.plan;
      state.searchPlanQuery = query;
      state.searchPlanMode = planned.mode;
      state.searchCriteria = planned.criteria || [];
      renderSearchPlan(state.searchPlan, state.searchCriteria, state.searchPlanMode, planned.warning || "");
    } catch (error) {
      state.searchPlan = null;
      state.searchPlanQuery = "";
      state.searchPlanMode = "fallback";
      toast(`AI planner unavailable: ${error.message}`);
    }
  }
  const params = buildSearchParams(page);
  const freshnessDecayDays = params.get("freshnessDecayDays");
  const freshnessWeight = params.get("freshnessWeight");
  $("searchButton").disabled = true;
  $("searchButton").textContent = "Searching profiles…";
  try {
    const result = await api(`/api/candidates?${params}`);
    state.candidates = result.candidates || [];
    state.searchPage = Number(result.page) || 1;
    state.searchTotal = Number(result.total) || 0;
    state.searchPageSize = Number(result.pageSize) || 40;
    state.searchTotalPages = Number(result.totalPages) || 1;
    $("exportResults").disabled = !state.searchTotal;
    renderCandidates();
    renderSearchPager();
    const first = state.searchTotal ? (state.searchPage - 1) * state.searchPageSize + 1 : 0;
    const last = Math.min(state.searchPage * state.searchPageSize, state.searchTotal);
    $("resultSummary").textContent = `Showing ${first}–${last} of ${state.searchTotal} matches · filtered across all ${Number(result.evaluated) || 0} repository profiles`;
    $("freshnessNote").textContent = Number(freshnessWeight) ? `Relevance + ${freshnessDecayDays}-day freshness decay` : "Relevance only · freshness off";
    $("latency").textContent = `Results in ${result.responseTimeMs} ms`;
    const hasSearchContext = Boolean($("searchInput").value.trim()) || state.track !== "All"
      || $("subjectFilter").value !== "All subjects" || $("languageFilter").value !== "All languages"
      || $("experienceFilter").value !== "0" || $("workModeFilter").value !== "Any work mode"
      || $("minViewsFilter").value !== "0" || $("minCallsFilter").value !== "0"
      || $("maxAgeFilter").value !== "0" || $("freshnessFilter").value !== "1:120";
    if (state.searchPlan) {
      state.searchPlan = result.searchPlan || state.searchPlan;
      state.searchCriteria = result.criteria || state.searchCriteria;
      renderSearchPlan();
    } else {
      $("understood").classList.toggle("show", hasSearchContext);
      if (hasSearchContext) $("understood").innerHTML = `<div class="understood-heading"><span>⌕</span><div><b>Manual filters</b><p>${escapeHtml(result.understoodAs)}</p></div><em>Indexed search</em></div>`;
    }
    if (logSearch && $("searchInput").value.trim()) api("/api/searches", { method: "POST", body: JSON.stringify({ query: $("searchInput").value.trim() }) }).catch(() => {});
  } catch (error) {
    $("candidateList").innerHTML = `<div class="empty-state"><h3>The repository could not be reached</h3><p>${escapeHtml(error.message)}</p></div>`;
    $("resultSummary").textContent = "Database check required";
    $("exportResults").disabled = true;
  } finally {
    $("searchButton").disabled = false;
    $("searchButton").textContent = "Ask AI to find →";
  }
}

function buildSearchParams(page = 1) {
  const [freshnessWeight, freshnessDecayDays] = $("freshnessFilter").value.split(":");
  const params = new URLSearchParams({
    q: $("searchInput").value.trim(),
    track: state.track,
    subject: $("subjectFilter").value,
    language: $("languageFilter").value,
    experience: $("experienceFilter").value,
    workMode: $("workModeFilter").value,
    minViews: $("minViewsFilter").value,
    minCalls: $("minCallsFilter").value,
    maxAgeDays: $("maxAgeFilter").value,
    freshnessWeight,
    freshnessDecayDays,
    page: String(page),
    pageSize: String(state.searchPageSize),
    includeClaims: $("includeClaims").checked ? "1" : "0",
  });
  if (state.searchPlan) params.set("plan", JSON.stringify(state.searchPlan));
  return params;
}

async function downloadSearchResults() {
  const button = $("exportResults");
  const query = $("searchInput").value.trim();
  button.disabled = true;
  const originalLabel = button.textContent;
  try {
    if (query && state.searchPlanQuery !== query) await runSearch(false, 1);
    const params = buildSearchParams(1);
    params.delete("page");
    params.delete("pageSize");
    const estimatedSeconds = Math.max(3, Math.ceil(Math.max(1, state.searchTotal) / 350));
    let elapsed = 0;
    button.textContent = `Preparing ${state.searchTotal.toLocaleString("en-IN")} · ETA ~${estimatedSeconds}s`;
    const progress = window.setInterval(() => {
      elapsed += 1;
      button.textContent = `Preparing Excel · ${elapsed}s elapsed`;
    }, 1000);
    let response;
    try {
      response = await fetch("/api/search/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: Object.fromEntries(params.entries()) }),
      });
    } finally { window.clearInterval(progress); }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Export failed (${response.status})`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "vedantu-talent-search-results.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`${state.searchTotal.toLocaleString("en-IN")} profiles downloaded · export logged in Activity`);
    loadMeta().catch(() => {});
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = originalLabel;
    button.disabled = !state.searchTotal;
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
  $("minViewsFilter").value = "0";
  $("minCallsFilter").value = "0";
  $("maxAgeFilter").value = "0";
  $("freshnessFilter").value = "1:120";
  $("includeClaims").checked = false;
  state.searchPlan = null;
  state.searchPlanQuery = "";
  state.searchPlanMode = "";
  state.searchCriteria = [];
  renderSearchPlan(null);
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

function aiEvidenceSection(candidate) {
  const profile = candidate.ai_profile;
  if (!profile?.profile_classification) return `<section class="drawer-section ai-evidence"><div class="evidence-heading"><div><h3>Résumé profile recommendation</h3><p>Not processed with the latest classification model. The source category remains visible but is not treated as résumé-verified.</p></div><span class="ai-badge pending">Awaiting AI</span></div></section>`;
  const classification = profile.profile_classification;
  const confidence = Math.round((Number(classification.confidence) || 0) * 100);
  const classificationCss = String(classification.recommended_track || "Unclear").toLowerCase().replace(/\s+/g, "-");
  const classificationEvidence = (classification.evidence || []).slice(0, 3).map((item) => `<p>“${escapeHtml(item.quote)}”${item.page ? ` · page ${escapeHtml(item.page)}` : ""}</p>`).join("");
  const comparison = candidate.classification_disagrees
    ? `Differs from source category: ${escapeHtml(candidate.track)}`
    : `Source category: ${escapeHtml(candidate.track)}${classification.recommended_track === "Unclear" ? " · human review needed" : ""}`;
  const facts = (profile.facts || []).filter((item) => ["subject", "exam", "grade", "board", "language", "role", "qualification", "college"].includes(item.category));
  const items = facts.slice(0, 24).map((item) => {
    const status = item.resume_status === "supported" ? "Resume-backed" : item.resume_status === "contradicted" ? "Conflict" : "Claim only";
    const evidence = (item.evidence || [])[0];
    return `<article class="evidence-row ${escapeHtml(item.resume_status)}"><div><small>${escapeHtml(item.category)}</small><b>${escapeHtml(item.value)}</b>${evidence?.quote ? `<p>“${escapeHtml(evidence.quote)}”${evidence.page ? ` · page ${escapeHtml(evidence.page)}` : ""}</p>` : ""}</div><span>${escapeHtml(status)}</span></article>`;
  }).join("");
  return `<section class="drawer-section ai-evidence"><div class="classification-card ${escapeHtml(classificationCss)}"><div><small>AI résumé recommendation</small><h3>${escapeHtml(classification.recommended_track)} profile</h3><p>${escapeHtml(classification.rationale)}</p>${classificationEvidence}</div><strong>${confidence}%<small>confidence</small></strong><span>${comparison}</span></div><div class="evidence-heading"><div><h3>Résumé evidence check</h3><p>${escapeHtml(candidate.ai_summary || profile.summary || "Application claims reconciled with the résumé.")}</p></div><span class="ai-badge verified">AI processed</span></div><div class="evidence-list">${items || "<p>No material evidence was extracted.</p>"}</div><p class="evidence-note">“Claim only” means the résumé did not evidence the form selection; it does not prove the claim is false. AI profile type is a routing recommendation and must not be used as the sole hiring decision.</p></section>`;
}

function historyEntry(entry) {
  const detail = entry.detail || entry.outcome || entry.note || "Activity recorded";
  const actor = entry.actor || entry.recruiter || "System";
  return `<div class="history-entry"><span class="avatar purple">${escapeHtml(initials(actor))}</span><div><p><b>${escapeHtml(actor)}</b> · ${escapeHtml((entry.action || "called").replaceAll("_", " "))}</p><small>${escapeHtml(detail)}</small></div><time>${escapeHtml(formatDate(entry.created_at, true))}</time></div>`;
}

function applicationEntry(entry) {
  const date = entry.applied_at && !String(entry.applied_at).startsWith("1970-")
    ? formatDate(entry.applied_at, true)
    : `First synchronized ${formatDate(entry.first_seen_at, true)}`;
  return `<article class="application-entry"><div><b>${escapeHtml(entry.source_label)}</b><small>${escapeHtml(date)} · source row ${escapeHtml(entry.source_row_key)}</small></div>${Number(entry.is_latest) ? '<span>Most recent</span>' : '<span class="previous">Previous</span>'}</article>`;
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
    const profileType = profileTypeInfo(candidate);
    $("drawerName").textContent = candidate.name;
    const activity = [...(result.activity || []), ...(result.calls || []).map((call) => ({ ...call, action: "called", actor: call.recruiter, detail: `${call.outcome} · ${call.role}${call.note ? ` · ${call.note}` : ""}` }))]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const applications = result.applications || [];
    $("drawerContent").innerHTML = `
      <div class="drawer-hero"><span class="avatar xlarge ${profileType.effective === "Teacher" ? "orange" : "purple"}">${escapeHtml(candidate.initials)}</span><div><h2>${escapeHtml(candidate.name)}</h2><p>${escapeHtml(candidate.role)}</p><small>${escapeHtml(candidate.city)}, ${escapeHtml(candidate.state)} · ${escapeHtml(candidate.work_mode)}</small></div><div class="drawer-score"><b>${candidate.match_percent}%</b><span>profile match</span></div></div>
      <div class="drawer-actions"><button class="primary-button" id="drawerResume">Resume preview</button><button class="outline-button" id="drawerCall">I called this profile</button><button class="outline-button" id="drawerHistory">View Log History</button></div>
      <section class="drawer-section"><h3>Candidate information</h3><div class="fact-grid">${fact("Applied", formatDate(candidate.applied_at, true))}${fact("Location", `${candidate.city}, ${candidate.state}`)}${fact("Phone", candidate.phone)}${fact("Email", candidate.email)}${fact("Source Sheet", candidate.source_sheet)}${fact("Work mode", candidate.work_mode)}</div></section>
      <section class="drawer-section"><h3>${profileType.effective === "Teacher" ? "Teaching profile" : "Professional profile"}</h3><div class="fact-grid">${fact("AI profile recommendation", profileType.reviewed ? profileType.label : "Awaiting résumé classification")}${fact("Source category", candidate.track)}${fact("Subject / function", candidate.subject_display)}${fact("Grades / levels", candidate.grades_display)}${fact("Boards", candidate.boards_display || "Not applicable")}${fact("Languages", candidate.languages_display)}${fact("Experience", `${candidate.experience_months} months`)}${fact("Education", `${candidate.education} · ${candidate.college}`)}</div></section>
      ${aiEvidenceSection(candidate)}
      ${additionalFacts(candidate)}
      <section class="drawer-section"><h3>Application history</h3><p class="section-note">Every application remains linked to this one candidate profile. Freshness and the primary source use the latest application date.</p>${applications.length ? applications.map(applicationEntry).join("") : "<p>No source-row history is available yet.</p>"}</section>
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
  $("callCandidateName").textContent = candidate.name;
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
  const activeEmployees = Number(repository.active_employees) || 0;
  const formerEmployees = Number(repository.former_employees) || 0;
  ["navCandidateCount", "healthProfiles", "heroProfiles", "metricProfiles", "activityProfiles"].forEach((id) => $(id).textContent = profiles);
  ["healthDuplicates", "metricDuplicates"].forEach((id) => $(id).textContent = duplicates);
  ["metricViews", "activityViews"].forEach((id) => $(id).textContent = views);
  ["metricCalls", "activityCalls"].forEach((id) => $(id).textContent = calls);
  $("heroActiveEmployees").textContent = activeEmployees;
  $("heroFormerEmployees").textContent = formerEmployees;
  $("navSourceCount").textContent = (state.meta.sources || []).length;
  $("navActivityCount").textContent = (state.meta.activity || []).length;
  const canManage = Boolean(state.session?.canManageSources);
  const renderSourceCard = (source) => {
    const connectedSheet = Boolean(source.spreadsheet_id);
    const employmentSource = source.kind === "Employment master";
    const action = source.connected ? "disconnect" : "reconnect";
    const fourthValue = employmentSource ? Number(source.matched_rows) || 0 : Number(source.duplicate_rows) || 0;
    const fourthLabel = employmentSource ? "profiles matched" : "duplicates";
    const sheetLink = safeExternalUrl(source.sheet_url);
    const historyPending = employmentSource ? 0 : Number(source.application_history_pending) || 0;
    const historyProgress = historyPending ? `<p class="source-history-progress"><b>Application history updating</b><span>${historyPending} dates remaining · about ${Math.max(1, Math.ceil(historyPending / 200))} min</span></p>` : "";
    return `<article class="source-card"><header><h3>${escapeHtml(source.label)}</h3><span class="status-${escapeHtml(String(source.status).toLowerCase())}">● ${escapeHtml(source.status)}</span></header><p>${escapeHtml(source.kind)}${connectedSheet ? ` · ${escapeHtml(source.tab_name || "first tab")}` : ""}</p>${sheetLink ? `<a class="source-sheet-link" href="${escapeHtml(sheetLink)}" title="${escapeHtml(sheetLink)}" target="_blank" rel="noopener">${escapeHtml(sheetLink)}</a>` : ""}<div class="source-stats"><div><b>${source.total_rows}</b><small>source rows</small></div><div><b>${source.synced_rows}</b><small>${employmentSource ? "checked" : "synced"}</small></div><div><b>${source.failed_rows}</b><small>failed</small></div><div><b>${fourthValue}</b><small>${fourthLabel}</small></div></div>${historyProgress}<footer><span>${source.connected ? "Connected" : "Disconnected"}</span><span>Last sync ${escapeHtml(formatDate(source.last_sync, true))}</span></footer>${connectedSheet && canManage ? `<div class="source-actions"><button class="text-button" data-source-action="sync" data-source-id="${escapeHtml(source.id)}">Sync now</button><button class="text-button" data-source-action="${action}" data-source-id="${escapeHtml(source.id)}">${action === "disconnect" ? "Disconnect" : "Reconnect"}</button></div>` : ""}${source.last_error ? `<p class="source-error">${escapeHtml(source.last_error)}</p>` : ""}</article>`;
  };
  const hiringSources = (state.meta.sources || []).filter((source) => source.kind !== "Employment master");
  const employmentSources = (state.meta.sources || []).filter((source) => source.kind === "Employment master");
  $("sourceGrid").innerHTML = hiringSources.map(renderSourceCard).join("") || "<div class='empty-state'><h3>No application Sheets connected</h3><p>An Admin can connect a response Sheet above.</p></div>";
  $("employmentSourceGrid").innerHTML = employmentSources.map(renderSourceCard).join("") || "<div class='empty-state'><h3>No employee masters connected</h3><p>Connect the Active and Former employee Sheets to enable employment-history matching.</p></div>";
  $("jobList").innerHTML = (state.meta.jobs || []).map((job) => {
    const percent = job.total_rows ? Math.min(100, Math.round(job.processed_rows / job.total_rows * 100)) : (job.status === "Complete" ? 100 : 0);
    const eta = job.status === "Running" && Number(job.eta_seconds) ? ` · about ${job.eta_seconds}s left` : "";
    const details = `${Number(job.imported_rows) || 0} new · ${Number(job.updated_rows) || 0} updated · ${Number(job.merged_rows) || 0} merged · ${Number(job.detail_failed_rows) || 0} failed`;
    return `<div class="job-row"><div><b>${escapeHtml(job.source_label)}</b><small>${escapeHtml(job.stage)} · ${escapeHtml(job.message)}</small><small class="job-detail">${escapeHtml(details)}</small></div><div><div class="progress"><i style="width:${percent}%"></i></div><small>${job.processed_rows || 0} of ${job.total_rows || "?"} rows${escapeHtml(eta)}</small></div><span class="job-status status-${escapeHtml(String(job.status).toLowerCase())}">${escapeHtml(job.status)} · ${percent}%</span></div>`;
  }).join("") || "<div class='job-row'>No background jobs yet.</div>";
  const ai = state.meta.ai || {};
  const aiCounts = ai.counts || {};
  const aiTotal = Number(aiCounts.total) || 0;
  const aiDone = (Number(aiCounts.completed) || 0) + (Number(aiCounts.failed) || 0);
  const aiPercent = aiTotal ? Math.round(aiDone / aiTotal * 100) : 0;
  const latestBatch = ai.latestBatch;
  const aiStage = !ai.configured ? "Setup required" : Number(aiCounts.processing) ? "OpenAI batch processing" : Number(aiCounts.queued) ? "Preparing résumé files" : aiTotal ? "Ready for the next batch" : "Ready for classification";
  const aiEta = Number(aiCounts.processing) ? "Often faster, but allow up to 24 hours" : Number(aiCounts.queued) ? "Progress updates automatically every minute" : "Search remains instant while this runs";
  $("aiPipeline").innerHTML = `<div class="ai-pipeline-copy"><span class="ai-orb">✦</span><div><b>${escapeHtml(aiStage)}</b><p>${ai.configured ? `${escapeHtml(ai.model)} · 50% Batch API discount · up to ${escapeHtml(ai.batchSize)} profiles per batch` : "Add the OpenAI API key in Cloudflare. No key is sent to the browser."}</p><small>${escapeHtml(aiEta)}${latestBatch ? ` · latest batch: ${escapeHtml(String(latestBatch.status).replaceAll("_", " "))}` : ""}</small></div></div><div class="ai-progress"><div><span>Queued <b>${Number(aiCounts.queued) || 0}</b></span><span>Processing <b>${Number(aiCounts.processing) || 0}</b></span><span>Classified <b>${Number(aiCounts.completed) || 0}</b></span><span>Needs attention <b>${Number(aiCounts.failed) || 0}</b></span></div><div class="progress"><i style="width:${aiPercent}%"></i></div><small>${aiDone} of ${aiTotal || 0} profiles finished · ${aiPercent}%</small></div>`;
  $("startAiBatch").disabled = !canManage || !ai.configured || Number(aiCounts.queued) > 0 || Number(aiCounts.processing) > 0;
  $("startAiBatch").textContent = "Classify next 20 profiles";
  $("aiOperations").classList.toggle("hidden", !canManage);
  if (canManage) {
    $("aiAutomation").checked = Boolean(ai.automatic);
    $("aiAutomation").disabled = !ai.configured;
    $("aiAutomationLabel").textContent = ai.automatic ? "Running" : "Paused";
    const failures = ai.failures || [];
    $("aiFailurePanel").classList.toggle("hidden", !failures.length);
    $("aiFailureSummary").textContent = failures.length
      ? `${failures.length} recent failure${failures.length === 1 ? "" : "s"} shown. Temporary service issues retry automatically up to three attempts.`
      : "No profiles currently need attention.";
    $("retryTemporaryAi").disabled = !failures.some((failure) => failure.autoRetry);
    $("retryAllAi").disabled = !failures.length;
    $("aiFailureList").innerHTML = failures.map((failure) => `<article><div><b>${escapeHtml(failure.candidate_name)}</b><small>${escapeHtml(failure.source_sheet)} · ${escapeHtml(failure.category)} · attempt ${Number(failure.attempt_count) || 0}</small><p>${escapeHtml(failure.error_message || "No detailed error was returned.")}</p><em>${escapeHtml(failure.guidance)}</em></div><div><button class="text-button" data-ai-profile="${escapeHtml(failure.candidate_id)}">Open profile</button><button class="outline-button" data-ai-retry="${escapeHtml(failure.id)}">Retry</button></div></article>`).join("");
    document.querySelectorAll("[data-ai-profile]").forEach((button) => button.onclick = () => openCandidate(button.dataset.aiProfile));
    document.querySelectorAll("[data-ai-retry]").forEach((button) => button.onclick = () => retryAiFailure(button.dataset.aiRetry));
  }
  $("accessList").innerHTML = (state.meta.users || []).map((user) => {
    const canRevoke = canManage && user.email !== state.session?.user?.email;
    return `<div class="access-row"><div><b>${escapeHtml(user.display_name)}</b><small>${escapeHtml(user.email)}</small></div><span class="role-pill">${escapeHtml(user.role)}</span><span>${user.active ? "Active" : "Disabled"}</span>${canRevoke ? `<button class="remove-access" data-revoke-user="${escapeHtml(user.email)}" data-revoke-name="${escapeHtml(user.display_name)}">Remove access</button>` : "<span></span>"}</div>`;
  }).join("");
  document.querySelectorAll("[data-source-action]").forEach((button) => button.onclick = () => manageSource(button.dataset.sourceId, button.dataset.sourceAction));
  document.querySelectorAll("[data-revoke-user]").forEach((button) => button.onclick = () => revokeAccess(button.dataset.revokeUser, button.dataset.revokeName));
  const sourceActive = (state.meta.jobs || []).some((job) => ["Queued", "Running"].includes(job.status));
  const aiActive = Number(aiCounts.queued) > 0 || Number(aiCounts.processing) > 0;
  scheduleSyncPolling(sourceActive || aiActive, sourceActive ? 2500 : 15000);
  renderActivity();
}

function renderActivity() {
  const actionCopy = { viewed: "viewed profile", resume_opened: "opened resume preview", called: "logged a call", searched: "searched", search_exported: "downloaded search results", synced: "synchronized source", access_revoked: "revoked workspace access for" };
  $("activityList").innerHTML = (state.meta?.activity || []).map((entry) => `<div class="activity-row"><span class="avatar orange">${escapeHtml(initials(entry.actor))}</span><span class="event-icon ${escapeHtml(entry.action)}">${entry.action === "synced" ? "↻" : entry.action === "called" ? "☎" : entry.action === "searched" ? "⌕" : entry.action === "search_exported" ? "↓" : "◉"}</span><div><p><b>${escapeHtml(entry.actor)}</b> ${escapeHtml(actionCopy[entry.action] || entry.action)}${entry.candidate_name ? ` <b>${escapeHtml(entry.candidate_name)}</b>` : ""}</p><small>${escapeHtml(entry.detail)}</small></div><time>${escapeHtml(formatDate(entry.created_at, true))}</time></div>`).join("") || "<div class='empty-state'><h3>No activity yet</h3></div>";
}

function renderSuperadmin() {
  if (!state.superadmin) return;
  const data = state.superadmin;
  const metrics = data.metrics || {};
  const cards = [
    ["Canonical profiles", metrics.profiles, "deduplicated applicants"],
    ["Active list", metrics.active_rows, `${Number(metrics.active_profiles) || 0} matched profiles`],
    ["Inactive / former list", metrics.former_rows, `${Number(metrics.former_profiles) || 0} matched profiles`],
    ["Active users", metrics.active_users, "workspace access"],
    ["Profile views", metrics.views, `${Number(metrics.resume_opens) || 0} résumé opens`],
    ["Calls logged", metrics.calls, `${Number(metrics.duplicates) || 0} duplicates merged`],
  ];
  $("superadminMetrics").innerHTML = cards.map(([label, value, note]) => `<div><span>${escapeHtml(label)}</span><strong>${Number(value) || 0}</strong><small>${escapeHtml(note)}</small></div>`).join("");
  $("superadminRows").innerHTML = (data.candidates || []).map((candidate) => {
    const recommendation = candidate.recommended_track && candidate.recommended_track !== "Pending"
      ? `${candidate.recommended_track} · ${Math.round((Number(candidate.classification_confidence) || 0) * 100)}%`
      : `Pending · source says ${candidate.source_track}`;
    return `<tr><td><b>${escapeHtml(candidate.name)}</b><small>${escapeHtml(candidate.email || candidate.phone)}</small><small>${escapeHtml([candidate.city, candidate.state].filter(Boolean).join(", "))}</small></td><td><b>${escapeHtml(recommendation)}</b><small>${escapeHtml(candidate.role || candidate.subject_display)}</small></td><td>${escapeHtml(candidate.employment_status)}</td><td><b>${escapeHtml(candidate.source_sheet)}</b><small>${escapeHtml(formatDate(candidate.applied_at))}</small></td><td>${Number(candidate.view_count) || 0} views<br>${Number(candidate.call_count) || 0} calls</td><td><button class="text-button" data-admin-edit="${escapeHtml(candidate.id)}">Open & edit</button></td></tr>`;
  }).join("") || `<tr><td colspan="6">No matching records.</td></tr>`;
  const totalPages = Math.max(1, Math.ceil((Number(data.total) || 0) / (Number(data.pageSize) || 50)));
  $("superadminPager").innerHTML = `<span>Page ${Number(data.page) || 1} of ${totalPages} · ${Number(data.total) || 0} records</span><div><button class="outline-button" data-admin-page="${Math.max(1, Number(data.page) - 1)}" ${Number(data.page) <= 1 ? "disabled" : ""}>Previous</button><button class="outline-button" data-admin-page="${Math.min(totalPages, Number(data.page) + 1)}" ${Number(data.page) >= totalPages ? "disabled" : ""}>Next</button></div>`;
  $("superadminUsage").innerHTML = (data.usage || []).map((entry) => `<article><div><b>${escapeHtml(entry.display_name)}</b><small>${escapeHtml(entry.identity)} · last active ${escapeHtml(formatDate(entry.last_active, true))}</small></div><span>${Number(entry.searches) || 0} searches · ${Number(entry.views) || 0} views · ${Number(entry.resume_opens) || 0} opens · ${Number(entry.calls) || 0} calls</span></article>`).join("") || "<p>No usage yet.</p>";
  const classificationRows = (data.classifications || []).map((item) => `<span><b>${Number(item.count) || 0}</b>${escapeHtml(item.recommendation)}</span>`).join("");
  const sourceRows = (data.sources || []).map((source) => `<article><div><b>${escapeHtml(source.label)}</b><small>${escapeHtml(source.kind)} · ${escapeHtml(source.status)}</small></div><span>${Number(source.synced_rows) || 0}/${Number(source.total_rows) || 0} synced · ${Number(source.failed_rows) || 0} failed</span></article>`).join("");
  $("superadminReports").innerHTML = `<div class="classification-summary">${classificationRows || "<span><b>0</b>AI classifications</span>"}</div>${sourceRows || "<p>No sources connected.</p>"}`;
  document.querySelectorAll("[data-admin-edit]").forEach((button) => button.onclick = () => openSuperadminEditor(button.dataset.adminEdit));
  document.querySelectorAll("[data-admin-page]").forEach((button) => button.onclick = () => loadSuperadmin(Number(button.dataset.adminPage)));
}

async function loadSuperadmin(page = state.superadminPage || 1) {
  if (!state.session?.isSuperadmin) return;
  state.superadminPage = page;
  try {
    const query = $("superadminSearch").value.trim();
    state.superadmin = await api(`/api/superadmin?page=${encodeURIComponent(page)}&q=${encodeURIComponent(query)}`);
    renderSuperadmin();
  } catch (error) { toast(error.message); }
}

async function openSuperadminEditor(candidateId) {
  $("superadminEditBackdrop").classList.remove("hidden");
  $("superadminEditTitle").textContent = "Loading candidate…";
  $("superadminRawRows").innerHTML = `<div class="loading-card"></div>`;
  try {
    const result = await api(`/api/superadmin/candidates/${encodeURIComponent(candidateId)}`);
    const candidate = result.candidate;
    $("superadminCandidateId").value = candidate.id;
    $("superadminEditTitle").textContent = candidate.name;
    $("superadminEditIdentity").textContent = `${candidate.email || "No email"} · ${candidate.phone || "No phone"} · ${candidate.source_sheet}`;
    $("superEditName").value = candidate.name || "";
    $("superEditTrack").value = candidate.track || "Non-teaching";
    $("superEditRole").value = candidate.role || "";
    $("superEditExperience").value = Number(candidate.experience_months) || 0;
    $("superEditCity").value = candidate.city || "";
    $("superEditState").value = candidate.state || "";
    $("superEditSubjects").value = candidate.subject_display || "";
    $("superEditGrades").value = candidate.grades_display || "";
    $("superEditBoards").value = candidate.boards_display || "";
    $("superEditLanguages").value = candidate.languages_display || "";
    $("superEditWorkMode").value = candidate.work_mode || "";
    $("superadminRawRows").innerHTML = (result.rows || []).map((row) => {
      let raw = row.raw_json || "{}";
      try { raw = JSON.stringify(JSON.parse(raw), null, 2); } catch { raw = String(raw); }
      return `<details><summary>${escapeHtml(row.source_label)} · row ${escapeHtml(row.source_row_key)}${row.duplicate_kind ? ` · ${escapeHtml(row.duplicate_kind)}` : ""}</summary><pre>${escapeHtml(raw)}</pre></details>`;
    }).join("") || "<p>No original application rows are linked.</p>";
  } catch (error) {
    closeSuperadminEditor();
    toast(error.message);
  }
}

function closeSuperadminEditor() { $("superadminEditBackdrop").classList.add("hidden"); }

async function saveSuperadminCandidate(event) {
  event.preventDefault();
  const candidateId = $("superadminCandidateId").value;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const result = await api(`/api/superadmin/candidates/${encodeURIComponent(candidateId)}`, { method: "POST", body: JSON.stringify({
      name: $("superEditName").value, track: $("superEditTrack").value, role: $("superEditRole").value,
      experience_months: $("superEditExperience").value, city: $("superEditCity").value, state: $("superEditState").value,
      subject_display: $("superEditSubjects").value, grades_display: $("superEditGrades").value,
      boards_display: $("superEditBoards").value, languages_display: $("superEditLanguages").value,
      work_mode: $("superEditWorkMode").value,
    }) });
    closeSuperadminEditor();
    toast(result.changed?.length ? `Saved ${result.changed.length} audited field changes` : "Record reviewed; no fields changed");
    await Promise.all([loadSuperadmin(state.superadminPage), runSearch(false), loadMeta()]);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Save audited changes"; }
}

function downloadSuperadminReport(type) {
  const link = document.createElement("a");
  link.href = `/api/superadmin/export?type=${encodeURIComponent(type)}`;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast("Preparing audited CSV export");
}

async function loadMeta() {
  try {
    state.meta = await api("/api/meta");
    renderMeta();
    resumeQueuedSync();
  } catch (error) {
    if (state.page !== "discover") toast(`Repository health unavailable: ${error.message}`);
  }
}

async function resumeQueuedSync() {
  if (state.syncKickInFlight || !state.session?.canManageSources) return;
  const queued = (state.meta?.jobs || []).find((job) => job.status === "Queued" && job.source_id);
  if (!queued) return;
  state.syncKickInFlight = true;
  try {
    await api(`/api/admin/sources/${encodeURIComponent(queued.source_id)}/sync`, { method: "POST", body: "{}" });
  } catch (error) {
    if (state.page === "sources") toast(`Background sync will retry automatically: ${error.message}`);
  } finally {
    state.syncKickInFlight = false;
  }
}

function scheduleSyncPolling(active, delay = 2500) {
  clearTimeout(state.syncPoller);
  state.syncPoller = null;
  if (!active) return;
  state.syncPoller = setTimeout(() => loadMeta(), delay);
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
  const fields = state.sourceMode === "employment" ? state.session?.employmentFields || [] : state.session?.canonicalFields || [];
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
  const valid = state.sourceMode === "employment"
    ? Boolean(mapping.workEmail || mapping.personalEmail || mapping.phone)
    : Boolean(mapping.fullName && mapping.appliedAt && (mapping.email || mapping.phone));
  $("saveSource").disabled = !valid;
  $("mappingCoverage").textContent = `${Object.keys(mapping).length} mapped`;
  $("mappingSummary").textContent = valid
    ? "Required identity fields are ready. Review the optional matches, then start the background sync."
    : state.sourceMode === "employment"
      ? "Map a work email, personal email, or phone to match employees with candidate profiles."
      : "Map Full name, Timestamp, and either Email or Phone to continue.";
}

function openSourceModal(mode = "candidate") {
  if (!state.session?.canManageSources) {
    toast("Source connection unlocks after Cloudflare Access protection is enabled");
    return;
  }
  if (!state.session.connectorConfigured) {
    toast("Finish the Apps Script connector setup in Cloudflare first");
    return;
  }
  state.sourceMode = mode === "employment" ? "employment" : "candidate";
  state.sourcePreview = null;
  $("sourceForm").reset();
  $("sourceHeaderRow").value = state.sourceMode === "employment" ? "2" : "1";
  $("employmentStatusField").classList.toggle("hidden", state.sourceMode !== "employment");
  $("sourceTitle").textContent = state.sourceMode === "employment" ? "Connect an employee master" : "Connect an application Sheet";
  $("sourceKicker").textContent = state.sourceMode === "employment" ? "Admin · Employment history" : "Admin · Google Sheets connector";
  $("sourceLabel").placeholder = state.sourceMode === "employment" ? "Example: GreytHR Active employees" : "Example: Teacher applications · July";
  $("sourceTab").placeholder = state.sourceMode === "employment" ? "Active Employees" : "Form Responses 1";
  $("mappingRequirement").textContent = state.sourceMode === "employment"
    ? "Required: Work email, personal email, or phone. GreytHR exports usually use header row 2."
    : "Required: Full name, Timestamp, and either Email or Phone.";
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
      body: JSON.stringify({ sheetUrl: $("sourceUrl").value, tabName: $("sourceTab").value, headerRow: Number($("sourceHeaderRow").value) || 1 }),
    });
    $("sourceTab").value = state.sourcePreview.tabName || $("sourceTab").value;
    $("mappingPanel").classList.remove("hidden");
    $("mappingStep").classList.add("active");
    renderMapping();
    toast(`${state.sourcePreview.headers.length} columns found · ${state.sourcePreview.totalRows} ${state.sourceMode === "employment" ? "employee" : "response"} rows`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Read columns"; }
}

async function saveSource(event) {
  event.preventDefault();
  const button = $("saveSource");
  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    const mapping = { ...currentMapping(), _headerRow: Number($("sourceHeaderRow").value) || 1 };
    await api("/api/admin/sources", {
      method: "POST",
      body: JSON.stringify({
        label: $("sourceLabel").value,
        sheetUrl: $("sourceUrl").value,
        tabName: $("sourceTab").value,
        mapping,
        sourceType: state.sourceMode,
        employmentStatus: $("employmentStatus").value,
      }),
    });
    closeSourceModal();
    toast(`${state.sourceMode === "employment" ? "Employee master" : "Application Sheet"} connected · background sync started`);
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

async function startAiBatch() {
  if (!window.confirm("Classify the next 20 unprocessed profiles? Their application rows and résumés will be sent to OpenAI in a discounted background batch.")) return;
  const button = $("startAiBatch");
  button.disabled = true;
  button.textContent = "Queuing batch…";
  try {
    const result = await api("/api/admin/ai/batch", { method: "POST", body: JSON.stringify({ limit: 20 }) });
    toast(result.queued ? `${result.queued} profiles queued for résumé classification · you can keep using Talent Desk` : result.message);
    await loadMeta();
  } catch (error) { toast(error.message); }
  finally { button.textContent = "Classify next 20 profiles"; }
}

async function retryAiFailure(jobId = "", retryableOnly = false) {
  try {
    const result = await api("/api/admin/ai/retry", { method: "POST", body: JSON.stringify({ jobId, retryableOnly }) });
    toast(result.retried ? `${result.retried} profile${result.retried === 1 ? "" : "s"} queued again` : "No eligible failures to retry");
    await loadMeta();
  } catch (error) { toast(error.message); }
}

async function changeAiAutomation() {
  const enabled = $("aiAutomation").checked;
  $("aiAutomation").disabled = true;
  try {
    const result = await api("/api/admin/ai/automation", { method: "POST", body: JSON.stringify({ enabled }) });
    toast(result.automatic ? "New profiles will classify automatically in background batches" : "Automatic classification paused");
    await loadMeta();
  } catch (error) {
    $("aiAutomation").checked = !enabled;
    toast(error.message);
  } finally { $("aiAutomation").disabled = false; }
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

async function revokeAccess(email, displayName) {
  if (!window.confirm(`Remove Talent Desk access for ${displayName || email}? Their past activity will remain in the audit log.`)) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(email)}`, { method: "DELETE" });
    toast("Workspace access removed");
    await loadMeta();
  } catch (error) { toast(error.message); }
}

document.querySelectorAll("[data-page-link]").forEach((button) => button.onclick = () => showPage(button.dataset.pageLink));
document.querySelectorAll("[data-track]").forEach((button) => button.onclick = () => {
  state.track = button.dataset.track;
  document.querySelectorAll("[data-track]").forEach((item) => item.classList.toggle("active", item === button));
  runSearch(false);
});
$("searchButton").onclick = () => runSearch(true);
$("exportResults").onclick = downloadSearchResults;
$("searchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") runSearch(true); });
["subjectFilter", "languageFilter", "experienceFilter", "workModeFilter", "minViewsFilter", "minCallsFilter", "maxAgeFilter", "freshnessFilter"].forEach((id) => $(id).addEventListener("change", () => runSearch(false, 1)));
$("includeClaims").addEventListener("change", () => runSearch(false));
$("clearFilters").onclick = clearFilters;
$("refreshMeta").onclick = () => loadMeta().then(() => toast("Repository health refreshed"));
$("refreshActivity").onclick = () => loadMeta().then(() => toast("Activity log refreshed"));
$("refreshSuperadmin").onclick = () => loadSuperadmin(state.superadminPage).then(() => toast("Superadmin reports refreshed"));
$("runSuperadminSearch").onclick = () => loadSuperadmin(1);
$("superadminSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") loadSuperadmin(1); });
document.querySelectorAll("[data-admin-export]").forEach((button) => button.onclick = () => downloadSuperadminReport(button.dataset.adminExport));
$("connectSource").onclick = () => openSourceModal("candidate");
$("connectEmploymentSource").onclick = () => openSourceModal("employment");
$("startAiBatch").onclick = startAiBatch;
$("aiAutomation").addEventListener("change", changeAiAutomation);
$("retryTemporaryAi").onclick = () => retryAiFailure("", true);
$("retryAllAi").onclick = () => retryAiFailure("", false);
$("addRecruiter").onclick = openUserModal;
$("readColumns").onclick = readSourceColumns;
$("sourceForm").addEventListener("submit", saveSource);
$("userForm").addEventListener("submit", saveAccessUser);
document.querySelectorAll("[data-close-drawer]").forEach((button) => button.onclick = closeDrawer);
document.querySelectorAll("[data-close-call]").forEach((button) => button.onclick = closeCallModal);
document.querySelectorAll("[data-close-source]").forEach((button) => button.onclick = closeSourceModal);
document.querySelectorAll("[data-close-user]").forEach((button) => button.onclick = closeUserModal);
document.querySelectorAll("[data-close-superadmin]").forEach((button) => button.onclick = closeSuperadminEditor);
$("profileBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeDrawer(); });
$("callBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeCallModal(); });
$("sourceBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeSourceModal(); });
$("userBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeUserModal(); });
$("superadminEditBackdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeSuperadminEditor(); });
$("callForm").addEventListener("submit", saveCall);
$("superadminEditForm").addEventListener("submit", saveSuperadminCandidate);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("callBackdrop").classList.contains("hidden")) closeCallModal();
  else if (!$("sourceBackdrop").classList.contains("hidden")) closeSourceModal();
  else if (!$("userBackdrop").classList.contains("hidden")) closeUserModal();
  else if (!$("superadminEditBackdrop").classList.contains("hidden")) closeSuperadminEditor();
  else if (!$("profileBackdrop").classList.contains("hidden")) closeDrawer();
});

async function initialize() {
  try { await loadSession(); }
  catch (error) { showLogin(error); return; }
  $("authLoader").classList.add("hidden");
  $("loginScreen").classList.add("hidden");
  document.body.classList.remove("auth-pending", "auth-login");
  await Promise.all([loadMeta(), runSearch(false)]);
}

initialize();
