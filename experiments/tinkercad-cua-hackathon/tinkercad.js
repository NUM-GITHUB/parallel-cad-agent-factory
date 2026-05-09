require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Kernel = require("@onkernel/sdk").default;
const Lightcone = require("@tzafon/lightcone").default;

// Tour Tinkercad — Autodesk's free in-browser 3D modeller.
// The full 3D editor sits behind an Autodesk sign-in we cannot satisfy
// without credentials, so the goal here is a well-documented public tour:
// homepage → sign-up wall (peek and back out) → Gallery → open one design.
// IMPORTANT: the screenshot includes the browser's address bar at the top,
// but it is NOT an interactable form input from the agent's view. The agent
// must use the `navigate` action for URL changes, never type into the URL bar.
const START_URL = "https://www.tinkercad.com/";
const TASK = [
  "You are on Tinkercad (tinkercad.com), Autodesk's free in-browser 3D design tool. The 3D editor itself requires an Autodesk account, so today's goal is a public tour of the site rather than a full design build.",
  "Visible at the top of the screenshot is the browser chrome (tab bar, address bar). DO NOT click into the address bar and DO NOT type URLs there — it does not work. To go to a different URL, emit a `navigate` action, never a click+type.",
  "STEP 1: From the homepage, click the 'Sign Up' or 'JOIN NOW' button at the very top right of the page. Take note of what the resulting Autodesk sign-up form looks like.",
  "STEP 2: Use the browser's back button (the ← arrow in the top-left of the page chrome — coordinates around (20, 60)) to return to the homepage. If that fails, emit a `navigate` action to https://www.tinkercad.com/.",
  "STEP 3: From the homepage, click 'Gallery' in the top navigation bar (it's the second nav item, around y≈120, plain text not a dropdown). The Gallery shows public 3D designs created by the community.",
  "STEP 4: Once the Gallery loads, scroll down once to see more designs, then click on the first design tile to open its detail page.",
  "STEP 5: On the design detail page, take a moment to observe the 3D model (you should see a rendered design with title and author info), then stop — the tour is complete.",
  "Hard rules: never invent credentials; never click the same coordinates more than twice in a row; for URL changes always emit `navigate`, never type into the address bar; if a button doesn't respond to a click, try a different element instead of repeating.",
].join(" ");

const OUT_DIR = path.join(__dirname, "tinkercad_out");
const WIDTH = 1280;
const HEIGHT = 800;
// Kernel's screenshot composites browser chrome (tabs + URL bar) into the
// captured image. Northstar can't tell chrome from page, and confidently
// clicks on the URL bar. Crop the chrome out and offset Y back when clicking.
const CHROME_OFFSET = 85;
const PAGE_HEIGHT = HEIGHT - CHROME_OFFSET;

async function grabPng(kernel, sessionId) {
  const res = await kernel.browsers.computer.captureScreenshot(sessionId, {
    region: { x: 0, y: CHROME_OFFSET, width: WIDTH, height: PAGE_HEIGHT },
  });
  return Buffer.from(await res.arrayBuffer());
}

// Northstar gives coordinates in cropped (page-only) space. The viewport
// Kernel actually clicks into is full-window space, so add CHROME_OFFSET to Y.
const toViewportY = (y) => (y == null ? null : y + CHROME_OFFSET);

async function execAction(kernel, sessionId, action) {
  switch (action.type) {
    case "click":
      await kernel.browsers.computer.clickMouse(sessionId, { x: action.x, y: toViewportY(action.y) });
      break;
    case "double_click":
      await kernel.browsers.computer.clickMouse(sessionId, { x: action.x, y: toViewportY(action.y), numClicks: 2 });
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
        y: toViewportY(action.y ?? PAGE_HEIGHT / 2),
        delta_x: action.scroll_x ?? 0,
        delta_y: action.scroll_y ?? 0,
      });
      break;
    case "drag":
      await kernel.browsers.computer.dragMouse(sessionId, {
        path: [
          [action.x, toViewportY(action.y)],
          [action.end_x, toViewportY(action.end_y)],
        ],
      });
      break;
    case "navigate":
      await kernel.browsers.playwright.execute(sessionId, {
        code: `await page.goto(${JSON.stringify(action.url)})`,
      });
      break;
    case "wait":
      await new Promise((r) => setTimeout(r, 2000));
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
    case "wait":         return `wait`;
    default:             return action.type;
  }
}

function actionKey(action) {
  return `${action.type}:${action.x ?? ""}:${action.y ?? ""}:${action.text ?? ""}:${(action.keys ?? []).join("+")}`;
}

