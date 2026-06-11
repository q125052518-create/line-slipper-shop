import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const shopBaseUrl = cleanBaseUrl(process.env.SHOP_BASE_URL || "https://line-slipper-shop.onrender.com");
const adminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
const productUrl = String(process.env.MYSHIP_PRODUCT_URL || "https://myship.7-11.com.tw/general/detail/GM2506169881759").trim();
const chromeProfileDir = path.resolve(process.env.MYSHIP_CHROME_PROFILE_DIR || path.join(repoRoot, ".myship-chrome-profile"));
const syncIntervalMs = Math.max(60000, Number(process.env.SYNC_INTERVAL_MS || 5 * 60 * 1000));
const defaultTimeoutMs = Math.max(5000, Number(process.env.MYSHIP_DEFAULT_TIMEOUT_MS || 30000));
const navTimeoutMs = Math.max(10000, Number(process.env.MYSHIP_NAV_TIMEOUT_MS || 60000));
const headless = parseFlag(process.env.MYSHIP_HEADLESS, false);
const dryRun = parseFlag(process.env.MYSHIP_DRY_RUN, false);
const facebookEmail = String(process.env.MYSHIP_FACEBOOK_EMAIL || "").trim();
const facebookPassword = String(process.env.MYSHIP_FACEBOOK_PASSWORD || "").trim();
const browserChannel = String(process.env.MYSHIP_BROWSER_CHANNEL || "chrome").trim();

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const runOnce = args.has("--once") || checkOnly;

let cookieHeader = "";

