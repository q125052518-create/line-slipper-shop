import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const asset = '/assets/store/brand-avatar.jpg';
const fixture = {
  categories: [{ id: 'cards', name: '卡膜卡套', isActive: true }],
  markets: [{ id: 'shop', name: '曜鑰購物', description: '卡膜卡套・出卡包材・活頁卡冊・飾品襪子', imageUrl: asset, products: [
    { id: 'sleeve', name: '透明小卡保護套', description: '商品詳細說明僅顯示於詳細頁。'.repeat(30), categoryId: 'cards', imageUrl: asset, variants: [{ id: 'pink', name: '粉色', price: 25, stock: 8, imageUrl: asset }] }
  ] }]
};
const layoutFixture = { blocks: [
  { type: 'notice', title: '歡迎光臨', text: '收藏每一份喜歡，包裝每一份心意。', sortOrder: 0 },
  { type: 'featured-products', title: '精選好物', sortOrder: 1 }
] };

test('storefront brand, search, category tabs and guest cart work across viewport sizes', async (t) => {
  const catalog = process.env.STOREFRONT_PREVIEW_CATALOG
    ? JSON.parse(await fs.readFile(process.env.STOREFRONT_PREVIEW_CATALOG, 'utf8')) : fixture;
  const layout = process.env.STOREFRONT_PREVIEW_LAYOUT
    ? JSON.parse(await fs.readFile(process.env.STOREFRONT_PREVIEW_LAYOUT, 'utf8')) : layoutFixture;
  const product = catalog.markets[0].products[0];
  const variant = product.variants.find(value => value.stock > 0);
  assert.ok(variant);
  const app = express();
  app.get('/api/markets', (_req, res) => res.json(catalog));
  app.get('/api/store-layout', (_req, res) => res.json(layout));
  app.get(['/api/auth/status', '/api/buyer/status'], (_req, res) => res.json({ authenticated: false }));
  app.use(express.static(path.join(root, 'public')));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // This storefront does not need the external LINE SDK for browsing or guest checkout.
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({ body: '' }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 920 });
    await page.goto(base);
    await page.locator('.store-strip-product-card').first().waitFor();
    assert.equal(await page.locator('#storeName').textContent(), catalog.markets[0].name);
    assert.equal(await page.locator('a[href*="shopee."]').count(), 0, 'No Shopee storefront links');
    assert.equal(await page.locator('.storefront-home').isVisible(), true, `Brand is hidden at ${width}px`);
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
    });
    const geometry = await page.evaluate(() => ({
      overflowing: document.documentElement.scrollWidth > innerWidth,
      brokenImages: Array.from(document.images).filter(image => image.offsetWidth > 0 && !image.naturalWidth).map(image => image.src),
      header: Array.from(document.querySelectorAll('.header-store-name, .storefront-search, .header-actions')).map(el => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      })
    }));
    assert.equal(geometry.overflowing, false, `Page overflows at ${width}px`);
    assert.deepEqual(geometry.brokenImages, [], `Broken assets at ${width}px`);
    for (let a = 0; a < geometry.header.length; a++) {
      for (let b = a + 1; b < geometry.header.length; b++) {
        const one = geometry.header[a], two = geometry.header[b];
        const overlaps = one.x < two.x + two.width && one.x + one.width > two.x && one.y < two.y + two.height && one.y + one.height > two.y;
        assert.equal(overlaps, false, `Header overlaps at ${width}px`);
      }
    }
    if (process.env.STOREFRONT_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.STOREFRONT_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.STOREFRONT_SCREENSHOT_DIR, `home-${width}.png`), fullPage: true });
    }
    await page.locator('.store-strip-product-card').first().click();
    assert.equal(await page.locator('.product-detail-dialog').isVisible(), true);
    assert.equal(await page.locator('.product-detail-description p').textContent(), product.description || '精選商品');
    await page.locator(`[data-select-variant="${product.id}"][data-variant-id="${variant.id}"]`).last().click();
    await page.locator('.product-detail-dialog [data-add-product]').click();
    assert.equal(await page.locator('#cartCount').textContent(), '1');
    await page.keyboard.press('Escape');
    await page.locator('#productSearch').fill(product.name);
    assert.equal(await page.locator('#productShell').isVisible(), true);
    assert.equal(await page.locator('#storeHero').isVisible(), false);
    assert.equal(await page.locator('#products [data-open-product]').count(), 1);
    assert.equal(await page.locator('#products .shop-product-body h3').textContent(), product.name);
    assert.equal(await page.locator('#products .shop-product-body > p:not(.shop-product-category)').count(), 0, 'Product cards show the title, not the description');
    await page.locator('#productSearch').fill('no-matching-product-012345');
    assert.equal(await page.locator('#products .empty').textContent(), '沒有符合的商品');
    await page.locator('[data-store-tab="categories"]').click();
    assert.equal(await page.locator('#categoryDirectory').isVisible(), true);
    await page.locator('.store-directory-row').first().click();
    assert.equal(await page.locator('#productShell').isVisible(), true);
    assert.equal(await page.locator('#productSearch').inputValue(), '');
    await page.locator('[data-store-tab="store"]').click();
    await page.locator('.store-hero-button').click();
    assert.equal(await page.locator('#storeHero').isVisible(), false);
    assert.equal(await page.locator('#products [data-open-product]').count(), 1);
    if (process.env.STOREFRONT_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.STOREFRONT_SCREENSHOT_DIR, `products-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => localStorage.clear());
  }
  catalog.markets[0].products = Array.from({ length: 6 }, (_, index) => ({ ...product, id: `grid-${index}`, name: `Grid item ${index + 1}` }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await page.locator('.store-strip-product-card').first().waitFor();
  assert.equal(await page.locator('.store-strip-product-card').count(), 6);
  assert.equal(await page.locator('.store-product-strip.is-single').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  const stockProduct = (id, prices, stocks, group = false) => ({
    ...product, id, name: `Stock test ${group ? 'group ' : ''}${id}`,
    variants: stocks.map((stock, index) => ({id: `${id}-${index}`, name: `Option ${index}`, stock, price: prices[index], imageUrl: asset}))
  });
  catalog.markets[0].products = [
    stockProduct('out-low', [1], [0], true),
    stockProduct('mixed', [100, 120], [0, 3], true),
    stockProduct('out-high', [999], [0]),
    stockProduct('in-low', [20], [2], true),
    stockProduct('in-mid', [50], [5])
  ];
  const originalIds = catalog.markets[0].products.map(item => item.id);
  const ids = selector => page.locator(selector).evaluateAll(items => items.map(item => item.dataset.openProduct));
  const defaultOrder = ['mixed', 'in-low', 'in-mid', 'out-low', 'out-high'];
  for (const type of ['featured-products', 'new-products', 'hot-products']) {
    layout.blocks = [{type, title: 'Stock test', productIds: originalIds, limit: 3}];
    await page.goto(base);
    await page.locator('.store-strip-product-card').first().waitFor();
    assert.equal(await page.locator('.store-strip-product-card').count(), 3);
    assert((await ids('.store-strip-product-card')).every(id => !id.startsWith('out-')), `${type} must prioritize stock before applying its limit`);
  }
  layout.blocks = [{type: 'featured-products', title: 'Stock test', productIds: originalIds, limit: 5}];
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 950});
    await page.goto(base);
    await page.locator('.store-strip-product-card').first().waitFor();
    assert.deepEqual(await ids('.store-strip-product-card'), defaultOrder);
    await page.locator('[data-store-tab="products"]').click();
    assert.deepEqual(await ids('#products .shop-product-card'), defaultOrder);
    assert.equal(await page.locator('#products [data-open-product="mixed"] .soldout-badge').count(), 0, 'Another variant is still in stock');
    assert.equal(await page.locator('#products .soldout-badge').count(), 2);
    await page.locator('#productSort').selectOption('price-asc');
    assert.deepEqual(await ids('#products .shop-product-card'), ['in-low', 'in-mid', 'mixed', 'out-low', 'out-high']);
    await page.locator('#productSort').selectOption('price-desc');
    assert.deepEqual(await ids('#products .shop-product-card'), ['mixed', 'in-mid', 'in-low', 'out-high', 'out-low']);
    await page.locator('#productSearch').fill('Stock test group');
    assert.deepEqual(await ids('#products .shop-product-card'), ['mixed', 'in-low', 'out-low']);
    await page.locator('[data-store-tab="categories"]').click();
    await page.locator('.store-directory-row').first().click();
    assert.deepEqual(await ids('#products .shop-product-card'), ['mixed', 'in-mid', 'in-low', 'out-high', 'out-low']);
    await page.locator('#products [data-open-product="mixed"]').click();
    await page.locator('.product-detail-dialog [data-variant-id="mixed-0"]').click();
    assert.equal(await page.locator('.product-detail-dialog [data-add-product]').isDisabled(), true);
    await page.locator('.product-detail-dialog [data-variant-id="mixed-1"]').click();
    assert.equal(await page.locator('.product-detail-dialog [data-add-product]').isEnabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(catalog.markets[0].products.map(item => item.id), originalIds, 'Display sorting must not reorder source data');
  assert.deepEqual(errors, []);
});
