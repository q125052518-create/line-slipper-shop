import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { parseImportRows, applyProductImport, productMedia } from "../scripts/product-fields.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const emptyCatalog = () => ({ categories: [{ id: "cat", name: "測試分類", parentId: "", isActive: true }], markets: [{ id: "shop", name: "第一站測試", isActive: true, products: [] }] });
const headers = ["商品名稱", "規格名稱 1", "規格選項 1", "規格名稱 2", "規格選項 2", "商品選項貨號", "價格", "庫存", "規格圖片", "主商品圖片", "商品圖片 1", "主商品貨號", "是否上架"];
const sample = ["測試商品", "顏色", "粉色", "尺寸", "M", "T-001", 100, 5, "https://example.com/option.png", "https://example.com/main.png", "https://example.com/side.png", "MAIN-01", "否"];

test("Shopee-like columns retain images, spec pairs and product-only visibility", () => {
  const parsed = parseImportRows([headers, sample]);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.items[0].variantName, "粉色 / M");
  const catalog = emptyCatalog(); let i = 0;
  applyProductImport(catalog, parsed.items, () => `id-${++i}`);
  const product = catalog.markets[0].products[0];
  assert.equal(catalog.markets[0].isActive, true);
  assert.equal(product.isActive, false);
  assert.equal(product.imageUrls.length, 2);
  assert.deepEqual(product.optionNames, ["顏色", "尺寸"]);
  assert.deepEqual(product.variants[0].options, ["粉色", "M"]);
  assert.equal(product.variants[0].imageUrl, sample[8]);
  applyProductImport(catalog, parsed.items, () => `id-${++i}`);
  assert.equal(catalog.markets[0].products.length, 1);
  assert.equal(product.variants.length, 1);
  assert.throws(() => applyProductImport(emptyCatalog(), [...parsed.items, ...parsed.items], () => `id-${++i}`), /重複品項/);
  assert.throws(() => productMedia({ imageUrls: ["javascript:alert(1)"] }), /圖片只接受/);
  assert.match(parseImportRows([headers, [...sample.slice(0, 12), "wrong"]]).error, /是否上架/);
});

