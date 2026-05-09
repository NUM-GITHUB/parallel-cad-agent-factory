require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Kernel = require("@onkernel/sdk").default;
const Lightcone = require("@tzafon/lightcone").default;

// Task: multi-step HN browsing — showcases navigate, scroll, and click
const START_URL = "https://news.ycombinator.com";
const TASK = [
  "You are on Hacker News (news.ycombinator.com).",
  "Step 1: Read the titles of the top 5 stories visible on screen.",
  "Step 2: Scroll down once to reveal more stories.",
  "Step 3: Scroll down once more.",
  "Step 4: Click on the title link of the very first story on the page (story #1).",
  "Step 5: Once the article page loads, scroll down twice to read more content.",
  "Then stop.",
].join(" ");

const OUT_DIR = path.join(__dirname, "demo_out");
const WIDTH = 1280;
const HEIGHT = 800;

// captureScreenshot returns a Fetch Response object
async function grabPng(kernel, sessionId) {
  const res = await kernel.browsers.computer.captureScreenshot(sessionId);
  return Buffer.from(await res.arrayBuffer());
}

async function execAction(kernel, sessionId, action) {
  switch (action.type) {
    case "click":
      await kernel.browsers.computer.clickMouse(sessionId, { x: action.x, y: action.y });
      break;
    case "double_click":
      await kernel.browsers.computer.clickMouse(sessionId, { x: action.x, y: action.y, numClicks: 2 });
      break;
    case "type":
      await kernel.browsers.computer.typeText(sessionId, { text: action.text });
      break;
    case "key":
    case "keypress":
      await kernel.browsers.computer.pressKey(sessionId, { keys: action.keys });
      break;
    case "scroll":
      await kernel.browsers.computer.scroll(sessionId, {
        x: action.x ?? WIDTH / 2,
        y: action.y ?? HEIGHT / 2,
        delta_x: action.scroll_x ?? 0,
        delta_y: action.scroll_y ?? 0,
      });
      break;
    case "drag":
      await kernel.browsers.computer.dragMouse(sessionId, {
        path: [[action.x, action.y], [action.end_x, action.end_y]],
      });
      break;
    case "navigate":
      await kernel.browsers.playwright.execute(sessionId, {
        code: `await page.goto(${JSON.stringify(action.url)})`,
      });
      break;
    default:
      console.log(`  (unhandled action: ${action.type})`);
  }
}

function actionLabel(action) {
  switch (action.type) {
    case "navigate":     return `navigate → ${action.url}`;
    case "type":         return `type ${JSON.stringify(action.text)}`;
    case "click":        return `click (${action.x}, ${action.y})`;
    case "double_click": return `double-click (${action.x}, ${action.y})`;
    case "scroll":       return `scroll Δy=${action.scroll_y ?? 0} at (${action.x ?? "center"}, ${action.y ?? "center"})`;
    case "key":
    case "keypress":     return `keypress [${(action.keys ?? []).join("+")}]`;
    case "drag":         return `drag (${action.x},${action.y})→(${action.end_x},${action.end_y})`;
    default:             return action.type;
  }
}

function actionKey(action) {
  return `${action.type}:${action.x ?? ""}:${action.y ?? ""}:${action.text ?? ""}:${(action.keys ?? []).join("+")}`;
}

