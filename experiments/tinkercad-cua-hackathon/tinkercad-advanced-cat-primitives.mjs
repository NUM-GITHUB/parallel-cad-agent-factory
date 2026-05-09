import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Kernel from "@onkernel/sdk";

const SESSION_ID = process.env.TINKERCAD_SESSION_ID || "bci8oiwimwel2pllyo9nyznt";
const PROJECT_URL =
  process.env.TINKERCAD_PROJECT_URL ||
  "https://www.tinkercad.com/things/2HmQNHPw1so/edit?returnTo=%2Fdashboard%3Ftype%3Ddesigns";
const DESIGN_NAME = "Advanced 3D Cat Tutorial Primitives";
const OUT_DIR = path.join(process.cwd(), "advanced_cat_out");
const WIDTH = 1280;
const HEIGHT = 800;
const CHROME_OFFSET = 85;

const shapeSelectors = {
  box: "#sidebar-item-box",
  cylinder: "#sidebar-item-cylinder",
  sphere: "#sidebar-item-sphere",
  cone: "#sidebar-item-cone",
  roof: "#sidebar-item-roof",
  roundRoof: "#sidebar-item-halfCylinder",
  halfSphere: "#sidebar-item-halfSphere",
  torus: "#sidebar-item-torus",
};

const palette = {
  gray: { x: 996, y: 403 },
  darkGray: { x: 1036, y: 403 },
  black: { x: 1036, y: 445 },
  white: { x: 996, y: 361 },
  cream: { x: 676, y: 361 },
};

