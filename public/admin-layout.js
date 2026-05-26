const refreshLayoutButtonEl = document.querySelector("#refreshLayoutButton");
const saveLayoutButtonEl = document.querySelector("#saveLayoutButton");
const layoutSettingsFormEl = document.querySelector("#layoutSettingsForm");
const layoutBlockSettingsEl = document.querySelector("#layoutBlockSettings");
const layoutPhonePreviewEl = document.querySelector("#layoutPhonePreview");
const layoutBlockListEl = document.querySelector("#layoutBlockList");
const layoutMessageEl = document.querySelector("#layoutMessage");
const layoutSettingsTitleEl = document.querySelector("#layoutSettingsTitle");
const phoneShopNameEl = document.querySelector("#phoneShopName");
const phoneShopAvatarEl = document.querySelector("#phoneShopAvatar");
const layoutDesktopPreviewEl = document.querySelector("#layoutDesktopPreview");
const desktopShopHeaderNameEl = document.querySelector("#desktopShopHeaderName");
const desktopShopNameEl = document.querySelector("#desktopShopName");
const desktopShopDescriptionEl = document.querySelector("#desktopShopDescription");
const desktopShopAvatarEl = document.querySelector("#desktopShopAvatar");
const phonePreviewTabEls = document.querySelectorAll("[data-phone-preview-tab]");
const previewDeviceButtonEls = document.querySelectorAll("[data-preview-device]");
const previewPaneEls = document.querySelectorAll("[data-preview-pane]");

const BLOCK_META = {
  banner: { label: "輪播看板", defaultTitle: "賣場看板" },
  notice: { label: "文字公告", defaultTitle: "賣場公告" },
  "category-grid": { label: "分類區", defaultTitle: "分類區" },
  "featured-products": { label: "主打商品", defaultTitle: "主打商品" },
  "new-products": { label: "新上架", defaultTitle: "新上架" },
  "hot-products": { label: "熱銷商品", defaultTitle: "熱銷商品" }
};

let catalog = { categories: [], markets: [] };
let storeLayout = { blocks: [] };
let activeBlockId = "";
let categorySearchQuery = "";
let productSearchQuery = "";
let draggedLayoutBlockId = "";
let pointerDragState = null;
let suppressNextClick = false;
let activePreviewTab = "store";
let activePreviewDevice = "phone";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function placeholderImage(name) {
  return `https://placehold.co/240x240/fde9ef/c55477?text=${encodeURIComponent(name || "商品")}`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "讀取失敗");
  return data;
}

function currentMarket() {
  return catalog.markets[0] || null;
}

function allProducts() {
  return currentMarket()?.products || [];
}

function formatMoney(value) {
  return `NT$${Number(value || 0).toLocaleString("zh-TW")}`;
}

function productMinPrice(product) {
  const prices = (product.variants || []).map((variant) => Number(variant.price || 0));
  return prices.length ? Math.min(...prices) : 0;
}

function productMaxPrice(product) {
  const prices = (product.variants || []).map((variant) => Number(variant.price || 0));
  return prices.length ? Math.max(...prices) : 0;
}

function productPriceText(product) {
  const min = productMinPrice(product);
  const max = productMaxPrice(product);
  return min === max ? formatMoney(min) : `${formatMoney(min)} - ${formatMoney(max)}`;
}

function productTotalStock(product) {
  return (product.variants || []).reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function productImage(product) {
  return product?.imageUrl || product?.variants?.find((variant) => variant.imageUrl)?.imageUrl || placeholderImage(product?.name || "商品");
}

function categoryById(categoryId) {
  return catalog.categories.find((category) => category.id === categoryId);
}

function sortCategoryList(categories) {
  return [...categories].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    return orderA - orderB || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

function childCategories(parentId = "") {
  const activeIds = new Set(catalog.categories.map((category) => category.id));
  return sortCategoryList(catalog.categories.filter((category) => {
    if (category.isActive === false) return false;
    const categoryParentId = category.parentId || "";
    if (parentId) return categoryParentId === parentId;
    return !categoryParentId || !activeIds.has(categoryParentId);
  }));
}

function categoryDepth(categoryId) {
  let depth = 0;
  let parentId = categoryById(categoryId)?.parentId || "";
  const seen = new Set([categoryId]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = categoryById(parentId)?.parentId || "";
  }
  return depth;
}

function sortedCategories() {
  const result = [];
  const appendChildren = (parentId) => {
    for (const category of childCategories(parentId)) {
      result.push(category);
      appendChildren(category.id);
    }
  };
  appendChildren("");
  return result;
}

function descendantCategoryIds(categoryId) {
  const ids = new Set([categoryId]);
  const appendChildren = (parentId) => {
    for (const child of childCategories(parentId)) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      appendChildren(child.id);
    }
  };
  appendChildren(categoryId);
  return ids;
}

function categoryProductCount(categoryId) {
  const ids = descendantCategoryIds(categoryId);
  return allProducts().filter((product) => ids.has(product.categoryId)).length;
}

function categoryImage(categoryId) {
  const category = categoryById(categoryId);
  if (category?.imageUrl) return category.imageUrl;
  const ids = descendantCategoryIds(categoryId);
  const product = allProducts().find((entry) => ids.has(entry.categoryId) && (
    entry.imageUrl || (entry.variants || []).some((variant) => variant.imageUrl)
  ));
  return product?.imageUrl || product?.variants?.find((variant) => variant.imageUrl)?.imageUrl || placeholderImage(category?.name || "分類");
}

function categoryLabel(category) {
  const depth = categoryDepth(category.id);
  return `${"　".repeat(depth)}${depth ? "└ " : ""}${category.name}`;
}

function sortedBlocks() {
  return [...(storeLayout.blocks || [])].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    return orderA - orderB;
  });
}