main().catch((error) => {
  console.error(`[myship-sync] fatal: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is required in .env");
  if (!productUrl) throw new Error("MYSHIP_PRODUCT_URL is required in .env");

  if (checkOnly) {
    await loginAdmin();
    const pending = await getPendingOrders();
    console.log(`[myship-sync] check ok. Pending orders: ${pending.orders.length}`);
    return;
  }

  do {
    await runSyncCycle();
    if (runOnce) return;
    await wait(syncIntervalMs);
  } while (true);
}

async function runSyncCycle() {
  await loginAdmin();
  const pending = await getPendingOrders();
  if (!pending.orders.length) {
    console.log(`[myship-sync] no pending orders. Next check in ${Math.round(syncIntervalMs / 1000)}s`);
    return;
  }

  if (dryRun) {
    console.log(`[myship-sync] dry run. Would create ${pending.orders.length} orders.`);
    return;
  }

  const context = await chromium.launchPersistentContext(chromeProfileDir, {
    channel: browserChannel || undefined,
    headless,
    locale: "zh-TW",
    args: ["--disable-dev-shm-usage"]
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(defaultTimeoutMs);
    page.setDefaultNavigationTimeout(navTimeoutMs);
    page.on("dialog", async (dialog) => dialog.accept().catch(() => {}));

    for (const order of pending.orders) {
      await processOrder(page, order);
    }
  } finally {
    await context.close();
  }
}

async function processOrder(page, pendingOrder) {
  const orderId = pendingOrder.id;
  let claimedOrder = pendingOrder;

  try {
    const claim = await apiFetch(`/api/admin/myship/orders/${encodeURIComponent(orderId)}/claim`, {
      method: "POST",
      body: { productUrl }
    });
    claimedOrder = claim.order;
  } catch (error) {
    console.warn(`[myship-sync] skip ${orderId}: ${error.message}`);
    return;
  }

  try {
    const created = await createMyshipOrder(page, claimedOrder);
    await apiFetch(`/api/admin/myship/orders/${encodeURIComponent(orderId)}/result`, {
      method: "POST",
      body: {
        status: "created",
        orderNo: created.orderNo || "",
        quantity: created.quantity,
        productUrl
      }
    });
    console.log(`[myship-sync] created ${orderId}${created.orderNo ? ` -> ${created.orderNo}` : ""}`);
  } catch (error) {
    await apiFetch(`/api/admin/myship/orders/${encodeURIComponent(orderId)}/result`, {
      method: "POST",
      body: {
        status: "failed",
        error: error.message,
        quantity: getMyshipQuantity(claimedOrder),
        productUrl
      }
    }).catch((writeError) => {
      console.error(`[myship-sync] failed to write error for ${orderId}: ${writeError.message}`);
    });
    console.error(`[myship-sync] failed ${orderId}: ${error.message}`);
  }
}

async function createMyshipOrder(page, order) {
  const quantity = getMyshipQuantity(order);
  await page.goto(productUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await dismissDialogs(page);
  await ensureMyshipLoggedIn(page);
  await clearMyshipCart(page);

  await clickFirst(page, [
    ".product_size_switch span[data-spec-price='1']",
    ".product_size_switch span[data-spec-name='金額']",
    ".product_size_switch span:has-text('金額')"
  ], "amount option 1");

  const quantityInput = page.locator("input.qty.available, input.qty, input[name*='Qty']").first();
  await quantityInput.waitFor({ state: "visible", timeout: defaultTimeoutMs });
  await setInputValue(page, quantityInput, String(quantity));

  const enteredCart = await clickCreateCart(page);
  if (!enteredCart) throw new Error("Could not enter MyShip checkout page");

  await confirmCartAmount(page, quantity);
  await fillCheckoutData(page, order);
  await submitMyshipOrder(page);

  const text = await bodyText(page);
  const orderNo = extractMyshipOrderNo(`${text}\n${page.url()}`);
  if (!orderNo) {
    throw new Error(`MyShip checkout did not return an order number. Final URL: ${page.url()}. Page: ${summarizePageText(text)}`);
  }

  return {
    quantity,
    orderNo
  };
}

async function clearMyshipCart(page) {
  await page.evaluate(() => {
    if (typeof window.clearCart === "function") window.clearCart();
  }).catch(() => {});
  await page.waitForTimeout(1000);
  await dismissDialogs(page);
}

async function ensureMyshipLoggedIn(page) {
  if (!await needsMyshipLogin(page)) return;

  await submitFacebookLogin(page);
  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    wait(5000)
  ]);

  const facebookPage = page.context().pages().find((entry) => entry.url().includes("facebook.com"));
  if (facebookPage) {
    await completeFacebookLogin(facebookPage);
    await Promise.race([
      facebookPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
      wait(5000)
    ]);
  }

  await page.goto(productUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await dismissDialogs(page);

  if (await needsMyshipLogin(page)) {
    throw new Error("MyShip still needs uniopen login. Open the same Chrome profile manually, finish Facebook/MyShip login, then click OK on the MyShip login prompt and confirm the product can be added to cart.");
  }
}

async function completeFacebookLogin(page) {
  if (!page.url().includes("facebook.com")) return;
  if (facebookEmail) {
    const emailInput = page.locator("input[name='email'], input#email, input[autocomplete*='username']").first();
    if (await emailInput.count()) await emailInput.fill(facebookEmail).catch(() => {});
  }
  if (facebookPassword) {
    const passInput = page.locator("input[name='pass'], input#pass, input[type='password']").first();
    if (await passInput.count()) {
      await passInput.fill(facebookPassword).catch(() => {});
      await passInput.press("Enter").catch(() => {});
    }
  }

  await wait(5000);
  if (/checkpoint|captcha|recover|two_factor|approvals|login_help/i.test(page.url())) {
    throw new Error("Facebook requires manual verification in this Chrome profile.");
  }
}

async function submitFacebookLogin(page) {
  const submitted = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((entry) => String(entry.action || "").includes("/SocialNetwork/ExternalLogin"));
    const button = form?.querySelector('button[name="provider"][value="Facebook"]');
    if (button) {
      button.click();
      return true;
    }

    const fallback = [...document.querySelectorAll("button, a")].find((entry) => /facebook/i.test(entry.textContent || entry.className || ""));
    if (fallback) {
      fallback.click();
      return true;
    }
    return false;
  });
  if (!submitted) throw new Error("Could not find MyShip Facebook login button");
}

async function clickCreateCart(page) {
  await clickFirst(page, [
    "button[onclick*='addAndCreateCart']",
    "button[onclick*='createCart']",
    "button.btn-addtocart"
  ], "create cart");

  await page.waitForTimeout(1200);
  if (!/\/cart\//i.test(page.url())) {
    await clickFirst(page, [
      "button[onclick='createCart()']",
      "button[onclick*='createCart']"
    ], "confirm create cart");
  }

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.waitForURL(/\/cart\/confirm\//, { timeout: 30000 }).catch(() => null),
    page.locator("#btnNext, button#btnNext, input#btnNext").first().waitFor({ timeout: 30000 }).catch(() => null)
  ]);

  await dismissDialogs(page);
  return await page.locator("#btnNext, button#btnNext, input#btnNext, #RcvName, input[name='RcvName']").count() > 0;
}

async function confirmCartAmount(page, quantity) {
  const hasRecipientFields = await page.locator("#RcvName, input[name='RcvName'], #RcvMobile, input[name='RcvMobile']").count();
  if (hasRecipientFields) return;

  const qtyInput = page.locator("input[name='Card_Qty_1'], input[id^='Card_Qty'], input[name*='Card_Qty'], input.qty").first();
  if (await qtyInput.count()) await setInputValue(page, qtyInput, String(quantity));

  const agree = page.locator("#Agree, input[name='Agree'], input[type='checkbox'][name*='Agree']").first();
  if (await agree.count()) {
    await agree.check({ force: true }).catch(async () => {
      await page.evaluate(() => {
        for (const selector of ["#Agree", "input[name='Agree']", "input[type='checkbox'][name*='Agree']"]) {
          const input = document.querySelector(selector);
          if (!input) continue;
          input.checked = true;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      });
    });
  }

  await clickFirst(page, [
    "#btnNext",
    "button#btnNext",
    "input#btnNext",
    "input[type='submit']"
  ], "next checkout");

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.locator("#RcvName, input[name='RcvName'], #RcvMobile, input[name='RcvMobile']").first().waitFor({ timeout: 30000 }).catch(() => null)
  ]);

  if (!await page.locator("#RcvName, input[name='RcvName'], #RcvMobile, input[name='RcvMobile']").count() && /\/cart\/confirm\//i.test(page.url())) {
    await page.evaluate(() => {
      const agreeInput = document.querySelector("#Agree");
      if (agreeInput) {
        agreeInput.checked = true;
        agreeInput.dispatchEvent(new Event("input", { bubbles: true }));
        agreeInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.forms[0]?.submit();
    }).catch(() => {});
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      page.locator("#RcvName, input[name='RcvName'], #RcvMobile, input[name='RcvMobile']").first().waitFor({ timeout: 30000 }).catch(() => null)
    ]);
  }
  await dismissDialogs(page);
}

async function fillCheckoutData(page, order) {
  const store = order.sevenElevenStore || {};
  const name = String(order.customerName || "").trim().slice(0, 10);
  const phone = normalizePhone(order.phone || "");
  const storeId = String(store.id || "").trim();

  if (!name) throw new Error("Missing recipient name for MyShip checkout");
  if (!phone) throw new Error("Missing recipient phone for MyShip checkout");
  if (!storeId) throw new Error("Missing 7-11 store id for MyShip checkout");

  await fillVisibleField(page, "#RcvName, input[name='RcvName']", name);
  await fillVisibleField(page, "#RcvMobile, input[name='RcvMobile']", phone);
  await selectMyshipPickupStore(page, storeId);
  await fillVisibleField(page, "#RcvName, input[name='RcvName']", name);
  await fillVisibleField(page, "#RcvMobile, input[name='RcvMobile']", phone);

  const result = await page.evaluate(() => ({
    name: document.querySelector("#RcvName, input[name='RcvName']")?.value || "",
    phone: document.querySelector("#RcvMobile, input[name='RcvMobile']")?.value || "",
    storeId: document.querySelector("#RcvStoreID, input[name='RcvStoreID']")?.value || "",
    storeName: document.querySelector("#RcvStoreName, input[name='RcvStoreName']")?.value || "",
    storeAddress: document.querySelector("#RcvStoreAddress, input[name='RcvStoreAddress']")?.value || ""
  }));

  if (!result.name || !result.phone) throw new Error("Could not fill MyShip recipient name or phone");
  if (!result.storeId || !result.storeName || !result.storeAddress) {
    throw new Error("Could not select MyShip 7-11 pickup store");
  }
}

async function fillVisibleField(page, selector, value) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: defaultTimeoutMs });
  await locator.fill(value);
  await locator.evaluate((element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }).catch(() => {});
}

async function selectMyshipPickupStore(page, storeId) {
  await page.evaluate(() => {
    if (typeof window.jsEmap === "function") window.jsEmap();
  });
  await Promise.race([
    page.waitForURL(/emap\.pcsc\.com\.tw\/mobilemap\//, { timeout: 30000 }).catch(() => null),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null)
  ]);
  await wait(2500);

  let frame = await waitForFrame(page, /Address\/Default\.aspx|Id\/Default\.aspx/i, 30000);
  if (!/Id\/Default\.aspx/i.test(frame.url())) {
    await frame.locator('a[href*="../Id/Default.aspx"]').click({ force: true });
    frame = await waitForFrame(page, /Id\/Default\.aspx/i, 30000);
  }

  await frame.locator("#inputKey").fill(storeId);
  await frame.locator("#send").click({ force: true });
  await waitForFrameFunction(frame, (id) => {
    return [...document.querySelectorAll("li")].some((entry) => String(entry.getAttribute("onclick") || "").includes(id));
  }, storeId, "7-11 store id search result");
  await frame.evaluate((id) => {
    if (typeof window.GoMap === "function") {
      window.GoMap(id);
      return;
    }
    const entry = [...document.querySelectorAll("li")].find((item) => String(item.getAttribute("onclick") || "").includes(id));
    entry?.click();
  }, storeId);

  frame = await waitForActionFrame(page, /Map\/Default\.aspx|mobilemap\/map\.aspx/i, "SendInfo", "7-11 map SendInfo");
  await clickFrameControl(frame, [
    "img[onclick*='SendInfo']",
    "#OK img",
    "#OK"
  ], () => typeof window.SendInfo === "function" && window.SendInfo(), "7-11 map SendInfo");

  frame = await waitForActionFrame(page, /Info\/NotifyUser\.aspx/i, "OK", "7-11 notify OK");
  await clickFrameControl(frame, [
    "#IMG1",
    "img[onclick*='OK']"
  ], () => typeof window.OK === "function" && window.OK(), "7-11 notify OK");

  frame = await waitForActionFrame(page, /Info\/Default\.aspx/i, "Submit", "7-11 store submit");
  await clickFrameControl(frame, [
    "#IMG1",
    "img[onclick*='Submit']"
  ], () => typeof window.Submit === "function" && window.Submit(), "7-11 store submit");

  await Promise.race([
    page.waitForURL(/myship\.7-11\.com\.tw\/cart\/detail/i, { timeout: 30000 }).catch(() => null),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.locator("#RcvStoreID, input[name='RcvStoreID']").first().waitFor({ timeout: 30000 }).catch(() => null)
  ]);
  await dismissDialogs(page);
}

async function waitForFrame(page, pattern, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = page.frames().find((entry) => pattern.test(entry.url()));
    if (frame) return frame;
    await wait(250);
  }
  throw new Error(`Timed out waiting for frame ${pattern}`);
}

async function waitForActionFrame(page, urlPattern, actionName, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    for (const frame of page.frames()) {
      if (!urlPattern.test(frame.url())) continue;
      const hasAction = await frame.evaluate((name) => {
        return typeof window[name] === "function"
          || Boolean(document.querySelector(`[onclick*="${name}"]`));
      }, actionName).catch(() => false);
      if (hasAction) return frame;
    }
    await wait(250);
  }
  const urls = page.frames().map((entry) => entry.url()).join(" | ");
  throw new Error(`${label}: timed out waiting for action ${actionName}. Frames: ${urls}`);
}

async function waitForFrameFunction(frame, pageFunction, arg, label) {
  try {
    return await frame.waitForFunction(pageFunction, arg, { timeout: 30000 });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

async function clickFrameControl(frame, selectors, fallbackFunction, label) {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if (!await locator.isVisible({ timeout: 5000 }).catch(() => false)) continue;
    await locator.click({ force: true });
    return;
  }

  try {
    await frame.waitForFunction(fallbackFunction, null, { timeout: 10000 });
    return;
  } catch (error) {
    const details = await describeFrame(frame).catch(() => "");
    throw new Error(`${label}: ${error.message}${details ? ` ${details}` : ""}`);
  }
}

async function describeFrame(frame) {
  const snapshot = await frame.evaluate(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 200),
    controls: [...document.querySelectorAll("img, button, a, input")]
      .slice(0, 25)
      .map((element) => ({
        tag: element.tagName,
        id: element.id || "",
        onclick: element.getAttribute("onclick") || "",
        text: (element.innerText || element.value || element.alt || element.title || "").trim().slice(0, 40)
      }))
  }));
  return `Frame: ${JSON.stringify(snapshot)}`;
}

async function submitMyshipOrder(page) {
  await clickFirst(page, [
    "input#btnNext[value='送出結帳']",
    "#btnNext",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('送出')",
    "button:has-text('確認')"
  ], "submit order");

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    wait(5000)
  ]);
  await dismissDialogs(page);
}

async function needsMyshipLogin(page) {
  if (page.url().includes("facebook.com") || page.url().includes("access.line.me")) return true;

  const alertText = await page
    .locator("#alertify .alertify-message, .alertify-message")
    .first()
    .innerText({ timeout: 1000 })
    .catch(() => "");
  if (/請登入|uniopen|會員再開始選購|登入/.test(alertText)) return true;

  const loginButton = page.locator("button.btn-soclial-login-facebook, button:has-text('Facebook')").first();
  if (await loginButton.isVisible({ timeout: 1000 }).catch(() => false)) return true;

  const text = await bodyText(page);
  return /Facebook|uniopen|login|登入|會員再開始選購/.test(text) && /登入|Login|會員再開始選購/.test(text);
}

async function needsLogin(page) {
  if (page.url().includes("facebook.com") || page.url().includes("access.line.me")) return true;
  const loginButton = page.locator("button.btn-soclial-login-facebook, button:has-text('Facebook')").first();
  if (await loginButton.isVisible({ timeout: 1000 }).catch(() => false)) return true;
  const text = await bodyText(page);
  return /Facebook|uniopen|login|登入/.test(text) && /登入|Login/.test(text);
}

async function dismissDialogs(page) {
  for (let round = 0; round < 3; round += 1) {
    let clicked = false;
    for (const selector of [
      "#alertify-ok",
      ".alertify-button-ok",
      "button.mfp-close",
      "button:has-text('OK')",
      "button:has-text('確認')"
    ]) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
        await locator.click({ force: true }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(300);
  }
}

async function clickFirst(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (!await item.isVisible().catch(() => false)) continue;
      await item.click({ timeout: 8000 }).catch(async () => item.click({ timeout: 8000, force: true }));
      return;
    }
  }
  throw new Error(`Could not click ${label}`);
}

async function setInputValue(page, locator, value) {
  await locator.fill(value).catch(async () => {
    const handle = await locator.elementHandle();
    if (!handle) throw new Error("Input not found");
    await page.evaluate(({ element, nextValue }) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, { element: handle, nextValue: value });
  });
  await page.waitForTimeout(500);
}

function getMyshipQuantity(order) {
  const value = Number(order?.myshipQuantity || order?.productTotal || order?.totalAmount || 0);
  return Math.max(1, Math.round(Number.isFinite(value) ? value : 0));
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").slice(0, 10);
}

function extractMyshipOrderNo(text) {
  const cleanText = String(text || "");
  const directMatch = cleanText.match(/\bC[MC]\d{8,}\b/i);
  if (directMatch) return directMatch[0].toUpperCase();
  const fallback = cleanText.match(/\b[A-Z]{1,3}\d{8,}\b/i);
  return fallback ? fallback[0].toUpperCase() : "";
}

async function loginAdmin() {
  const response = await fetch(`${shopBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword })
  });
  if (!response.ok) throw new Error(`Admin login failed: ${response.status} ${await response.text()}`);
  cookieHeader = parseSetCookie(response.headers.get("set-cookie"));
  if (!cookieHeader) throw new Error("Admin login did not return a session cookie");
}

async function getPendingOrders() {
  return apiFetch("/api/admin/myship/pending-orders");
}

async function apiFetch(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${shopBaseUrl}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookieHeader
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) throw new Error(payload.message || `${method} ${pathname} failed with ${response.status}`);
  return payload;
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

function summarizePageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function parseSetCookie(value) {
  if (!value) return "";
  return value
    .split(/,\s*(?=[^=;,]+=[^;,]+)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function parseFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