const stages = [
  {
    name: "head_ears",
    screenshot: "stage_01_head_ears",
    parts: [
      {
        name: "head sphere",
        shape: "sphere",
        color: "gray",
        values: [0, 28, 34, 28.26, 24.96, 24.66],
        note: "00:37 head sphere dimensions from the tutorial",
      },
      {
        name: "left ear cone",
        shape: "cone",
        color: "gray",
        values: [-10, 27, 56, 14.47, 11.64, 16.72],
        note: "00:54 tutorial uses paraboloid; current Basic Shapes exposes cone as the closest tapered primitive",
      },
      {
        name: "right ear cone",
        shape: "cone",
        color: "gray",
        values: [10, 27, 56, 14.47, 11.64, 16.72],
      },
      {
        name: "left inner ear",
        shape: "cone",
        color: "cream",
        values: [-10, 31, 59, 8.2, 5.8, 10.5],
      },
      {
        name: "right inner ear",
        shape: "cone",
        color: "cream",
        values: [10, 31, 59, 8.2, 5.8, 10.5],
      },
    ],
  },
  {
    name: "muzzle_eyes",
    screenshot: "stage_02_muzzle_eyes",
    parts: [
      {
        name: "left muzzle sphere",
        shape: "sphere",
        color: "cream",
        values: [-4.2, 55, 39, 8, 7.27, 7],
        note: "01:41 paired small muzzle spheres",
      },
      {
        name: "right muzzle sphere",
        shape: "sphere",
        color: "cream",
        values: [4.2, 55, 39, 8, 7.27, 7],
      },
      {
        name: "lower muzzle sphere",
        shape: "sphere",
        color: "cream",
        values: [0, 56, 34, 7.6, 6.5, 6.8],
      },
      {
        name: "nose bridge round roof",
        shape: "roundRoof",
        color: "cream",
        values: [0, 56, 44, 7, 3, 2],
        note: "02:24 round-roof bridge, 7 mm wide and 2 mm tall",
      },
      {
        name: "nose roof",
        shape: "roof",
        color: "black",
        values: [0, 60, 41, 5, 2.5, 2],
        note: "02:37 roof nose, 5 mm wide and 2 mm tall",
      },
      {
        name: "left eye white",
        shape: "sphere",
        color: "white",
        values: [-7, 54, 46, 7.27, 8.23, 7],
        note: "03:58 eye spheres",
      },
      {
        name: "right eye white",
        shape: "sphere",
        color: "white",
        values: [7, 54, 46, 7.27, 8.23, 7],
      },
      {
        name: "left pupil",
        shape: "sphere",
        color: "black",
        values: [-7, 60, 46.5, 3, 3, 4],
        note: "04:36 pupil spheres",
      },
      {
        name: "right pupil",
        shape: "sphere",
        color: "black",
        values: [7, 60, 46.5, 3, 3, 4],
      },
    ],
  },
  {
    name: "body_neck",
    screenshot: "stage_03_body_neck",
    parts: [
      {
        name: "body sphere",
        shape: "sphere",
        color: "gray",
        values: [0, 0, 14, 25, 50, 25],
        note: "05:09 elongated sphere body, 50 mm long and 25 mm wide",
      },
      {
        name: "neck cylinder",
        shape: "cylinder",
        color: "gray",
        values: [0, 20, 26, 12, 12, 18],
        note: "05:30 cylinder between body and head",
      },
    ],
  },
  {
    name: "legs_paws",
    screenshot: "stage_04_legs_paws",
    parts: [
      {
        name: "left front shoulder",
        shape: "sphere",
        color: "gray",
        values: [-8, 20, 14, 13, 14, 11],
        note: "06:04 front leg shoulder sphere, 13 x 14 x 11",
      },
      {
        name: "right front shoulder",
        shape: "sphere",
        color: "gray",
        values: [8, 20, 14, 13, 14, 11],
      },
      {
        name: "left front leg cylinder",
        shape: "cylinder",
        color: "gray",
        values: [-8, 22, 0, 8, 8, 22],
      },
      {
        name: "right front leg cylinder",
        shape: "cylinder",
        color: "gray",
        values: [8, 22, 0, 8, 8, 22],
      },
      {
        name: "left front paw",
        shape: "halfSphere",
        color: "cream",
        values: [-8, 31, 0, 10, 12, 6],
        note: "06:48 half-sphere paws, 10 x 12 x 6",
      },
      {
        name: "right front paw",
        shape: "halfSphere",
        color: "cream",
        values: [8, 31, 0, 10, 12, 6],
      },
      {
        name: "left back haunch",
        shape: "sphere",
        color: "gray",
        values: [-9, -18, 11, 12, 20, 14],
        note: "07:25 rear haunch from a 20 mm long sphere",
      },
      {
        name: "right back haunch",
        shape: "sphere",
        color: "gray",
        values: [9, -18, 11, 12, 20, 14],
      },
      {
        name: "left back leg cylinder",
        shape: "cylinder",
        color: "gray",
        values: [-9, -24, 0, 8, 8, 18],
      },
      {
        name: "right back leg cylinder",
        shape: "cylinder",
        color: "gray",
        values: [9, -24, 0, 8, 8, 18],
      },
      {
        name: "left back paw",
        shape: "halfSphere",
        color: "cream",
        values: [-9, -32, 0, 10, 12, 6],
      },
      {
        name: "right back paw",
        shape: "halfSphere",
        color: "cream",
        values: [9, -32, 0, 10, 12, 6],
      },
    ],
  },
  {
    name: "tail",
    screenshot: "stage_05_tail_final",
    parts: [
      {
        name: "torus tail loop",
        shape: "torus",
        color: "gray",
        values: [0, -35, 28, 40, 40, 9],
        note: "08:06 tutorial torus tail, 40 x 40 and 9 tall",
      },
      {
        name: "tail tip cap",
        shape: "sphere",
        color: "gray",
        values: [0, -52, 39, 10, 10, 10],
      },
    ],
  },
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

function js(value) {
  return JSON.stringify(value);
}

async function screenshot(kernel, label) {
  const file = path.join(OUT_DIR, `${label}.png`);
  const res = await kernel.browsers.computer.captureScreenshot(SESSION_ID, {
    region: { x: 0, y: CHROME_OFFSET, width: WIDTH, height: HEIGHT - CHROME_OFFSET },
  });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`screenshot ${file}`);
  return file;
}