function normalizeLocalOrder(blocks = sortedBlocks()) {
  storeLayout.blocks = blocks.map((block, index) => ({ ...block, sortOrder: index }));
}

function activeBlock() {
  return sortedBlocks().find((block) => block.id === activeBlockId) || sortedBlocks()[0] || null;
}

function ensureActiveBlock() {
  const blocks = sortedBlocks();
  if (!blocks.length) {
    activeBlockId = "";
    return;
  }
  if (!blocks.some((block) => block.id === activeBlockId)) activeBlockId = blocks[0].id;
}

function makeBlock(type) {
  const meta = BLOCK_META[type] || BLOCK_META.notice;
  const base = {
    id: makeId("layout-block"),
    type,
    title: meta.defaultTitle,
    enabled: true,
    sortOrder: sortedBlocks().length
  };
  if (type === "banner") return { ...base, imageUrls: [], linkUrl: "" };
  if (type === "notice") return { ...base, text: "新品陸續上架中，下單前可先聊聊確認現貨。" };
  if (type === "category-grid") return { ...base, categoryIds: [], columns: 5 };
  if (type === "featured-products") return { ...base, productIds: [], limit: 6 };
  return { ...base, limit: 6 };
}

function selectedLayoutCategories(block) {
  const byId = new Map(catalog.categories.map((category) => [category.id, category]));
  const selected = (block.categoryIds || []).map((categoryId) => byId.get(categoryId)).filter(Boolean);
  return selected.filter((category) => category.isActive !== false);
}

function productsForBlock(block) {
  const limit = Math.min(20, Math.max(1, Number(block.limit || 6)));
  if (block.type === "featured-products") {
    const byId = new Map(allProducts().map((product) => [product.id, product]));
    const selected = (block.productIds || []).map((id) => byId.get(id)).filter(Boolean);
    return (selected.length ? selected : allProducts()).slice(0, limit);
  }
  if (block.type === "new-products") return [...allProducts()].reverse().slice(0, limit);
  if (block.type === "hot-products") {
    return [...allProducts()]
      .sort((a, b) => productTotalStock(b) - productTotalStock(a))
      .slice(0, limit);
  }
  return [];
}

function phoneBlockAttributes(block) {
  const blockId = escapeHtml(block.id);
  return `data-drag-layout-block="${blockId}" data-select-layout-block="${blockId}"`;
}

function renderPhoneBanner(block) {
  const imageUrls = (block.imageUrls || []).filter(Boolean);
  const firstImage = imageUrls[0];
  return `
    <section class="phone-layout-block phone-banner-block ${block.id === activeBlockId ? "is-active" : ""}" ${phoneBlockAttributes(block)}>
      ${firstImage ? `
        <img src="${escapeHtml(firstImage)}" alt="" onerror="this.closest('.phone-banner-block').classList.add('has-broken-image');">
      ` : `
        <div class="phone-banner-placeholder">
          <strong>${escapeHtml(block.title || "賣場看板")}</strong>
          <span>上傳或貼上圖片網址</span>
        </div>
      `}
      ${imageUrls.length > 1 ? `<div class="phone-banner-dots">${imageUrls.map((_, index) => `<span class="${index === 0 ? "is-active" : ""}"></span>`).join("")}</div>` : ""}
    </section>
  `;
}

function renderPhoneNotice(block) {
  return `
    <section class="phone-layout-block phone-notice-block ${block.id === activeBlockId ? "is-active" : ""}" ${phoneBlockAttributes(block)}>
      <strong>${escapeHtml(block.title || "賣場公告")}</strong>
      <p>${escapeHtml(block.text || "尚未輸入公告內容")}</p>
    </section>
  `;
}