function buildReport(steps, task, liveViewUrl) {
  const cards = steps.map((s, i) => `
    <div class="card">
      <div class="label"><span class="num">${i + 1}</span><code>${s.label}</code></div>
      <img src="${path.basename(s.file)}" alt="step ${i + 1}" />
    </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Kernel + Northstar Demo</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:1380px;margin:0 auto;padding:24px;background:#f5f5f5}
  h1{margin-bottom:4px}
  .meta{font-size:.85rem;color:#555;margin-bottom:18px}
  .meta a{color:#0070f3}
  .task{background:#fff;border:1px solid #ddd;padding:12px 16px;border-radius:8px;margin-bottom:24px;font-size:.88rem;line-height:1.5}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(580px,1fr));gap:18px}
  .card{background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)}
  .label{padding:9px 14px;font-size:.8rem;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px}
  .num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#0070f3;color:#fff;font-weight:700;font-size:.7rem;flex-shrink:0}
  img{width:100%;display:block}
</style>
</head>
<body>
<h1>Kernel + Northstar CUA Demo</h1>
<p class="meta">
  Live view: <a href="${liveViewUrl}" target="_blank">${liveViewUrl}</a> &nbsp;·&nbsp;
  ${steps.length} steps captured
</p>
<div class="task"><strong>Task:</strong> ${task}</div>
<div class="grid">${cards}</div>
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const tzafon = new Lightcone({ apiKey: process.env.TZAFON_API_KEY });

  console.log("Creating Kernel browser session…");
  const session = await kernel.browsers.create({
    stealthMode: true,
    viewport: { width: WIDTH, height: HEIGHT },
    timeoutSeconds: 300,
  });

  const sessionId = session.session_id;
  const liveViewUrl = session.browser_live_view_url;
  console.log("\n  Live view  :", liveViewUrl);
  console.log("  Session    :", sessionId);

  // Pre-navigate to starting URL before handing off to Northstar
  console.log("  Navigating to", START_URL, "…");
  await kernel.browsers.playwright.execute(sessionId, {
    code: `await page.goto(${JSON.stringify(START_URL)})`,
  });
  await new Promise((r) => setTimeout(r, 1500));

  const steps = [];

  const snapshot = async (label) => {
    const n = String(steps.length).padStart(2, "0");
    const file = path.join(OUT_DIR, `step_${n}.png`);
    const buf = await grabPng(kernel, sessionId);
    fs.writeFileSync(file, buf);
    steps.push({ label, file });
    return buf.toString("base64");
  };

  let b64 = await snapshot("initial — " + START_URL);
  console.log("  Task       :", TASK.slice(0, 80) + "…\n");

  let response = await tzafon.responses.create({
    model: "tzafon.northstar-cua-fast",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: TASK },
        { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
      ],
    }],
    tools: [{ type: "computer_use", display_width: WIDTH, display_height: HEIGHT, environment: "browser" }],
  });

  // Track recent actions to detect infinite loops
  const recentKeys = [];

  for (let step = 0; step < 40; step++) {
    const call = response.output?.find((o) => o.type === "computer_call");
    if (!call) { console.log("✓ Done (no further actions)."); break; }

    const action = call.action;
    const label = actionLabel(action);
    console.log(`  [${String(step + 1).padStart(2, "0")}] ${label}`);

    if (["terminate", "done", "answer"].includes(action.type)) {
      console.log("  Result:", action.text ?? action.result ?? "(done)");
      await snapshot(`result: ${action.text?.slice(0, 60) ?? "done"}`);
      break;
    }

    // Break out if the same action repeats 5 times consecutively
    const key = actionKey(action);
    recentKeys.push(key);
    if (recentKeys.length > 5) recentKeys.shift();
    if (recentKeys.length === 5 && recentKeys.every((k) => k === key)) {
      console.log("  ⚠ Loop detected — same action 5× in a row. Stopping.");
      await snapshot("loop detected — stopped");
      break;
    }

    await execAction(kernel, sessionId, action);
    await new Promise((r) => setTimeout(r, 1200));
    b64 = await snapshot(`after: ${label}`);

    response = await tzafon.responses.create({
      model: "tzafon.northstar-cua-fast",
      previous_response_id: response.id,
      input: [{
        type: "computer_call_output",
        call_id: call.call_id,
        output: { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
      }],
      tools: [{ type: "computer_use", display_width: WIDTH, display_height: HEIGHT, environment: "browser" }],
    });
  }

  const reportPath = path.join(OUT_DIR, "report.html");
  fs.writeFileSync(reportPath, buildReport(steps, TASK, liveViewUrl));

  console.log(`\n  ${steps.length} screenshots → ${OUT_DIR}/`);
  console.log("  HTML report:", reportPath, "\n");
}

main().catch(console.error);
