import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { catalogRevision } from "../scripts/product-fields.js";
import { normalizePromotion, variantPricing, orderTotals } from "../scripts/product-pricing.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("promotion prices retain cents and only the final payable total is rounded", () => {
  assert.deepEqual(variantPricing({}, { price: 129 }), { price: 129 });
  assert.deepEqual(variantPricing({ promotion: { pricePercent: 85 } }, { price: 129 }), { price: 109.65, originalPrice: 129, pricePercent: 85 });
  assert.deepEqual(variantPricing({ promotion: { pricePercent: 85 } }, { price: 1 }), { price: 0.85, originalPrice: 1, pricePercent: 85 });
  assert.deepEqual(variantPricing({ promotion: { pricePercent: 85 } }, { price: 0 }), { price: 0 });
  assert.deepEqual(variantPricing({ promotion: { pricePercent: 100 } }, { price: 129 }), { price: 129 });
  assert.equal(normalizePromotion(null), null);
  for (const pricePercent of [0, 100, -1, 85.5, "invalid"]) assert.throws(() => normalizePromotion({ pricePercent }));
  assert.deepEqual(orderTotals([{ price: 109.65, quantity: 2 }]), { productTotal: 219.3, shippingFee: 0, totalAmount: 219, roundingAdjustment: -0.3 });
  assert.deepEqual(orderTotals([{ price: 0.85, quantity: 10 }]), { productTotal: 8.5, shippingFee: 0, totalAmount: 9, roundingAdjustment: 0.5 });
  assert.deepEqual(orderTotals([{ price: 109.65, quantity: 1 }, { price: 0.85, quantity: 1 }], 38), { productTotal: 110.5, shippingFee: 38, totalAmount: 149, roundingAdjustment: 0.5 });
  assert.deepEqual(orderTotals([{ price: 100, quantity: 2 }], 38), { productTotal: 200, shippingFee: 38, totalAmount: 238, roundingAdjustment: 0 });
});

