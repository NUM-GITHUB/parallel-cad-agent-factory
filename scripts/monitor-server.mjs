import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Lightcone from '@tzafon/lightcone';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const runsRoot = path.join(rootDir, '.lightcone-runs', 'monitor');
loadEnvFile(path.join(rootDir, '.env.local'));
loadEnvFile(path.join(rootDir, '.env'));
loadEnvFile(path.join(rootDir, '..', '.env.local'));
loadEnvFile(path.join(rootDir, '..', '.env'));

const preferredPort = Number.parseInt(process.env.PORT || '8780', 10);
const viewport = process.env.PARALLEL_CAD_VIEWPORT || '1280x800@60';
const refreshMs = Number.parseInt(process.env.MONITOR_REFRESH_MS || '3000', 10);
const northstarModel = process.env.TZAFON_MODEL || 'tzafon.northstar-cua-fast';
const northstarWorkerMaxSteps = Number.parseInt(process.env.MONITOR_AGENT_MAX_STEPS || '4', 10);
const northstarAssemblerMaxSteps = Number.parseInt(process.env.MONITOR_ASSEMBLER_MAX_STEPS || '5', 10);
const defaultAgentBackend = normalizeAgentBackend(
  process.env.MONITOR_AGENT_BACKEND || (process.env.MONITOR_AGENT_MODE === 'off' ? 'off' : 'codex'),
);
const northstarClient =
  process.env.TZAFON_API_KEY && process.env.MONITOR_AGENT_MODE !== 'off'
    ? new Lightcone({ apiKey: process.env.TZAFON_API_KEY, timeout: 3 * 60 * 1000 })
    : null;
const runs = new Map();
const activePort = await findAvailablePort(preferredPort);

fs.mkdirSync(runsRoot, { recursive: true });

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message });
  }
});

server.listen(activePort, '127.0.0.1', () => {
  console.log(`CAD Agent Factory: http://127.0.0.1:${activePort}/parallel-cad.html`);
});