function renderPhoneCategoryGrid(block) {
  const categories = selectedLayoutCategories(block);
  const columns = Math.min(6, Math.max(3, Number(block.columns || 5)));
  return `
    <section class="phone-layout-block phone-category-section ${block.id === activeBlockId ? "is-active" : ""}" ${phoneBlockAttributes(block)}>
      <div class="phone-section-head">
        <strong>${escapeHtml(block.title || "分類區")}</strong>
      </div>
      <div class="phone-category-grid" style="--phone-category-columns: ${columns};">
        ${categories.map((category) => `
          <button type="button" class="phone-category-card">
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <span>${escapeHtml(category.name)}</span>
          </button>
        `).join("") || '<p class="phone-empty">尚未建立分類</p>'}
      </div>
    </section>
  `;
}

function renderPhoneProductBlock(block) {
  const products = productsForBlock(block);
  return `
    <section class="phone-layout-block phone-products-section ${block.id === activeBlockId ? "is-active" : ""}" ${phoneBlockAttributes(block)}>
      <div class="phone-section-head">
        <strong>${escapeHtml(block.title || BLOCK_META[block.type]?.defaultTitle || "商品區")}</strong>
      </div>
      <div class="phone-product-scroll">
        ${products.map((product) => `
          <article class="phone-product-card">
            <img src="${escapeHtml(productImage(product))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(product.name))}';">
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(productPriceText(product))}</span>
          </article>
        `).join("") || '<p class="phone-empty">目前沒有商品</p>'}
      </div>
    </section>
  `;
}

function renderPhoneBlock(block) {
  if (block.enabled === false) return "";
  if (block.type === "banner") return renderPhoneBanner(block);
  if (block.type === "notice") return renderPhoneNotice(block);
  if (block.type === "category-grid") return renderPhoneCategoryGrid(block);
  return renderPhoneProductBlock(block);
}

function renderPreviewTabs() {
  phonePreviewTabEls.forEach((tab) => {
    tab.classList.toggle("is-current", tab.dataset.phonePreviewTab === activePreviewTab);
  });
}

function renderPhoneAllProducts() {
  const products = allProducts();
  return `
    <section class="phone-layout-block phone-products-section">
      <div class="phone-section-head">
        <strong>全部商品</strong>
      </div>
      <div class="phone-product-scroll">
        ${products.map((product) => `
          <article class="phone-product-card">
            <img src="${escapeHtml(productImage(product))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(product.name))}';">
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(productPriceText(product))}</span>
          </article>
        `).join("") || '<p class="phone-empty">目前沒有商品</p>'}
      </div>
    </section>
  `;
}

function renderPhoneAllCategories() {
  const categories = sortedCategories().filter((category) => category.isActive !== false);
  return `
    <section class="phone-layout-block phone-directory-section">
      <div class="phone-section-head">
        <strong>全部分類</strong>
      </div>
      <div class="phone-directory-list">
        ${categories.map((category) => `
          <button type="button" class="phone-directory-row" style="--category-depth: ${Math.min(categoryDepth(category.id), 5)};">
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <span>${categoryDepth(category.id) ? "› " : ""}${escapeHtml(category.name)}</span>
            <small>(${categoryProductCount(category.id)})</small>
            <b aria-hidden="true">›</b>
          </button>
        `).join("") || '<p class="phone-empty">尚未建立分類</p>'}
      </div>
    </section>
  `;
}

function renderPhonePreview() {
  const market = currentMarket();
  phoneShopNameEl.textContent = market?.name || "拖鞋賣場";
  if (phoneShopAvatarEl) {
    const imageUrl = market?.imageUrl || "";
    phoneShopAvatarEl.style.backgroundImage = imageUrl ? `url("${imageUrl.replaceAll('"', '\\"')}")` : "";
    phoneShopAvatarEl.classList.toggle("has-image", Boolean(imageUrl));
  }
  renderPreviewTabs();
  const html = activePreviewTab === "categories"
    ? renderPhoneAllCategories()
    : activePreviewTab === "products"
      ? renderPhoneAllProducts()
      : sortedBlocks().map(renderPhoneBlock).join("");
  layoutPhonePreviewEl.innerHTML = html || '<p class="phone-empty">尚未加入首頁元件</p>';
}

function desktopBlockAttributes(block) {
  return `data-select-layout-block="${escapeHtml(block.id)}"`;
}

function renderPreviewDevice() {
  previewDeviceButtonEls.forEach((button) => {
    button.classList.toggle("is-current", button.dataset.previewDevice === activePreviewDevice);
  });
  previewPaneEls.forEach((pane) => {
    pane.classList.toggle("hidden", pane.dataset.previewPane !== activePreviewDevice);
  });
}

