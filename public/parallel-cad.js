const promptInput = document.querySelector("#prompt");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const resetButton = document.querySelector("#resetButton");
const planList = document.querySelector("#planList");
const monitorGrid = document.querySelector("#monitorGrid");
const manifestEl = document.querySelector("#manifest");
const plannerStatus = document.querySelector("#plannerStatus");
const monitorStatus = document.querySelector("#monitorStatus");
const manifestStatus = document.querySelector("#manifestStatus");
const runIdEl = document.querySelector("#runId");
const kernelCountEl = document.querySelector("#kernelCount");
const refreshRateEl = document.querySelector("#refreshRate");

let activeRunId = null;
let pollTimer = null;
const defaultRunButtonText = runButton.textContent;

function reset() {
  clearPoll();
  activeRunId = null;
  runButton.disabled = false;
  runButton.textContent = defaultRunButtonText;
  stopButton.disabled = true;
  runIdEl.textContent = "none";
  kernelCountEl.textContent = "0";
  refreshRateEl.textContent = "waiting";
  planList.innerHTML = "";
  monitorGrid.innerHTML = `<div class="empty-state">Run the factory to clone CAD Agent instances and monitor their Kernel computers.</div>`;
  manifestEl.textContent = "{}";
  setStatus(plannerStatus, "idle", "idle");
  setStatus(monitorStatus, "idle", "idle");
  setStatus(manifestStatus, "idle", "idle");
}

function setStatus(el, state, text) {
  el.className = `status ${state}`;
  el.textContent = text;
}

async function startRun() {
  runButton.disabled = true;
  runButton.textContent = "Creating...";
  stopButton.disabled = true;
  setStatus(plannerStatus, "running", "planning");
  setStatus(monitorStatus, "running", "creating");
  setStatus(manifestStatus, "running", "pending");
  monitorGrid.innerHTML = `<div class="empty-state">Creating fresh CAD Agent instances on new Kernel computers...</div>`;

  try {
    const run = await api("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: promptInput.value }),
    }, 12000);
    activeRunId = run.id;
    renderRun(run);
    startPoll(run.refreshMs);
  } catch (error) {
    await recoverLatestRun(error);
  }
}

async function recoverLatestRun(originalError) {
  try {
    const run = await api("/api/runs/latest", {}, 5000);
    activeRunId = run.id;
    renderRun(run);
    startPoll(run.refreshMs);
  } catch {
    showError(originalError);
    runButton.disabled = false;
    runButton.textContent = defaultRunButtonText;
  }
}

async function stopRun() {
  if (!activeRunId) return;
  stopButton.disabled = true;
  setStatus(monitorStatus, "running", "stopping");
  try {
    const run = await api(`/api/runs/${activeRunId}/stop`, { method: "POST" });
    renderRun(run);
    clearPoll();
    runButton.disabled = false;
  } catch (error) {
    showError(error);
  }
}

async function resetRun() {
  try {
    await api("/api/runs/stop-all", { method: "POST" });
  } catch {
    // The server may have restarted; resetting the local UI is still useful.
  }
  reset();
}

function startPoll(refreshMs) {
  clearPoll();
  const interval = Math.max(1500, Math.min(refreshMs || 3000, 5000));
  pollTimer = setInterval(async () => {
    if (!activeRunId) return;
    try {
      const run = await api(`/api/runs/${activeRunId}`);
      renderRun(run);
      if (["failed", "stopped"].includes(run.status)) {
        clearPoll();
        runButton.disabled = false;
        stopButton.disabled = true;
      }
    } catch (error) {
      showError(error);
      clearPoll();
    }
  }, interval);
}

function clearPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function renderRun(run) {
  runIdEl.textContent = run.id;
  kernelCountEl.textContent = String(run.workers.length);
  refreshRateEl.textContent = `${Math.round(run.refreshMs / 1000)} sec screenshots`;
  runButton.disabled = !["failed", "stopped", "complete"].includes(run.status);
  runButton.textContent = defaultRunButtonText;
  stopButton.disabled = ["failed", "stopped"].includes(run.status);

  renderPlan(run);
  renderMonitor(run);
  renderManifest(run);

  if (run.status === "failed") {
    setStatus(plannerStatus, "failed", "failed");
    setStatus(monitorStatus, "failed", "failed");
    setStatus(manifestStatus, "failed", "failed");
  } else if (run.status === "stopped") {
    setStatus(plannerStatus, "done", "stopped");
    setStatus(monitorStatus, "done", "stopped");
    setStatus(manifestStatus, "done", "saved");
  } else if (run.status === "complete") {
    setStatus(plannerStatus, "done", "planned");
    setStatus(monitorStatus, "done", "complete");
    setStatus(manifestStatus, "done", "saved");
  } else if (["monitoring", "agents-running", "assembling"].includes(run.status)) {
    setStatus(plannerStatus, "done", "planned");
    setStatus(monitorStatus, "running", run.status === "assembling" ? "assembling" : "agents");
    setStatus(manifestStatus, "done", "live");
  } else {
    setStatus(plannerStatus, "running", "planning");
    setStatus(monitorStatus, "running", "creating");
    setStatus(manifestStatus, "running", "pending");
  }
}

