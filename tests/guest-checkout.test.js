import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, child, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited early (${child.exitCode}).\n${output.join("")}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/markets`);
      if (response.ok) return;
    } catch {
      // The server can refuse connections briefly while Node is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for test server.\n${output.join("")}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function removeTestDirectory(directory) {
  const tempRoot = path.resolve(os.tmpdir());
  const target = path.resolve(directory);
  if (!target.startsWith(`${tempRoot}${path.sep}`) || !path.basename(target).startsWith("line-slipper-guest-test-")) {
    throw new Error(`Refusing to remove unexpected test directory: ${target}`);
  }
  await fs.rm(target, { recursive: true, force: true });
}

test("storefront source has no buyer-login purchase gate", async () => {
  const appSource = await fs.readFile(path.join(projectRoot, "public", "app.js"), "utf8");
  const cartSource = await fs.readFile(path.join(projectRoot, "public", "cart.js"), "utf8");
  const ordersHtml = await fs.readFile(path.join(projectRoot, "public", "orders.html"), "utf8");

  assert.doesNotMatch(appSource, /登入購買|請先登入買家帳號，再加入購物車/);
  assert.doesNotMatch(cartSource, /liff\.login\(|請先登入買家帳號才能結帳/);
  assert.match(ordersHtml, /name="orderId"/);
  assert.match(ordersHtml, /name="phone"/);
  assert.doesNotMatch(ordersHtml, /type="password"/);
});

test("guest can create, look up, and request cancellation of a 7-11 order", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "line-slipper-guest-test-"));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];

  const catalog = {
    categories: [
      { id: "test-category", name: "測試分類", isActive: true, parentId: "", sortOrder: 0 }
    ],
    markets: [
      {
        id: "test-market",
        name: "測試賣場",
        description: "",
        imageUrl: transparentPixel,
        isActive: true,
        products: [
          {
            id: "test-product",
            name: "訪客結帳測試商品",
            categoryId: "test-category",
            imageUrl: transparentPixel,
            description: "",
            variants: [
              {
                id: "test-variant",
                name: "粉色 / M",
                imageUrl: transparentPixel,
                barcode: "GUEST-TEST-001",
                price: 100,
                stock: 5
              }
            ]
          }
        ]
      }
    ]
  };
  const storeLayout = { version: 2, blocks: [] };
  await fs.writeFile(path.join(dataDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(dataDir, "store-layout.json"), `${JSON.stringify(storeLayout, null, 2)}\n`, "utf8");

  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      LIFF_ID: "",
      MALLBIC_AUTO_SYNC_ENABLED: "false",
      MALLBIC_ORDER_AUTO_SYNC_ENABLED: "false",
      MYSHIP_AUTO_ORDER_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await stopChild(child);
    await removeTestDirectory(dataDir);
  });

  await waitForServer(baseUrl, child, output);

  const invalidResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "",
      phone: "0912345678",
      deliveryMethod: "自行取貨",
      items: [{ marketId: "test-market", productId: "test-product", variantId: "test-variant", quantity: 1 }]
    })
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).message, "請輸入姓名");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#storeProductCount").getByText("1", { exact: true }).waitFor();
  await page.locator('[data-store-tab="products"]').click();
  const productViewState = await page.evaluate(() => ({
    currentTabClass: document.querySelector('[data-store-tab="products"]')?.className,
    productShellClass: document.querySelector("#productShell")?.className
  }));
  assert.match(productViewState.currentTabClass || "", /is-current/, JSON.stringify(productViewState));
  assert.doesNotMatch(productViewState.productShellClass || "", /\bhidden\b/, JSON.stringify(productViewState));
  await page.locator('[data-open-product="test-product"]').click();
  await page.locator('.product-detail-dialog [data-select-variant="test-product"][data-variant-id="test-variant"]').click();
  const addButton = page.locator('.product-detail-dialog [data-add-product="test-product"]');
  await addButton.waitFor({ state: "visible" });
  assert.equal(await addButton.textContent(), "加入購物車");
  assert.equal(await addButton.isEnabled(), true);
  await addButton.click();
  await page.locator(".product-detail-close").click();

  await page.locator('.app-header a[href="/cart.html"]').click();
  await page.locator("#cart").getByText("訪客結帳測試商品").waitFor();
  assert.equal(await page.locator('#orderForm button[type="submit"]').isEnabled(), true);

  await page.locator('[name="customerName"]').fill("訪客測試");
  await page.locator('[name="phone"]').fill("0912-345-678");
  await page.locator('[name="deliveryMethod"]').selectOption("7-11 賣貨便");
  await page.locator('[name="sevenElevenStoreId"]').fill("123456");
  await page.locator('[name="sevenElevenStoreName"]').fill("測試門市");
  await page.locator('[name="sevenElevenStoreAddress"]').fill("台北市測試路 1 號");

  const orderResponsePromise = page.waitForResponse((response) => (
    response.url() === `${baseUrl}/api/orders` && response.request().method() === "POST"
  ));
  await page.locator('#orderForm button[type="submit"]').click();
  const orderResponse = await orderResponsePromise;
  assert.equal(orderResponse.status(), 201);
  const orderPayload = await orderResponse.json();
  const orderId = orderPayload.order.id;
  assert.match(orderId, /^ORD-\d+$/);
  assert.equal(orderPayload.order.buyerId, "");
  assert.equal(orderPayload.order.customerName, "訪客測試");
  assert.equal(orderPayload.order.phone, "0912-345-678");
  assert.equal(orderPayload.order.shippingFee, 38);
  assert.deepEqual(orderPayload.order.sevenElevenStore, {
    id: "123456",
    name: "測試門市",
    address: "台北市測試路 1 號"
  });

  const wrongLookup = await fetch(`${baseUrl}/api/orders/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, phone: "0900000000" })
  });
  assert.equal(wrongLookup.status, 404);

  await page.locator('.app-header a[href="/orders.html"]').click();
  await page.locator(".buyer-order h3").filter({ hasText: orderId }).waitFor();
  assert.equal(await page.locator('[name="orderId"]').inputValue(), orderId);
  assert.equal(await page.locator('[name="phone"]').inputValue(), "0912-345-678");

  const screenshotDir = String(process.env.GUEST_CHECKOUT_SCREENSHOT_DIR || "").trim();
  if (screenshotDir) {
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "guest-orders-desktop.png"), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth
  }));
  assert.ok(mobileLayout.contentWidth <= mobileLayout.viewportWidth + 1, JSON.stringify(mobileLayout));
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "guest-orders-mobile.png"), fullPage: true });
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`[data-cancel-order="${orderId}"]`).click();
  await page.getByText("取消申請已送出，等待賣家同意").first().waitFor();

  const orders = JSON.parse(await fs.readFile(path.join(dataDir, "orders.json"), "utf8"));
  const buyers = JSON.parse(await fs.readFile(path.join(dataDir, "buyers.json"), "utf8"));
  const savedCatalog = JSON.parse(await fs.readFile(path.join(dataDir, "catalog.json"), "utf8"));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].cancelRequest.status, "pending");
  assert.equal(buyers.length, 0);
  assert.equal(savedCatalog.markets[0].products[0].variants[0].stock, 4);
});
