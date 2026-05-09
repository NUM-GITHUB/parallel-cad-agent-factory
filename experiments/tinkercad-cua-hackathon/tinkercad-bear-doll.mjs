import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Kernel from "@onkernel/sdk";

const SESSION_ID = process.env.TINKERCAD_SESSION_ID || "ep3r5xvs33td4hto6eq3nxu7";
const OUT_DIR = path.join(process.cwd(), "bear_doll_out");
const WIDTH = 1280;
const HEIGHT = 800;
const CHROME_OFFSET = 85;

const colors = {
  bear: { x: 676, y: 362 },
  muzzle: { x: 676, y: 362 },
  black: { x: 1036, y: 446 },
  yellow: { x: 676, y: 404 },
  brown: { x: 956, y: 404 },
};

const parts = [
  { name: "body", shape: "sphere", color: "bear", values: [null, 0, 0, 36, 32, 46], drop: { x: 0.45, y: 0.52 } },
  { name: "head", shape: "sphere", color: "bear", values: [null, 41, -4, 44, 42, 42], drop: { x: 0.45, y: 0.43 } },
  { name: "muzzle", shape: "sphere", color: "muzzle", values: [null, 52, -25, 20, 10, 14], drop: { x: 0.45, y: 0.43 } },
  { name: "left ear", shape: "sphere", color: "bear", values: [null, 74, -4, 15, 9, 15], drop: { x: 0.42, y: 0.39 } },
  { name: "right ear", shape: "sphere", color: "bear", values: [null, 74, -4, 15, 9, 15], drop: { x: 0.48, y: 0.39 } },
  { name: "left eye", shape: "sphere", color: "black", values: [null, 60, -28, 5, 3, 6], drop: { x: 0.43, y: 0.42 } },
  { name: "right eye", shape: "sphere", color: "black", values: [null, 60, -28, 5, 3, 6], drop: { x: 0.47, y: 0.42 } },
  { name: "nose", shape: "sphere", color: "black", values: [null, 56, -31, 8, 4, 7], drop: { x: 0.45, y: 0.44 } },
  { name: "left arm", shape: "sphere", color: "bear", values: [null, 12, -4, 13, 11, 32], drop: { x: 0.38, y: 0.55 } },
  { name: "right arm", shape: "sphere", color: "bear", values: [null, 12, -4, 13, 11, 32], drop: { x: 0.52, y: 0.55 } },
  { name: "left leg", shape: "sphere", color: "bear", values: [null, 0, -23, 15, 28, 15], drop: { x: 0.42, y: 0.66 } },
  { name: "right leg", shape: "sphere", color: "bear", values: [null, 0, -23, 15, 28, 15], drop: { x: 0.48, y: 0.66 } },
  { name: "belly", shape: "sphere", color: "muzzle", values: [null, 17, -24, 22, 6, 25], drop: { x: 0.45, y: 0.55 } },
];

async function execute(kernel, code, timeout = 120_000) {
  const response = await kernel.browsers.playwright.execute(SESSION_ID, {
    code,
    timeout_sec: Math.ceil(timeout / 1000),
  });
  if (response?.success === false) {
    throw new Error(response.error || response.stderr || "Playwright execute failed");
  }
  return response?.result ?? response;
}

async function screenshot(kernel, label) {
  const res = await kernel.browsers.computer.captureScreenshot(SESSION_ID, {
    region: { x: 0, y: CHROME_OFFSET, width: WIDTH, height: HEIGHT - CHROME_OFFSET },
  });
  fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), Buffer.from(await res.arrayBuffer()));
}

function jsString(value) {
  return JSON.stringify(String(value));
}

async function renameDesign(kernel) {
  await execute(kernel, `
    const desired = "Bear Doll Tutorial Build";
    await page.keyboard.press("Escape").catch(() => null);
    const title = page.locator("#topnav-title").first();
    const input = page.locator("#topnav-title-input").first();
    if (await title.count()) await title.click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(400);
    if (await input.count()) {
      await input.fill(desired).catch(async () => {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.type(desired);
      });
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(1500);
    return page.url();
  `);
}

