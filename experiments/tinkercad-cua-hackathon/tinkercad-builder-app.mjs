// Kernel cloud-deployed CUA app — builds a 3D design on Tinkercad using Northstar.
// Deploy:  npx kernel deploy tinkercad-builder-app.mjs --env-file .env
// Invoke:  npx kernel invoke tinkercad-builder build
// Env vars are injected by Kernel at deploy time; dotenv is not used.

import Kernel from "@onkernel/sdk";
import { KernelApp } from "@onkernel/sdk/core/app-framework";
import Lightcone from "@tzafon/lightcone";

const WIDTH = 1280;
const HEIGHT = 800;
// Kernel composites browser chrome (tab bar + URL bar) into screenshots.
// Cropping it out lets Northstar see only page content and prevents it from
// mistakenly clicking the address bar.
const CHROME_OFFSET = 85;
const PAGE_HEIGHT = HEIGHT - CHROME_OFFSET;
const MODEL = "tzafon.northstar-cua-fast";

const TASK = [
  "You are on the Tinkercad dashboard (already logged in).",
  "Goal: create a new 3D design, place a Box shape on the canvas, rename it 'My Hackathon House', then stop.",
  "",
  "IMPORTANT — NEVER click the address bar or type URLs directly. Use `navigate` for page changes.",
  "",
  "STEP 1 — Create a new 3D design:",
  "  Look for a blue 'Create new design' or '+' button and click it.",
  "  If a type picker appears, choose '3D Design'.",
  "  If a template picker appears, choose 'Empty'.",
  "  If you're not on the Tinkercad dashboard yet, use `navigate` to go to https://www.tinkercad.com/users/me",
  "",
  "STEP 2 — Add a Box to the canvas:",
  "  You should see the 3D editor: a grey grid workspace with a shape library on the right.",
  "  Find 'Box' in the shape library (it looks like a cube). Drag it onto the centre of the grey grid.",
  "",
  "STEP 3 — Rename the design:",
  "  Click the design name at the top-left (usually shows 'Untitled' or a random name).",
  "  Type: My Hackathon House",
  "  Press Enter to confirm.",
  "",
  "DONE — Once the box is on the canvas and the name is saved, you are finished.",
  "",
  "RULES:",
  "  - If an auth gate appears unexpectedly, use `navigate` to https://www.tinkercad.com/users/me",
  "  - If you get stuck 2 steps in a row, scroll or press Escape then try a different element.",
].join("\n");

