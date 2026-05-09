import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sessionTimeout = process.env.PARALLEL_CAD_KERNEL_TIMEOUT || '600';
const viewport = process.env.PARALLEL_CAD_VIEWPORT || '1280x800@60';
const runId = `parallel-cad-kernel-${timestamp()}`;
const runDir = path.join(process.cwd(), '.lightcone-runs', runId);
const screenshotsDir = path.join(runDir, 'screenshots');
const eventsPath = path.join(runDir, 'events.jsonl');

const prompt =
  process.argv.slice(2).join(' ').trim() ||
  'Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.';

const workers = [
  {
    id: 'head',
    title: 'Head worker',
    color: '#6842b9',
    mission: 'Build the robot head, face, and antenna pieces.',
    actions: [
      ['box', 1030, 265, 506, 328, 'place purple head block'],
      ['sphere', 1030, 390, 488, 326, 'place left eye'],
      ['sphere', 1030, 390, 526, 326, 'place right eye'],
      ['cylinder', 1188, 265, 506, 262, 'place antenna post'],
    ],
  },
  {
    id: 'body',
    title: 'Body worker',
    color: '#2f9e59',
    mission: 'Build the robot torso and chest screen.',
    actions: [
      ['box', 1030, 265, 520, 352, 'place green torso'],
      ['box', 1030, 265, 520, 348, 'place raised screen panel'],
      ['sphere', 1030, 390, 520, 338, 'place round status button'],
    ],
  },
  {
    id: 'arms',
    title: 'Arm worker',
    color: '#ed7a22',
    mission: 'Build mirrored robot arms with hand caps.',
    actions: [
      ['cylinder', 1188, 265, 468, 350, 'place left arm cylinder'],
      ['cylinder', 1188, 265, 576, 350, 'place right arm cylinder'],
      ['sphere', 1030, 390, 438, 350, 'place left hand cap'],
      ['sphere', 1030, 390, 606, 350, 'place right hand cap'],
    ],
  },
  {
    id: 'feet',
    title: 'Feet worker',
    color: '#1664c0',
    mission: 'Build blue wheel-like feet and lower anchors.',
    actions: [
      ['cylinder', 1188, 265, 478, 410, 'place left wheel foot'],
      ['cylinder', 1188, 265, 562, 410, 'place right wheel foot'],
      ['box', 1030, 265, 478, 382, 'place left leg strut'],
      ['box', 1030, 265, 562, 382, 'place right leg strut'],
    ],
  },
];

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'prompt.txt'), `${prompt}\n`);
fs.writeFileSync(eventsPath, '');

try {
  console.log(`Run: ${runId}`);
  console.log(`Prompt: ${prompt}`);
  record('run.started', { runId, prompt });

  const workerResults = await Promise.all(workers.map(runWorker));
  const assembler = await runAssembler(workerResults);
  writeResultPage(workerResults, assembler);

  console.log(`Result page: ${path.join(runDir, 'result.html')}`);
  console.log(`Assembler live view: ${assembler.liveViewUrl}`);
} catch (error) {
  record('run.failed', { message: error.message, stack: error.stack });
  console.error(error);
  process.exitCode = 1;
}

