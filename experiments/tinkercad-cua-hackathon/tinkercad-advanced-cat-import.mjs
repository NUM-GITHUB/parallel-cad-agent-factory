import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Kernel from "@onkernel/sdk";

const WIDTH = 1280;
const HEIGHT = 800;
const CHROME_OFFSET = 85;
const PAGE_HEIGHT = HEIGHT - CHROME_OFFSET;
const OUT_DIR = path.join(process.cwd(), "advanced_cat_out");
const ASSET_DIR = path.join(process.cwd(), "advanced_cat_assets");
const STL_PATH = path.join(ASSET_DIR, "advanced_3d_cat.stl");
const REMOTE_STL_PATH = "/tmp/advanced_3d_cat.stl";
const DESIGN_NAME = "Advanced 3D Cat Tutorial Build";

function getTinkercadCredentials() {
  let email = process.env.TINKERCAD_EMAIL ?? process.env.AUTODESK_EMAIL;
  let password = process.env.TINKERCAD_PASSWORD ?? process.env.AUTODESK_PASSWORD;

  if ((!email || !password) && process.env.ALLOW_LEGACY_TINKERCAD_CREDS === "1") {
    const legacyPath = path.join(process.cwd(), "tinkercad-builder-app.mjs");
    if (fs.existsSync(legacyPath)) {
      const legacy = fs.readFileSync(legacyPath, "utf8");
      email ??= legacy.match(/emailField\.fill\("([^"]+)"\)/)?.[1];
      password ??= legacy.match(/pwField\.fill\("([^"]+)"\)/)?.[1];
    }
  }

  if (!email || !password) {
    throw new Error("Set TINKERCAD_EMAIL and TINKERCAD_PASSWORD in .env before running this importer.");
  }

  return { email, password };
}