function renderDesktopBanner(block) {
  const imageUrls = (block.imageUrls || []).filter(Boolean);
  const firstImage = imageUrls[0];
  return `
    <section class="desktop-layout-block desktop-banner-block ${block.id === activeBlockId ? "is-active" : ""}" ${desktopBlockAttributes(block)}>
      ${firstImage ? `
        <img src="${escapeHtml(firstImage)}" alt="" onerror="this.closest('.desktop-banner-block').classList.add('has-broken-image');">
      ` : `
        <div class="desktop-banner-placeholder">
          <strong>${escapeHtml(block.title || "賣場看板")}</strong>
          <span>上傳或貼上圖片網址</span>
        </div>
      `}
    </section>
  `;
}

function renderDesktopNotice(block) {
  return `
    <section class="desktop-layout-block desktop-notice-block ${block.id === activeBlockId ? "is-active" : ""}" ${desktopBlockAttributes(block)}>
      <strong>${escapeHtml(block.title || "賣場公告")}</strong>
      <p>${escapeHtml(block.text || "新品陸續上架中，下單前可先聊聊確認現貨。")}</p>
    </section>
  `;
}

function renderDesktopCategoryGrid(block) {
  const categories = selectedLayoutCategories(block);
  const columns = Math.min(8, Math.max(3, Number(block.columns || 5)));
  return `
    <section class="desktop-layout-block desktop-category-section ${block.id === activeBlockId ? "is-active" : ""}" ${desktopBlockAttributes(block)}>
      <div class="desktop-section-head">
        <strong>${escapeHtml(block.title || "分類區")}</strong>
      </div>
      <div class="desktop-category-grid" style="--desktop-category-columns: ${columns};">
        ${categories.map((category) => `
          <article class="desktop-category-card">
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <strong>${escapeHtml(category.name)}</strong>
            <span>${categoryProductCount(category.id)} 件商品</span>
          </article>
        `).join("") || '<p class="desktop-empty">尚未選擇分類</p>'}
      </div>
    </section>
  `;
}

function renderDesktopProductBlock(block) {
  const products = productsForBlock(block);
  return `
    <section class="desktop-layout-block desktop-products-section ${block.id === activeBlockId ? "is-active" : ""}" ${desktopBlockAttributes(block)}>
      <div class="desktop-section-head">
        <strong>${escapeHtml(block.title || BLOCK_META[block.type]?.defaultTitle || "商品區")}</strong>
      </div>
      <div class="desktop-product-grid">
        ${products.map((product) => `
          <article class="desktop-product-card">
            <img src="${escapeHtml(productImage(product))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(product.name))}';">
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(productPriceText(product))}</span>
          </article>
        `).join("") || '<p class="desktop-empty">目前沒有商品</p>'}
      </div>
    </section>
  `;
}

function renderDesktopBlock(block) {
  if (block.enabled === false) return "";
  if (block.type === "banner") return renderDesktopBanner(block);
  if (block.type === "notice") return renderDesktopNotice(block);
  if (block.type === "category-grid") return renderDesktopCategoryGrid(block);
  return renderDesktopProductBlock(block);
}

function renderDesktopAllProducts() {
  const products = allProducts();
  return `
    <section class="desktop-layout-block desktop-products-section">
      <div class="desktop-section-head">
        <strong>全部商品</strong>
      </div>
      <div class="desktop-product-grid">
        ${products.map((product) => `
          <article class="desktop-product-card">
            <img src="${escapeHtml(productImage(product))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(product.name))}';">
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(productPriceText(product))}</span>
          </article>
        `).join("") || '<p class="desktop-empty">目前沒有商品</p>'}
      </div>
    </section>
  `;
}

function renderDesktopAllCategories() {
  const categories = sortedCategories().filter((category) => category.isActive !== false);
  return `
    <section class="desktop-layout-block desktop-directory-section">
      <div class="desktop-section-head">
        <strong>全部分類</strong>
      </div>
      <div class="desktop-directory-list">
        ${categories.map((category) => `
          <article class="desktop-directory-row" style="--category-depth: ${Math.min(categoryDepth(category.id), 5)};">
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <strong>${categoryDepth(category.id) ? "└ " : ""}${escapeHtml(category.name)}</strong>
            <span>${categoryProductCount(category.id)} 件商品</span>
          </article>
        `).join("") || '<p class="desktop-empty">尚未建立分類</p>'}
      </div>
    </section>
  `;
}