function buildReport(steps, task, liveViewUrl, finalResult) {
  const cards = steps.map((s, i) => `
    <div class="card">
      <div class="label"><span class="num">${i + 1}</span><code>${s.label}</code></div>
      <img src="${path.basename(s.file)}" alt="step ${i + 1}" />
    </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Tinkercad CUA · Kernel + Northstar</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:1380px;margin:0 auto;padding:24px;background:#f5f5f5}
  h1{margin-bottom:4px}
  .meta{font-size:.85rem;color:#555;margin-bottom:18px}
  .meta a{color:#0070f3}
  .task{background:#fff;border:1px solid #ddd;padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:.88rem;line-height:1.5}
  .result{background:#eef7ff;border:1px solid #b6d4fe;padding:12px 16px;border-radius:8px;margin-bottom:24px;font-size:.9rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(580px,1fr));gap:18px}
  .card{background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)}
  .label{padding:9px 14px;font-size:.8rem;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px}
  .num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#0070f3;color:#fff;font-weight:700;font-size:.7rem;flex-shrink:0}
  img{width:100%;display:block}
</style>
</head>
<body>
<h1>Tinkercad CUA · Kernel + Northstar</h1>
<p class="meta">
  Live view: <a href="${liveViewUrl}" target="_blank">${liveViewUrl}</a> &nbsp;·&nbsp;
  ${steps.length} steps captured
</p>
<div class="task"><strong>Task:</strong> ${task}</div>
${finalResult ? `<div class="result"><strong>Agent result:</strong> ${finalResult}</div>` : ""}
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
    timeoutSeconds: 600,
  });

  const sessionId = session.session_id;
  const liveViewUrl = session.browser_live_view_url;
  console.log("\n  Live view  :", liveViewUrl);
  console.log("  Session    :", sessionId);

  // Handle Ctrl-C / kill so we don't leak the cloud browser.
  let cleaningUp = false;
  const cleanup = async (signal) => {
    if (cleaningUp) return;
    cleaningUp = true;
    console.log(`\n  Caught ${signal} — deleting browser ${sessionId}…`);
    try {
      await kernel.browsers.deleteByID(sessionId);
      console.log("  ✓ Browser deleted.");
    } catch (e) {
      console.error("  ✗ Delete failed:", e.message);
    }
    process.exit(signal === "SIGINT" ? 130 : 1);
  };
  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("SIGTERM", () => cleanup("SIGTERM"));

  try {
    await runAgent(kernel, tzafon, sessionId, liveViewUrl);
  } finally {
    if (!cleaningUp) {
      console.log("  Cleaning up browser session…");
      try {
        await kernel.browsers.deleteByID(sessionId);
        console.log("  ✓ Browser deleted:", sessionId);
      } catch (e) {
        console.error("  ✗ Browser delete FAILED:", sessionId, "—", e.message);
        console.error("    Run `node cleanup.js` to delete leaked sessions.");
      }
    }
  }
}

async function runAgent(kernel, tzafon, sessionId, liveViewUrl) {
  console.log("  Navigating to", START_URL, "…");
  await kernel.browsers.playwright.execute(sessionId, {
    code: `await page.goto(${JSON.stringify(START_URL)})`,
  });
  // Tinkercad's homepage has heavy JS — give it a moment.
  await new Promise((r) => setTimeout(r, 3000));

  const steps = [];
  let finalResult = null;

  const snapshot = async (label) => {
    const n = String(steps.length).padStart(2, "0");
    const file = path.join(OUT_DIR, `step_${n}.png`);
    const buf = await grabPng(kernel, sessionId);
    fs.writeFileSync(file, buf);
    steps.push({ label, file });
    return buf.toString("base64");
  };

  let b64 = await snapshot("initial — tinkercad.com");
  console.log("  Task       :", TASK.slice(0, 100) + "…\n");

  let response = await tzafon.responses.create({
    model: "tzafon.northstar-cua-fast",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: TASK },
        { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
      ],
    }],
    tools: [{ type: "computer_use", display_width: WIDTH, display_height: PAGE_HEIGHT, environment: "browser" }],
  });

  const recentKeys = [];
  const MAX_STEPS = 60;

  for (let step = 0; step < MAX_STEPS; step++) {
    const call = response.output?.find((o) => o.type === "computer_call");
    if (!call) {
      // Northstar may have emitted a final text message instead of an action.
      const msg = response.output?.find((o) => o.type === "message");
      if (msg) {
        const text = (msg.content ?? []).map((c) => c.text ?? "").join(" ").trim();
        if (text) {
          finalResult = text;
          console.log("  Final message:", text);
        }
      }
      console.log("✓ Done (no further actions).");
      break;
    }

    const action = call.action;
    const label = actionLabel(action);
    console.log(`  [${String(step + 1).padStart(2, "0")}] ${label}`);

    if (["terminate", "done", "answer"].includes(action.type)) {
      finalResult = action.text ?? action.result ?? "(done)";
      console.log("  Result:", finalResult);
      await snapshot(`result: ${String(finalResult).slice(0, 60)}`);
      break;
    }

    const key = actionKey(action);
    recentKeys.push(key);
    if (recentKeys.length > 3) recentKeys.shift();
    if (recentKeys.length === 3 && recentKeys.every((k) => k === key)) {
      console.log("  ⚠ Loop detected — same action 3× in a row. Stopping.");
      finalResult = "Stopped: same action repeated 3 times in a row.";
      await snapshot("loop detected — stopped");
      break;
    }

    await execAction(kernel, sessionId, action);
    // Tinkercad's editor is heavy; give navigations and drags a generous beat.
    const settle = action.type === "navigate" ? 3000 : action.type === "drag" ? 1800 : 1200;
    await new Promise((r) => setTimeout(r, settle));
    b64 = await snapshot(`after: ${label}`);

    response = await tzafon.responses.create({
      model: "tzafon.northstar-cua-fast",
      previous_response_id: response.id,
      input: [{
        type: "computer_call_output",
        call_id: call.call_id,
        output: { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
      }],
      tools: [{ type: "computer_use", display_width: WIDTH, display_height: PAGE_HEIGHT, environment: "browser" }],
    });
  }

  const reportPath = path.join(OUT_DIR, "report.html");
  fs.writeFileSync(reportPath, buildReport(steps, TASK, liveViewUrl, finalResult));

  console.log(`\n  ${steps.length} screenshots → ${OUT_DIR}/`);
  console.log("  HTML report:", reportPath);
  console.log("  Live view  :", liveViewUrl);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