function ensureAssets() {
  if (!fs.existsSync(STL_PATH)) {
    throw new Error(`Missing ${STL_PATH}. Run: node build-advanced-3d-cat-assets.mjs`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshot(kernel, sessionId, label) {
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const file = path.join(OUT_DIR, `${String(Date.now()).slice(-6)}_${safe}.png`);
  const res = await kernel.browsers.computer.captureScreenshot(sessionId, {
    region: { x: 0, y: CHROME_OFFSET, width: WIDTH, height: PAGE_HEIGHT },
  });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  Screenshot: ${file}`);
  return file;
}

async function execute(kernel, sessionId, code, timeoutSec = 60) {
  const response = await kernel.browsers.playwright.execute(sessionId, {
    code,
    timeout_sec: timeoutSec,
  });
  if (response?.success === false) {
    throw new Error(response.error || response.stderr || "Playwright execution failed");
  }
  return response?.result ?? response;
}

function jsString(value) {
  return JSON.stringify(value);
}

async function logPageState(kernel, sessionId, label) {
  const state = await execute(kernel, sessionId, `
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      text: await page.evaluate(() => document.body?.innerText?.slice(0, 1400) ?? "").catch(() => "")
    };
  `);
  console.log(`  ${label}: ${state.url}`);
  if (/captcha|verify|verification|two-step|authenticator|security code/i.test(state.text)) {
    console.log("  Auth attention text:", state.text.slice(0, 300).replace(/\\s+/g, " "));
  }
  return state;
}

async function signIn(kernel, sessionId, email, password) {
  console.log("  Opening Tinkercad dashboard...");
  await execute(kernel, sessionId, `
    await page.goto("https://www.tinkercad.com/users/me", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
  `);
  await screenshot(kernel, sessionId, "dashboard_or_login");

  let state = await logPageState(kernel, sessionId, "after dashboard navigation");
  if (/tinkercad\.com\/(dashboard|users|things)/i.test(state.url) && !/log in|sign in/i.test(state.text)) {
    console.log("  Already signed in.");
    return;
  }

  console.log("  Signing in through Autodesk...");
  await execute(kernel, sessionId, `
    const clickFirst = async (selectors) => {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count()) {
          await locator.click({ timeout: 5000 }).catch(() => null);
          await page.waitForTimeout(1500);
          return true;
        }
      }
      return false;
    };

    await clickFirst([
      'a:has-text("Log In")',
      'button:has-text("Log In")',
      'a:has-text("Sign In")',
      'button:has-text("Sign In")'
    ]);

    if (!/autodesk|signin|login|accounts/i.test(page.url())) {
      await page.goto("https://www.tinkercad.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    }
    await page.waitForTimeout(1500);

    const proceedAnyway = page.locator('a:has-text("Proceed anyway"), button:has-text("Proceed anyway")').first();
    if (await proceedAnyway.count()) {
      await proceedAnyway.click().catch(() => null);
      await page.waitForTimeout(1000);
    }

    const personalAccount = page.locator('a:has-text("Personal accounts"), button:has-text("Personal accounts")').first();
    if (await personalAccount.count()) {
      await personalAccount.click({ timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(4000);
    }

    const autodeskEmail = page.locator('#autodeskProviderButton, a:has-text("Email or Username"), button:has-text("Email or Username")').first();
    if (await autodeskEmail.count()) {
      await autodeskEmail.click({ timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(4000);
    }

    const emailSelector = 'input[type="email"], input[name="email"], input[name="userName"], input[id*="email" i], input[id*="user" i]';
    await page.locator(emailSelector).first().waitFor({ timeout: 25000 });
    await page.locator(emailSelector).first().fill(${jsString(email)});
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3500);

    const passwordSelector = 'input[type="password"], input[name="password"], input[id*="password" i]';
    await page.locator(passwordSelector).first().waitFor({ timeout: 25000 });
    await page.locator(passwordSelector).first().fill(${jsString(password)});
    await page.keyboard.press("Enter");
    await page.waitForTimeout(9000);

    const possibleContinue = page.locator('button:has-text("Continue"), button:has-text("Allow"), button:has-text("Accept"), button:has-text("OK"), a:has-text("Continue")').first();
    if (await possibleContinue.count()) {
      await possibleContinue.click().catch(() => null);
      await page.waitForTimeout(5000);
    }
  `, 90);
  await screenshot(kernel, sessionId, "after_sign_in_attempt");

  state = await logPageState(kernel, sessionId, "after sign in");
  if (/captcha|verify|verification|two-step|authenticator|security code|check your email/i.test(state.text)) {
    if (process.env.WAIT_FOR_MANUAL_AUTH === "1") {
      console.log("  Manual auth required. Please use the live view to finish the verification.");
      for (let i = 0; i < 120; i += 1) {
        await sleep(5000);
        state = await logPageState(kernel, sessionId, `manual auth poll ${i + 1}`);
        if (/tinkercad\.com/i.test(state.url) && !/captcha|verify|verification|two-step|authenticator|security code|check your email|welcome back|personal accounts/i.test(state.text)) {
          console.log("  Manual auth appears complete.");
          break;
        }
      }
    } else {
      throw new Error("Autodesk sign-in needs manual verification or CAPTCHA.");
    }
  }

  await execute(kernel, sessionId, `
    await page.goto("https://www.tinkercad.com/users/me", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4500);
  `);
  state = await logPageState(kernel, sessionId, "dashboard after sign in");
  if (!/tinkercad\.com/i.test(state.url) || /anonymous|profile is private|welcome back|personal accounts|log in|sign up/i.test(state.text)) {
    throw new Error(`Sign-in did not reach Tinkercad. Current URL: ${state.url}`);
  }
}

function isSignedInTinkercadState(state) {
  if (!/tinkercad\.com/i.test(state.url)) return false;
  if (/anonymous|profile is private|welcome back|personal accounts|log in|sign up|password|username and password do not match|forgot\?/i.test(state.text)) {
    return false;
  }
  return /dashboard|3d designs|designs|create|classes|collections|tutorials|things/i.test(state.text) || /\/dashboard|\/things\//i.test(state.url);
}

async function waitForManualSignIn(kernel, sessionId) {
  console.log("  Opening Tinkercad sign-in for manual account selection...");
  await execute(kernel, sessionId, `
    await page.goto("https://www.tinkercad.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
  `);
  await screenshot(kernel, sessionId, "manual_sign_in_ready");
  console.log("  Paused for manual sign-in. Use the live view to sign into the account for this session.");

  for (let i = 0; i < 180; i += 1) {
    await sleep(5000);
    let state = await logPageState(kernel, sessionId, `manual sign-in poll ${i + 1}`);
    if (isSignedInTinkercadState(state)) {
      console.log("  Manual sign-in detected.");
      return;
    }

    if (/tinkercad\.com\/users\/me/i.test(state.url) && /anonymous|profile is private/i.test(state.text)) {
      await execute(kernel, sessionId, `
        await page.goto("https://www.tinkercad.com/dashboard?type=designs", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3000);
      `).catch(() => null);
      state = await logPageState(kernel, sessionId, `manual sign-in dashboard retry ${i + 1}`);
      if (isSignedInTinkercadState(state)) {
        console.log("  Manual sign-in detected.");
        return;
      }
    }
  }

  throw new Error("Timed out waiting for manual Tinkercad sign-in.");
}

async function createNewDesign(kernel, sessionId) {
  console.log("  Creating a new 3D design...");
  const result = await execute(kernel, sessionId, `
    await page.goto("https://www.tinkercad.com/dashboard?type=designs", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6000);

    async function clickByText(patterns) {
      for (const pattern of patterns) {
        const locator = page.locator('button, a, [role="button"]').filter({ hasText: pattern }).first();
        if (await locator.count()) {
          await locator.scrollIntoViewIfNeeded().catch(() => null);
          await locator.click({ timeout: 8000 }).catch(() => null);
          await page.waitForTimeout(2500);
          return true;
        }
      }
      return false;
    }

    let clicked = await clickByText([/Create new design/i, /Create 3D Design/i, /3D Design/i, /Create/i, /New/i]);
    if (!clicked) return { url: page.url(), title: await page.title().catch(() => ""), missingCreateButton: true };

    if (!/\\/things\\//i.test(page.url()) || /dashboard/i.test(page.url())) {
      await clickByText([/3D Design/i, /3D design/i, /Empty/i]);
    }

    await page.waitForTimeout(12000);

    if (!/\\/things\\//i.test(page.url())) {
      const designCard = page.locator('a[href*="/things/"], [role="link"][href*="/things/"]').first();
      if (await designCard.count()) {
        await designCard.click();
        await page.waitForTimeout(10000);
      }
    }

    return { url: page.url(), title: await page.title().catch(() => "") };
  `, 120);

  await screenshot(kernel, sessionId, "new_design_editor");
  const state = await logPageState(kernel, sessionId, "new design state");
  if (result?.missingCreateButton || /sorry, that page is missing/i.test(state.text) || !/tinkercad\.com\/things\//i.test(state.url)) {
    throw new Error(`Could not open a Tinkercad design editor. Current URL: ${state.url}`);
  }
  return state.url;
}

async function renameDesign(kernel, sessionId) {
  console.log(`  Renaming design to "${DESIGN_NAME}"...`);
  await execute(kernel, sessionId, `
    const desired = ${jsString(DESIGN_NAME)};

    async function tryLocator(locator) {
      if (!(await locator.count())) return false;
      await locator.first().click({ timeout: 5000 }).catch(() => null);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => null);
      await page.keyboard.type(desired).catch(() => null);
      await page.keyboard.press("Enter").catch(() => null);
      await page.waitForTimeout(2000);
      return true;
    }

    const candidates = [
      page.locator('#topnav-title-input, input[aria-label*="name" i], input[title*="name" i]').first(),
      page.locator('#topnav-title, [contenteditable="true"]').first(),
      page.locator('button, div, span').filter({ hasText: /Untitled|Design|Brilliant|Magnificent|Fantastic|Incredible|Dazzling|Snazzy/i }).first(),
    ];

    for (const candidate of candidates) {
      if (await tryLocator(candidate)) return true;
    }
    return false;
  `, 45).catch((err) => {
    console.log(`  Rename skipped: ${err.message}`);
    return false;
  });
}

async function importStl(kernel, sessionId) {
  console.log("  Importing generated advanced cat STL...");
  await execute(kernel, sessionId, `
    await page.waitForTimeout(3000);

    async function clickVisibleImport() {
      const importButton = page.locator('button:has-text("Import"), [role="button"]:has-text("Import"), a:has-text("Import")').first();
      if (await importButton.count()) {
        await importButton.click({ timeout: 10000 });
        await page.waitForTimeout(1500);
        return true;
      }
      return false;
    }

    await clickVisibleImport();

    const input = page.locator('input[type="file"]').first();
    if (await input.count()) {
      await input.setInputFiles(${jsString(REMOTE_STL_PATH)});
    } else {
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 15000 });
      const chooseButton = page.locator('button:has-text("Choose"), button:has-text("Select"), [role="button"]:has-text("Choose"), [role="button"]:has-text("Select")').first();
      if (await chooseButton.count()) {
        await chooseButton.click();
      } else {
        await clickVisibleImport();
      }
      const chooser = await chooserPromise;
      await chooser.setFiles(${jsString(REMOTE_STL_PATH)});
    }

    await page.waitForTimeout(2500);

    const importConfirm = page.locator('button:has-text("Import"), [role="button"]:has-text("Import")')
      .filter({ hasNotText: /URL/i })
      .last();
    if (await importConfirm.count()) {
      await importConfirm.click({ timeout: 10000 }).catch(() => null);
    } else {
      await page.keyboard.press("Enter").catch(() => null);
    }

    await page.waitForTimeout(30000);
    return {
      url: page.url(),
      text: await page.evaluate(() => document.body?.innerText?.slice(0, 1400) ?? "").catch(() => "")
    };
  `, 150);

  await screenshot(kernel, sessionId, "after_advanced_cat_import");
  const state = await logPageState(kernel, sessionId, "after import");
  if (/error importing|failed|unsupported|too large/i.test(state.text)) {
    throw new Error(`Tinkercad reported an import error: ${state.text.slice(0, 300)}`);
  }
  return state.url;
}

async function main() {
  ensureAssets();
  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const attachedSessionId = process.env.TINKERCAD_SESSION_ID;
  const isAttachedSession = Boolean(attachedSessionId);

  let session;
  if (isAttachedSession) {
    console.log("Using existing Kernel browser session...");
    session = {
      session_id: attachedSessionId,
      browser_live_view_url: process.env.TINKERCAD_LIVE_VIEW_URL || null,
    };
  } else {
    console.log("Creating Kernel browser session...");
    session = await kernel.browsers.create({
      stealthMode: true,
      viewport: { width: WIDTH, height: HEIGHT },
      timeoutSeconds: 1200,
    });
  }

  const sessionId = session.session_id;
  if (session.browser_live_view_url) console.log("Live view:", session.browser_live_view_url);
  console.log("Session:", sessionId);
  const heartbeat = setInterval(() => {
    console.log(`  Working... ${new Date().toISOString()}`);
  }, 8000);

  let cleaned = false;
  const cleanup = async (signal) => {
    if (cleaned) return;
    cleaned = true;
    console.log(`Cleaning up browser ${sessionId}...`);
    try {
      await kernel.browsers.deleteByID(sessionId);
      console.log("Browser deleted.");
    } catch (err) {
      console.error("Delete failed:", err.message);
    }
    if (signal) process.exit(signal === "SIGINT" ? 130 : 1);
  };

  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("SIGTERM", () => cleanup("SIGTERM"));

  let succeeded = false;
  try {
    console.log("  Uploading STL to Kernel browser filesystem...");
    await kernel.browsers.fs.upload(sessionId, {
      files: [{ dest_path: REMOTE_STL_PATH, file: fs.createReadStream(STL_PATH) }],
    });

    if (isAttachedSession) {
      await execute(kernel, sessionId, `
        await page.goto("https://www.tinkercad.com/users/me", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(4500);
      `);
      const state = await logPageState(kernel, sessionId, "attached session dashboard check");
      if (!isSignedInTinkercadState(state)) {
        throw new Error(`Attached session is not signed in yet. Current URL: ${state.url}`);
      }
    } else if (process.env.MANUAL_TINKERCAD_LOGIN === "1") {
      await waitForManualSignIn(kernel, sessionId);
    } else {
      const { email, password } = getTinkercadCredentials();
      await signIn(kernel, sessionId, email, password);
    }
    const editorUrl = await createNewDesign(kernel, sessionId);
    await renameDesign(kernel, sessionId);
    const finalUrl = await importStl(kernel, sessionId);
    await sleep(3000);
    const finalScreenshot = await screenshot(kernel, sessionId, "final_saved_advanced_cat");

    const resultPath = path.join(OUT_DIR, "advanced-cat-result.json");
    fs.writeFileSync(resultPath, `${JSON.stringify({
      designName: DESIGN_NAME,
      editorUrl: finalUrl || editorUrl,
      liveViewUrl: session.browser_live_view_url,
      importedAsset: STL_PATH,
      finalScreenshot,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`);

    console.log("Done.");
    console.log("Design URL:", finalUrl || editorUrl);
    console.log("Result:", resultPath);
    succeeded = true;
  } catch (err) {
    if (process.env.KEEP_BROWSER_ON_FAILURE === "1") {
      cleaned = true;
      console.error("Error:", err.message);
      console.log("Keeping browser open for inspection.");
      if (session.browser_live_view_url) console.log("Live view:", session.browser_live_view_url);
      console.log("Session:", sessionId);
      console.log(`Cleanup later: node cleanup.js --delete ${sessionId}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    clearInterval(heartbeat);
    const shouldDeleteAttached = isAttachedSession && process.env.DELETE_ATTACHED_SESSION === "1";
    const shouldDeleteCreated = !isAttachedSession;
    if (!cleaned && (shouldDeleteCreated || shouldDeleteAttached) && (succeeded || process.env.KEEP_BROWSER_ON_FAILURE !== "1")) await cleanup();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