function renderDesktopPreview() {
  if (!layoutDesktopPreviewEl) return;
  const market = currentMarket();
  const storeName = market?.name || "拖鞋賣場";
  const storeDescription = market?.description || "精選商品，線上下單。";
  if (desktopShopHeaderNameEl) desktopShopHeaderNameEl.textContent = storeName;
  if (desktopShopNameEl) desktopShopNameEl.textContent = storeName;
  if (desktopShopDescriptionEl) desktopShopDescriptionEl.textContent = storeDescription;
  if (desktopShopAvatarEl) {
    const imageUrl = market?.imageUrl || "";
    desktopShopAvatarEl.src = imageUrl || "https://placehold.co/160x160/f2efe8/1e2720?text=Shop";
  }
  const desktopTab = activePreviewTab === "categories" ? "store" : activePreviewTab;
  const html = desktopTab === "products"
      ? renderDesktopAllProducts()
      : sortedBlocks().map(renderDesktopBlock).join("");
  layoutDesktopPreviewEl.innerHTML = html || '<p class="desktop-empty">尚未加入首頁元件</p>';
}

function renderPreviews() {
  renderPhonePreview();
  renderDesktopPreview();
  renderPreviewDevice();
}

function renderBlockList() {
  const blocks = sortedBlocks();
  layoutBlockListEl.innerHTML = blocks.map((block, index) => {
    const meta = BLOCK_META[block.type] || { label: block.type };
    return `
      <div class="layout-block-row ${block.id === activeBlockId ? "is-active" : ""}" data-select-layout-block="${escapeHtml(block.id)}">
        <span class="layout-block-handle">☰</span>
        <div>
          <strong>${escapeHtml(block.title || meta.label)}</strong>
          <small>${escapeHtml(meta.label)}${block.enabled === false ? " · 已隱藏" : ""}</small>
        </div>
        <button type="button" data-move-layout-block="up" data-block-id="${escapeHtml(block.id)}" ${index === 0 ? "disabled" : ""}>上移</button>
        <button type="button" data-move-layout-block="down" data-block-id="${escapeHtml(block.id)}" ${index === blocks.length - 1 ? "disabled" : ""}>下移</button>
        <button type="button" class="danger" data-remove-layout-block="${escapeHtml(block.id)}">刪除</button>
      </div>
    `;
  }).join("") || '<p class="empty">尚未加入首頁元件</p>';
}

function commonSettingsHtml(block) {
  return `
    <label class="checkbox-row">
      <input type="checkbox" data-setting="enabled" ${block.enabled !== false ? "checked" : ""}>
      前台顯示這個元件
    </label>
    <label>
      區塊標題
      <input data-setting="title" value="${escapeHtml(block.title || "")}" placeholder="${escapeHtml(BLOCK_META[block.type]?.defaultTitle || "元件標題")}">
    </label>
  `;
}