async function openProject(kernel) {
  return execute(
    kernel,
    `
      page.on("dialog", async dialog => dialog.accept().catch(() => null));
      await page.goto(${js(PROJECT_URL)}, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(7000);
      const state = {
        url: page.url(),
        title: await page.title().catch(() => ""),
        text: await page.evaluate(() => document.body.innerText.slice(0, 1200)).catch(() => "")
      };
      if (/log in|sign in|password|verification|captcha|personal accounts/i.test(state.text)) {
        throw new Error("Tinkercad sign-in or verification is showing. Pause here and let the user sign in through the live view.");
      }
      return state;
    `,
    90_000,
  );
}

async function renameDesign(kernel) {
  await execute(
    kernel,
    `
      await page.keyboard.press("Escape").catch(() => null);
      const title = page.locator("#topnav-title").first();
      const input = page.locator("#topnav-title-input").first();
      if (await title.count()) await title.click({ timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(400);
      if (await input.count()) {
        await input.fill(${js(DESIGN_NAME)}).catch(async () => {
          await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
          await page.keyboard.type(${js(DESIGN_NAME)});
        });
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(1500);
      return page.url();
    `,
  );
}

async function clearWorkplane(kernel) {
  await execute(
    kernel,
    `
      await page.keyboard.press("Escape").catch(() => null);
      await page.waitForTimeout(300);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.waitForTimeout(300);
      await page.locator("#subnavcontrol-editor3d-delete").click({ timeout: 5000 }).catch(async () => {
        await page.keyboard.press("Delete");
      });
      await page.waitForTimeout(3500);
      await page.keyboard.press("Escape").catch(() => null);
    `,
  );
}

async function placeRuler(kernel) {
  await execute(
    kernel,
    `
      const ruler = await page.locator("#sidebar-toolbox-ruler").boundingBox();
      const canvas = await page.locator("canvas").nth(1).boundingBox();
      if (!ruler || !canvas) throw new Error("Missing ruler or canvas");
      await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.58, { steps: 18 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
    `,
  );
}

async function addShape(kernel, shape, drop = { x: 0.55, y: 0.34 }) {
  const selector = shapeSelectors[shape];
  if (!selector) throw new Error(`Unknown shape: ${shape}`);
  await execute(
    kernel,
    `
      if (!/\\/edit/i.test(page.url())) {
        throw new Error("Editor is no longer open before adding shape ${shape}: " + page.url());
      }
      await page.keyboard.press("Escape").catch(() => null);
      const source = page.locator(${js(selector)}).first();
      await source.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(200);
      const src = await source.boundingBox();
      const canvas = await page.locator("canvas").nth(1).boundingBox();
      if (!src || !canvas) throw new Error("Shape not found or not visible: ${shape}");
      await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width * ${drop.x}, canvas.y + canvas.height * ${drop.y}, { steps: 22 });
      await page.mouse.up();
      await page.waitForTimeout(2600);
      const labels = await page.locator(".dimension-label-view.visible").evaluateAll(els => els.map(e => e.innerText.trim())).catch(() => []);
      if (!labels.length) {
        await page.mouse.click(canvas.x + canvas.width * ${drop.x}, canvas.y + canvas.height * ${drop.y});
        await page.waitForTimeout(900);
      }
    `,
  );
}