async function findAvailablePort(startPort) {
  for (let candidate = startPort; candidate < startPort + 20; candidate += 1) {
    if (await canListen(candidate)) return candidate;
  }
  throw new Error(`No available port found from ${startPort} to ${startPort + 19}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

function normalizeAgentBackend(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['northstar', 'tzafon', 'lightcone'].includes(normalized)) return 'northstar';
  if (['off', 'none', 'monitor'].includes(normalized)) return 'off';
  return 'codex';
}

function resolveAgentBackend(requestedBackend) {
  if (requestedBackend === 'off') return 'off';
  if (requestedBackend === 'northstar') return northstarClient ? 'northstar' : 'codex';
  return 'codex';
}

async function route(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${activePort}`);

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: '/parallel-cad.html' });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      refreshMs,
      defaultAgentBackend,
      northstarAvailable: Boolean(northstarClient),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/runs') {
    sendJson(response, 200, {
      runs: [...runs.values()].map((run) => ({
        id: run.id,
        status: run.status,
        prompt: run.prompt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/runs') {
    const body = await readJson(request);
    const freshProject = body.stopPrevious !== false;
    const run = createRun(body.prompt || '', {
      freshProject,
      agentBackend: body.agentBackend || defaultAgentBackend,
    });
    runs.set(run.id, run);
    bootRun(run).catch((error) => failRun(run, error));
    sendJson(response, 202, serializeRun(run));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/runs/latest') {
    const run = latestRun();
    if (!run) {
      sendJson(response, 404, { error: 'no runs yet' });
      return;
    }
    sendJson(response, 200, serializeRun(run));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/runs/stop-all') {
    await stopAllRuns();
    sendJson(response, 200, { ok: true, stoppedRuns: [...runs.values()].filter((run) => run.status === 'stopped').length });
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === 'GET' && runMatch) {
    const run = findRun(runMatch[1]);
    sendJson(response, 200, serializeRun(run));
    return;
  }

  const stopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
  if (request.method === 'POST' && stopMatch) {
    const run = findRun(stopMatch[1]);
    await stopRun(run);
    sendJson(response, 200, serializeRun(run));
    return;
  }

  const shotMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/workers\/([^/]+)\/screenshot$/);
  if (request.method === 'GET' && shotMatch) {
    const run = findRun(shotMatch[1]);
    const worker = run.workers.find((item) => item.id === shotMatch[2]);
    if (!worker) {
      sendJson(response, 404, { error: 'worker not found' });
      return;
    }
    const filePath = worker.screenshotPath;
    if (!filePath || !fs.existsSync(filePath)) {
      sendSvgPlaceholder(response, worker.title, worker.status);
      return;
    }
    response.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  if (request.method === 'GET') {
    await serveStatic(url.pathname, response);
    return;
  }

  sendJson(response, 404, { error: 'not found' });
}

function createRun(prompt, options = {}) {
  const id = `monitor-${timestamp()}`;
  const dir = path.join(runsRoot, id);
  const screenshotsDir = path.join(dir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const requestedAgentBackend = normalizeAgentBackend(options.agentBackend || defaultAgentBackend);
  const agentBackend = resolveAgentBackend(requestedAgentBackend);
  const agentsEnabled = agentBackend !== 'off';
  const plan = makePlan(prompt);
  const workers = [...plan.workers, plan.assembler].map((worker) => ({
    ...worker,
    status: 'queued',
    sessionId: null,
    liveViewUrl: null,
    screenshotVersion: 0,
    screenshotPath: path.join(screenshotsDir, `${worker.id}.png`),
    lastScreenshotAt: null,
    error: null,
    agentStatus: agentsEnabled ? 'queued' : 'disabled',
    agentBackend,
    agentStep: 0,
    actionCount: 0,
    lastAction: null,
    finalText: '',
    partManifest: null,
    agentError: null,
    agentStartedAt: null,
    agentFinishedAt: null,
  }));

  const run = {
    id,
    prompt: plan.prompt,
    status: 'planning',
    dir,
    screenshotsDir,
    plan,
    freshProject: options.freshProject !== false,
    requestedAgentBackend,
    agentBackend,
    cleanup: options.cleanup || null,
    workers,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    timer: null,
  };

  fs.writeFileSync(path.join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  return run;
}

async function bootRun(run) {
  if (run.freshProject) {
    run.status = 'clearing-projects';
    touch(run);
    await stopPreviousRuns(run);
    run.cleanup = { status: 'background', scanned: 0, deleted: 0 };
    clearFactoryBrowsers({ before: run.createdAt })
      .then((cleanup) => {
        run.cleanup = cleanup;
        touch(run);
      })
      .catch((error) => {
        run.cleanup = { status: 'failed', scanned: 0, deleted: 0, error: error.message };
        touch(run);
      });
    touch(run);
  }

  run.status = 'creating-kernels';
  touch(run);

  await Promise.all(run.workers.map((worker) => bootWorker(run, worker)));

  run.status = run.agentBackend !== 'off' ? 'agents-running' : 'monitoring';
  touch(run);
  await captureRun(run);
  run.timer = setInterval(() => {
    captureRun(run).catch((error) => {
      run.error = error.message;
      touch(run);
    });
  }, refreshMs);

  if (run.agentBackend === 'off') {
    for (const worker of run.workers) worker.agentStatus = 'disabled';
    touch(run);
    return;
  }

  await runAgentOrchestration(run);
}

async function bootWorker(run, worker) {
  worker.status = 'creating-kernel';
  worker.agentStatus = run.agentBackend !== 'off' ? 'queued' : 'disabled';
  worker.agentBackend = run.agentBackend;
  touch(run);

  try {
    const browser = await createKernelBrowser();
    worker.sessionId = browser.session_id;
    worker.liveViewUrl = browser.browser_live_view_url;
    worker.status = 'loading-workbench';
    touch(run);

    const html = kernelWorkbenchHtml(run, worker);
    await kernelStdout([
      'browsers',
      'playwright',
      'execute',
      worker.sessionId,
      `await page.goto("about:blank", { waitUntil: "domcontentloaded" });
await page.setContent(${JSON.stringify(html)}, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#resetProject", { timeout: 10000 });
return await page.title();`,
    ]);

    worker.status = 'ready';
    worker.agentStatus =
      run.agentBackend !== 'off' ? (isDispatchAssemblyAgent(worker) ? 'waiting' : 'queued') : 'disabled';
    touch(run);
    await captureWorker(worker);
  } catch (error) {
    worker.status = 'failed';
    worker.agentStatus = 'failed';
    worker.error = error.message;
    worker.agentError = error.message;
    touch(run);
  }
}

async function captureRun(run) {
  const liveWorkers = run.workers.filter((worker) => worker.sessionId && worker.status !== 'failed');
  await Promise.allSettled(liveWorkers.map((worker) => captureWorker(worker)));
  touch(run);
}

async function captureWorker(worker) {
  if (worker.capturePromise) return worker.capturePromise;
  worker.capturePromise = captureWorkerNow(worker).finally(() => {
    worker.capturePromise = null;
  });
  return worker.capturePromise;
}

async function captureWorkerNow(worker) {
  const output = await kernelStdout([
    'browsers',
    'playwright',
    'execute',
    worker.sessionId,
    'return Buffer.from(await page.screenshot({ fullPage: false })).toString("base64");',
  ]);
  fs.writeFileSync(worker.screenshotPath, Buffer.from(extractCliResultString(output), 'base64'));
  worker.screenshotVersion += 1;
  worker.lastScreenshotAt = new Date().toISOString();
  return {
    filepath: worker.screenshotPath,
    size: readPngDimensions(worker.screenshotPath),
    dataUrl: `data:image/png;base64,${fs.readFileSync(worker.screenshotPath, 'base64')}`,
  };
}

async function stopRun(run) {
  if (run.status === 'stopped') return;

  if (run.timer) {
    clearInterval(run.timer);
    run.timer = null;
  }

  const sessionIds = run.workers.map((worker) => worker.sessionId).filter(Boolean);
  await Promise.allSettled(sessionIds.map((id) => kernelStdout(['browsers', 'delete', id, '--no-color'])));
  run.status = 'stopped';
  for (const worker of run.workers) {
    if (worker.status !== 'failed') worker.status = 'stopped';
    if (worker.agentStatus !== 'failed') worker.agentStatus = 'stopped';
  }
  touch(run);
}

async function stopAllRuns() {
  const activeRuns = [...runs.values()].filter((run) => !['stopped', 'failed'].includes(run.status));
  await Promise.allSettled(activeRuns.map((run) => stopRun(run)));
}

async function stopPreviousRuns(currentRun) {
  const activeRuns = [...runs.values()].filter(
    (run) => run !== currentRun && !['stopped', 'failed'].includes(run.status),
  );
  await Promise.allSettled(activeRuns.map((run) => stopRun(run)));
}

async function clearFactoryBrowsers({ before } = {}) {
  let browsers = [];
  try {
    browsers = JSON.parse(
      stripAnsi(await kernelStdout(['browsers', 'list', '-o', 'json', '--no-color'], { timeoutMs: 5000 })),
    );
  } catch (error) {
    return { status: 'failed', scanned: 0, deleted: 0, error: error.message };
  }

  const beforeTime = before ? Date.parse(before) : Number.POSITIVE_INFINITY;
  let deleted = 0;
  const candidates = browsers
    .filter((browser) => browser.session_id)
    .filter((browser) => !Number.isFinite(beforeTime) || Date.parse(browser.created_at) < beforeTime)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 24);

  for (const browser of candidates) {
    try {
      const title = extractCliResultString(
        await kernelStdout([
          'browsers',
          'playwright',
          'execute',
          browser.session_id,
          'return await page.title();',
        ], { timeoutMs: 3000 }),
      );
      if (String(title).includes('CAD Agent Factory')) {
        await kernelStdout(['browsers', 'delete', browser.session_id, '--no-color'], { timeoutMs: 5000 });
        deleted += 1;
      }
    } catch {
      // Ignore stale or unrelated sessions. Fresh runs only need best-effort cleanup.
    }
  }
  return { status: 'complete', scanned: candidates.length, deleted };
}

function failRun(run, error) {
  if (run.timer) clearInterval(run.timer);
  run.status = 'failed';
  run.error = error.message;
  for (const worker of run.workers) {
    if (!['complete', 'failed'].includes(worker.agentStatus)) {
      worker.agentStatus = 'failed';
      worker.agentError = error.message;
    }
  }
  touch(run);
}

async function runAgentOrchestration(run) {
  const partWorkers = run.workers.filter((worker) => isCadAgentInstance(worker) && worker.status !== 'failed');
  const assembler = run.workers.find((worker) => isDispatchAssemblyAgent(worker));
  const runAgent =
    run.agentBackend === 'northstar'
      ? (worker) => runNorthstarAgent(run, worker, isDispatchAssemblyAgent(worker) ? northstarAssemblerMaxSteps : northstarWorkerMaxSteps)
      : (worker) => runCodexAgent(run, worker);

  await Promise.allSettled(partWorkers.map((worker) => runAgent(worker)));

  if (run.status === 'stopped') return;

  if (assembler && assembler.status !== 'failed') {
    run.status = 'assembling';
    assembler.agentStatus = 'queued';
    touch(run);
    await runAgent(assembler);
  }

  if (run.status !== 'stopped' && run.status !== 'failed') {
    run.status = 'complete';
    touch(run);
  }
}

async function runCodexAgent(run, worker) {
  worker.agentStatus = 'thinking';
  worker.agentStartedAt = new Date().toISOString();
  worker.agentError = null;
  worker.finalText = '';
  worker.agentStep = 1;
  touch(run);

  try {
    await captureWorker(worker);
    await clickWorkbenchElement(run, worker, '#resetProject', 'Reset Project');
    await captureWorker(worker);

    if (isDispatchAssemblyAgent(worker)) {
      await syncAssemblyInputs(run, worker);
    }

    const actions = isDispatchAssemblyAgent(worker) ? codexAssemblyActions(run) : codexPartActions(worker);
    let step = 2;
    for (const action of actions) {
      if (run.status === 'stopped') {
        worker.agentStatus = 'stopped';
        return;
      }

      worker.agentStatus = 'acting';
      worker.agentStep = step;
      touch(run);

      const selector = action.part
        ? `button[data-part="${cssEscape(action.part)}"]`
        : `button[data-shape="${cssEscape(action.shape)}"]`;
      await clickWorkbenchElement(run, worker, selector, `select ${action.part || action.shape}`);
      await clickWorkbenchPoint(run, worker, action.x, action.y, action.label);
      await captureWorker(worker);
      step += 1;
    }

    worker.agentStatus = 'complete';
    worker.partManifest = isDispatchAssemblyAgent(worker)
      ? buildAssemblyManifest(run, worker, actions)
      : buildPartManifest(worker, actions);
    worker.finalText = isDispatchAssemblyAgent(worker)
      ? `Codex backend complete: imported ${worker.partManifest.sources.length} CAD Agent manifests and assembled ${worker.partManifest.placements.length} source primitives.`
      : `Codex backend complete: exported ${worker.partManifest.id} with ${actions.length} placement${actions.length === 1 ? '' : 's'}.`;
  } catch (error) {
    worker.agentStatus = 'failed';
    worker.agentError = error.message;
    worker.error ||= error.message;
  } finally {
    worker.agentFinishedAt = new Date().toISOString();
    touch(run);
  }
}

function codexPartActions(worker) {
  const plans = {
    body: [
      { shape: 'box', x: 0.5, y: 0.55, label: 'green rounded torso block' },
    ],
    head: [
      { shape: 'box', x: 0.5, y: 0.42, label: 'purple head block' },
      { shape: 'sphere', x: 0.44, y: 0.39, label: 'left head sensor' },
      { shape: 'sphere', x: 0.56, y: 0.39, label: 'right head sensor' },
    ],
    arms: [
      { shape: 'cylinder', x: 0.35, y: 0.52, label: 'left orange arm' },
      { shape: 'cylinder', x: 0.65, y: 0.52, label: 'right orange arm' },
    ],
    feet: [
      { shape: 'cylinder', x: 0.42, y: 0.68, label: 'left blue wheel foot' },
      { shape: 'cylinder', x: 0.58, y: 0.68, label: 'right blue wheel foot' },
    ],
    details: [
      { shape: 'box', x: 0.5, y: 0.54, label: 'small chest screen' },
      { shape: 'sphere', x: 0.45, y: 0.47, label: 'left button' },
      { shape: 'sphere', x: 0.55, y: 0.47, label: 'right button' },
    ],
    wings: [
      { shape: 'cone', x: 0.35, y: 0.52, label: 'left wing' },
      { shape: 'cone', x: 0.65, y: 0.52, label: 'right wing' },
    ],
  };
  return plans[worker.id] || [{ shape: 'box', x: 0.5, y: 0.5, label: worker.assignment || worker.id }];
}

function buildPartManifest(worker, actions) {
  return {
    id: `part-manifest-${worker.id}`,
    sourceWorkerId: worker.id,
    sourceWorkerTitle: worker.title,
    template: worker.template,
    part: worker.id,
    assignment: worker.assignment,
    color: worker.color,
    contract: worker.contract,
    placements: actions.map((action, index) => ({
      id: `${worker.id}-${index + 1}`,
      primitive: action.shape,
      label: action.label,
      color: action.color || worker.color,
      x: action.x,
      y: action.y,
    })),
    exportedAt: new Date().toISOString(),
  };
}

function buildAssemblyManifest(run, worker, actions) {
  const sources = run.workers.filter((item) => isCadAgentInstance(item)).map((item) => item.partManifest).filter(Boolean);
  const placements = actions.flatMap((action, actionIndex) => {
    const source = sources.find((item) => item.id === action.sourceManifestId);
    if (!source?.placements?.length) {
      return [
        {
          id: `assembly-${actionIndex + 1}`,
          importedFrom: action.sourceManifestId,
          sourceWorkerId: action.sourceWorkerId,
          part: action.part,
          primitive: action.part,
          label: action.label,
          color: source?.color || action.color,
          x: action.x,
          y: action.y,
        },
      ];
    }

    return transformSourcePlacements(source, action).map((placement, placementIndex) => ({
      id: `assembly-${actionIndex + 1}-${placementIndex + 1}`,
      importedFrom: action.sourceManifestId,
      sourceWorkerId: action.sourceWorkerId,
      sourcePlacementId: placement.sourcePlacementId,
      part: action.part,
      primitive: placement.primitive,
      label: placement.label,
      color: placement.color,
      x: placement.x,
      y: placement.y,
    }));
  });

  return {
    id: `assembly-manifest-${run.id}`,
    sourceWorkerId: worker.id,
    sourceWorkerTitle: worker.title,
    template: worker.template,
    part: 'final assembly',
    assignment: worker.assignment,
    sources: sources.map((source) => ({
      id: source.id,
      sourceWorkerId: source.sourceWorkerId,
      sourceWorkerTitle: source.sourceWorkerTitle,
      part: source.part,
      placementCount: source.placements.length,
    })),
    placements,
    exportedAt: new Date().toISOString(),
  };
}

function codexAssemblyActions(run) {
  const manifests = run.workers.filter((worker) => isCadAgentInstance(worker)).map((worker) => worker.partManifest).filter(Boolean);
  const sourcePlans = manifests.length
    ? manifests
    : run.plan.workers.map((worker) => ({
        id: `planned-${worker.id}`,
        sourceWorkerId: worker.id,
        sourceWorkerTitle: worker.title,
        part: worker.id,
      }));

  return sourcePlans.map((source) => {
    const anchor = assemblyAnchorForPart(source.part);
    return {
      part: source.part,
      x: anchor.x,
      y: anchor.y,
      label: `import ${source.part} geometry`,
      sourceManifestId: source.id,
      sourceWorkerId: source.sourceWorkerId,
      sourceWorkerTitle: source.sourceWorkerTitle,
    };
  });
}

function assemblyAnchorForPart(part) {
  const anchors = {
    body: { x: 0.5, y: 0.56 },
    head: { x: 0.5, y: 0.4 },
    arms: { x: 0.5, y: 0.55 },
    feet: { x: 0.5, y: 0.68 },
    details: { x: 0.5, y: 0.56 },
    wings: { x: 0.5, y: 0.5 },
  };
  return anchors[part] || { x: 0.5, y: 0.5 };
}

function transformSourcePlacements(source, action, scale = 0.62) {
  const bounds = placementBounds(source.placements);
  return source.placements.map((placement) => ({
    sourcePlacementId: placement.id,
    primitive: placement.primitive,
    label: placement.label,
    color: placement.color || source.color,
    x: roundRatio(action.x + (placement.x - bounds.centerX) * scale),
    y: roundRatio(action.y + (placement.y - bounds.centerY) * scale),
  }));
}

function placementBounds(placements) {
  const xs = placements.map((placement) => Number(placement.x)).filter(Number.isFinite);
  const ys = placements.map((placement) => Number(placement.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return { centerX: 0.5, centerY: 0.5 };
  return {
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000;
}

async function syncAssemblyInputs(run, worker) {
  const manifests = run.workers.filter((item) => isCadAgentInstance(item)).map((item) => item.partManifest).filter(Boolean);
  await playwrightExecute(
    worker.sessionId,
    `await page.evaluate((manifests) => {
  window.importedManifests = manifests;
  const imported = document.querySelector("#importedOutputs");
  if (imported) imported.textContent = JSON.stringify(manifests, null, 2);
  const log = document.querySelector("#log");
  if (log) {
    log.textContent = "Project reset. Scene is empty.\\nImported " + manifests.length + " CAD Agent output manifests.";
  }
}, ${JSON.stringify(manifests)});`,
  );
  recordCodexAction(run, worker, `codex imported ${manifests.length} CAD Agent manifests`);
}

async function clickWorkbenchElement(run, worker, selector, label) {
  const point = await playwrightResult(
    worker.sessionId,
    `const point = await page.evaluate((selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error("Missing element: " + selector);
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}, ${JSON.stringify(selector)});
const { x, y } = point;
await page.mouse.click(x, y);
return { x, y };`,
  );
  recordCodexAction(run, worker, `codex click ${label} at (${point.x}, ${point.y})`);
  await wait(250);
}

async function clickWorkbenchPoint(run, worker, xRatio, yRatio, label) {
  const point = await playwrightResult(
    worker.sessionId,
    `const point = await page.evaluate(({ xRatio, yRatio }) => {
  const workspace = document.querySelector("#workspace");
  if (!workspace) throw new Error("Missing workspace");
  const rect = workspace.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width * xRatio),
    y: Math.round(rect.top + rect.height * yRatio),
  };
}, { xRatio: ${Number(xRatio)}, yRatio: ${Number(yRatio)} });
const { x, y } = point;
await page.mouse.click(x, y);
return { x, y };`,
  );
  recordCodexAction(run, worker, `codex place ${label} at (${point.x}, ${point.y})`);
  await wait(350);
}

function recordCodexAction(run, worker, text) {
  worker.actionCount += 1;
  worker.lastAction = text;
  touch(run);
}

async function playwrightResult(sessionId, code) {
  return extractCliResultString(
    await kernelStdout(['browsers', 'playwright', 'execute', sessionId, code]),
  );
}

function cssEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runNorthstarAgent(run, worker, maxSteps) {
  worker.agentStatus = 'thinking';
  worker.agentStartedAt = new Date().toISOString();
  worker.agentError = null;
  worker.finalText = '';
  touch(run);

  let previousResponseId = null;
  let lastComputerCall = null;
  let lastSize = { width: 1280, height: 800 };

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      if (run.status === 'stopped') {
        worker.agentStatus = 'stopped';
        return;
      }

      worker.agentStatus = 'thinking';
      worker.agentStep = step;
      touch(run);

      const screenshot = await captureWorker(worker);
      lastSize = screenshot.size;
      const input =
        step === 1
          ? [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: buildAgentPrompt(run, worker),
                  },
                  {
                    type: 'input_image',
                    image_url: screenshot.dataUrl,
                    detail: 'auto',
                  },
                ],
              },
            ]
          : [
              {
                type: 'computer_call_output',
                call_id: lastComputerCall.call_id,
                output: {
                  type: 'input_image',
                  image_url: screenshot.dataUrl,
                  detail: 'auto',
                },
                acknowledged_safety_checks: lastComputerCall.pending_safety_checks || [],
              },
            ];

      const response = await northstarClient.responses.create({
        model: northstarModel,
        input,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        tools: [
          {
            type: 'computer_use',
            environment: 'browser',
            display_width: lastSize.width,
            display_height: lastSize.height,
          },
        ],
        truncation: 'auto',
        max_output_tokens: 512,
      });

      if (run.status === 'stopped') {
        worker.agentStatus = 'stopped';
        return;
      }

      previousResponseId = response.id;
      const text = extractText(response);
      if (text) worker.finalText = text;

      if (isDoneText(text)) {
        worker.agentStatus = 'complete';
        break;
      }

      const computerCall = response.output?.find((item) => item.type === 'computer_call');
      if (!computerCall) {
        worker.finalText ||= text || 'Northstar finished without another computer action.';
        worker.agentStatus = 'complete';
        break;
      }

      if (isTerminalAction(computerCall.action)) {
        worker.finalText ||= computerCall.action.result || computerCall.action.text || 'Northstar marked this worker complete.';
        worker.agentStatus = 'complete';
        break;
      }

      lastComputerCall = computerCall;
      worker.agentStatus = 'acting';
      worker.actionCount += 1;
      worker.lastAction = formatAction(computerCall.action);
      touch(run);

      await executeKernelAction(worker.sessionId, computerCall.action, lastSize);
      await captureWorker(worker);
    }

    if (!['complete', 'stopped', 'failed'].includes(worker.agentStatus)) {
      worker.agentStatus = 'complete';
      worker.finalText ||= `Reached demo step limit (${maxSteps}).`;
    }
  } catch (error) {
    worker.agentStatus = 'failed';
    worker.agentError = error.message;
    worker.error ||= error.message;
  } finally {
    worker.agentFinishedAt = new Date().toISOString();
    touch(run);
  }
}

function buildAgentPrompt(run, worker) {
  if (isDispatchAssemblyAgent(worker)) {
    return `${worker.prompt}

You are the Dispatch & Assembly Agent. You receive manifests from copied CAD Agent instances, then assemble their outputs in this Kernel.
The CAD Agent instance contracts are:
${JSON.stringify(run.plan.workers.map((item) => item.contract), null, 2)}

Use the visible MiniCAD UI directly:
1. Click Reset Project once before doing anything else, even if the project appears empty.
2. Click one tile in the Assembly Parts palette.
3. Click the workplane where that robot part should go.
4. Repeat for body, head, arms, feet, and details.

Do not ask the main agent for coordinates. Do not rely on hidden scripts. Use one computer action at a time. When the final robot is represented, answer with a short sentence containing the word "complete".`;
  }

  return `${worker.prompt}

You are one copied instance of the same CAD Agent template. The Dispatch & Assembly Agent gave this instance a part-specific prompt.
You control the visible MiniCAD webpage in this Kernel browser.

Use the visible UI directly:
1. Click Reset Project once before doing anything else, even if the project appears empty.
2. Click a primitive in the Basic Shapes palette.
3. Click the workplane where the primitive should be placed.
4. Repeat until your assigned part is represented.

Do not ask the main agent for coordinates. Do not rely on hidden scripts. Use one computer action at a time. When your part is complete, answer with a short sentence containing the word "complete".`;
}

async function executeKernelAction(sessionId, action, screenshotSize) {
  switch (action.type) {
    case 'click':
      {
        const [x, y] = toPixels(action.x, action.y, screenshotSize);
        await playwrightExecute(sessionId, `await page.mouse.click(${x}, ${y}, { button: ${JSON.stringify(action.button || 'left')} });`);
      }
      break;
    case 'double_click':
      {
        const [x, y] = toPixels(action.x, action.y, screenshotSize);
        await playwrightExecute(sessionId, `await page.mouse.dblclick(${x}, ${y});`);
      }
      break;
    case 'drag':
      {
        const rawPath =
          action.path ||
          (Number.isFinite(action.x) && Number.isFinite(action.y) && Number.isFinite(action.end_x) && Number.isFinite(action.end_y)
            ? [
                { x: action.x, y: action.y },
                { x: action.end_x, y: action.end_y },
              ]
            : []);
        const pathPoints = rawPath.map((point) => toPixels(point.x, point.y, screenshotSize));
        if (pathPoints.length < 2) throw new Error(`Drag action missing path: ${JSON.stringify(action)}`);
        const code = [
          `await page.mouse.move(${pathPoints[0][0]}, ${pathPoints[0][1]});`,
          'await page.mouse.down();',
          ...pathPoints.slice(1).map(([x, y]) => `await page.mouse.move(${x}, ${y}, { steps: 8 });`),
          'await page.mouse.up();',
        ].join('\n');
        await playwrightExecute(sessionId, code);
      }
      break;
    case 'move':
      {
        const [x, y] = toPixels(action.x, action.y, screenshotSize);
        await playwrightExecute(sessionId, `await page.mouse.move(${x}, ${y});`);
      }
      break;
    case 'point_and_type':
      {
        const [x, y] = toPixels(action.x, action.y, screenshotSize);
        await playwrightExecute(sessionId, `await page.mouse.click(${x}, ${y}); await page.keyboard.type(${JSON.stringify(action.text || '')});`);
      }
      break;
    case 'type':
      await playwrightExecute(sessionId, `await page.keyboard.type(${JSON.stringify(action.text || '')});`);
      break;
    case 'key':
    case 'keypress':
      {
        const keys = (action.keys || []).map(normalizeKey);
        if (keys.length > 1) {
          await playwrightExecute(sessionId, `await page.keyboard.press(${JSON.stringify(keys.join('+'))});`);
        } else {
          for (const key of keys) await playwrightExecute(sessionId, `await page.keyboard.press(${JSON.stringify(key)});`);
        }
      }
      break;
    case 'navigate':
      if (!action.url) throw new Error(`Navigate action missing url: ${JSON.stringify(action)}`);
      await playwrightExecute(sessionId, `await page.goto(${JSON.stringify(action.url)}, { waitUntil: "domcontentloaded" });`);
      break;
    case 'scroll':
      {
        const [x, y] = toPixels(action.x || 500, action.y || 500, screenshotSize);
        const scrollX = Math.round(((action.scroll_x || 0) / 1000) * screenshotSize.width);
        const scrollY = Math.round(((action.scroll_y || 0) / 1000) * screenshotSize.height);
        await playwrightExecute(sessionId, `await page.mouse.move(${x}, ${y}); await page.mouse.wheel(${scrollX}, ${scrollY});`);
      }
      break;
    case 'wait':
      await wait(1000);
      break;
    case 'screenshot':
      break;
    default:
      throw new Error(`Unsupported Northstar action: ${JSON.stringify(action)}`);
  }

  await wait(700);
}

async function playwrightExecute(sessionId, code) {
  await kernelStdout(['browsers', 'playwright', 'execute', sessionId, code]);
}

async function createKernelBrowser() {
  const stdout = await kernelStdout([
    'browsers',
    'create',
    '-o',
    'json',
    '--no-color',
    '--viewport',
    viewport,
    '--timeout',
    '900',
  ]);
  return JSON.parse(stripAnsi(stdout));
}

async function kernelStdout(args, options = {}) {
  const { stdout } = await execFileAsync('kernel', args, {
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeoutMs || 0,
  });
  const output = stdout.trim();
  const plain = stripAnsi(output);
  if (/Success\s*\|\s*false/.test(plain)) {
    const stderr = plain.match(/stderr:\s*\n([\s\S]*)$/)?.[1]?.trim();
    throw new Error(stderr || plain.slice(0, 700));
  }
  return output;
}

function makePlan(rawPrompt) {
  const prompt = rawPrompt.trim() || 'Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.';
  const lower = prompt.toLowerCase();
  const workers = [];

  add(workers, {
    id: 'body',
    title: 'CAD Agent Instance 01',
    role: 'cad-agent',
    template: 'CAD Agent',
    assignment: 'body',
    color: '#2f9e59',
    prompt: `Build only the core body/torso for this object: "${prompt}". Return dimensions, color, and anchor points.`,
    contract: { part: 'body', anchor: 'center', output: 'body geometry and anchors' },
  });

  if (mentions(lower, ['robot', 'head', 'face', 'eyes', 'antenna'])) {
    add(workers, {
      id: 'head',
      title: `CAD Agent Instance ${String(workers.length + 1).padStart(2, '0')}`,
      role: 'cad-agent',
      template: 'CAD Agent',
      assignment: 'head',
      color: '#6842b9',
      prompt: `Build only the head/face module for this object: "${prompt}". Include visible face details if requested.`,
      contract: { part: 'head', anchor: 'top of body', output: 'head geometry and anchors' },
    });
  }

  if (mentions(lower, ['arm', 'arms', 'hand', 'hands', 'claw', 'claws'])) {
    add(workers, {
      id: 'arms',
      title: `CAD Agent Instance ${String(workers.length + 1).padStart(2, '0')}`,
      role: 'cad-agent',
      template: 'CAD Agent',
      assignment: 'arms',
      color: '#ed7a22',
      prompt: `Build only the left and right arm modules for this object: "${prompt}". Keep symmetry and connector anchors.`,
      contract: { part: 'arms', anchor: 'left and right body sides', output: 'arm geometry and anchors' },
    });
  }

  if (mentions(lower, ['foot', 'feet', 'leg', 'legs', 'wheel', 'wheels', 'base'])) {
    add(workers, {
      id: 'feet',
      title: `CAD Agent Instance ${String(workers.length + 1).padStart(2, '0')}`,
      role: 'cad-agent',
      template: 'CAD Agent',
      assignment: 'feet',
      color: '#1664c0',
      prompt: `Build only the feet/base/wheels for this object: "${prompt}". Return bottom anchors for assembly.`,
      contract: { part: 'feet', anchor: 'bottom of body', output: 'feet geometry and anchors' },
    });
  }

  if (mentions(lower, ['wing', 'wings', 'fin', 'fins'])) {
    add(workers, {
      id: 'wings',
      title: `CAD Agent Instance ${String(workers.length + 1).padStart(2, '0')}`,
      role: 'cad-agent',
      template: 'CAD Agent',
      assignment: 'wings',
      color: '#38b6d8',
      prompt: `Build only the wing/fin modules for this object: "${prompt}". Return left/right anchors.`,
      contract: { part: 'wings', anchor: 'side of body', output: 'wing geometry and anchors' },
    });
  }

  if (mentions(lower, ['screen', 'button', 'panel', 'antenna', 'hat', 'sensor', 'accessory'])) {
    add(workers, {
      id: 'details',
      title: `CAD Agent Instance ${String(workers.length + 1).padStart(2, '0')}`,
      role: 'cad-agent',
      template: 'CAD Agent',
      assignment: 'details',
      color: '#e7b32b',
      prompt: `Build only the decorative/details module for this object: "${prompt}". Focus on screens, buttons, antennas, sensors, or accessories.`,
      contract: { part: 'details', anchor: 'front/top detail anchors', output: 'detail geometry and anchors' },
    });
  }

  while (workers.length < 4) {
    const id = ['head', 'arms', 'feet', 'details'].find((candidate) => !workers.some((worker) => worker.id === candidate));
    const fallback = fallbackWorker(id, prompt, workers.length + 1);
    add(workers, fallback);
  }

  return {
    prompt,
    strategy: 'agent-factory-one-cad-agent-template-many-prompted-instances',
    factory: {
      dispatcher: 'Dispatch & Assembly Agent',
      workerTemplate: 'CAD Agent',
    },
    workers,
    assembler: {
      id: 'dispatch-assembly',
      title: 'Dispatch & Assembly Agent',
      role: 'dispatch-assembly-agent',
      template: 'Dispatch & Assembly Agent',
      assignment: 'dispatch and final assembly',
      color: '#182330',
      prompt: `Dispatch this request into part-specific prompts for copied CAD Agent instances, then assemble the final model for: "${prompt}". Use worker contracts, align anchors, inspect screenshots, and produce the final combined design.`,
      contract: { part: 'final assembly', anchor: 'scene', output: 'assembled model and QA screenshot' },
    },
  };
}

function add(workers, worker) {
  if (!workers.some((item) => item.id === worker.id)) workers.push(worker);
}

function fallbackWorker(id, prompt, instanceNumber) {
  const specs = {
    head: ['#6842b9', 'Build the top/head or front-facing identity module.'],
    arms: ['#ed7a22', 'Build side attachments or manipulator modules.'],
    feet: ['#1664c0', 'Build the bottom supports, base, wheels, or legs.'],
    details: ['#e7b32b', 'Build decorative details, controls, lights, panels, or sensors.'],
  };
  const [color, instruction] = specs[id];
  return {
    id,
    title: `CAD Agent Instance ${String(instanceNumber).padStart(2, '0')}`,
    role: 'cad-agent',
    template: 'CAD Agent',
    assignment: id,
    color,
    prompt: `${instruction} User request: "${prompt}". Return geometry, dimensions, and anchor metadata.`,
    contract: { part: id, anchor: 'auto', output: `${id} geometry and anchors` },
  };
}

function mentions(text, words) {
  return words.some((word) => text.includes(word));
}

function isCadAgentInstance(worker) {
  return worker.role === 'cad-agent';
}

function isDispatchAssemblyAgent(worker) {
  return worker.role === 'dispatch-assembly-agent';
}

function kernelWorkbenchHtml(run, worker) {
  const isAssembler = isDispatchAssemblyAgent(worker);
  const contracts = run.plan.workers.map((item) => item.contract);
  const palette = isAssembler ? assemblyPaletteHtml(run) : primitivePaletteHtml(worker);
  const selectedDefault = isAssembler ? 'body' : 'box';
  const emptyLog = isAssembler ? 'No assembly parts placed yet.' : 'No shapes placed yet.';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(worker.title)} - CAD Agent Factory</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; min-height: 100vh; overflow: hidden; }
    header { height: 78px; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; background: #fff; border-bottom: 1px solid #d8e1ea; }
    h1 { margin: 0; font-size: 22px; line-height: 1.15; }
    p { margin: 0; }
    .sub { margin-top: 5px; color: #607080; font-size: 14px; }
    .badge { min-width: 118px; text-align: center; padding: 8px 10px; border-radius: 999px; color: #0f4a27; background: #dbf6e5; font-weight: 800; }
    .clock { color: #344455; font-size: 13px; font-weight: 800; text-align: right; }
    .clock strong { display: block; color: #182330; font-size: 17px; }
    .workspace { position: absolute; left: 24px; top: 102px; right: 390px; bottom: 24px; overflow: hidden; border: 1px solid #b9d8e7; border-radius: 8px; background: #eef9fc; cursor: crosshair; }
    .grid { position: absolute; inset: 0; background: linear-gradient(#c9e8f4 1px, transparent 1px), linear-gradient(90deg, #c9e8f4 1px, transparent 1px); background-size: 24px 24px; transform: skewX(-14deg) scaleY(.84); transform-origin: center bottom; pointer-events: none; }
    .label { position: absolute; left: 28px; bottom: 20px; color: rgba(24, 91, 129, .28); font-size: 42px; font-weight: 900; font-style: italic; pointer-events: none; }
    .ghost { position: absolute; left: 50%; top: 44%; width: ${isAssembler ? '280px' : '180px'}; height: ${isAssembler ? '260px' : '160px'}; transform: translate(-50%, -50%); border: 3px dashed rgba(22,100,192,.26); border-radius: 12px; display: grid; place-items: center; color: rgba(22,100,192,.58); text-align: center; font-weight: 900; padding: 18px; }
    .ghost, .activity { pointer-events: none; }
    .workspace.has-parts .ghost { display: none; }
    .activity { position: absolute; left: 28px; right: 28px; top: 24px; min-height: 64px; border: 1px solid rgba(22,100,192,.2); border-radius: 8px; background: rgba(255,255,255,.78); overflow: hidden; }
    .activity::before { content: ""; position: absolute; left: -28%; top: 0; width: 28%; height: 100%; background: linear-gradient(90deg, transparent, rgba(22,100,192,.24), transparent); animation: sweep 2.8s linear infinite; }
    .activity-row { position: relative; z-index: 1; display: flex; height: 64px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; font-weight: 850; }
    .phase { color: #0b5cad; }
    .tick { color: #607080; font-size: 13px; }
    aside { position: absolute; right: 0; top: 78px; bottom: 0; width: 366px; padding: 18px; overflow: auto; background: #fff; border-left: 1px solid #d8e1ea; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    .tool-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; }
    .tool-grid.assembly { grid-template-columns: repeat(3, 1fr); }
    button.tool { min-height: 92px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; display: grid; place-items: center; gap: 6px; cursor: pointer; font: inherit; color: #182330; font-weight: 800; }
    button.tool.selected { outline: 4px solid rgba(22,100,192,.28); border-color: #1664c0; }
    .thumb { position: relative; pointer-events: none; display: block; }
    .thumb.box { width: 56px; height: 48px; border-radius: 8px; background: ${worker.color}; box-shadow: inset -10px -12px rgba(0,0,0,.12); }
    .thumb.cylinder { width: 56px; height: 48px; border-radius: 50% / 18%; background: ${worker.color}; box-shadow: inset -10px -14px rgba(0,0,0,.14); }
    .thumb.sphere { width: 50px; height: 50px; border-radius: 50%; background: radial-gradient(circle at 30% 26%, #fff 0 6%, ${worker.color} 26%, #0b5cad 100%); }
    .thumb.cone { width: 0; height: 0; border-left: 30px solid transparent; border-right: 30px solid transparent; border-bottom: 58px solid ${worker.color}; filter: drop-shadow(8px 9px 0 rgba(0,0,0,.12)); }
    .thumb.body { width: 46px; height: 38px; border-radius: 7px; background: #2f9e59; }
    .thumb.head { width: 44px; height: 33px; border-radius: 7px; background: #6842b9; }
    .thumb.arm { width: 54px; height: 14px; border-radius: 999px; background: #ed7a22; }
    .thumb.foot { width: 42px; height: 23px; border-radius: 50%; background: #1664c0; }
    .thumb.detail { width: 40px; height: 26px; border-radius: 6px; background: #e7b32b; }
    .placed { --part-color: ${worker.color}; --part-dark: #255fae; position: absolute; z-index: 4; display: grid; place-items: center; color: transparent; font-size: 11px; font-weight: 800; box-shadow: 0 18px 28px rgba(21,38,55,.18); }
    .placed.box { width: 92px; height: 74px; border-radius: 12px; background: var(--part-color); box-shadow: inset -12px -14px rgba(0,0,0,.1), 0 18px 28px rgba(21,38,55,.18); }
    .placed.cylinder { width: 86px; height: 74px; border-radius: 50% / 18%; background: var(--part-color); box-shadow: inset -10px -14px rgba(0,0,0,.12), 0 18px 28px rgba(21,38,55,.18); }
    .placed.sphere { width: 70px; height: 70px; border-radius: 50%; background: radial-gradient(circle at 30% 24%, #fff 0 7%, var(--part-color) 30%, var(--part-dark) 100%); }
    .placed.cone { width: 0; height: 0; border-left: 40px solid transparent; border-right: 40px solid transparent; border-bottom: 78px solid var(--part-color); filter: drop-shadow(0 16px 14px rgba(21,38,55,.2)); }
    .placed.body { width: 112px; height: 92px; border-radius: 18px; background: linear-gradient(145deg, #38b76a, #22814d); box-shadow: inset -12px -16px rgba(0,0,0,.12), 0 18px 28px rgba(21,38,55,.18); }
    .placed.head { width: 86px; height: 72px; border-radius: 22px 22px 18px 18px; background: linear-gradient(145deg, #7b52d1, #5632a7); box-shadow: inset -10px -12px rgba(0,0,0,.14), 0 18px 28px rgba(21,38,55,.18); }
    .placed.head::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #f6fbff; box-shadow: 30px 0 #f6fbff; transform: translateX(-15px); }
    .placed.arm { width: 96px; height: 24px; border-radius: 999px; background: linear-gradient(145deg, #ff8f2d, #d96512); box-shadow: inset -8px -8px rgba(0,0,0,.12), 0 14px 22px rgba(21,38,55,.16); }
    .placed.foot { width: 78px; height: 36px; border-radius: 999px; background: radial-gradient(circle at 30% 30%, #2e83e6 0 18%, #1664c0 46%, #0d4387 100%); box-shadow: inset -8px -8px rgba(0,0,0,.14), 0 14px 22px rgba(21,38,55,.16); }
    .placed.detail { width: 62px; height: 38px; border-radius: 9px; background: linear-gradient(145deg, #ffd34f, #d9a90d); box-shadow: inset -7px -8px rgba(0,0,0,.12), 0 14px 20px rgba(21,38,55,.14); }
    .placed.detail::before { content: ""; width: 36px; height: 16px; border-radius: 4px; background: #18324f; box-shadow: inset 0 0 0 2px rgba(255,255,255,.18); }
    .placed.source-body.box { width: 112px; height: 92px; border-radius: 18px; background: linear-gradient(145deg, var(--part-color), var(--part-dark)); }
    .placed.source-head.box { width: 86px; height: 72px; border-radius: 22px 22px 18px 18px; background: linear-gradient(145deg, var(--part-color), var(--part-dark)); }
    .placed.source-head.box::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #f6fbff; box-shadow: 30px 0 #f6fbff; transform: translateX(-15px); }
    .placed.source-head.sphere { width: 26px; height: 26px; background: radial-gradient(circle at 30% 24%, #fff 0 10%, var(--part-color) 34%, var(--part-dark) 100%); }
    .placed.source-arms.cylinder { width: 96px; height: 24px; border-radius: 999px; background: linear-gradient(145deg, var(--part-color), var(--part-dark)); }
    .placed.source-feet.cylinder { width: 78px; height: 36px; border-radius: 999px; background: radial-gradient(circle at 30% 30%, #2e83e6 0 18%, var(--part-color) 46%, var(--part-dark) 100%); }
    .placed.source-details.box { width: 62px; height: 38px; border-radius: 9px; background: linear-gradient(145deg, var(--part-color), var(--part-dark)); }
    .placed.source-details.box::before { content: ""; width: 36px; height: 16px; border-radius: 4px; background: #18324f; box-shadow: inset 0 0 0 2px rgba(255,255,255,.18); }
    .placed.source-details.sphere { width: 24px; height: 24px; background: radial-gradient(circle at 30% 24%, #fff 0 10%, var(--part-color) 38%, var(--part-dark) 100%); }
    .instructions { margin: 12px 0; padding: 10px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; color: #435466; line-height: 1.45; font-size: 13px; }
    .reset-project { width: 100%; margin: 0 0 12px; min-height: 42px; border: 1px solid #cfdae5; border-radius: 8px; background: #edf3f8; color: #223244; font: inherit; font-weight: 900; cursor: pointer; }
    .log { margin-bottom: 12px; padding: 10px; border: 1px solid #d8e1ea; border-radius: 8px; background: #101820; color: #dff7ec; min-height: 76px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; }
    .prompt, pre, .contract { border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; padding: 12px; line-height: 1.45; }
    .prompt { color: #344455; font-size: 14px; }
    .contract { margin-top: 12px; }
    .contract strong { display: block; margin-bottom: 5px; }
    pre { max-height: 260px; overflow: auto; background: #101820; color: #dff7ec; font-size: 12px; white-space: pre-wrap; }
    .heartbeat { display: inline-block; width: 10px; height: 10px; margin-right: 7px; border-radius: 50%; background: ${worker.color}; animation: pulse 1.4s infinite ease-in-out; }
    @keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.12); } }
    @keyframes sweep { to { left: 100%; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(worker.title)}</h1>
      <p class="sub">${escapeHtml(isAssembler ? 'Dispatch, routing, and final assembly' : 'Copied CAD Agent template instance')} · run ${escapeHtml(run.id)}</p>
    </div>
    <div class="clock">live clock<strong id="clock">--:--:--</strong></div>
    <div class="badge"><span class="heartbeat"></span>Kernel ready</div>
  </header>
  <main>
    <section id="workspace" class="workspace" aria-label="CAD workplane">
      <div class="grid"></div>
      <div class="activity">
        <div class="activity-row">
          <span id="phase" class="phase">observing screen</span>
          <span id="tick" class="tick">tick 0</span>
        </div>
      </div>
      <div class="ghost">${escapeHtml(isAssembler ? 'Assembly workplane waiting for imported worker manifests' : `${worker.id} workplane waiting for CAD Agent actions`)}</div>
      <div class="label">${escapeHtml(isAssembler ? 'Assembler' : worker.id)}</div>
    </section>
    <aside>
      ${palette}
      <button id="resetProject" class="reset-project" type="button">Reset Project</button>
      <div class="instructions">${escapeHtml(isAssembler ? 'Click a robot part, then click the workplane to place it.' : 'Click a primitive, then click the workplane to place it.')}</div>
      <div id="log" class="log">${escapeHtml(emptyLog)}</div>
      <h2>Assigned prompt</h2>
      <p class="prompt">${escapeHtml(worker.prompt)}</p>
      <div class="contract">
        <strong>Output contract</strong>
        <pre>${escapeHtml(JSON.stringify(worker.contract, null, 2))}</pre>
      </div>
      ${isAssembler ? `<div class="contract"><strong>CAD Agent contracts</strong><pre>${escapeHtml(JSON.stringify(contracts, null, 2))}</pre></div>` : ''}
      ${isAssembler ? `<div class="contract"><strong>Imported CAD Agent outputs</strong><pre id="importedOutputs">[]</pre></div>` : ''}
    </aside>
  </main>
  <script>
    const phases = ["observing screen", "planning next action", "moving cursor", "capturing screenshot"];
    let tick = 0;
    const workspace = document.querySelector("#workspace");
    const log = document.querySelector("#log");
    const resetProject = document.querySelector("#resetProject");
    const buttons = [...document.querySelectorAll(".tool")];
    const defaultSelection = ${JSON.stringify(selectedDefault)};
    const emptyLog = ${JSON.stringify(emptyLog)};
    const isAssembler = ${JSON.stringify(isAssembler)};
    const workerPart = ${JSON.stringify(worker.id)};
    const workerColor = ${JSON.stringify(worker.color)};
    const importScale = 0.62;
    window.importedManifests = window.importedManifests || [];
    window.demoManifest = { worker: ${JSON.stringify(worker.id)}, parts: [] };
    let selected = defaultSelection;
    setSelected(selected);

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        selected = button.dataset.shape || button.dataset.part;
        setSelected(selected);
        writeLog("Selected " + selected + ". Click the workplane to place it.");
      });
    });

    resetProject.addEventListener("click", () => {
      for (const placed of [...workspace.querySelectorAll(".placed")]) placed.remove();
      workspace.classList.remove("has-parts");
      window.demoManifest.parts = [];
      log.textContent = "Project reset. Scene is empty.";
    });

    workspace.addEventListener("click", (event) => {
      const rect = workspace.getBoundingClientRect();
      const x = Math.round(event.clientX - rect.left);
      const y = Math.round(event.clientY - rect.top);
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

      const imported = isAssembler ? findImportedManifest(selected) : null;
      if (imported && imported.placements && imported.placements.length) {
        const count = renderImportedManifest(imported, x, y);
        workspace.classList.add("has-parts");
        writeLog("Placed " + imported.id + " as " + count + " imported primitives at (" + x + ", " + y + ").");
        return;
      }

      createPlaced(selected, x, y, {
        sourcePart: isAssembler ? selected : workerPart,
        color: isAssembler ? paletteColor(selected) : workerColor,
      });
      workspace.classList.add("has-parts");
      writeLog("Placed " + selected + " at (" + x + ", " + y + ").");
    });

    function renderImportedManifest(manifest, anchorX, anchorY) {
      const bounds = manifestBounds(manifest.placements);
      const rect = workspace.getBoundingClientRect();
      let count = 0;
      for (const placement of manifest.placements) {
        const x = anchorX + (Number(placement.x) - bounds.centerX) * rect.width * importScale;
        const y = anchorY + (Number(placement.y) - bounds.centerY) * rect.height * importScale;
        createPlaced(placement.primitive, x, y, {
          sourcePart: manifest.part,
          color: placement.color || manifest.color,
          manifestId: manifest.id,
          sourcePlacementId: placement.id,
          label: placement.label,
        });
        count += 1;
      }
      return count;
    }

    function createPlaced(shape, x, y, options = {}) {
      const sourcePart = options.sourcePart || workerPart;
      const part = document.createElement("div");
      part.className = "placed " + partClass(shape) + " source-" + safeClass(sourcePart);
      setPartColor(part, options.color || workerColor);
      const offset = partOffset(shape, sourcePart);
      part.style.left = Math.round(x - offset.x) + "px";
      part.style.top = Math.round(y - offset.y) + "px";
      part.textContent = partLabel(shape);
      workspace.append(part);
      window.demoManifest.parts.push({
        part: sourcePart,
        primitive: shape,
        x: Math.round(x),
        y: Math.round(y),
        manifestId: options.manifestId || null,
        sourcePlacementId: options.sourcePlacementId || null,
        label: options.label || "",
      });
    }

    function findImportedManifest(part) {
      return (window.importedManifests || []).find((manifest) => manifest.part === part);
    }

    function manifestBounds(placements) {
      const xs = placements.map((placement) => Number(placement.x)).filter(Number.isFinite);
      const ys = placements.map((placement) => Number(placement.y)).filter(Number.isFinite);
      if (!xs.length || !ys.length) return { centerX: 0.5, centerY: 0.5 };
      return {
        centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
        centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    }

    function setSelected(value) {
      for (const button of buttons) {
        button.classList.toggle("selected", (button.dataset.shape || button.dataset.part) === value);
      }
    }

    function partClass(value) {
      const classes = {
        box: "box",
        cylinder: "cylinder",
        sphere: "sphere",
        cone: "cone",
        body: "body",
        head: "head",
        arms: "arm",
        feet: "foot",
        details: "detail",
      };
      return classes[value] || "box";
    }

    function partOffset(value, sourcePart = workerPart) {
      const sourceOffsets = {
        "body:box": { x: 56, y: 46 },
        "head:box": { x: 43, y: 36 },
        "head:sphere": { x: 13, y: 13 },
        "arms:cylinder": { x: 48, y: 12 },
        "feet:cylinder": { x: 39, y: 18 },
        "details:box": { x: 31, y: 19 },
        "details:sphere": { x: 12, y: 12 },
      };
      const sourceKey = sourcePart + ":" + value;
      if (sourceOffsets[sourceKey]) return sourceOffsets[sourceKey];
      const offsets = {
        box: { x: 46, y: 37 },
        cylinder: { x: 43, y: 37 },
        sphere: { x: 35, y: 35 },
        cone: { x: 40, y: 74 },
        body: { x: 56, y: 46 },
        head: { x: 43, y: 36 },
        arms: { x: 48, y: 12 },
        feet: { x: 39, y: 18 },
        details: { x: 31, y: 19 },
      };
      return offsets[value] || { x: 40, y: 34 };
    }

    function paletteColor(value) {
      const colors = {
        body: "#2f9e59",
        head: "#6842b9",
        arms: "#ed7a22",
        feet: "#1664c0",
        details: "#e7b32b",
        wings: "#38b6d8",
      };
      return colors[value] || workerColor;
    }

    function setPartColor(element, color) {
      element.style.setProperty("--part-color", color);
      element.style.setProperty("--part-dark", darkenHex(color, 34));
    }

    function darkenHex(hex, amount) {
      const clean = String(hex || "").replace("#", "");
      if (!/^[0-9a-f]{6}$/i.test(clean)) return "#1d3550";
      const next = [0, 2, 4].map((start) => {
        const channel = Math.max(0, Number.parseInt(clean.slice(start, start + 2), 16) - amount);
        return channel.toString(16).padStart(2, "0");
      });
      return "#" + next.join("");
    }

    function safeClass(value) {
      return String(value || "part").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    }

    function partLabel(value) {
      return "";
    }

    function writeLog(line) {
      const existing = log.textContent === emptyLog ? "" : log.textContent + "\\n";
      log.textContent = existing + line;
    }

    function updateLiveSignals() {
      tick += 1;
      document.querySelector("#clock").textContent = new Date().toLocaleTimeString();
      document.querySelector("#phase").textContent = phases[tick % phases.length];
      document.querySelector("#tick").textContent = "tick " + tick;
    }
    updateLiveSignals();
    setInterval(updateLiveSignals, 1000);
  </script>
</body>
</html>`;
}

function primitivePaletteHtml(worker) {
  return `<h2>Basic Shapes</h2>
    <div class="tool-grid">
      <button class="tool" data-shape="box" type="button" aria-label="Box primitive"><span class="thumb box"></span><span>Box</span></button>
      <button class="tool" data-shape="cylinder" type="button" aria-label="Cylinder primitive"><span class="thumb cylinder"></span><span>Cylinder</span></button>
      <button class="tool" data-shape="sphere" type="button" aria-label="Sphere primitive"><span class="thumb sphere"></span><span>Sphere</span></button>
      <button class="tool" data-shape="cone" type="button" aria-label="Cone primitive"><span class="thumb cone"></span><span>Cone</span></button>
    </div>
    <div class="contract"><strong>Agent owner</strong><pre>${escapeHtml(JSON.stringify({ template: 'CAD Agent', instance: worker.title, assignment: worker.assignment, kernel: worker.id }, null, 2))}</pre></div>`;
}

function assemblyPaletteHtml(run) {
  const ids = run.plan.workers.map((worker) => worker.id);
  const tools = ids.map((id) => {
    const label = id.charAt(0).toUpperCase() + id.slice(1);
    const klass = ['body', 'head', 'arms', 'feet'].includes(id) ? id.replace('arms', 'arm').replace('feet', 'foot') : 'detail';
    return `<button class="tool" data-part="${escapeHtml(id)}" type="button" aria-label="${escapeHtml(label)} part"><span class="thumb ${escapeHtml(klass)}"></span><span>${escapeHtml(label)}</span></button>`;
  });
  return `<h2>Assembly Parts</h2>
    <div class="tool-grid assembly">${tools.join('')}</div>
    <div class="contract"><strong>Agent owner</strong><pre>${escapeHtml(JSON.stringify({ template: 'Dispatch & Assembly Agent', kernel: 'dispatch-assembly' }, null, 2))}</pre></div>`;
}

function serializeRun(run) {
  return {
    id: run.id,
    prompt: run.prompt,
    status: run.status,
    strategy: run.plan.strategy,
    factory: run.plan.factory,
    freshProject: run.freshProject,
    agentBackend: run.agentBackend,
    requestedAgentBackend: run.requestedAgentBackend,
    cleanup: run.cleanup,
    refreshMs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    error: run.error,
    northstar: {
      enabled: Boolean(northstarClient),
      model: northstarModel,
      workerMaxSteps: northstarWorkerMaxSteps,
      assemblerMaxSteps: northstarAssemblerMaxSteps,
    },
    plan: {
      workers: run.plan.workers.map((worker) => ({
        id: worker.id,
        title: worker.title,
        role: worker.role,
        template: worker.template,
        assignment: worker.assignment,
        prompt: worker.prompt,
        contract: worker.contract,
      })),
      assembler: {
        id: run.plan.assembler.id,
        title: run.plan.assembler.title,
        role: run.plan.assembler.role,
        template: run.plan.assembler.template,
        assignment: run.plan.assembler.assignment,
        prompt: run.plan.assembler.prompt,
        contract: run.plan.assembler.contract,
      },
    },
    workers: run.workers.map((worker) => ({
      id: worker.id,
      title: worker.title,
      role: worker.role,
      template: worker.template,
      assignment: worker.assignment,
      prompt: worker.prompt,
      contract: worker.contract,
      status: worker.status,
      sessionId: worker.sessionId,
      liveViewUrl: worker.liveViewUrl,
      screenshotVersion: worker.screenshotVersion,
      lastScreenshotAt: worker.lastScreenshotAt,
      error: worker.error,
      agentBackend: worker.agentBackend,
      agentStatus: worker.agentStatus,
      agentStep: worker.agentStep,
      actionCount: worker.actionCount,
      lastAction: worker.lastAction,
      finalText: worker.finalText,
      partManifest: worker.partManifest,
      agentError: worker.agentError,
      screenshotUrl: `/api/runs/${run.id}/workers/${worker.id}/screenshot?v=${worker.screenshotVersion}`,
    })),
  };
}

function findRun(id) {
  const run = runs.get(id);
  if (!run) {
    const error = new Error('run not found');
    error.status = 404;
    throw error;
  }
  return run;
}

function latestRun() {
  return [...runs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

async function serveStatic(urlPath, response) {
  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, normalized === '/' ? 'parallel-cad.html' : normalized);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }
  response.writeHead(200, { 'content-type': mimeType(filePath) });
  fs.createReadStream(filePath).pipe(response);
}

function sendSvgPlaceholder(response, title, status) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
    <rect width="1280" height="800" fill="#eef9fc"/>
    <path d="M0 0H1280M0 80H1280M0 160H1280M0 240H1280M0 320H1280M0 400H1280M0 480H1280M0 560H1280M0 640H1280M0 720H1280M80 0V800M160 0V800M240 0V800M320 0V800M400 0V800M480 0V800M560 0V800M640 0V800M720 0V800M800 0V800M880 0V800M960 0V800M1040 0V800M1120 0V800M1200 0V800" stroke="#c9e8f4"/>
    <text x="640" y="364" text-anchor="middle" font-family="Arial" font-size="44" font-weight="700" fill="#182330">${escapeHtml(title)}</text>
    <text x="640" y="424" text-anchor="middle" font-family="Arial" font-size="28" fill="#607080">${escapeHtml(status)}</text>
  </svg>`;
  response.writeHead(200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'no-store',
  });
  response.end(svg);
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function extractCliResultString(output) {
  const stripped = stripAnsi(output);
  const match = stripped.match(/result:\s*\n([\s\S]*)$/);
  if (!match) throw new Error(`Could not parse Kernel Playwright result: ${stripped.slice(0, 500)}`);
  const raw = match[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^"|"$/g, '');
  }
}

function extractText(response) {
  const chunks = [];
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function isDoneText(text) {
  return /done|complete|completed|finished|final|success/i.test(text || '');
}

function isTerminalAction(action) {
  return ['terminate', 'done', 'answer'].includes(action?.type);
}

function toPixels(modelX, modelY, screenshotSize) {
  return [
    Math.floor((Number(modelX) / 1000) * screenshotSize.width),
    Math.floor((Number(modelY) / 1000) * screenshotSize.height),
  ];
}

function readPngDimensions(filepath) {
  const buffer = fs.readFileSync(filepath);
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  return { width: 1280, height: 800 };
}

function formatAction(action) {
  if (!action) return 'none';
  if (action.type === 'click') return `click ${action.button || 'left'} at (${action.x}, ${action.y})`;
  if (action.type === 'double_click') return `double click at (${action.x}, ${action.y})`;
  if (action.type === 'drag') return `drag ${(action.path || []).map((point) => `(${point.x},${point.y})`).join(' -> ')}`;
  if (action.type === 'move') return `move to (${action.x}, ${action.y})`;
  if (action.type === 'point_and_type') return `point and type at (${action.x}, ${action.y}): ${JSON.stringify(action.text)}`;
  if (action.type === 'type') return `type ${JSON.stringify(action.text)}`;
  if (action.type === 'key') return `key ${(action.keys || []).join('+')}`;
  if (action.type === 'keypress') return `keypress ${(action.keys || []).join('+')}`;
  if (action.type === 'scroll') return `scroll (${action.scroll_x}, ${action.scroll_y}) at (${action.x}, ${action.y})`;
  if (action.type === 'wait') return 'wait';
  return JSON.stringify(action);
}

function normalizeKey(key) {
  const normalized = String(key).toLowerCase();
  const aliases = {
    enter: 'Return',
    return: 'Return',
    escape: 'Escape',
    esc: 'Escape',
    backspace: 'Backspace',
    tab: 'Tab',
    space: 'Space',
    ctrl: 'Control',
    control: 'Control',
    cmd: 'Meta',
    command: 'Meta',
    meta: 'Meta',
  };
  return aliases[normalized] || key;
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function touch(run) {
  run.updatedAt = new Date().toISOString();
}

function mimeType(filePath) {
  const extension = path.extname(filePath);
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }[extension] || 'application/octet-stream';
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