test("one-product promotion applies consistently to listing, cart and server checkout", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "line-promotion-test-"));
  const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const base = `http://127.0.0.1:${port}`;
  const product = { id: "p1", name: "折扣測試商品", isActive: true, sku: "P1", categoryId: "cat", imageUrl: `${base}/assets/store/editorial-hero.png`, variants: [
    { id: "v1", name: "小款", barcode: "P1-01", price: 129, stock: 10 },
    { id: "v2", name: "大款", barcode: "P1-02", price: 240, stock: 10 }
  ] };
  const other = { ...structuredClone(product), id: "p2", name: "一元商品", sku: "P2", variants: [{ id: "v3", name: "單個", barcode: "P2-01", price: 1, stock: 20 }] };
  const hidden = { ...structuredClone(product), id: "p3", name: "Hidden", isActive: false };
  const catalog = { categories: [{ id: "cat", name: "分類", isActive: true, parentId: "", sortOrder: 0 }], markets: [{ id: "shop", name: "測試賣場", isActive: true, products: [product, other, hidden] }] };
  await fs.writeFile(path.join(directory, "catalog.json"), JSON.stringify(catalog));
  await fs.writeFile(path.join(directory, "store-layout.json"), JSON.stringify({ version: 2, blocks: [] }));
  const child = spawn(process.execPath, ["server.js"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, PORT: String(port), DATA_DIR: directory, ADMIN_PASSWORD: "promotion-test", SESSION_SECRET: "promotion-test", LIFF_ID: "", LINE_CHANNEL_ACCESS_TOKEN: "",
    MALLBIC_AUTO_SYNC_ENABLED: "false", MALLBIC_ORDER_AUTO_SYNC_ENABLED: "false", MYSHIP_AUTO_ORDER_ENABLED: "false"
  } });
  let output = "", browser;
  child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  t.after(async () => {
    if (browser) await browser.close();
    if (child.exitCode === null) { const stopped = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await stopped; }
    const target = path.resolve(directory);
    assert.ok(target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(target).startsWith("line-promotion-test-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const response = await fetch(`${base}/api/markets`); await response.arrayBuffer(); if (response.ok) { ready = true; break; } } catch { /* Server starting. */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "promotion-test" }) });
  const cookie = login.headers.getSetCookie()[0].split(";")[0]; await login.arrayBuffer();
  async function api(route, method = "GET", body, authenticated = true) {
    const response = await fetch(base + route, { method, headers: { "content-type": "application/json", ...(authenticated ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  const before = (await api("/api/admin/catalog")).data;
  const endpoint = "/api/admin/products/p1/promotion";
  const body = { expectedRevision: catalogRevision(before), promotion: { pricePercent: 85 } };
  assert.equal((await api(endpoint, "PUT", body, false)).status, 401);
  assert.equal((await api(endpoint, "PUT", { ...body, expectedRevision: "stale" })).status, 409);
  assert.equal((await api(endpoint, "PUT", { ...body, promotion: { pricePercent: 100 } })).status, 400);
  assert.equal((await api(endpoint, "PUT", body)).status, 200);
  const expected = structuredClone(before); expected.markets[0].products[0].promotion = { pricePercent: 85 };
  assert.deepEqual((await api("/api/admin/catalog")).data, expected);
  const publicCatalog = (await api("/api/markets")).data;
  assert.equal(publicCatalog.markets[0].products[0].variants[0].price, 109.65);
  assert.deepEqual(publicCatalog.markets[0].products[1], before.markets[0].products[1]);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base);
  await page.locator('#storeProductCount').getByText('2', { exact: true }).waitFor();
  await page.locator('[data-store-tab="products"]').click();
  const card = page.locator('#products [data-open-product="p1"]');
  assert.equal(await card.locator('.price-sale').isVisible(), true);
  assert.equal(await card.locator('.price-original').isVisible(), true);
  assert.equal(await card.locator('.price-discount').isVisible(), true);
  assert.equal(await card.locator(".price-original").textContent(), "$129");
  assert.equal(await card.locator(".price-sale").textContent(), "$109.65");
  assert.equal(await card.locator(".price-discount").textContent(), "85折");
  assert.equal(await page.locator('#products [data-open-product="p2"] .price-pair').count(), 0);
  await card.click();
  await page.locator('.product-detail-dialog [data-variant-id="v2"]').click();
  assert.equal(await page.locator(".product-detail-meta .price-original").textContent(), "$240");
  assert.equal(await page.locator(".product-detail-meta .price-sale").textContent(), "$204");
  await page.locator('.product-detail-dialog [data-variant-id="v1"]').click();
  await page.locator('.product-detail-dialog [data-add-product]').click();
  await page.goto(`${base}/cart.html`);
  await page.locator("#cart .price-original").waitFor();
  assert.match(await page.locator("#cart .price-original").textContent(), /129/);
  assert.match(await page.locator("#cart .price-sale").textContent(), /109\.65/);
  assert.equal(await page.locator('#subtotal').textContent(), 'NT$109.65');
  assert.equal(await page.locator('#total').textContent(), 'NT$110');
  assert.equal(await page.locator('#roundingAdjustment').textContent(), '+NT$0.35');
  const order = await api("/api/orders", "POST", { customerName: "Test", phone: "0912345678", deliveryMethod: "自行取貨", items: [{ marketId: "shop", productId: "p1", variantId: "v1", quantity: 2, price: 1 }] }, false);
  assert.equal(order.status, 201);
  assert.equal(order.data.order.productTotal, 219.3);
  assert.equal(order.data.order.items[0].subtotal, 219.3);
  assert.equal(order.data.order.totalAmount, 219);
  assert.equal(order.data.order.roundingAdjustment, -0.3);
  assert.equal(order.data.order.items[0].originalPrice, 129);
  assert.equal(order.data.order.items[0].price, 109.65);
  const edited = await api("/api/admin/products/p1", "PUT", { name: "Updated" });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.product.promotion.pricePercent, 85);
  const current = (await api("/api/admin/catalog")).data;
  assert.equal((await api(endpoint, "PUT", { expectedRevision: catalogRevision(current), promotion: null })).status, 200);
  assert.equal((await api("/api/markets")).data.markets[0].products[0].variants[0].price, 129);
  await page.reload();
  await page.locator("#cart .price-sale").waitFor();
  assert.equal(await page.locator("#cart .price-original").count(), 0);
  assert.match(await page.locator("#cart .price-sale").textContent(), /129/);
  assert.equal(await page.locator('#roundingRow').isVisible(), false);

  const bulkEndpoint = '/api/admin/products/bulk-promotion';
  const bulkBefore = (await api('/api/admin/catalog')).data;
  const bulkBody = { productIds: ['p1', 'p2'], promotion: { pricePercent: 85 }, expectedRevision: catalogRevision(bulkBefore) };
  assert.equal((await api(bulkEndpoint, 'PUT', bulkBody, false)).status, 401);
  assert.equal((await api(bulkEndpoint, 'PUT', { ...bulkBody, expectedRevision: 'stale' })).status, 409);
  assert.equal((await api(bulkEndpoint, 'PUT', { ...bulkBody, productIds: ['p1', 'missing'] })).status, 404);
  assert.equal((await api(bulkEndpoint, 'PUT', { ...bulkBody, productIds: ['p1', 'p1'] })).status, 400);
  assert.equal((await api(bulkEndpoint, 'PUT', { ...bulkBody, promotion: { pricePercent: 0 } })).status, 400);
  assert.deepEqual((await api('/api/admin/catalog')).data, bulkBefore);
  const bulkResult = await api(bulkEndpoint, 'PUT', bulkBody);
  assert.equal(bulkResult.status, 200);
  assert.equal(bulkResult.data.updatedCount, 2);
  const bulkExpected = structuredClone(bulkBefore);
  for (const product of bulkExpected.markets[0].products.filter((p) => p.isActive !== false)) product.promotion = { pricePercent: 85 };
  assert.deepEqual((await api('/api/admin/catalog')).data, bulkExpected);
  await page.goto(base);
  await page.locator('#storeProductCount').getByText('2', { exact: true }).waitFor();
  await page.locator('[data-store-tab="products"]').click();
  assert.equal(await page.locator('#products [data-open-product="p2"] .price-sale').textContent(), '$0.85');
  await page.evaluate(() => localStorage.setItem('line-slipper-cart', JSON.stringify({ small: { marketId: 'shop', productId: 'p2', variantId: 'v3', quantity: 10, price: 1 } })));
  await page.goto(`${base}/cart.html`);
  await page.locator('#cart .price-original').waitFor();
  assert.equal(await page.locator('#subtotal').textContent(), 'NT$8.5');
  assert.equal(await page.locator('#total').textContent(), 'NT$9');
  await page.locator('#deliveryMethod').selectOption('7-11 賣貨便');
  assert.equal(await page.locator('#total').textContent(), 'NT$47');
  assert.equal(await page.locator('#roundingAdjustment').textContent(), '+NT$0.5');
  const smallOrder = await api('/api/orders', 'POST', { customerName: 'Test', phone: '0912345678', deliveryMethod: '7-11 賣貨便', sevenElevenStoreId: '123456', sevenElevenStoreName: 'Test', sevenElevenStoreAddress: 'Test', items: [{ marketId: 'shop', productId: 'p2', variantId: 'v3', quantity: 10, price: 1 }] }, false);
  assert.equal(smallOrder.status, 201, JSON.stringify(smallOrder.data));
  assert.equal(smallOrder.data.order.items[0].price, 0.85);
  assert.equal(smallOrder.data.order.items[0].subtotal, 8.5);
  assert.equal(smallOrder.data.order.productTotal, 8.5);
  assert.equal(smallOrder.data.order.totalAmount, 47);
  assert.equal(smallOrder.data.order.roundingAdjustment, 0.5);
  const lookup = await api('/api/orders/lookup', 'POST', { orderId: smallOrder.data.order.id, phone: '0912345678' }, false);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.orders[0].roundingAdjustment, 0.5);
  assert.equal(lookup.data.orders[0].totalAmount, 47);
});