async function runWorker(worker) {
  record('worker.start', { worker: worker.id });
  const created = await createBrowser();
  const workerDir = path.join(screenshotsDir, worker.id);
  fs.mkdirSync(workerDir, { recursive: true });

  const pageUrl = dataUrl(workerHtml(worker, prompt));
  await kernel(['browsers', 'playwright', 'execute', created.session_id, `await page.goto(${JSON.stringify(pageUrl)}, { waitUntil: "domcontentloaded" }); return await page.title();`]);

  const replay = await startReplay(created.session_id).catch((error) => {
    record('worker.replay.failed', { worker: worker.id, message: error.message });
    return null;
  });

  await screenshot(created.session_id, path.join(workerDir, 'step-00-ready.png'));
  const steps = [{ title: 'Worker workspace ready', screenshot: rel(path.join(workerDir, 'step-00-ready.png')) }];

  for (const [index, action] of worker.actions.entries()) {
    const [shape, fromX, fromY, toX, toY, label] = action;
    console.log(`${worker.id}: ${label}`);
    await computerDrag(created.session_id, fromX, fromY, toX, toY);
    await sleep(420);
    const shot = path.join(workerDir, `step-${String(index + 1).padStart(2, '0')}-${shape}.png`);
    await screenshot(created.session_id, shot);
    steps.push({ title: label, screenshot: rel(shot) });
    record('worker.action', { worker: worker.id, shape, label, to: [toX, toY] });
  }

  const manifest = {
    worker: worker.id,
    title: worker.title,
    prompt,
    parts: worker.actions.map(([shape, , , toX, toY, label]) => ({
      shape,
      label,
      target: [toX, toY],
      color: worker.color,
    })),
  };

  if (replay) {
    await kernel(['browsers', 'replays', 'stop', created.session_id, replay.replay_id]).catch((error) => {
      record('worker.replay.stop.failed', { worker: worker.id, message: error.message });
    });
  }

  const result = {
    ...worker,
    sessionId: created.session_id,
    liveViewUrl: created.browser_live_view_url,
    replayViewUrl: replay?.replay_view_url || '',
    manifest,
    steps,
  };
  record('worker.done', { worker: worker.id, sessionId: created.session_id, liveViewUrl: created.browser_live_view_url });
  return result;
}

async function runAssembler(workerResults) {
  record('assembler.start', {});
  const created = await createBrowser();
  const pageUrl = dataUrl(assemblerHtml(workerResults, prompt));
  await kernel(['browsers', 'playwright', 'execute', created.session_id, `await page.goto(${JSON.stringify(pageUrl)}, { waitUntil: "domcontentloaded" }); return await page.title();`]);
  await sleep(850);
  const shot = path.join(screenshotsDir, 'assembler-final.png');
  await screenshot(created.session_id, shot);
  const result = {
    sessionId: created.session_id,
    liveViewUrl: created.browser_live_view_url,
    screenshot: rel(shot),
  };
  record('assembler.done', result);
  return result;
}

async function createBrowser() {
  const stdout = await kernel([
    'browsers',
    'create',
    '-o',
    'json',
    '--no-color',
    '--viewport',
    viewport,
    '--timeout',
    sessionTimeout,
  ]);
  return JSON.parse(stripAnsi(stdout));
}

async function startReplay(sessionId) {
  const stdout = await kernel(['browsers', 'replays', 'start', sessionId, '-o', 'json', '--no-color']);
  return JSON.parse(stripAnsi(stdout));
}

async function computerDrag(sessionId, fromX, fromY, toX, toY) {
  await kernel([
    'browsers',
    'computer',
    'drag-mouse',
    sessionId,
    '--point',
    `${fromX},${fromY}`,
    '--point',
    `${Math.round((fromX + toX) / 2)},${Math.round((fromY + toY) / 2)}`,
    '--point',
    `${toX},${toY}`,
    '--duration-ms',
    '900',
  ]);
}

async function screenshot(sessionId, filepath) {
  await kernel(['browsers', 'computer', 'screenshot', sessionId, '--to', filepath]);
}

async function kernel(args) {
  const { stdout, stderr } = await execFileAsync('kernel', args, {
    maxBuffer: 12 * 1024 * 1024,
  });
  if (stderr.trim()) {
    record('kernel.stderr', { args, stderr: stripAnsi(stderr).trim() });
  }
  return stdout;
}

