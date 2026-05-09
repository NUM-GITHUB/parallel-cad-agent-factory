import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const runsRoot = path.join(rootDir, '.lightcone-runs', 'monitor');
const preferredPort = Number.parseInt(process.env.PORT || '8780', 10);
const viewport = process.env.PARALLEL_CAD_VIEWPORT || '1280x800@60';
const refreshMs = Number.parseInt(process.env.MONITOR_REFRESH_MS || '3000', 10);
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
  console.log(`Parallel CAD monitor: http://127.0.0.1:${activePort}/parallel-cad.html`);
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

async function route(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${activePort}`);

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: '/parallel-cad.html' });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, refreshMs });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/runs') {
    const body = await readJson(request);
    const run = createRun(body.prompt || '');
    runs.set(run.id, run);
    bootRun(run).catch((error) => failRun(run, error));
    sendJson(response, 202, serializeRun(run));
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

function createRun(prompt) {
  const id = `monitor-${timestamp()}`;
  const dir = path.join(runsRoot, id);
  const screenshotsDir = path.join(dir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

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
  }));

  const run = {
    id,
    prompt: plan.prompt,
    status: 'planning',
    dir,
    screenshotsDir,
    plan,
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
  run.status = 'creating-kernels';
  touch(run);

  await Promise.all(run.workers.map((worker) => bootWorker(run, worker)));

  run.status = 'monitoring';
  touch(run);
  await captureRun(run);
  run.timer = setInterval(() => {
    captureRun(run).catch((error) => {
      run.error = error.message;
      touch(run);
    });
  }, refreshMs);
}

async function bootWorker(run, worker) {
  worker.status = 'creating-kernel';
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
      `await page.setContent(${JSON.stringify(html)}, { waitUntil: "domcontentloaded" }); return await page.title();`,
    ]);

    worker.status = 'ready';
    touch(run);
    await captureWorker(worker);
  } catch (error) {
    worker.status = 'failed';
    worker.error = error.message;
    touch(run);
  }
}

async function captureRun(run) {
  const liveWorkers = run.workers.filter((worker) => worker.sessionId && worker.status !== 'failed');
  await Promise.allSettled(liveWorkers.map((worker) => captureWorker(worker)));
  touch(run);
}

async function captureWorker(worker) {
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
}

async function stopRun(run) {
  if (run.timer) {
    clearInterval(run.timer);
    run.timer = null;
  }

  const sessionIds = run.workers.map((worker) => worker.sessionId).filter(Boolean);
  await Promise.allSettled(sessionIds.map((id) => kernelStdout(['browsers', 'delete', id, '--no-color'])));
  run.status = 'stopped';
  for (const worker of run.workers) {
    if (worker.status !== 'failed') worker.status = 'stopped';
  }
  touch(run);
}

function failRun(run, error) {
  if (run.timer) clearInterval(run.timer);
  run.status = 'failed';
  run.error = error.message;
  touch(run);
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

async function kernelStdout(args) {
  const { stdout } = await execFileAsync('kernel', args, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function makePlan(rawPrompt) {
  const prompt = rawPrompt.trim() || 'Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.';
  const lower = prompt.toLowerCase();
  const workers = [];

  add(workers, {
    id: 'body',
    title: 'Body Kernel',
    role: 'part-worker',
    color: '#2f9e59',
    prompt: `Build only the core body/torso for this object: "${prompt}". Return dimensions, color, and anchor points.`,
    contract: { part: 'body', anchor: 'center', output: 'body geometry and anchors' },
  });

  if (mentions(lower, ['robot', 'head', 'face', 'eyes', 'antenna'])) {
    add(workers, {
      id: 'head',
      title: 'Head Kernel',
      role: 'part-worker',
      color: '#6842b9',
      prompt: `Build only the head/face module for this object: "${prompt}". Include visible face details if requested.`,
      contract: { part: 'head', anchor: 'top of body', output: 'head geometry and anchors' },
    });
  }

  if (mentions(lower, ['arm', 'arms', 'hand', 'hands', 'claw', 'claws'])) {
    add(workers, {
      id: 'arms',
      title: 'Arms Kernel',
      role: 'part-worker',
      color: '#ed7a22',
      prompt: `Build only the left and right arm modules for this object: "${prompt}". Keep symmetry and connector anchors.`,
      contract: { part: 'arms', anchor: 'left and right body sides', output: 'arm geometry and anchors' },
    });
  }

  if (mentions(lower, ['foot', 'feet', 'leg', 'legs', 'wheel', 'wheels', 'base'])) {
    add(workers, {
      id: 'feet',
      title: 'Feet Kernel',
      role: 'part-worker',
      color: '#1664c0',
      prompt: `Build only the feet/base/wheels for this object: "${prompt}". Return bottom anchors for assembly.`,
      contract: { part: 'feet', anchor: 'bottom of body', output: 'feet geometry and anchors' },
    });
  }

  if (mentions(lower, ['wing', 'wings', 'fin', 'fins'])) {
    add(workers, {
      id: 'wings',
      title: 'Wings Kernel',
      role: 'part-worker',
      color: '#38b6d8',
      prompt: `Build only the wing/fin modules for this object: "${prompt}". Return left/right anchors.`,
      contract: { part: 'wings', anchor: 'side of body', output: 'wing geometry and anchors' },
    });
  }

  if (mentions(lower, ['screen', 'button', 'panel', 'antenna', 'hat', 'sensor', 'accessory'])) {
    add(workers, {
      id: 'details',
      title: 'Details Kernel',
      role: 'part-worker',
      color: '#e7b32b',
      prompt: `Build only the decorative/details module for this object: "${prompt}". Focus on screens, buttons, antennas, sensors, or accessories.`,
      contract: { part: 'details', anchor: 'front/top detail anchors', output: 'detail geometry and anchors' },
    });
  }

  while (workers.length < 4) {
    const id = ['head', 'arms', 'feet', 'details'].find((candidate) => !workers.some((worker) => worker.id === candidate));
    const fallback = fallbackWorker(id, prompt);
    add(workers, fallback);
  }

  return {
    prompt,
    strategy: 'main-agent-writes-prompts-each-kernel-has-own-agent',
    workers,
    assembler: {
      id: 'assembler',
      title: 'Assembler Kernel',
      role: 'assembler',
      color: '#182330',
      prompt: `Assemble the final model for this prompt: "${prompt}". Use the worker contracts, align anchors, inspect screenshots, and produce the final combined design.`,
      contract: { part: 'final assembly', anchor: 'scene', output: 'assembled model and QA screenshot' },
    },
  };
}

function add(workers, worker) {
  if (!workers.some((item) => item.id === worker.id)) workers.push(worker);
}

function fallbackWorker(id, prompt) {
  const specs = {
    head: ['Head Kernel', '#6842b9', 'Build the top/head or front-facing identity module.'],
    arms: ['Arms Kernel', '#ed7a22', 'Build side attachments or manipulator modules.'],
    feet: ['Feet Kernel', '#1664c0', 'Build the bottom supports, base, wheels, or legs.'],
    details: ['Details Kernel', '#e7b32b', 'Build decorative details, controls, lights, panels, or sensors.'],
  };
  const [title, color, instruction] = specs[id];
  return {
    id,
    title,
    role: 'part-worker',
    color,
    prompt: `${instruction} User request: "${prompt}". Return geometry, dimensions, and anchor metadata.`,
    contract: { part: id, anchor: 'auto', output: `${id} geometry and anchors` },
  };
}

function mentions(text, words) {
  return words.some((word) => text.includes(word));
}

function kernelWorkbenchHtml(run, worker) {
  const isAssembler = worker.role === 'assembler';
  const contracts = run.plan.workers.map((item) => item.contract);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(worker.title)} - Parallel CAD Monitor</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; min-height: 100vh; overflow: hidden; }
    header { height: 78px; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; background: #fff; border-bottom: 1px solid #d8e1ea; }
    h1 { margin: 0; font-size: 22px; line-height: 1.15; }
    p { margin: 0; }
    .sub { margin-top: 5px; color: #607080; font-size: 14px; }
    .badge { min-width: 118px; text-align: center; padding: 8px 10px; border-radius: 999px; color: #0f4a27; background: #dbf6e5; font-weight: 800; }
    .workspace { position: absolute; left: 24px; top: 102px; right: 390px; bottom: 24px; overflow: hidden; border: 1px solid #b9d8e7; border-radius: 8px; background: #eef9fc; }
    .grid { position: absolute; inset: 0; background: linear-gradient(#c9e8f4 1px, transparent 1px), linear-gradient(90deg, #c9e8f4 1px, transparent 1px); background-size: 24px 24px; transform: skewX(-14deg) scaleY(.84); transform-origin: center bottom; }
    .label { position: absolute; left: 28px; bottom: 20px; color: rgba(24, 91, 129, .28); font-size: 42px; font-weight: 900; font-style: italic; }
    .ghost { position: absolute; left: 50%; top: 46%; width: ${isAssembler ? '280px' : '180px'}; height: ${isAssembler ? '260px' : '160px'}; transform: translate(-50%, -50%); border: 3px dashed rgba(22,100,192,.26); border-radius: 12px; display: grid; place-items: center; color: rgba(22,100,192,.58); text-align: center; font-weight: 900; padding: 18px; }
    aside { position: absolute; right: 0; top: 78px; bottom: 0; width: 366px; padding: 18px; overflow: auto; background: #fff; border-left: 1px solid #d8e1ea; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    .prompt, pre, .contract { border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; padding: 12px; line-height: 1.45; }
    .prompt { color: #344455; font-size: 14px; }
    .contract { margin-top: 12px; }
    .contract strong { display: block; margin-bottom: 5px; }
    pre { max-height: 260px; overflow: auto; background: #101820; color: #dff7ec; font-size: 12px; white-space: pre-wrap; }
    .heartbeat { display: inline-block; width: 10px; height: 10px; margin-right: 7px; border-radius: 50%; background: ${worker.color}; animation: pulse 1.4s infinite ease-in-out; }
    @keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.12); } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(worker.title)}</h1>
      <p class="sub">${escapeHtml(isAssembler ? 'Final assembly agent' : 'Dedicated part-building agent')} · run ${escapeHtml(run.id)}</p>
    </div>
    <div class="badge"><span class="heartbeat"></span>Kernel ready</div>
  </header>
  <main>
    <section class="workspace" aria-label="CAD workplane">
      <div class="grid"></div>
      <div class="ghost">${escapeHtml(isAssembler ? 'Assembly workplane waiting for worker outputs' : `${worker.id} workplane waiting for Northstar actions`)}</div>
      <div class="label">${escapeHtml(isAssembler ? 'Assembler' : worker.id)}</div>
    </section>
    <aside>
      <h2>Assigned prompt</h2>
      <p class="prompt">${escapeHtml(worker.prompt)}</p>
      <div class="contract">
        <strong>Output contract</strong>
        <pre>${escapeHtml(JSON.stringify(worker.contract, null, 2))}</pre>
      </div>
      ${isAssembler ? `<div class="contract"><strong>Worker contracts</strong><pre>${escapeHtml(JSON.stringify(contracts, null, 2))}</pre></div>` : ''}
    </aside>
  </main>
</body>
</html>`;
}

function serializeRun(run) {
  return {
    id: run.id,
    prompt: run.prompt,
    status: run.status,
    strategy: run.plan.strategy,
    refreshMs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    error: run.error,
    plan: {
      workers: run.plan.workers.map((worker) => ({
        id: worker.id,
        title: worker.title,
        role: worker.role,
        prompt: worker.prompt,
        contract: worker.contract,
      })),
      assembler: {
        id: run.plan.assembler.id,
        title: run.plan.assembler.title,
        role: run.plan.assembler.role,
        prompt: run.plan.assembler.prompt,
        contract: run.plan.assembler.contract,
      },
    },
    workers: run.workers.map((worker) => ({
      id: worker.id,
      title: worker.title,
      role: worker.role,
      prompt: worker.prompt,
      contract: worker.contract,
      status: worker.status,
      sessionId: worker.sessionId,
      liveViewUrl: worker.liveViewUrl,
      screenshotVersion: worker.screenshotVersion,
      lastScreenshotAt: worker.lastScreenshotAt,
      error: worker.error,
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
