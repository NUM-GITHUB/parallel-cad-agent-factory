import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import Lightcone from '@tzafon/lightcone';

const execFileAsync = promisify(execFile);

loadEnvFile('.env.local');
loadEnvFile('.env');
loadEnvFile('../.env.local');
loadEnvFile('../.env');

const apiKey = process.env.TZAFON_API_KEY;
const model = process.env.TZAFON_MODEL || 'tzafon.northstar-cua-fast';
const viewport = process.env.PARALLEL_CAD_VIEWPORT || '1280x800@60';
const maxSteps = Number.parseInt(process.env.NORTHSTAR_WORKER_MAX_STEPS || '10', 10);
const assemblerMaxSteps = Number.parseInt(process.env.NORTHSTAR_ASSEMBLER_MAX_STEPS || '14', 10);
const runId = `northstar-parallel-cad-${timestamp()}`;
const runDir = path.join(process.cwd(), '.lightcone-runs', runId);
const screenshotsDir = path.join(runDir, 'screenshots');
const eventsPath = path.join(runDir, 'events.jsonl');

const userPrompt =
  process.argv.slice(2).join(' ').trim() ||
  'Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.';

if (!apiKey) {
  console.error('Missing TZAFON_API_KEY.');
  console.error('Set TZAFON_API_KEY in the environment or in .env.local.');
  process.exit(1);
}

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.writeFileSync(eventsPath, '');
fs.writeFileSync(path.join(runDir, 'prompt.txt'), `${userPrompt}\n`);

const client = new Lightcone({
  apiKey,
  timeout: 3 * 60 * 1000,
});

