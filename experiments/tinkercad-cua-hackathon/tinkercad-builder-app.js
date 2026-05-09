// Kernel cloud-deployed CUA app — builds a 3D design on Tinkercad using Northstar.
// Deploy:  npx kernel deploy tinkercad-builder-app.js --env-file .env
// Invoke:  npx kernel invoke tinkercad-builder build
// Note: dotenv is NOT used here — Kernel injects env vars at deploy time via --env-file.
const { KernelApp } = require("@onkernel/sdk/core/app-framework");
const Kernel = require("@onkernel/sdk").default;
const Lightcone = require("@tzafon/lightcone").default;

const WIDTH = 1280;
const HEIGHT = 800;
// Kernel composites browser chrome (tab bar + URL bar) into screenshots.
// Crop it so Northstar only sees page content and doesn't click the address bar.
const CHROME_OFFSET = 85;
const PAGE_HEIGHT = HEIGHT - CHROME_OFFSET;

const MODEL = "tzafon.northstar-cua-fast";

const TASK = [
  "You are on Tinkercad (tinkercad.com), Autodesk's free in-browser 3D design tool.",
  "Your goal is to CREATE a simple 3D design — a small house shape — inside the Tinkercad 3D editor.",
  "",
  "NAVIGATION RULE: The browser chrome (address bar, tabs) appears at the very top of the screenshot but you CANNOT click into it. To change URLs, emit a `navigate` action — never click the address bar.",
  "",
  "PHASE 1 — Get into the editor:",
  "  1a. If you see a 'Start Tinkering' or 'Tinker this design' button, click it.",
  "  1b. If you see a 'Sign In' / 'Log In' wall, stop and report that Tinkercad credentials are required.",
  "      The ESM runner in tinkercad-builder-app.mjs handles credentials through .env.",
  "  1c. If after sign-in you see an email-verification prompt, click 'Skip for now' or 'Continue' if available.",
  "  1d. If you land on a dashboard, click 'Create new design' or the blue '+' / '3D Design' button.",
  "  1e. If prompted to pick a starter design, choose 'Empty'.",
  "",
  "PHASE 2 — Build a house shape in the 3D editor:",
  "  Once you see the grey 3D grid workspace with a shape panel on the right side:",
  "  2a. From the shape panel, drag a 'Box' shape onto the centre of the grid (this will be the house body).",
  "  2b. Drag a 'Roof' shape (or a 'Wedge' if Roof is absent) and drop it above the box.",
  "  2c. Click the design name field at the top-left (usually 'Untitled') and rename it 'My Hackathon House'.",
  "  2d. Press Enter / click away to confirm the rename.",
  "",
  "PHASE 3 — Save:",
  "  Tinkercad auto-saves. Once the name is set and at least one shape is on the canvas, emit `done`.",
  "",
  "HARD RULES:",
  "  - Never click the same coordinates twice in a row if nothing changed.",
  "  - For URL navigation always use `navigate`, never type in the address bar.",
  "  - If a sign-up step asks for a birth date, enter January 1, 2000.",
  "  - If a CAPTCHA appears, describe what you see and stop.",
  "  - If you get stuck (same screen for 3 steps), try scrolling or pressing Escape, then retry.",
].join("\n");

// ── helpers ──────────────────────────────────────────────────────────────────

async function grabPng(kernel, sessionId) {
  const res = await kernel.browsers.computer.captureScreenshot(sessionId, {
    region: { x: 0, y: CHROME_OFFSET, width: WIDTH, height: PAGE_HEIGHT },
  });
  return Buffer.from(await res.arrayBuffer());
}

// Northstar coordinates are in cropped (page-only) space → add chrome offset for real clicks.
const toVpY = (y) => (y == null ? null : y + CHROME_OFFSET);