function getTinkercadCredentials() {
  const email = process.env.TINKERCAD_EMAIL ?? process.env.AUTODESK_EMAIL;
  const password = process.env.TINKERCAD_PASSWORD ?? process.env.AUTODESK_PASSWORD;

  if (!email || !password) {
    throw new Error("Set TINKERCAD_EMAIL and TINKERCAD_PASSWORD in .env before deploying this app.");
  }

  return { email, password };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function grabPng(kernel, sessionId) {
  const res = await kernel.browsers.computer.captureScreenshot(sessionId, {
    region: { x: 0, y: CHROME_OFFSET, width: WIDTH, height: PAGE_HEIGHT },
  });
  return Buffer.from(await res.arrayBuffer());
}

// Northstar coordinates are in cropped (page-only) space.
// Clamp to valid range before converting to viewport coordinates.
const clampX = (x) => (x == null ? null : Math.max(0, Math.min(x, WIDTH - 1)));
const clampY = (y) => (y == null ? null : Math.max(0, Math.min(y, PAGE_HEIGHT - 1)));
const toVpY = (y) => (y == null ? null : clampY(y) + CHROME_OFFSET);

async function execAction(kernel, sessionId, action) {
  try {
    switch (action.type) {
      case "click":
        await kernel.browsers.computer.clickMouse(sessionId, { x: clampX(action.x), y: toVpY(action.y) });
        break;
      case "double_click":
        await kernel.browsers.computer.clickMouse(sessionId, { x: clampX(action.x), y: toVpY(action.y), numClicks: 2 });
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
          x: clampX(action.x ?? WIDTH / 2),
          y: toVpY(action.y ?? PAGE_HEIGHT / 2),
          delta_x: action.scroll_x ?? 0,
          delta_y: action.scroll_y ?? 0,
        });
        break;
      case "drag":
        await kernel.browsers.computer.dragMouse(sessionId, {
          path: [
            [clampX(action.x), toVpY(action.y)],
            [clampX(action.end_x), toVpY(action.end_y)],
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
        console.log(`  (unhandled action type: ${action.type})`);
    }
  } catch (err) {
    console.log(`  ⚠ execAction error (${action.type}): ${err.message ?? err}`);
    // Continue — a single failed action should not abort the run.
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
  const { email, password } = getTinkercadCredentials();

  console.log(`[${ctx.invocation_id}] Starting Tinkercad builder…`);

  const session = await kernel.browsers.create({
    stealthMode: true,
    viewport: { width: WIDTH, height: HEIGHT },
    timeoutSeconds: 900,
  });
  const { session_id: sessionId, browser_live_view_url: liveViewUrl } = session;

  console.log(`\n  ┌─ LIVE VIEW ────────────────────────────────`);
  console.log(`  │  ${liveViewUrl}`);
  console.log(`  └────────────────────────────────────────────\n`);

  try {
    // ── PHASE 1: Playwright-driven login (deterministic, no Northstar needed) ──
    console.log("  Navigating to Tinkercad…");
    await kernel.browsers.playwright.execute(sessionId, {
      code: `await page.goto("https://www.tinkercad.com/")`,
    });
    await new Promise((r) => setTimeout(r, 3000));

    console.log("  Clicking Log In…");
    await kernel.browsers.playwright.execute(sessionId, {
      code: `
        const btn = await page.$('a:has-text("Log In"), a:has-text("Sign In"), button:has-text("Log In")');
        if (btn) { await btn.click(); }
        else { await page.goto("https://www.tinkercad.com/users/me"); }
      `,
    });
    await new Promise((r) => setTimeout(r, 5000));

    // Fill in email on the Autodesk SSO page.
    console.log("  Filling email…");
    await kernel.browsers.playwright.execute(sessionId, {
      code: `
        await page.waitForSelector('input[type="email"], input[name="email"], input[name="userName"], input[id*="email"], input[id*="user"]', { timeout: 15000 });
        const emailField = await page.$('input[type="email"], input[name="email"], input[name="userName"], input[id*="email"], input[id*="user"]');
        if (emailField) {
          await emailField.fill(${JSON.stringify(email)});
          await page.keyboard.press("Enter");
        }
      `,
    });
    await new Promise((r) => setTimeout(r, 3000));

    // Fill in password.
    console.log("  Filling password…");
    await kernel.browsers.playwright.execute(sessionId, {
      code: `
        await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 15000 });
        const pwField = await page.$('input[type="password"], input[name="password"]');
        if (pwField) {
          await pwField.fill(${JSON.stringify(password)});
          await page.keyboard.press("Enter");
        }
      `,
    });

    // Wait for redirect back to Tinkercad.
    console.log("  Waiting for Tinkercad dashboard…");
    await new Promise((r) => setTimeout(r, 8000));

    // If we're on an intermediate Autodesk page (account picker, consent, etc), click Continue/OK.
    await kernel.browsers.playwright.execute(sessionId, {
      code: `
        const cont = await page.$('button:has-text("Continue"), button:has-text("Allow"), button:has-text("Accept"), button:has-text("OK"), a:has-text("Continue")');
        if (cont) await cont.click();
      `,
    });
    await new Promise((r) => setTimeout(r, 5000));

    // Check current URL.
    const urlResult = await kernel.browsers.playwright.execute(sessionId, {
      code: `return page.url()`,
    });
    console.log("  Current URL:", urlResult);

    // If not yet on tinkercad.com, try navigating to dashboard.
    if (!String(urlResult).includes("tinkercad.com")) {
      await kernel.browsers.playwright.execute(sessionId, {
        code: `await page.goto("https://www.tinkercad.com/users/me")`,
      });
      await new Promise((r) => setTimeout(r, 5000));
    }

    console.log("  Auth phase done. Handing off to Northstar…\n");

    let png = await grabPng(kernel, sessionId);
    let b64 = png.toString("base64");

    let response = await tzafon.responses.create({
      model: MODEL,
      input: [{
        role: "user",
        content: [
          { type: "input_text",  text: TASK },
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
        const msgText = msg ? (msg.content ?? []).map((c) => c.text ?? "").join(" ").trim() : "";

        if (!msgText) {
          // Truly empty response — agent is done.
          console.log("  ✓ Done — no output.");
          finalResult = "completed";
          break;
        }

        // Northstar sometimes emits a reasoning message instead of an action.
        // Always nudge it to continue with a fresh screenshot.
        console.log(`  [--] Agent thinking: ${msgText.slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 1000));
        png = await grabPng(kernel, sessionId);
        b64 = png.toString("base64");
        response = await tzafon.responses.create({
          model: MODEL,
          previous_response_id: response.id,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: "Continue executing the task. Look at the current browser state and take the next action now." },
              { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
            ],
          }],
          tools: [{ type: "computer_use", display_width: WIDTH, display_height: PAGE_HEIGHT, environment: "browser" }],
        });
        continue;
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

      // Loop detection: abort if the same action repeats 3× consecutively.
      const k = keyOf(action);
      recentKeys.push(k);
      if (recentKeys.length > 3) recentKeys.shift();
      if (recentKeys.length === 3 && recentKeys.every((x) => x === k)) {
        finalResult = "Stopped: same action repeated 3 times in a row.";
        console.log(`  ⚠ ${finalResult}`);
        break;
      }

      await execAction(kernel, sessionId, action);

      // Tinkercad's WebGL editor is heavy — give navigations and drags extra settling time.
      const settle = action.type === "navigate" ? 4000
                   : action.type === "drag"     ? 2000
                   :                              1200;
      await new Promise((r) => setTimeout(r, settle));

      png = await grabPng(kernel, sessionId);
      b64 = png.toString("base64");

      response = await tzafon.responses.create({
        model: MODEL,
        previous_response_id: response.id,  // chains Northstar's context memory — never omit
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

    console.log(`\n  Total steps : ${stepCount}`);
    console.log(`  Live view   : ${liveViewUrl}\n`);

    return { liveViewUrl, steps: stepCount, result: finalResult ?? "completed" };

  } finally {
    try { await kernel.browsers.deleteByID(sessionId); } catch (_) {
      try { await kernel.browsers.delete(sessionId); } catch (_2) { /* best-effort */ }
    }
  }
});