function renderBannerSettings(block) {
  const imageUrls = block.imageUrls?.length ? block.imageUrls : [""];
  return `
    ${commonSettingsHtml(block)}
    <label>
      點擊連結（可留白）
      <input data-setting="linkUrl" value="${escapeHtml(block.linkUrl || "")}" placeholder="https://">
    </label>
    <div class="layout-config-box">
      <div class="section-head compact-head">
        <div>
          <h3>看板圖片</h3>
          <p class="muted">可放多張，前台會先顯示第一張。</p>
        </div>
        <button type="button" data-add-banner-image>新增圖片</button>
      </div>
      <div class="layout-image-url-list">
        ${imageUrls.map((url, index) => `
          <div class="layout-image-url-row">
            <input data-banner-url-index="${index}" value="${escapeHtml(url)}" placeholder="圖片網址">
            <button type="button" class="danger" data-remove-banner-image="${index}">刪除</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderNoticeSettings(block) {
  return `
    ${commonSettingsHtml(block)}
    <label>
      公告內容
      <textarea data-setting="text" rows="5" placeholder="輸入公告內容">${escapeHtml(block.text || "")}</textarea>
    </label>
  `;
}

function renderCategorySettings(block) {
  const selectedIds = new Set(block.categoryIds || []);
  const query = categorySearchQuery.trim().toLowerCase();
  const categories = sortedCategories().filter((category) => !query || category.name.toLowerCase().includes(query));
  return `
    ${commonSettingsHtml(block)}
    <label>
      每排幾個分類
      <select data-setting="columns">
        ${[3, 4, 5, 6].map((value) => `<option value="${value}" ${Number(block.columns || 5) === value ? "selected" : ""}>${value} 個</option>`).join("")}
      </select>
    </label>
    <div class="layout-config-box">
      <div class="section-head compact-head">
        <div>
          <h3>分類清單</h3>
          <p class="muted">只會顯示已勾選的分類，沒勾選就不顯示分類卡。</p>
        </div>
      </div>
      <label class="shop-search">
        <span>搜尋分類</span>
        <input data-category-search type="search" value="${escapeHtml(categorySearchQuery)}" placeholder="輸入分類名稱">
      </label>
      <div class="layout-category-picker">
        ${categories.map((category) => `
          <label class="layout-category-option">
            <input type="checkbox" data-layout-category-id="${escapeHtml(category.id)}" ${selectedIds.has(category.id) ? "checked" : ""}>
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <span>
              <strong>${escapeHtml(categoryLabel(category))}</strong>
              <small>${categoryProductCount(category.id)} 件商品</small>
            </span>
          </label>
        `).join("") || '<p class="empty">找不到分類</p>'}
      </div>
    </div>
  `;
}

function renderProductPicker(block) {
  const selectedIds = new Set(block.productIds || []);
  const query = productSearchQuery.trim().toLowerCase();
  const products = allProducts().filter((product) => {
    const text = [product.name, product.description, ...(product.variants || []).flatMap((variant) => [variant.name, variant.barcode])].join(" ").toLowerCase();
    return !query || text.includes(query);
  });
  return `
    <div class="layout-product-picker">
      ${products.map((product) => `
        <label class="layout-product-option">
          <input type="checkbox" data-layout-product-id="${escapeHtml(product.id)}" ${selectedIds.has(product.id) ? "checked" : ""}>
          <img src="${escapeHtml(productImage(product))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(product.name))}';">
          <span>
            <strong>${escapeHtml(product.name)}</strong>
            <small>${escapeHtml(productPriceText(product))} · 庫存 ${productTotalStock(product)}</small>
          </span>
        </label>
      `).join("") || '<p class="empty">找不到商品</p>'}
    </div>
  `;
}

function renderProductSettings(block) {
  const isFeatured = block.type === "featured-products";
  return `
    ${commonSettingsHtml(block)}
    <label>
      顯示商品數
      <input type="number" min="1" max="20" data-setting="limit" value="${escapeHtml(block.limit || 6)}">
    </label>
    ${isFeatured ? `
      <div class="layout-config-box">
        <div class="section-head compact-head">
          <div>
            <h3>選擇主打商品</h3>
            <p class="muted">不勾選時，會自動顯示前幾個商品。</p>
          </div>
        </div>
        <label class="shop-search">
          <span>搜尋商品</span>
          <input data-product-search type="search" value="${escapeHtml(productSearchQuery)}" placeholder="商品名稱、條碼、款式">
        </label>
        ${renderProductPicker(block)}
      </div>
    ` : ""}
  `;
}

function renderSettings() {
  const block = activeBlock();
  if (!block) {
    layoutSettingsTitleEl.textContent = "元件設定";
    layoutBlockSettingsEl.innerHTML = '<p class="empty">請先加入首頁元件</p>';
    return;
  }
  layoutSettingsTitleEl.textContent = `${BLOCK_META[block.type]?.label || "元件"}設定`;
  if (block.type === "banner") layoutBlockSettingsEl.innerHTML = renderBannerSettings(block);
  else if (block.type === "notice") layoutBlockSettingsEl.innerHTML = renderNoticeSettings(block);
  else if (block.type === "category-grid") layoutBlockSettingsEl.innerHTML = renderCategorySettings(block);
  else layoutBlockSettingsEl.innerHTML = renderProductSettings(block);
}

function renderAll() {
  ensureActiveBlock();
  renderPreviews();
  renderBlockList();
  renderSettings();
}

function clearPhoneDropClasses() {
  document.querySelectorAll(".phone-layout-block.is-drop-before, .phone-layout-block.is-drop-after, .phone-layout-block.is-dragging")
    .forEach((element) => {
      element.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
    });
}

function markPhoneDropTarget(targetEl, clientY) {
  clearPhoneDropClasses();
  if (!targetEl || !draggedLayoutBlockId) return null;
  const sourceEl = document.querySelector(`[data-drag-layout-block="${CSS.escape(draggedLayoutBlockId)}"]`);
  sourceEl?.classList.add("is-dragging");
  if (targetEl.dataset.dragLayoutBlock === draggedLayoutBlockId) return null;
  const rect = targetEl.getBoundingClientRect();
  const placement = clientY > rect.top + rect.height / 2 ? "after" : "before";
  targetEl.classList.add(placement === "after" ? "is-drop-after" : "is-drop-before");
  return {
    targetId: targetEl.dataset.dragLayoutBlock,
    placement
  };
}

function reorderLayoutBlock(dragId, targetId, placement) {
  if (!dragId || !targetId || dragId === targetId) return;
  const blocks = sortedBlocks();
  const draggedBlock = blocks.find((block) => block.id === dragId);
  if (!draggedBlock) return;
  const remainingBlocks = blocks.filter((block) => block.id !== dragId);
  const targetIndex = remainingBlocks.findIndex((block) => block.id === targetId);
  if (targetIndex < 0) return;
  remainingBlocks.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedBlock);
  normalizeLocalOrder(remainingBlocks);
  activeBlockId = dragId;
  layoutMessageEl.textContent = "順序已調整，記得按儲存";
  renderAll();
}