function workerHtml(worker, userPrompt) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(worker.title)} - MiniCAD</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; min-height: 100vh; overflow: hidden; }
    header { height: 70px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; background: #fff; border-bottom: 1px solid #d8e1ea; }
    h1 { margin: 0; font-size: 22px; }
    header p { margin: 4px 0 0; color: #607080; font-size: 14px; }
    .kernel { color: #0b5cad; font-weight: 800; }
    .workspace { position: absolute; left: 24px; top: 92px; right: 328px; bottom: 24px; border: 1px solid #b9d8e7; border-radius: 8px; overflow: hidden; background: #eef9fc; }
    .grid { position: absolute; inset: 0; background: linear-gradient(#c9e8f4 1px, transparent 1px), linear-gradient(90deg, #c9e8f4 1px, transparent 1px); background-size: 24px 24px; transform: skewX(-14deg) scaleY(0.84); transform-origin: center bottom; }
    .workspace-label { position: absolute; left: 28px; bottom: 20px; color: rgba(24, 91, 129, 0.28); font-size: 44px; font-weight: 900; font-style: italic; }
    .palette { position: absolute; right: 0; top: 70px; bottom: 0; width: 304px; padding: 18px; background: #fff; border-left: 1px solid #d8e1ea; }
    .palette h2 { margin: 0 0 12px; font-size: 18px; }
    .shape-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .primitive { height: 112px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; display: grid; place-items: center; cursor: grab; user-select: none; }
    .primitive:active { cursor: grabbing; }
    .thumb { position: relative; width: 62px; height: 62px; }
    .thumb.box { background: ${worker.color}; border-radius: 8px; box-shadow: inset -12px -14px rgba(0,0,0,0.12); }
    .thumb.cylinder { border-radius: 50% / 18%; background: ${worker.color}; box-shadow: inset -12px -20px rgba(0,0,0,0.14); }
    .thumb.sphere { border-radius: 50%; background: radial-gradient(circle at 30% 26%, #fff 0 6%, ${worker.color} 26%, #0b5cad 100%); }
    .thumb.cone { width: 0; height: 0; border-left: 34px solid transparent; border-right: 34px solid transparent; border-bottom: 66px solid ${worker.color}; filter: drop-shadow(9px 10px 0 rgba(0,0,0,0.12)); }
    .part { position: absolute; z-index: 3; display: grid; place-items: center; color: white; font-size: 11px; font-weight: 800; box-shadow: 0 16px 24px rgba(21, 38, 55, 0.18); }
    .part.box { width: 88px; height: 70px; border-radius: 8px; background: ${worker.color}; }
    .part.cylinder { width: 82px; height: 72px; border-radius: 50% / 18%; background: ${worker.color}; }
    .part.sphere { width: 64px; height: 64px; border-radius: 50%; background: radial-gradient(circle at 30% 24%, #fff 0 6%, ${worker.color} 25%, #0b5cad 100%); }
    .part.cone { width: 0; height: 0; border-left: 38px solid transparent; border-right: 38px solid transparent; border-bottom: 74px solid ${worker.color}; filter: drop-shadow(0 16px 14px rgba(21,38,55,.2)); }
    .log { margin-top: 18px; padding: 12px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; min-height: 172px; }
    .log h3 { margin: 0 0 8px; font-size: 14px; }
    .log ol { margin: 0; padding-left: 20px; color: #435466; line-height: 1.55; font-size: 13px; }
    .drag-ghost { position: fixed; z-index: 20; pointer-events: none; opacity: .72; transform: translate(-50%, -50%) scale(.82); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(worker.title)}</h1>
      <p>${escapeHtml(worker.mission)}</p>
    </div>
    <div class="kernel">Kernel worker: ${escapeHtml(worker.id)}</div>
  </header>
  <main>
    <section id="workspace" class="workspace" aria-label="CAD workplane">
      <div class="grid"></div>
      <div class="workspace-label">Workplane</div>
    </section>
    <aside class="palette" aria-label="Shape palette">
      <h2>Basic Shapes</h2>
      <div class="shape-grid">
        <div class="primitive" data-shape="box"><div class="thumb box"></div></div>
        <div class="primitive" data-shape="cylinder"><div class="thumb cylinder"></div></div>
        <div class="primitive" data-shape="sphere"><div class="thumb sphere"></div></div>
        <div class="primitive" data-shape="cone"><div class="thumb cone"></div></div>
      </div>
      <div class="log">
        <h3>Computer-use trace</h3>
        <ol id="log"><li>Workspace opened for prompt: ${escapeHtml(userPrompt)}</li></ol>
      </div>
    </aside>
  </main>
  <script>
    window.demoManifest = { worker: ${JSON.stringify(worker.id)}, title: ${JSON.stringify(worker.title)}, prompt: ${JSON.stringify(userPrompt)}, parts: [] };
    const workspace = document.querySelector("#workspace");
    const log = document.querySelector("#log");
    let active = null;
    let ghost = null;

    document.querySelectorAll(".primitive").forEach((item) => {
      item.addEventListener("mousedown", (event) => {
        active = item.dataset.shape;
        ghost = document.createElement("div");
        ghost.className = "drag-ghost thumb " + active;
        document.body.append(ghost);
        moveGhost(event);
        event.preventDefault();
      });
    });

    window.addEventListener("mousemove", moveGhost);
    window.addEventListener("mouseup", (event) => {
      if (!active) return;
      const rect = workspace.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside) {
        const part = document.createElement("div");
        part.className = "part " + active;
        part.style.left = Math.round(event.clientX - rect.left - 38) + "px";
        part.style.top = Math.round(event.clientY - rect.top - 34) + "px";
        part.textContent = active === "box" ? "BOX" : "";
        workspace.append(part);
        const item = { shape: active, x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top), color: ${JSON.stringify(worker.color)} };
        window.demoManifest.parts.push(item);
        const li = document.createElement("li");
        li.textContent = "Placed " + active + " at (" + item.x + ", " + item.y + ")";
        log.append(li);
      }
      if (ghost) ghost.remove();
      active = null;
      ghost = null;
    });

    function moveGhost(event) {
      if (!ghost) return;
      ghost.style.left = event.clientX + "px";
      ghost.style.top = event.clientY + "px";
    }
  </script>
</body>
</html>`;
}

function assemblerHtml(workerResults, userPrompt) {
  const cards = workerResults
    .map(
      (worker) => `<article>
        <h2>${escapeHtml(worker.title)}</h2>
        <p>${escapeHtml(worker.mission)}</p>
        <a href="${escapeHtml(worker.liveViewUrl)}">live view</a>
      </article>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Assembler - Parallel CAD</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; }
    main { min-height: 100vh; display: grid; grid-template-columns: minmax(460px, .82fr) minmax(580px, 1.18fr); gap: 18px; padding: 22px; }
    section { background: #fff; border: 1px solid #d8e1ea; border-radius: 8px; box-shadow: 0 10px 26px rgba(22,35,49,.08); }
    .stage { position: relative; overflow: hidden; min-height: 720px; background: #eef9fc; }
    .grid { position: absolute; inset: 0; background: linear-gradient(#c9e8f4 1px, transparent 1px), linear-gradient(90deg, #c9e8f4 1px, transparent 1px); background-size: 26px 26px; transform: skewX(-14deg) scaleY(.82); transform-origin: center bottom; }
    .robot { position: absolute; left: 50%; top: 52%; width: 330px; height: 420px; transform: translate(-50%, -50%) scale(.92); }
    .head { position: absolute; left: 99px; top: 35px; width: 132px; height: 92px; border-radius: 12px; background: #6842b9; }
    .eye { position: absolute; top: 72px; width: 18px; height: 18px; border-radius: 4px; background: white; }
    .eye.left { left: 138px; } .eye.right { left: 176px; }
    .antenna { position: absolute; left: 161px; top: 0; width: 8px; height: 42px; border-radius: 999px; background: #e7b32b; }
    .antenna::before { content: ""; position: absolute; left: -9px; top: -13px; width: 26px; height: 26px; border-radius: 50%; background: #e7b32b; }
    .body { position: absolute; left: 79px; top: 124px; width: 172px; height: 148px; border-radius: 15px; background: #2f9e59; }
    .screen { position: absolute; left: 122px; top: 171px; width: 86px; height: 42px; border-radius: 8px; background: #38b6d8; }
    .arm { position: absolute; top: 174px; width: 105px; height: 26px; border-radius: 999px; background: #ed7a22; }
    .arm.left { left: 16px; transform: rotate(-15deg); } .arm.right { right: 16px; transform: rotate(15deg); }
    .foot { position: absolute; top: 284px; width: 82px; height: 40px; border-radius: 50%; background: #1664c0; }
    .foot.left { left: 72px; } .foot.right { right: 72px; }
    .side { padding: 18px; }
    h1 { margin: 0 0 8px; font-size: 26px; } p { color: #526373; line-height: 1.5; }
    .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 18px; }
    article { border: 1px solid #d8e1ea; border-radius: 8px; padding: 12px; background: #fbfdff; }
    article h2 { margin: 0 0 6px; font-size: 16px; }
    a { color: #0b5cad; font-weight: 800; }
    pre { margin-top: 16px; max-height: 260px; overflow: auto; border-radius: 8px; padding: 12px; background: #101820; color: #dff7ec; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <section class="stage">
      <div class="grid"></div>
      <div class="robot" aria-label="Assembled robot">
        <div class="antenna"></div><div class="head"></div><div class="eye left"></div><div class="eye right"></div>
        <div class="body"></div><div class="screen"></div><div class="arm left"></div><div class="arm right"></div>
        <div class="foot left"></div><div class="foot right"></div>
      </div>
    </section>
    <section class="side">
      <h1>Assembler Agent</h1>
      <p>Prompt: ${escapeHtml(userPrompt)}</p>
      <p>Four Kernel workers produced part manifests in parallel. The assembler aligns anchors and previews the combined robot.</p>
      <div class="cards">${cards}</div>
      <pre>${escapeHtml(JSON.stringify(workerResults.map((worker) => worker.manifest), null, 2))}</pre>
    </section>
  </main>
</body>
</html>`;
}

function writeResultPage(workerResults, assembler) {
  const cards = workerResults
    .map(
      (worker) => `<article class="worker">
        <h2>${escapeHtml(worker.title)}</h2>
        <p>${escapeHtml(worker.mission)}</p>
        <p><a href="${escapeHtml(worker.liveViewUrl)}">Kernel live view</a>${worker.replayViewUrl ? ` · <a href="${escapeHtml(worker.replayViewUrl)}">replay</a>` : ''}</p>
        <div class="shots">${worker.steps
          .map((step) => `<figure><img src="${escapeHtml(step.screenshot)}" alt="${escapeHtml(step.title)}"><figcaption>${escapeHtml(step.title)}</figcaption></figure>`)
          .join('')}</div>
      </article>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Parallel CAD Kernel Demo</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; }
    main { max-width: 1220px; margin: 0 auto; padding: 34px 22px 60px; }
    h1 { margin: 0 0 8px; font-size: 34px; }
    .lede { color: #526373; max-width: 860px; line-height: 1.55; margin: 0 0 22px; }
    .links { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
    a.button { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border-radius: 7px; background: #1664c0; color: white; text-decoration: none; font-weight: 800; }
    .assembler { background: #fff; border: 1px solid #d8e1ea; border-radius: 8px; padding: 16px; box-shadow: 0 10px 26px rgba(22,35,49,.08); margin-bottom: 18px; }
    .assembler img { width: 100%; border: 1px solid #d8e1ea; border-radius: 8px; background: #eef9fc; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
    article.worker { background: #fff; border: 1px solid #d8e1ea; border-radius: 8px; padding: 16px; box-shadow: 0 10px 26px rgba(22,35,49,.08); }
    article h2 { margin: 0 0 8px; font-size: 20px; }
    article p { color: #526373; line-height: 1.5; }
    .shots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    figure { margin: 0; }
    figure img { width: 100%; border: 1px solid #d8e1ea; border-radius: 7px; background: #eef9fc; }
    figcaption { margin-top: 5px; color: #526373; font-size: 12px; line-height: 1.35; }
  </style>
</head>
<body>
  <main>
    <h1>Parallel CAD Kernel Demo</h1>
    <p class="lede">Prompt: ${escapeHtml(prompt)}. This run launched four Kernel workers in parallel. Each worker opened a CAD-like workspace and used OS-level computer actions to drag visible primitives onto its workplane. A fifth Kernel opened the assembler view.</p>
    <div class="links">
      <a class="button" href="${escapeHtml(assembler.liveViewUrl)}">Open assembler live view</a>
    </div>
    <section class="assembler">
      <h2>Assembler output</h2>
      <img src="${escapeHtml(assembler.screenshot)}" alt="Assembler robot output">
    </section>
    <section class="grid">${cards}</section>
  </main>
</body>
</html>`;
  fs.writeFileSync(path.join(runDir, 'result.html'), html);
}

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function rel(filepath) {
  return path.relative(runDir, filepath).replaceAll(path.sep, '/');
}

function record(type, payload) {
  fs.appendFileSync(eventsPath, `${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n`);
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