function renderPlan(run) {
  const workers = run.plan.workers.concat(run.plan.assembler);
  planList.innerHTML = workers
    .map(
      (worker) => `<li>
        <strong>${escapeHtml(worker.template || worker.title)}${worker.assignment ? ` (${escapeHtml(worker.assignment)})` : ""}:</strong>
        ${escapeHtml(worker.prompt)}
      </li>`,
    )
    .join("");
}

function renderMonitor(run) {
  monitorGrid.innerHTML = run.workers
    .map((worker) => {
      const updated = worker.lastScreenshotAt ? new Date(worker.lastScreenshotAt).toLocaleTimeString() : "waiting";
      const liveLink = worker.liveViewUrl ? `<a href="${escapeAttr(worker.liveViewUrl)}" target="_blank" rel="noreferrer">live view</a>` : "";
      const session = worker.sessionId ? `<span>session: ${escapeHtml(worker.sessionId)}</span>` : "<span>session: creating</span>";
      const error = worker.error || worker.agentError ? `<span>error: ${escapeHtml(worker.error || worker.agentError)}</span>` : "";
      const lastAction = worker.lastAction ? `<div class="last-action">last action: ${escapeHtml(worker.lastAction)}</div>` : "";
      const finalText = worker.finalText ? `<div class="final-text">${escapeHtml(worker.finalText)}</div>` : "";
      return `<article class="kernel-card">
        <div class="kernel-top">
          <div class="kernel-title">
            <h3>${escapeHtml(worker.title)}</h3>
            <p>${escapeHtml(worker.template || worker.role)} · prompt: ${escapeHtml(worker.assignment || worker.id)}</p>
          </div>
          <span class="kernel-state ${escapeAttr(worker.agentStatus || worker.status)}">${escapeHtml(worker.agentStatus || worker.status)}</span>
        </div>
        <div class="kernel-shot">
          <img src="${escapeAttr(worker.screenshotUrl)}" alt="${escapeAttr(worker.title)} screenshot">
          <div class="shot-badge">shot #${escapeHtml(worker.screenshotVersion)}</div>
          <div class="shot-sweep" aria-hidden="true"></div>
        </div>
        <div class="kernel-meta">
          <div class="kernel-prompt">${escapeHtml(worker.prompt)}</div>
          <div class="refresh-line">
            <span class="refresh-dot"></span>
            <span>last screenshot: ${escapeHtml(updated)} · actions: ${escapeHtml(worker.actionCount || 0)} · step: ${escapeHtml(worker.agentStep || 0)}</span>
          </div>
          ${lastAction}
          ${finalText}
          <div class="kernel-links">${liveLink}${session}${error}</div>
        </div>
      </article>`;
    })
    .join("");
}

function renderManifest(run) {
  manifestEl.textContent = JSON.stringify(
    {
      runId: run.id,
      status: run.status,
      strategy: run.strategy,
      factory: run.factory,
      prompt: run.prompt,
      agentInstances: run.workers.map((worker) => ({
        id: worker.id,
        role: worker.role,
        template: worker.template,
        assignment: worker.assignment,
        status: worker.status,
        agentStatus: worker.agentStatus,
        agentStep: worker.agentStep,
        actionCount: worker.actionCount,
        lastAction: worker.lastAction,
        finalText: worker.finalText,
        sessionId: worker.sessionId,
        liveViewUrl: worker.liveViewUrl,
        screenshotVersion: worker.screenshotVersion,
        prompt: worker.prompt,
        contract: worker.contract,
        lastScreenshotAt: worker.lastScreenshotAt,
      })),
    },
    null,
    2,
  );
}

async function api(path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(path, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function showError(error) {
  setStatus(plannerStatus, "failed", "error");
  setStatus(monitorStatus, "failed", "error");
  setStatus(manifestStatus, "failed", "error");
  monitorGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<br>Run the monitor server with npm run serve.</div>`;
  manifestEl.textContent = JSON.stringify({ error: error.message }, null, 2);
  stopButton.disabled = true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

runButton.addEventListener("click", startRun);
stopButton.addEventListener("click", stopRun);
resetButton.addEventListener("click", resetRun);

reset();