test("editor, import preview and storefront work using isolated data", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "line-product-editor-test-"));
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const base = `http://127.0.0.1:${port}`;
  await fs.writeFile(path.join(directory, "catalog.json"), JSON.stringify(emptyCatalog()));
  await fs.writeFile(path.join(directory, "store-layout.json"), JSON.stringify({ version: 2, blocks: [] }));
  const child = spawn(process.execPath, ["server.js"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, PORT: String(port), DATA_DIR: directory, ADMIN_PASSWORD: "isolated-test-password", SESSION_SECRET: "isolated-test-secret", LIFF_ID: "", LINE_CHANNEL_ACCESS_TOKEN: "",
    MALLBIC_AUTO_SYNC_ENABLED: "false", MALLBIC_ORDER_AUTO_SYNC_ENABLED: "false", MYSHIP_AUTO_ORDER_ENABLED: "false"
  } });
  let output = ""; child.stdout.on("data", (c) => { output += c; }); child.stderr.on("data", (c) => { output += c; });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (child.exitCode === null) { const stopped = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await stopped; }
    const target = path.resolve(directory), parent = path.resolve(os.tmpdir());
    assert.ok(target.startsWith(`${parent}${path.sep}`) && path.basename(target).startsWith("line-product-editor-test-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(`${base}/api/markets`); await response.arrayBuffer(); if (response.ok) { ready = true; break; } } catch { /* Server starting. */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "isolated-test-password" }) });
  const cookie = login.headers.getSetCookie()[0].split(";")[0]; await login.arrayBuffer();
  async function api(route, body, method = "POST") {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const upload = await api("/api/admin/product-images", { dataUrl: pixel });
  assert.equal(upload.status, 200);
  const photo = upload.data.imageUrl;
  const rows = [headers, [...sample]]; rows[1][8] = photo; rows[1][9] = `${base}/assets/store/editorial-hero.png`; rows[1][10] = photo;
  const before = await fs.readFile(path.join(directory, "catalog.json"), "utf8");
  const preview = await api("/api/admin/products/import", { rows, preview: true });
  assert.equal(preview.status, 200);
  assert.equal(await fs.readFile(path.join(directory, "catalog.json"), "utf8"), before);
  assert.equal((await api("/api/admin/products/import", { rows, expectedRevision: "stale" })).status, 409);
  assert.equal((await api("/api/admin/products/import", { rows, expectedRevision: preview.data.revision })).status, 200);
  const hidden = await fetch(`${base}/api/markets`).then((r) => r.json());
  assert.equal(hidden.markets[0].products.length, 0);
  let catalog = (await api("/api/admin/catalog", null, "GET")).data;
  const product = catalog.markets[0].products[0];
  assert.equal(catalog.markets[0].isActive, true);
  const saved = await api(`/api/admin/products/${product.id}`, { ...product, isActive: true, weight: 0.5, length: 20, leadDays: 2 }, "PUT");
  assert.equal(saved.status, 200);
  const unchanged = await fs.readFile(path.join(directory, "catalog.json"), "utf8");
  const invalid = await api("/api/admin/products/import", { rows: [headers, rows[1], rows[1]] });
  assert.equal(invalid.status, 400);
  assert.equal(await fs.readFile(path.join(directory, "catalog.json"), "utf8"), unchanged);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: cookie.split("=")[0], value: cookie.slice(cookie.indexOf("=") + 1), url: base }]);
  const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/admin.html`);
  await page.locator(`[data-edit-product="${product.id}"]`).first().click();
  const editor = page.locator(".product-edit-form");
  await editor.locator('[name="sku"]').waitFor();
  assert.equal(await page.locator(".media-tile").count(), 2);
  await page.locator('[data-image-move="1"][data-direction="-1"]').click();
  assert.equal(JSON.parse(await editor.locator('[name="imageUrls"]').inputValue())[0], photo);
  await page.locator('[data-image-move="0"][data-direction="1"]').click();
  await page.locator(".media-preview").first().click();
  assert.equal(await page.locator("#imageZoom").evaluate((el) => el.open), true);
  await page.locator('#imageZoom button').click();
  await editor.locator('[name="name"]').fill("粉色拖鞋測試商品");
  await editor.locator('[name="option1"]').fill("粉色");
  const saveResponse = page.waitForResponse((r) => r.url().endsWith(`/api/admin/products/${product.id}`) && r.request().method() === "PUT");
  await page.getByRole("button", { name: "儲存商品", exact: true }).first().click();
  assert.equal((await saveResponse).status(), 200);
  await page.locator(`[data-edit-product="${product.id}"]`).first().click();
  await fs.mkdir(path.join(root, ".run-state", "listing-editor"), { recursive: true });
  await page.screenshot({ path: path.join(root, ".run-state", "listing-editor", "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, ".run-state", "listing-editor", "mobile.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "Mobile editor must not overflow");
  await page.goto(`${base}/`);
  await page.locator('[data-store-tab="products"]').click();
  await page.locator(`#products [data-open-product="${product.id}"]`).first().click();
  assert.equal(await page.locator("[data-gallery-select]").count(), 2);
  await page.locator("[data-gallery-select]").nth(1).click();
  assert.ok((await page.locator(".product-detail-image").getAttribute("src")).includes("/uploads/product-images/"));
  await page.locator(".product-gallery-main").click();
  assert.equal(await page.locator("#imageZoom").evaluate((el) => el.open), true);
  await page.goto(`${base}/admin-tools.html`);
  await page.locator('[name="productFile"]').setInputFiles(path.join(root, "public", "product-import-template.xlsx"));
  await page.getByRole("button", { name: "讀取並預覽", exact: true }).click();
  await page.locator("[data-confirm-import]").waitFor();
  assert.equal(await page.locator("[data-confirm-import]").isEnabled(), true);
  await page.locator('[data-cell-row="1"][data-cell-column="7"]').fill("123");
  assert.equal(await page.locator("[data-confirm-import]").isEnabled(), false);
  await page.locator("[data-recheck-import]").click();
  await page.waitForFunction(() => !document.querySelector("[data-confirm-import]").disabled);
  await page.goto(`${base}/admin.html`);
  await page.locator("[data-create-product]").click();
  const create = page.locator("#productForm");
  await create.locator('[name="name"]').fill("組合測試");
  await create.locator('[name="sku"]').fill("COMBO");
  await create.locator('[name="optionName1"]').fill("顏色");
  await create.locator('[name="optionName2"]').fill("尺寸");
  await create.locator('[data-option-values="0"]').fill("白色,粉色");
  await create.locator('[data-option-values="1"]').fill("M,L");
  await create.locator("[data-generate-variants]").click();
  assert.equal(await create.locator("[data-variant-row]").count(), 4);
  await create.locator("[data-bulk-price]").fill("123");
  await create.locator("[data-bulk-stock]").fill("8");
  await create.locator("[data-apply-variant-values]").click();
  for (let i = 0; i < 4; i++) await create.locator('[name="barcode"]').nth(i).fill(`COMBO-${i}`);
  await create.locator("[data-gallery-files]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(pixel.split(",")[1], "base64") });
  await create.locator(".media-tile").waitFor();
  const createdResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/markets/shop/products") && r.request().method() === "POST");
  await create.getByRole("button", { name: "新增商品", exact: true }).click();
  const created = await (await createdResponse).json();
  assert.equal(created.product.imageUrls[0], photo);
  assert.equal(created.product.variants.length, 4);
  assert.equal(created.product.variants[0].price, 123);
  assert.equal(created.product.variants[3].name, "粉色 / L");
  assert.deepEqual(errors, []);
});