async function clearWorkplane(kernel) {
  await execute(kernel, `
    await page.keyboard.press("Escape").catch(() => null);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.waitForTimeout(300);
    await page.keyboard.press("Backspace").catch(async () => page.keyboard.press("Delete"));
    await page.waitForTimeout(3000);
  `);
}

async function placeRuler(kernel) {
  await execute(kernel, `
    const ruler = await page.locator("#sidebar-toolbox-ruler").boundingBox();
    const canvas = await page.locator("canvas").nth(1).boundingBox();
    await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.58, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  `);
}

async function addShape(kernel, shape, drop = { x: 0.55, y: 0.34 }) {
  const selector = shape === "text" ? "#sidebar-item-text" : `#sidebar-item-${shape}`;
  await execute(kernel, `
    await page.keyboard.press("Escape").catch(() => null);
    const src = await page.locator(${jsString(selector)}).boundingBox();
    if (!src) throw new Error("Shape not found: ${shape}");
    const canvas = await page.locator("canvas").nth(1).boundingBox();
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * ${drop.x}, canvas.y + canvas.height * ${drop.y}, { steps: 22 });
    await page.mouse.up();
    await page.waitForTimeout(2600);
    let labels = await page.locator(".dimension-label-view.visible").evaluateAll(els => els.map(e => e.innerText.trim())).catch(() => []);
    if (!labels.length) {
      await page.mouse.click(canvas.x + canvas.width * ${drop.x}, canvas.y + canvas.height * ${drop.y});
      await page.waitForTimeout(900);
    }
  `);
}

async function setLabel(kernel, index, value) {
  await execute(kernel, `
    const labels = await page.locator(".dimension-label-view.visible").evaluateAll(els => els.map((e, i) => {
      const b = e.getBoundingClientRect();
      return { i, text: e.innerText.trim(), x: b.x, y: b.y, w: b.width, h: b.height };
    }));
    if (!labels[${index}]) throw new Error("Missing ruler label ${index}: " + JSON.stringify(labels));
    const l = labels[${index}];
    if (Number.isFinite(Number(l.text)) && Math.abs(Number(l.text) - Number(${jsString(value)})) < 0.01) return true;
    await page.mouse.click(l.x + l.w / 2, l.y + l.h / 2, { clickCount: 2 });
    await page.waitForTimeout(120);
    const input = page.locator(".dimension-label-view.visible").nth(${index}).locator("input.value");
    const visible = await input.evaluate(el => getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden").catch(() => false);
    if (visible) {
      await input.fill(${jsString(value)});
    } else {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.type(${jsString(value)});
    }
    await page.keyboard.press("Enter");
    await page.waitForTimeout(360);
  `);
}

async function setRulerValues(kernel, values) {
  await execute(kernel, `
    const values = ${JSON.stringify(values)};
    const order = [3, 4, 5, 2, 1];
    for (const i of order) {
      const desired = values[i];
      if (desired === null || desired === undefined) continue;
      const labels = await page.locator(".dimension-label-view.visible").evaluateAll(els => els.map((e, j) => {
        const b = e.getBoundingClientRect();
        return { j, text: e.innerText.trim(), x: b.x, y: b.y, w: b.width, h: b.height };
      }));
      if (!labels[i]) throw new Error("Missing ruler label " + i + ": " + JSON.stringify(labels));
      const current = Number(labels[i].text);
      if (Number.isFinite(current) && Math.abs(current - Number(desired)) < 0.01) continue;
      const target = page.locator(".dimension-label-view.visible").nth(i);
      const l = labels[i];
      await target.dblclick({ force: true, timeout: 5000 }).catch(async () => {
        await page.mouse.click(l.x + l.w / 2, l.y + l.h / 2, { clickCount: 2 });
      });
      await page.waitForTimeout(120);
      const input = target.locator("input.value");
      const visible = await input.evaluate(el => getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden").catch(() => false);
      if (visible) {
        await input.fill(String(desired));
      } else {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.type(String(desired));
      }
      await page.keyboard.press("Enter");
      await page.waitForTimeout(420);
    }
    await page.waitForTimeout(700);
  `);
}