async function execAction(kernel, sessionId, action) {
  switch (action.type) {
    case "click":
      await kernel.browsers.computer.clickMouse(sessionId, { x: action.x, y: toVpY(action.y) });
      break;
    case "double_click":
      await kernel.browsers.computer.clickMouse(sessionId, { x: action.x, y: toVpY(action.y), numClicks: 2 });
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
        y: toVpY(action.y ?? PAGE_HEIGHT / 2),
        delta_x: action.scroll_x ?? 0,
        delta_y: action.scroll_y ?? 0,
      });
      break;
    case "drag":
      await kernel.browsers.computer.dragMouse(sessionId, {
        path: [
          [action.x, toVpY(action.y)],
          [action.end_x, toVpY(action.end_y)],
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
      console.log(`  (unhandled: ${action.type})`);
  }
}

function labelOf(action) {
  switch (action.type) {
    case "navigate":      return `navigate → ${action.url}`;
    case "type":          return `type ${JSON.stringify(action.text)}`;
    case "click":         return `click (${action.x}, ${action.y})`;
    case "double_click":  return `double-click (${action.x}, ${action.y})`;
    case "scroll":        return `scroll Δy=${action.scroll_y ?? 0}`;
    case "key":
    case "keypress":      return `key [${(action.keys ?? []).join("+")}]`;
    case "drag":          return `drag (${action.x},${action.y})→(${action.end_x},${action.end_y})`;
    case "wait":          return "wait";
    default:              return action.type;
  }
}

function keyOf(action) {
  return `${action.type}:${action.x ?? ""}:${action.y ?? ""}:${action.text ?? ""}:${(action.keys ?? []).join("+")}`;
}

// ── Kernel app ────────────────────────────────────────────────────────────────

const app = new KernelApp("tinkercad-builder");

app.action("build", async (ctx) => {
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const tzafon = new Lightcone({ apiKey: process.env.TZAFON_API_KEY });

  console.log(`[invocation: ${ctx.invocation_id}] Starting Tinkercad builder…`);

  const session = await kernel.browsers.create({
    stealthMode: true,
    viewport: { width: WIDTH, height: HEIGHT },
    timeoutSeconds: 900,
  });
  const { session_id: sessionId, browser_live_view_url: liveViewUrl } = session;

  console.log(`\n  ┌─ LIVE VIEW ──────────────────────────────────`);
  console.log(`  │  ${liveViewUrl}`);
  console.log(`  └──────────────────────────────────────────────\n`);

  try {
    // Navigate to Tinkercad and give it time to fully load.
    await kernel.browsers.playwright.execute(sessionId, {
      code: `await page.goto("https://www.tinkercad.com/")`,
    });
    await new Promise((r) => setTimeout(r, 3500));

    let png = await grabPng(kernel, sessionId);
    let b64 = png.toString("base64");

    // Initial Northstar call
    let response = await tzafon.responses.create({
      model: MODEL,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: TASK },
          { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
        ],
      }],
      tools: [{ type: "computer_use", display_width: WIDTH, display_height: PAGE_HEIGHT, environment: "browser" }],
    });

    let stepCount = 0;
    const MAX_STEPS = 80;
    const recentKeys = [];
    let finalResult = null;

    for (let step = 0; step < MAX_STEPS; step++) {
      const call = response.output?.find((o) => o.type === "computer_call");

      if (!call) {
        const msg = response.output?.find((o) => o.type === "message");
        if (msg) {
          finalResult = (msg.content ?? []).map((c) => c.text ?? "").join(" ").trim();
          console.log(`  ✓ Agent message: ${finalResult}`);
        }
        console.log("  ✓ Done — no further actions.");
        break;
      }

      const action = call.action;
      const label = labelOf(action);
      stepCount++;
      console.log(`  [${String(stepCount).padStart(2, "0")}] ${label}`);

      if (["terminate", "done", "answer"].includes(action.type)) {
        finalResult = action.text ?? action.result ?? "(task complete)";
        console.log(`  ✓ Result: ${finalResult}`);
        break;
      }

      // Loop detection: abort if same action repeats 3× in a row.
      const k = keyOf(action);
      recentKeys.push(k);
      if (recentKeys.length > 3) recentKeys.shift();
      if (recentKeys.length === 3 && recentKeys.every((x) => x === k)) {
        finalResult = "Stopped: same action repeated 3 times in a row.";
        console.log(`  ⚠ ${finalResult}`);
        break;
      }

      await execAction(kernel, sessionId, action);

      // Give Tinkercad's heavy WebGL editor extra time to settle after navigations/drags.
      const settle = action.type === "navigate" ? 4000 : action.type === "drag" ? 2000 : 1200;
      await new Promise((r) => setTimeout(r, settle));

      png = await grabPng(kernel, sessionId);
      b64 = png.toString("base64");

      response = await tzafon.responses.create({
        model: MODEL,
        previous_response_id: response.id,   // chains Northstar's memory
        input: [{
          type: "computer_call_output",
          call_id: call.call_id,
          output: { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
        }],
        tools: [{ type: "computer_use", display_width: WIDTH, display_height: PAGE_HEIGHT, environment: "browser" }],
      });
    }

    if (stepCount >= MAX_STEPS) {
      finalResult = `Reached max steps (${MAX_STEPS}).`;
      console.log(`  ⚠ ${finalResult}`);
    }

    console.log(`\n  Total steps: ${stepCount}`);
    console.log(`  Live view:   ${liveViewUrl}\n`);

    return {
      liveViewUrl,
      steps: stepCount,
      result: finalResult ?? "completed",
    };

  } finally {
    // Best-effort cleanup.
    try { await kernel.browsers.deleteByID(sessionId); } catch (_) {
      try { await kernel.browsers.delete(sessionId); } catch (_2) { /* ignore */ }
    }
  }
});