function updateActiveBlockSetting(target) {
  const block = activeBlock();
  if (!block) return;
  const setting = target.dataset.setting;
  if (setting === "enabled") block.enabled = target.checked;
  if (setting === "title") block.title = target.value.trim();
  if (setting === "linkUrl") block.linkUrl = target.value.trim();
  if (setting === "text") block.text = target.value;
  if (setting === "columns") block.columns = Math.min(6, Math.max(3, Number(target.value || 5)));
  if (setting === "limit") block.limit = Math.min(20, Math.max(1, Number(target.value || 6)));

  if (target.dataset.bannerUrlIndex !== undefined) {
    const index = Number(target.dataset.bannerUrlIndex);
    block.imageUrls = Array.isArray(block.imageUrls) ? block.imageUrls : [];
    block.imageUrls[index] = target.value.trim();
  }

  if (target.dataset.layoutCategoryId) {
    const selectedIds = new Set(block.categoryIds || []);
    if (target.checked) selectedIds.add(target.dataset.layoutCategoryId);
    else selectedIds.delete(target.dataset.layoutCategoryId);
    block.categoryIds = sortedCategories().map((category) => category.id).filter((id) => selectedIds.has(id));
  }

  if (target.dataset.layoutProductId) {
    const selectedIds = new Set(block.productIds || []);
    if (target.checked) selectedIds.add(target.dataset.layoutProductId);
    else selectedIds.delete(target.dataset.layoutProductId);
    block.productIds = allProducts().map((product) => product.id).filter((id) => selectedIds.has(id));
  }

  renderPreviews();
  renderBlockList();
}

async function loadLayoutData() {
  const [catalogData, layoutData] = await Promise.all([
    requestJson("/api/admin/catalog"),
    requestJson("/api/admin/store-layout")
  ]);
  catalog = catalogData;
  storeLayout = layoutData;
  renderAll();
}

document.addEventListener("click", (event) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const previewDevice = event.target.closest("[data-preview-device]");
  if (previewDevice) {
    activePreviewDevice = previewDevice.dataset.previewDevice || "phone";
    renderPreviewDevice();
    return;
  }

  const previewTab = event.target.closest("[data-phone-preview-tab]");
  if (previewTab) {
    activePreviewTab = previewTab.dataset.phonePreviewTab || "store";
    renderPreviews();
    return;
  }

  const addType = event.target.closest("[data-add-layout-block]")?.dataset.addLayoutBlock;
  if (addType) {
    const block = makeBlock(addType);
    normalizeLocalOrder([...sortedBlocks(), block]);
    activeBlockId = block.id;
    layoutMessageEl.textContent = "";
    renderAll();
    return;
  }

  const removeId = event.target.closest("[data-remove-layout-block]")?.dataset.removeLayoutBlock;
  if (removeId) {
    normalizeLocalOrder(sortedBlocks().filter((block) => block.id !== removeId));
    if (activeBlockId === removeId) activeBlockId = "";
    layoutMessageEl.textContent = "";
    renderAll();
    return;
  }

  const moveButton = event.target.closest("[data-move-layout-block]");
  if (moveButton) {
    const id = moveButton.dataset.blockId;
    const direction = moveButton.dataset.moveLayoutBlock;
    const blocks = sortedBlocks();
    const index = blocks.findIndex((block) => block.id === id);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index >= 0 && nextIndex >= 0 && nextIndex < blocks.length) {
      [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
      normalizeLocalOrder(blocks);
      activeBlockId = id;
      layoutMessageEl.textContent = "";
      renderAll();
    }
    return;
  }

  const addBannerButton = event.target.closest("[data-add-banner-image]");
  if (addBannerButton) {
    const block = activeBlock();
    if (block?.type === "banner") {
      block.imageUrls = Array.isArray(block.imageUrls) ? block.imageUrls : [];
      block.imageUrls.push("");
      renderAll();
    }
    return;
  }

  const removeBannerButton = event.target.closest("[data-remove-banner-image]");
  if (removeBannerButton) {
    const block = activeBlock();
    if (block?.type === "banner") {
      const index = Number(removeBannerButton.dataset.removeBannerImage);
      block.imageUrls = (block.imageUrls || []).filter((_, itemIndex) => itemIndex !== index);
      renderAll();
    }
    return;
  }

  const selectId = event.target.closest("[data-select-layout-block]")?.dataset.selectLayoutBlock;
  if (selectId) {
    activeBlockId = selectId;
    layoutMessageEl.textContent = "";
    renderAll();
  }
});