async function setColor(kernel, colorName) {
  const p = colors[colorName];
  await execute(kernel, `
    await page.locator("#colorButtonInspector").click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(500);
    await page.mouse.click(${p.x}, ${p.y});
    await page.waitForTimeout(650);
    await page.mouse.click(180, 150);
    await page.waitForTimeout(450);
  `);
}

async function setTextShape(kernel, text) {
  await execute(kernel, `
    await page.waitForTimeout(800);
    const candidates = await page.locator('input, textarea').evaluateAll(els => els.map((e, i) => {
      const b = e.getBoundingClientRect();
      return { i, value: e.value, text: e.textContent, x: b.x, y: b.y, w: b.width, h: b.height, cls: String(e.className) };
    }));
    const index = candidates.find(c => /text|TEXT|abc|ABC/i.test(c.value || c.text || c.cls) || c.w > 40);
    if (index) {
      const el = page.locator('input, textarea').nth(index.i);
      await el.fill(${jsString(text)}).catch(async () => {
        await el.click();
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.type(${jsString(text)});
      });
      await page.keyboard.press("Enter").catch(() => null);
      await page.waitForTimeout(1000);
    }
    return candidates;
  `);
}

async function buildPart(kernel, part) {
  console.log("placing", part.name);
  await addShape(kernel, part.shape, part.drop);
  await setRulerValues(kernel, part.values);
  await setColor(kernel, part.color);
}

async function buildText(kernel) {
  await addShape(kernel, "text", { x: 0.30, y: 0.48 });
  await setTextShape(kernel, "BEAR");
  await setRulerValues(kernel, [-72, 0, -18, 42, 4, 13]);
  await setColor(kernel, "yellow");

  await addShape(kernel, "text", { x: 0.30, y: 0.60 });
  await setTextShape(kernel, "DOLL");
  await setRulerValues(kernel, [-72, 0, -40, 42, 4, 13]);
  await setColor(kernel, "yellow");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });

  await execute(kernel, `
    page.on("dialog", async dialog => dialog.accept().catch(() => null));
    await page.goto("https://www.tinkercad.com/things/3q02mpqDhaA/edit?returnTo=%2Fdashboard%3Ftype%3Ddesigns", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(7000);
  `);
  await renameDesign(kernel);
  await clearWorkplane(kernel);
  await placeRuler(kernel);
  await screenshot(kernel, "stage_00_empty_with_ruler");

  for (const part of parts.slice(0, 2)) await buildPart(kernel, part);
  await screenshot(kernel, "stage_01_head_body");

  for (const part of parts.slice(2, 8)) await buildPart(kernel, part);
  await screenshot(kernel, "stage_02_face_ears");

  for (const part of parts.slice(8)) await buildPart(kernel, part);
  await screenshot(kernel, "stage_03_limbs_belly");

  await buildText(kernel);
  await execute(kernel, `
    await page.keyboard.press("Escape").catch(() => null);
    await page.waitForTimeout(2500);
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      visibleTitle: await page.locator("#topnav-title, #topnav-title-input").first().evaluate(e => e.value || e.textContent).catch(() => null),
      text: await page.evaluate(() => document.body.innerText.slice(0, 1200)).catch(() => "")
    };
  `);
  await screenshot(kernel, "stage_04_final_bear_doll");

  const status = await execute(kernel, `
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      visibleTitle: await page.locator("#topnav-title, #topnav-title-input").first().evaluate(e => e.value || e.textContent).catch(() => null),
      body: await page.evaluate(() => document.body.innerText.slice(0, 800)).catch(() => "")
    };
  `);
  fs.writeFileSync(path.join(OUT_DIR, "bear-doll-result.json"), `${JSON.stringify(status, null, 2)}\\n`);
  console.log(JSON.stringify(status, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
