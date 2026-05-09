// Probe: take a full-window screenshot and a cropped (chrome-removed) screenshot
// of tinkercad.com. Check that clickMouse on the page (without offset) hits the
// correct element so we know how to map Northstar's coordinates to clicks.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Kernel = require("@onkernel/sdk").default;

const WIDTH = 1280;
const HEIGHT = 800;
const PROBE_DIR = path.join(__dirname, "probe_out");

async function main() {
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });

  const session = await kernel.browsers.create({
    stealthMode: true,
    viewport: { width: WIDTH, height: HEIGHT },
    timeoutSeconds: 120,
  });
  console.log("Live view:", session.browser_live_view_url);

  try {
    await kernel.browsers.playwright.execute(session.session_id, {
      code: `await page.goto("https://www.tinkercad.com/")`,
    });
    await new Promise((r) => setTimeout(r, 3000));

    // (1) Full-window screenshot
    let res = await kernel.browsers.computer.captureScreenshot(session.session_id);
    const full = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(PROBE_DIR, "full.png"), full);
    console.log("Full screenshot:", full.length, "bytes");

    // (2) Cropped screenshot starting at y=85 (skip browser chrome)
    res = await kernel.browsers.computer.captureScreenshot(session.session_id, {
      region: { x: 0, y: 85, width: WIDTH, height: HEIGHT - 85 },
    });
    const cropped = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(PROBE_DIR, "cropped.png"), cropped);
    console.log("Cropped screenshot:", cropped.length, "bytes");

    // (3) Inspect viewport-vs-window via JS
    const r = await kernel.browsers.playwright.execute(session.session_id, {
      code: `
        return JSON.stringify({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio,
        });
      `,
    });
    console.log("Window dims:", r);
  } finally {
    try { await kernel.browsers.deleteByID(session.session_id); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