document.addEventListener("pointerdown", (event) => {
  const blockEl = event.target.closest("[data-drag-layout-block]");
  if (!blockEl || event.button !== 0) return;
  pointerDragState = {
    id: blockEl.dataset.dragLayoutBlock,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    targetId: "",
    placement: "after",
    pointerId: event.pointerId
  };
  activeBlockId = pointerDragState.id;
  blockEl.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (!pointerDragState) return;
  const distance = Math.hypot(event.clientX - pointerDragState.startX, event.clientY - pointerDragState.startY);
  if (!pointerDragState.dragging && distance < 7) return;
  pointerDragState.dragging = true;
  draggedLayoutBlockId = pointerDragState.id;
  event.preventDefault();
  const targetEl = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drag-layout-block]");
  const dropInfo = markPhoneDropTarget(targetEl, event.clientY);
  pointerDragState.targetId = dropInfo?.targetId || "";
  pointerDragState.placement = dropInfo?.placement || "after";
});

document.addEventListener("pointerup", (event) => {
  if (!pointerDragState) return;
  const state = pointerDragState;
  pointerDragState = null;
  if (state.dragging) {
    event.preventDefault();
    suppressNextClick = true;
    clearPhoneDropClasses();
    reorderLayoutBlock(state.id, state.targetId, state.placement);
  }
  draggedLayoutBlockId = "";
});

document.addEventListener("pointercancel", () => {
  pointerDragState = null;
  draggedLayoutBlockId = "";
  clearPhoneDropClasses();
});

document.addEventListener("dragstart", (event) => {
  const blockEl = event.target.closest("[data-drag-layout-block]");
  if (!blockEl) return;
  draggedLayoutBlockId = blockEl.dataset.dragLayoutBlock;
  activeBlockId = draggedLayoutBlockId;
  blockEl.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedLayoutBlockId);
  renderBlockList();
  renderSettings();
});

document.addEventListener("dragover", (event) => {
  const blockEl = event.target.closest("[data-drag-layout-block]");
  if (!blockEl || !draggedLayoutBlockId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearPhoneDropClasses();
  if (blockEl.dataset.dragLayoutBlock === draggedLayoutBlockId) {
    blockEl.classList.add("is-dragging");
    return;
  }
  const rect = blockEl.getBoundingClientRect();
  const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  blockEl.classList.add(placement === "after" ? "is-drop-after" : "is-drop-before");
  document.querySelector(`[data-drag-layout-block="${CSS.escape(draggedLayoutBlockId)}"]`)?.classList.add("is-dragging");
});

document.addEventListener("drop", (event) => {
  const blockEl = event.target.closest("[data-drag-layout-block]");
  if (!blockEl || !draggedLayoutBlockId) return;
  event.preventDefault();
  const rect = blockEl.getBoundingClientRect();
  const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  const targetId = blockEl.dataset.dragLayoutBlock;
  clearPhoneDropClasses();
  reorderLayoutBlock(draggedLayoutBlockId, targetId, placement);
  draggedLayoutBlockId = "";
});

document.addEventListener("dragend", () => {
  draggedLayoutBlockId = "";
  clearPhoneDropClasses();
});

layoutSettingsFormEl.addEventListener("input", (event) => {
  if (event.target.matches("[data-category-search]")) {
    categorySearchQuery = event.target.value;
    renderSettings();
    return;
  }
  if (event.target.matches("[data-product-search]")) {
    productSearchQuery = event.target.value;
    renderSettings();
    return;
  }
  updateActiveBlockSetting(event.target);
});

layoutSettingsFormEl.addEventListener("change", (event) => {
  updateActiveBlockSetting(event.target);
  if (event.target.matches("[data-layout-category-id], [data-layout-product-id], [data-setting='columns']")) {
    renderSettings();
  }
});

refreshLayoutButtonEl.addEventListener("click", () => {
  layoutMessageEl.textContent = "";
  loadLayoutData().catch((error) => {
    layoutMessageEl.textContent = error.message;
  });
});

saveLayoutButtonEl.addEventListener("click", async () => {
  normalizeLocalOrder();
  layoutMessageEl.textContent = "儲存中...";
  try {
    storeLayout = await requestJson("/api/admin/store-layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(storeLayout)
    });
    renderAll();
    layoutMessageEl.textContent = "賣場布置已儲存";
  } catch (error) {
    layoutMessageEl.textContent = error.message;
  }
});

loadLayoutData().catch((error) => {
  layoutPhonePreviewEl.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  if (layoutDesktopPreviewEl) layoutDesktopPreviewEl.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
});
