require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Kernel = require("@onkernel/sdk").default;
const Lightcone = require("@tzafon/lightcone").default;

async function main() {
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const tzafon = new Lightcone({ apiKey: process.env.TZAFON_API_KEY });

  console.log("Creating Kernel browser session...");
  const session = await kernel.browsers.create({
    stealthMode: true,
    viewport: { width: 1280, height: 800 },
  });
  const sessionId = session.session_id;
  console.log("Live view:", session.browser_live_view_url);
  console.log("Session ID:", sessionId);

  try {
    console.log("Navigating to example.org...");
    await kernel.browsers.playwright.execute(sessionId, {
      code: `await page.goto("https://example.org")`,
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log("Taking initial screenshot...");
    let pngRes = await kernel.browsers.computer.captureScreenshot(sessionId);
    let b64 = Buffer.from(await pngRes.arrayBuffer()).toString("base64");

    console.log("Sending to Northstar...");
    let response = await tzafon.responses.create({
      model: "tzafon.northstar-cua-fast",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "You are on a browser. Confirm you can see example.org and then stop." },
          { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
        ],
      }],
      tools: [{
        type: "computer_use",
        display_width: 1280,
        display_height: 800,
        environment: "browser",
      }],
    });

    for (let step = 0; step < 20; step++) {
      const call = response.output?.find((o) => o.type === "computer_call");
      if (!call) {
        console.log("Northstar finished (no more computer_call).");
        break;
      }
      const action = call.action;
      console.log(`Step ${step + 1}: action=${action.type}`);
      if (["terminate", "done", "answer"].includes(action.type)) {
        console.log("Result:", action.text ?? action.result ?? "done");
        break;
      }

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
          await kernel.browsers.computer.scroll(sessionId, { x: action.x ?? 640, y: action.y ?? 400, deltaX: 0, deltaY: action.scroll_y ?? 0 });
          break;
        case "navigate":
          await kernel.browsers.playwright.execute(sessionId, {
            code: `await page.goto("${action.url}")`,
          });
          break;
      }

      await new Promise((r) => setTimeout(r, 1000));
      pngRes = await kernel.browsers.computer.captureScreenshot(sessionId);
      b64 = Buffer.from(await pngRes.arrayBuffer()).toString("base64");

      response = await tzafon.responses.create({
        model: "tzafon.northstar-cua-fast",
        previous_response_id: response.id,
        input: [{
          type: "computer_call_output",
          call_id: call.call_id,
          output: { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
        }],
        tools: [{
          type: "computer_use",
          display_width: 1280,
          display_height: 800,
          environment: "browser",
        }],
      });
    }

    // Take final screenshot and save
    const finalRes = await kernel.browsers.computer.captureScreenshot(sessionId);
    const finalBuf = Buffer.from(await finalRes.arrayBuffer());
    const outPath = path.join(__dirname, "example_org.png");
    fs.writeFileSync(outPath, finalBuf);
    console.log("Screenshot saved to:", outPath);
  } finally {
    // Non-persistent sessions auto-expire; no explicit delete needed
    console.log("Done. Session will auto-expire.");
  }
}

main().catch(console.error);