async function setRulerValues(kernel, values) {
  await execute(
    kernel,
    `
      const getLabels = async () => {
        const all = await page.locator(".dimension-label-view.visible").evaluateAll(els => els.map((e, j) => {
          const b = e.getBoundingClientRect();
          const label = e.querySelector(".label");
          const input = e.querySelector("input.value");
          const text = (label?.textContent || e.innerText || "").trim();
          const inputValue = input?.value || "";
          return { j, text: text || inputValue, x: b.x, y: b.y, w: b.width, h: b.height };
        }));
        return all.filter(label => !String(label.text).includes("°"));
      };
      const values = ${js(values)};
      const order = [3, 4, 5, 2, 0, 1];
      for (const i of order) {
        const desired = values[i];
        if (desired === null || desired === undefined) continue;
        if (!/\\/edit/i.test(page.url())) {
          throw new Error("Editor is no longer open while setting label " + i + ": " + page.url());
        }
        const labels = await getLabels();
        if (!labels[i]) throw new Error("Missing ruler label " + i + ": " + JSON.stringify(labels));
        const current = Number(labels[i].text);
        if (Number.isFinite(current) && Math.abs(current - Number(desired)) < 0.01) continue;
        const l = labels[i];
        await page.mouse.click(l.x + l.w / 2, l.y + l.h / 2, { clickCount: 2 });
        await page.waitForTimeout(120);
        let activeInput = await page.evaluate(() => {
          const el = document.activeElement;
          if (!(el instanceof HTMLInputElement) || !el.classList.contains("value")) return false;
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        });
        if (!activeInput) {
          await page.mouse.click(l.x + l.w / 2, l.y + l.h / 2, { clickCount: 2 });
          await page.waitForTimeout(180);
          activeInput = await page.evaluate(() => {
            const el = document.activeElement;
            if (!(el instanceof HTMLInputElement) || !el.classList.contains("value")) return false;
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
          });
        }
        if (!activeInput) {
          throw new Error("Could not open ruler label input " + i + ": " + JSON.stringify(labels));
        }
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.type(String(desired));
        await page.keyboard.press("Enter");
        await page.waitForTimeout(420);
      }
      await page.waitForTimeout(700);
    `,
  );
}

async function setColor(kernel, colorName) {
  const point = palette[colorName];
  if (!point) throw new Error(`Unknown color: ${colorName}`);
  await execute(
    kernel,
    `
      await page.locator("#colorButtonInspector").click({ timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(450);
      await page.mouse.click(${point.x}, ${point.y});
      await page.waitForTimeout(600);
      await page.keyboard.press("Escape").catch(() => null);
      await page.waitForTimeout(250);
    `,
  );
}

async function buildPart(kernel, part) {
  console.log(`placing ${part.name}`);
  await addShape(kernel, part.shape);
  await setRulerValues(kernel, part.values);
  await setColor(kernel, part.color);
}

async function collectStatus(kernel) {
  return execute(
    kernel,
    `
      await page.keyboard.press("Escape").catch(() => null);
      await page.waitForTimeout(2500);
      return {
        url: page.url(),
        title: await page.title().catch(() => ""),
        visibleTitle: await page.locator("#topnav-title, #topnav-title-input").first().evaluate(e => e.value || e.textContent).catch(() => null),
        labelCount: await page.locator(".dimension-label-view.visible").count().catch(() => 0),
        body: await page.evaluate(() => document.body.innerText.slice(0, 1000)).catch(() => "")
      };
    `,
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const screenshots = [];
  const tutorialSteps = [];

  await openProject(kernel);
  await renameDesign(kernel);
  await clearWorkplane(kernel);
  await placeRuler(kernel);
  screenshots.push(await screenshot(kernel, "stage_00_empty_with_ruler"));

  for (const stage of stages) {
    console.log(`stage ${stage.name}`);
    for (const part of stage.parts) {
      await buildPart(kernel, part);
      if (part.note) tutorialSteps.push({ part: part.name, note: part.note, values: part.values });
    }
    screenshots.push(await screenshot(kernel, stage.screenshot));
  }

  const status = await collectStatus(kernel);
  status.designName = DESIGN_NAME;
  status.video = "https://www.youtube.com/watch?v=gDMqKux9Bzo";
  status.method = "Tinkercad primitive build; no STL/OBJ/mesh import used.";
  status.tutorialSteps = tutorialSteps;
  status.screenshots = screenshots;
  fs.writeFileSync(
    path.join(OUT_DIR, "advanced-cat-primitive-result.json"),
    `${JSON.stringify(status, null, 2)}\n`,
  );
  console.log(JSON.stringify(status, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