const plan = makePlan(userPrompt);
fs.writeFileSync(path.join(runDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);

try {
  console.log(`Run: ${runId}`);
  console.log(`Planner created ${plan.workers.length} worker prompts.`);
  record('run.started', { runId, userPrompt, plan });

  const workerResults = await Promise.all(plan.workers.map((worker) => runNorthstarWorker(worker)));
  const assembler = await runNorthstarAssembler(workerResults, plan.assembler);

  writeResultPage(workerResults, assembler);

  console.log(`Result page: ${path.join(runDir, 'result.html')}`);
  console.log(`Assembler live view: ${assembler.liveViewUrl}`);
} catch (error) {
  record('run.failed', { message: error.message, stack: error.stack });
  console.error(error);
  process.exitCode = 1;
}

async function runNorthstarWorker(worker) {
  const workerDir = path.join(screenshotsDir, worker.id);
  fs.mkdirSync(workerDir, { recursive: true });

  const browser = await createBrowser();
  const startUrl = dataUrl(workerHtml(worker));
  await kernelStdout([
    'browsers',
    'playwright',
    'execute',
    browser.session_id,
    `await page.goto(${JSON.stringify(startUrl)}, { waitUntil: "domcontentloaded" }); return await page.title();`,
  ]);

  const result = {
    ...worker,
    sessionId: browser.session_id,
    liveViewUrl: browser.browser_live_view_url,
    actions: [],
    screenshots: [],
    finalText: '',
  };

  record('worker.started', {
    worker: worker.id,
    sessionId: browser.session_id,
    liveViewUrl: browser.browser_live_view_url,
    prompt: worker.prompt,
  });

  let previousResponseId = null;
  let lastComputerCall = null;
  let lastSize = { width: 1280, height: 800 };

  for (let step = 1; step <= maxSteps; step += 1) {
    const screenshot = await takePageScreenshot(browser.session_id, path.join(workerDir, `step-${String(step).padStart(2, '0')}.png`));
    lastSize = screenshot.size;
    result.screenshots.push({
      step,
      filename: rel(screenshot.filepath),
    });

    const input =
      step === 1
        ? [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `${worker.prompt}

You are the dedicated Northstar computer-use agent for this one part. You control the visible CAD-like webpage in this Kernel browser.

Use the UI directly. Prefer this simple workflow:
1. Click a primitive in the Basic Shapes palette.
2. Click the workplane where that primitive should be placed.
3. Repeat until your assigned part is represented.

Do not ask the main agent for coordinates. Do not rely on hidden scripts. Use one computer action at a time. When your part is complete, answer with a short sentence containing the word "complete".`,
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

    console.log(`${worker.id}: asking Northstar step ${step}`);
    const response = await client.responses.create({
      model,
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

    previousResponseId = response.id;
    record('northstar.response', { worker: worker.id, step, response });

    const text = extractText(response);
    if (text) {
      result.finalText = text;
      console.log(`${worker.id}: ${text}`);
    }
    if (isDoneText(text)) {
      break;
    }

    const computerCall = response.output?.find((item) => item.type === 'computer_call');
    if (!computerCall) {
      result.finalText ||= text || 'Northstar finished without another computer action.';
      break;
    }
    if (isTerminalAction(computerCall.action)) {
      result.finalText ||= computerCall.action.result || computerCall.action.text || 'Northstar marked this worker complete.';
      break;
    }

    lastComputerCall = computerCall;
    result.actions.push({ step, action: computerCall.action });
    console.log(`${worker.id}: executing ${formatAction(computerCall.action)}`);
    await executeKernelAction(browser.session_id, computerCall.action, lastSize);
  }

  const finalShot = await takePageScreenshot(browser.session_id, path.join(workerDir, 'final.png'));
  result.screenshots.push({ step: 'final', filename: rel(finalShot.filepath) });
  result.manifest = {
    worker: worker.id,
    title: worker.title,
    prompt: worker.prompt,
    outputContract: worker.outputContract,
    liveViewUrl: result.liveViewUrl,
    actions: result.actions.map((item) => item.action),
  };

  record('worker.completed', {
    worker: worker.id,
    sessionId: result.sessionId,
    liveViewUrl: result.liveViewUrl,
    finalText: result.finalText,
  });

  return result;
}

async function runNorthstarAssembler(workerResults, assemblerPlan) {
  const workerDir = path.join(screenshotsDir, 'assembler');
  fs.mkdirSync(workerDir, { recursive: true });

  const browser = await createBrowser();
  const startUrl = dataUrl(assemblerWorkbenchHtml(workerResults, assemblerPlan));
  await kernelStdout([
    'browsers',
    'playwright',
    'execute',
    browser.session_id,
    `await page.goto(${JSON.stringify(startUrl)}, { waitUntil: "domcontentloaded" }); return await page.title();`,
  ]);

  const assembler = {
    ...assemblerPlan,
    sessionId: browser.session_id,
    liveViewUrl: browser.browser_live_view_url,
    actions: [],
    screenshots: [],
    finalText: '',
    manifest: workerResults.map((worker) => worker.manifest),
  };

  record('assembler.started', {
    sessionId: browser.session_id,
    liveViewUrl: browser.browser_live_view_url,
    prompt: assemblerPlan.prompt,
  });

  let previousResponseId = null;
  let lastComputerCall = null;
  let lastSize = { width: 1280, height: 800 };

  for (let step = 1; step <= assemblerMaxSteps; step += 1) {
    const screenshot = await takePageScreenshot(browser.session_id, path.join(workerDir, `step-${String(step).padStart(2, '0')}.png`));
    lastSize = screenshot.size;
    assembler.screenshots.push({
      step,
      filename: rel(screenshot.filepath),
    });

    const input =
      step === 1
        ? [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `${assemblerPlan.prompt}

You are the dedicated Northstar assembler agent for the final robot. You control the visible assembly webpage in this Kernel browser.

The main agent has already delegated parts to separate worker agents. Their output contracts are below:
${JSON.stringify(workerResults.map((worker) => worker.manifest), null, 2)}

Use the UI directly. Prefer this simple workflow:
1. Click one part tile in the Assembly Parts palette.
2. Click the workplane where that part should go.
3. Repeat until the final robot is assembled.

Place the body near the center, the head above it, arms on the left and right, feet below, then add the antenna, eyes, and chest screen. Do not rely on hidden scripts. Use one computer action at a time. When the assembled robot is complete, answer with a short sentence containing the word "complete".`,
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

    console.log(`assembler: asking Northstar step ${step}`);
    const response = await client.responses.create({
      model,
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

    previousResponseId = response.id;
    record('northstar.response', { worker: 'assembler', step, response });

    const text = extractText(response);
    if (text) {
      assembler.finalText = text;
      console.log(`assembler: ${text}`);
    }
    if (isDoneText(text)) {
      break;
    }

    const computerCall = response.output?.find((item) => item.type === 'computer_call');
    if (!computerCall) {
      assembler.finalText ||= text || 'Northstar finished without another computer action.';
      break;
    }
    if (isTerminalAction(computerCall.action)) {
      assembler.finalText ||= computerCall.action.result || computerCall.action.text || 'Northstar marked assembly complete.';
      break;
    }

    lastComputerCall = computerCall;
    assembler.actions.push({ step, action: computerCall.action });
    console.log(`assembler: executing ${formatAction(computerCall.action)}`);
    await executeKernelAction(browser.session_id, computerCall.action, lastSize);
  }

  const screenshot = await takePageScreenshot(browser.session_id, path.join(workerDir, 'final.png'));
  assembler.screenshot = rel(screenshot.filepath);
  assembler.screenshots.push({ step: 'final', filename: assembler.screenshot });
  record('assembler.completed', assembler);
  return assembler;
}

function makePlan(prompt) {
  return {
    prompt,
    plannerRole: 'Main agent only writes prompts and assigns Kernel workers.',
    workers: [
      {
        id: 'head',
        title: 'Head Northstar agent',
        color: '#6842b9',
        part: 'robot head',
        prompt: `Build only the robot head for this prompt: "${prompt}". Use purple block-like geometry for the head, add two white/bright eye markers, and add a small antenna marker above it.`,
        outputContract: { part: 'head', anchor: 'top of body', approximateColor: 'purple' },
      },
      {
        id: 'body',
        title: 'Body Northstar agent',
        color: '#2f9e59',
        part: 'robot body',
        prompt: `Build only the robot body for this prompt: "${prompt}". Use a green torso, then add a small cyan chest screen or button on the front.`,
        outputContract: { part: 'body', anchor: 'center of robot', approximateColor: 'green' },
      },
      {
        id: 'arms',
        title: 'Arms Northstar agent',
        color: '#ed7a22',
        part: 'robot arms',
        prompt: `Build only the robot arms for this prompt: "${prompt}". Make two orange arm pieces, one left and one right, with simple hand caps if possible.`,
        outputContract: { part: 'arms', anchor: 'left and right side of body', approximateColor: 'orange' },
      },
      {
        id: 'feet',
        title: 'Feet Northstar agent',
        color: '#1664c0',
        part: 'robot feet',
        prompt: `Build only the robot feet for this prompt: "${prompt}". Make two blue wheel-like feet and simple supports that could connect to the body.`,
        outputContract: { part: 'feet', anchor: 'bottom of body', approximateColor: 'blue' },
      },
    ],
    assembler: {
      id: 'assembler',
      title: 'Assembler Northstar agent',
      prompt: `Assemble the final robot for this prompt: "${prompt}". Use the completed worker contracts for head, body, arms, and feet. Build one coherent robot on the workplane, placing parts in the correct relative positions.`,
      outputContract: { part: 'complete robot', anchor: 'assembled scene', approximateColor: 'multi-color' },
    },
  };
}

async function createBrowser() {
  const stdout = await kernelStdout([
    'browsers',
    'create',
    '-o',
    'json',
    '--no-color',
    '--viewport',
    viewport,
    '--timeout',
    '600',
  ]);
  return JSON.parse(stripAnsi(stdout));
}

async function takePageScreenshot(sessionId, filepath) {
  const output = await kernelStdout([
    'browsers',
    'playwright',
    'execute',
    sessionId,
    'return Buffer.from(await page.screenshot({ fullPage: false })).toString("base64");',
  ]);
  fs.writeFileSync(filepath, Buffer.from(extractCliResultString(output), 'base64'));
  const size = readPngDimensions(filepath);
  return {
    filepath,
    size,
    dataUrl: `data:image/png;base64,${fs.readFileSync(filepath, 'base64')}`,
  };
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
          for (const key of keys) {
            await playwrightExecute(sessionId, `await page.keyboard.press(${JSON.stringify(key)});`);
          }
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

async function kernelStdout(args) {
  const { stdout } = await execFileAsync('kernel', args, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function workerHtml(worker) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(worker.title)} - Northstar MiniCAD</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; min-height: 100vh; overflow: hidden; }
    header { height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; background: #fff; border-bottom: 1px solid #d8e1ea; }
    h1 { margin: 0; font-size: 22px; }
    header p { margin: 4px 0 0; color: #607080; font-size: 14px; }
    .workspace { position: absolute; left: 24px; top: 94px; right: 352px; bottom: 24px; border: 1px solid #b9d8e7; border-radius: 8px; overflow: hidden; background: #eef9fc; }
    .grid { position: absolute; inset: 0; background: linear-gradient(#c9e8f4 1px, transparent 1px), linear-gradient(90deg, #c9e8f4 1px, transparent 1px); background-size: 24px 24px; transform: skewX(-14deg) scaleY(0.84); transform-origin: center bottom; }
    .workspace-label { position: absolute; left: 28px; bottom: 20px; color: rgba(24, 91, 129, 0.28); font-size: 44px; font-weight: 900; font-style: italic; }
    .palette { position: absolute; right: 0; top: 72px; bottom: 0; width: 328px; padding: 18px; background: #fff; border-left: 1px solid #d8e1ea; }
    .palette h2 { margin: 0 0 12px; font-size: 18px; }
    .shape-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    button.primitive { height: 118px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; display: grid; place-items: center; cursor: pointer; font: inherit; color: #182330; font-weight: 800; }
    button.primitive.selected { outline: 4px solid rgba(22, 100, 192, .28); border-color: #1664c0; }
    .thumb { position: relative; width: 62px; height: 62px; pointer-events: none; }
    .thumb.box { background: ${worker.color}; border-radius: 8px; box-shadow: inset -12px -14px rgba(0,0,0,0.12); }
    .thumb.cylinder { border-radius: 50% / 18%; background: ${worker.color}; box-shadow: inset -12px -20px rgba(0,0,0,0.14); }
    .thumb.sphere { border-radius: 50%; background: radial-gradient(circle at 30% 26%, #fff 0 6%, ${worker.color} 26%, #0b5cad 100%); }
    .thumb.cone { width: 0; height: 0; border-left: 34px solid transparent; border-right: 34px solid transparent; border-bottom: 66px solid ${worker.color}; filter: drop-shadow(9px 10px 0 rgba(0,0,0,0.12)); }
    .part { position: absolute; z-index: 3; display: grid; place-items: center; color: white; font-size: 11px; font-weight: 800; box-shadow: 0 16px 24px rgba(21, 38, 55, 0.18); }
    .part.box { width: 88px; height: 70px; border-radius: 8px; background: ${worker.color}; }
    .part.cylinder { width: 82px; height: 72px; border-radius: 50% / 18%; background: ${worker.color}; }
    .part.sphere { width: 64px; height: 64px; border-radius: 50%; background: radial-gradient(circle at 30% 24%, #fff 0 6%, ${worker.color} 25%, #0b5cad 100%); }
    .part.cone { width: 0; height: 0; border-left: 38px solid transparent; border-right: 38px solid transparent; border-bottom: 74px solid ${worker.color}; filter: drop-shadow(0 16px 14px rgba(21,38,55,.2)); }
    .instructions { margin-top: 16px; padding: 12px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; color: #435466; line-height: 1.5; font-size: 14px; }
    .log { margin-top: 12px; padding: 12px; border: 1px solid #d8e1ea; border-radius: 8px; background: #101820; color: #dff7ec; min-height: 150px; font-size: 13px; line-height: 1.45; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(worker.title)}</h1>
      <p>${escapeHtml(worker.part)} · controlled by its own Northstar agent</p>
    </div>
    <strong>Kernel worker: ${escapeHtml(worker.id)}</strong>
  </header>
  <main>
    <section id="workspace" class="workspace" aria-label="CAD workplane">
      <div class="grid"></div>
      <div class="workspace-label">Workplane</div>
    </section>
    <aside class="palette" aria-label="Shape palette">
      <h2>Basic Shapes</h2>
      <div class="shape-grid">
        <button class="primitive" data-shape="box" type="button" aria-label="Box primitive"><div class="thumb box"></div><span>Box</span></button>
        <button class="primitive" data-shape="cylinder" type="button" aria-label="Cylinder primitive"><div class="thumb cylinder"></div><span>Cylinder</span></button>
        <button class="primitive" data-shape="sphere" type="button" aria-label="Sphere primitive"><div class="thumb sphere"></div><span>Sphere</span></button>
        <button class="primitive" data-shape="cone" type="button" aria-label="Cone primitive"><div class="thumb cone"></div><span>Cone</span></button>
      </div>
      <div class="instructions">Click a primitive, then click the workplane to place it. Repeat until your assigned part is complete.</div>
      <div id="log" class="log">No shapes placed yet.</div>
    </aside>
  </main>
  <script>
    const workspace = document.querySelector("#workspace");
    const log = document.querySelector("#log");
    const buttons = [...document.querySelectorAll(".primitive")];
    window.demoManifest = { worker: ${JSON.stringify(worker.id)}, parts: [] };
    let selected = "box";
    setSelected(selected);

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        selected = button.dataset.shape;
        setSelected(selected);
        writeLog("Selected " + selected + ". Click the workplane to place it.");
      });
    });

    workspace.addEventListener("click", (event) => {
      const rect = workspace.getBoundingClientRect();
      const x = Math.round(event.clientX - rect.left);
      const y = Math.round(event.clientY - rect.top);
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      const part = document.createElement("div");
      part.className = "part " + selected;
      part.style.left = Math.round(x - 38) + "px";
      part.style.top = Math.round(y - 34) + "px";
      part.textContent = selected === "box" ? "BOX" : "";
      workspace.append(part);
      window.demoManifest.parts.push({ shape: selected, x, y, color: ${JSON.stringify(worker.color)} });
      writeLog("Placed " + selected + " at (" + x + ", " + y + ").");
    });

    function setSelected(shape) {
      for (const button of buttons) button.classList.toggle("selected", button.dataset.shape === shape);
    }

    function writeLog(line) {
      const existing = log.textContent === "No shapes placed yet." ? "" : log.textContent + "\\n";
      log.textContent = existing + line;
    }
  </script>
</body>
</html>`;
}

function assemblerWorkbenchHtml(workerResults, assemblerPlan) {
  const cards = workerResults
    .map(
      (worker) => `<article>
        <h2>${escapeHtml(worker.title)}</h2>
        <p>${escapeHtml(worker.outputContract?.part || worker.part)} · ${escapeHtml(worker.outputContract?.anchor || '')}</p>
        <a href="${escapeHtml(worker.liveViewUrl)}">live view</a>
      </article>`,
    )
    .join('');
  const parts = [
    { id: 'body', label: 'Body', className: 'body' },
    { id: 'head', label: 'Head', className: 'head' },
    { id: 'left-arm', label: 'Left Arm', className: 'arm left' },
    { id: 'right-arm', label: 'Right Arm', className: 'arm right' },
    { id: 'left-foot', label: 'Left Foot', className: 'foot left' },
    { id: 'right-foot', label: 'Right Foot', className: 'foot right' },
    { id: 'antenna', label: 'Antenna', className: 'antenna' },
    { id: 'eye', label: 'Eye', className: 'eye' },
    { id: 'screen', label: 'Screen', className: 'screen' },
  ];
  const partButtons = parts
    .map((part) => `<button class="part-button" data-part="${escapeHtml(part.id)}" type="button"><span class="mini ${escapeHtml(part.className)}"></span><strong>${escapeHtml(part.label)}</strong></button>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(assemblerPlan.title)} - Parallel CAD</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; min-height: 100vh; overflow: hidden; }
    header { height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; background: #fff; border-bottom: 1px solid #d8e1ea; }
    h1 { margin: 0; font-size: 22px; }
    header p { margin: 4px 0 0; color: #607080; font-size: 14px; }
    .workspace { position: absolute; left: 24px; top: 94px; right: 376px; bottom: 24px; border: 1px solid #b9d8e7; border-radius: 8px; overflow: hidden; background: #eef9fc; }
    .grid { position: absolute; inset: 0; background: linear-gradient(#c9e8f4 1px, transparent 1px), linear-gradient(90deg, #c9e8f4 1px, transparent 1px); background-size: 24px 24px; transform: skewX(-14deg) scaleY(0.84); transform-origin: center bottom; }
    .workspace-label { position: absolute; left: 28px; bottom: 20px; color: rgba(24, 91, 129, 0.28); font-size: 44px; font-weight: 900; font-style: italic; }
    .palette { position: absolute; right: 0; top: 72px; bottom: 0; width: 352px; padding: 18px; background: #fff; border-left: 1px solid #d8e1ea; overflow: auto; }
    .palette h2 { margin: 0 0 12px; font-size: 18px; }
    .part-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    button.part-button { min-height: 86px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; display: grid; place-items: center; gap: 6px; cursor: pointer; font: inherit; color: #182330; }
    button.part-button.selected { outline: 4px solid rgba(22, 100, 192, .28); border-color: #1664c0; }
    .mini { position: relative; display: block; pointer-events: none; }
    .mini.body { width: 44px; height: 38px; border-radius: 7px; background: #2f9e59; }
    .mini.head { width: 42px; height: 32px; border-radius: 7px; background: #6842b9; }
    .mini.arm { width: 54px; height: 13px; border-radius: 999px; background: #ed7a22; }
    .mini.foot { width: 42px; height: 22px; border-radius: 50%; background: #1664c0; }
    .mini.antenna { width: 7px; height: 42px; border-radius: 999px; background: #e7b32b; }
    .mini.eye { width: 24px; height: 18px; border-radius: 5px; background: #fff; border: 2px solid #6842b9; }
    .mini.screen { width: 46px; height: 25px; border-radius: 6px; background: #38b6d8; }
    .placed { position: absolute; z-index: 3; display: block; box-shadow: 0 16px 24px rgba(21, 38, 55, 0.18); }
    .placed.body { width: 156px; height: 136px; border-radius: 14px; background: #2f9e59; }
    .placed.head { width: 128px; height: 90px; border-radius: 12px; background: #6842b9; }
    .placed.arm { width: 110px; height: 27px; border-radius: 999px; background: #ed7a22; }
    .placed.arm.left { transform: rotate(-14deg); }
    .placed.arm.right { transform: rotate(14deg); }
    .placed.foot { width: 80px; height: 42px; border-radius: 50%; background: #1664c0; }
    .placed.antenna { width: 9px; height: 50px; border-radius: 999px; background: #e7b32b; }
    .placed.antenna::before { content: ""; position: absolute; left: -9px; top: -14px; width: 27px; height: 27px; border-radius: 50%; background: #e7b32b; }
    .placed.eye { width: 18px; height: 18px; border-radius: 5px; background: #fff; }
    .placed.screen { width: 84px; height: 42px; border-radius: 8px; background: #38b6d8; }
    .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }
    article { border: 1px solid #d8e1ea; border-radius: 8px; padding: 9px; background: #fbfdff; }
    article h2 { margin: 0 0 5px; font-size: 14px; }
    article p { margin: 0 0 5px; color: #526373; font-size: 12px; line-height: 1.35; }
    a { color: #0b5cad; font-weight: 800; }
    .instructions { margin-top: 14px; padding: 12px; border: 1px solid #d8e1ea; border-radius: 8px; background: #f8fafc; color: #435466; line-height: 1.45; font-size: 13px; }
    .log { margin-top: 12px; padding: 12px; border: 1px solid #d8e1ea; border-radius: 8px; background: #101820; color: #dff7ec; min-height: 106px; font-size: 12px; line-height: 1.4; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(assemblerPlan.title)}</h1>
      <p>Controlled by its own Northstar agent using worker outputs</p>
    </div>
    <strong>Kernel worker: assembler</strong>
  </header>
  <main>
    <section id="workspace" class="workspace" aria-label="Final robot assembly workplane">
      <div class="grid"></div>
      <div class="workspace-label">Final Assembly</div>
    </section>
    <aside class="palette" aria-label="Assembly part palette">
      <h2>Assembly Parts</h2>
      <div class="part-grid">${partButtons}</div>
      <div class="instructions">Click a part tile, then click the workplane to place it. Use the worker outputs as the assembly spec.</div>
      <div class="cards">${cards}</div>
      <div id="log" class="log">No assembly parts placed yet.</div>
    </aside>
  </main>
  <script>
    const workspace = document.querySelector("#workspace");
    const log = document.querySelector("#log");
    const buttons = [...document.querySelectorAll(".part-button")];
    window.demoManifest = { worker: "assembler", parts: [] };
    let selected = "body";
    setSelected(selected);

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        selected = button.dataset.part;
        setSelected(selected);
        writeLog("Selected " + selected + ". Click the workplane to place it.");
      });
    });

    workspace.addEventListener("click", (event) => {
      const rect = workspace.getBoundingClientRect();
      const x = Math.round(event.clientX - rect.left);
      const y = Math.round(event.clientY - rect.top);
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      const part = document.createElement("div");
      part.className = "placed " + partClass(selected);
      part.style.left = Math.round(x - partOffset(selected).x) + "px";
      part.style.top = Math.round(y - partOffset(selected).y) + "px";
      workspace.append(part);
      window.demoManifest.parts.push({ part: selected, x, y });
      writeLog("Placed " + selected + " at (" + x + ", " + y + ").");
    });

    function partOffset(part) {
      const offsets = {
        body: { x: 78, y: 68 },
        head: { x: 64, y: 45 },
        "left-arm": { x: 55, y: 14 },
        "right-arm": { x: 55, y: 14 },
        "left-foot": { x: 40, y: 21 },
        "right-foot": { x: 40, y: 21 },
        antenna: { x: 5, y: 50 },
        eye: { x: 9, y: 9 },
        screen: { x: 42, y: 21 },
      };
      return offsets[part] || { x: 40, y: 30 };
    }

    function partClass(part) {
      const classes = {
        body: "body",
        head: "head",
        "left-arm": "arm left",
        "right-arm": "arm right",
        "left-foot": "foot left",
        "right-foot": "foot right",
        antenna: "antenna",
        eye: "eye",
        screen: "screen",
      };
      return classes[part] || "body";
    }

    function setSelected(part) {
      for (const button of buttons) button.classList.toggle("selected", button.dataset.part === part);
    }

    function writeLog(line) {
      const existing = log.textContent === "No assembly parts placed yet." ? "" : log.textContent + "\\n";
      log.textContent = existing + line;
    }
  </script>
</body>
</html>`;
}

function writeResultPage(workerResults, assembler) {
  const workerCards = workerResults
    .map(
      (worker) => `<article class="worker">
        <h2>${escapeHtml(worker.title)}</h2>
        <p><strong>Main prompt to worker:</strong> ${escapeHtml(worker.prompt)}</p>
        <p><a href="${escapeHtml(worker.liveViewUrl)}">Kernel live view</a></p>
        <pre>${escapeHtml(worker.actions.map((item) => `step ${item.step}: ${formatAction(item.action)}`).join('\n') || 'No actions captured.')}</pre>
        <div class="shots">${worker.screenshots
          .map((shot) => `<figure><img src="${escapeHtml(shot.filename)}" alt="${escapeHtml(worker.id)} step ${escapeHtml(shot.step)}"><figcaption>${escapeHtml(worker.id)} · ${escapeHtml(shot.step)}</figcaption></figure>`)
          .join('')}</div>
      </article>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northstar Parallel CAD Demo</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182330; background: #f3f6f8; }
    body { margin: 0; }
    main { max-width: 1220px; margin: 0 auto; padding: 34px 22px 60px; }
    h1 { margin: 0 0 8px; font-size: 34px; }
    .lede { color: #526373; max-width: 900px; line-height: 1.55; margin: 0 0 22px; }
    a.button { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border-radius: 7px; background: #1664c0; color: white; text-decoration: none; font-weight: 800; margin-bottom: 22px; }
    .assembler, .worker { background: #fff; border: 1px solid #d8e1ea; border-radius: 8px; padding: 16px; box-shadow: 0 10px 26px rgba(22,35,49,.08); margin-bottom: 18px; }
    .assembler img { width: 100%; border: 1px solid #d8e1ea; border-radius: 8px; background: #eef9fc; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(390px, 1fr)); gap: 16px; }
    .shots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    figure { margin: 0; }
    figure img { width: 100%; border: 1px solid #d8e1ea; border-radius: 7px; background: #eef9fc; }
    figcaption { margin-top: 5px; color: #526373; font-size: 12px; line-height: 1.35; }
    pre { white-space: pre-wrap; border-radius: 8px; padding: 12px; background: #101820; color: #dff7ec; font-size: 12px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <h1>Northstar Parallel CAD Demo</h1>
    <p class="lede">Prompt: ${escapeHtml(userPrompt)}. The main agent only produced worker and assembler prompts. Each worker, including the assembler, got its own Kernel browser and its own Northstar computer-use loop to operate the CAD UI from screenshots.</p>
    <a class="button" href="${escapeHtml(assembler.liveViewUrl)}">Open assembler live view</a>
    <section class="assembler">
      <h2>Assembler output</h2>
      <img src="${escapeHtml(assembler.screenshot)}" alt="Assembler output">
      <pre>${escapeHtml(assembler.actions.map((item) => `step ${item.step}: ${formatAction(item.action)}`).join('\n') || 'No assembler actions captured.')}</pre>
      <div class="shots">${assembler.screenshots
        .map((shot) => `<figure><img src="${escapeHtml(shot.filename)}" alt="assembler step ${escapeHtml(shot.step)}"><figcaption>assembler · ${escapeHtml(shot.step)}</figcaption></figure>`)
        .join('')}</div>
    </section>
    <section class="grid">${workerCards}</section>
  </main>
</body>
</html>`;

  fs.writeFileSync(path.join(runDir, 'result.html'), html);
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
  if (action.type === 'drag') return `drag ${(action.path || []).map((p) => `(${p.x},${p.y})`).join(' -> ')}`;
  if (action.type === 'move') return `move to (${action.x}, ${action.y})`;
  if (action.type === 'point_and_type') return `point and type at (${action.x}, ${action.y}): ${JSON.stringify(action.text)}`;
  if (action.type === 'type') return `type ${JSON.stringify(action.text)}`;
  if (action.type === 'key') return `key ${(action.keys || []).join('+')}`;
  if (action.type === 'keypress') return `keypress ${(action.keys || []).join('+')}`;
  if (action.type === 'scroll') return `scroll (${action.scroll_x}, ${action.scroll_y}) at (${action.x}, ${action.y})`;
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

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function rel(filepath) {
  return path.relative(runDir, filepath).replaceAll(path.sep, '/');
}

function record(type, payload) {
  fs.appendFileSync(eventsPath, `${JSON.stringify({ type, timestamp: new Date().toISOString(), payload })}\n`);
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
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

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
