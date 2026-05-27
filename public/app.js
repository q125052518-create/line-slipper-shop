const CART_KEY = "line-slipper-cart";

const state = {
  markets: [],
  currentMarketId: "",
  categories: [],
  storeLayout: { blocks: [] },
  currentStoreTab: "store",
  currentCategoryId: "all",
  selectedVariants: {},
  openProductId: "",
  cart: readCart(),
  buyer: null
};

const categoryLandingEl = document.querySelector("#categoryLanding");
const subCategoryLandingEl = document.querySelector("#subCategoryLanding");
const categoryTitleEl = document.querySelector("#categoryTitle");
const marketDescriptionEl = document.querySelector("#marketDescription");
const productsEl = document.querySelector("#products");
const messageEl = document.querySelector("#message");
const cartCountEl = document.querySelector("#cartCount");
const productSearchEl = document.querySelector("#productSearch");
const productSortEl = document.querySelector("#productSort");
const storeNameEl = document.querySelector("#storeName");
const storeAvatarEl = document.querySelector("#storeAvatar");
const storeProductCountEl = document.querySelector("#storeProductCount");
const storeCategoryCountEl = document.querySelector("#storeCategoryCount");
const storeTabsEl = document.querySelector("#storeTabs");
const layoutBlocksEl = document.querySelector("#layoutBlocks");
const categoryDirectoryEl = document.querySelector("#categoryDirectory");
const productShellEl = document.querySelector("#productShell");
const appHeaderTitleEl = document.querySelector(".app-header h1");
const desktopStoreMedia = window.matchMedia("(min-width: 901px)");

function normalizeStoreTabForViewport() {
  if (desktopStoreMedia.matches && state.currentStoreTab === "categories") {
    state.currentStoreTab = "store";
  }
}

async function loadMarkets() {
  const [data, layoutData] = await Promise.all([
    fetch("/api/markets").then((response) => response.json()),
    fetch("/api/store-layout")
      .then((response) => (response.ok ? response.json() : { blocks: [] }))
      .catch(() => ({ blocks: [] }))
  ]);
  state.markets = data.markets || [];
  state.categories = data.categories || [];
  state.storeLayout = layoutData || { blocks: [] };
  state.currentMarketId = state.markets[0]?.id || "";
  state.currentStoreTab = "store";
  state.currentCategoryId = "all";
  renderCatalog();
  renderCartCount();
}

async function loadBuyerStatus() {
  try {
    const data = await fetch("/api/buyer/status").then((response) => response.json());
    state.buyer = data.authenticated ? data.buyer : null;
  } catch {
    state.buyer = null;
  }
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  renderCartCount();
}

function renderCartCount() {
  const count = Object.values(state.cart).reduce((sum, item) => sum + item.quantity, 0);
  cartCountEl.textContent = count;
}

function currentMarket() {
  return state.markets.find((market) => market.id === state.currentMarketId);
}

function formatMoney(value) {
  return `NT$${Number(value || 0).toLocaleString("zh-TW")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function placeholderImage(name) {
  return `https://placehold.co/720x720/f2efe8/1e2720?text=${encodeURIComponent(name || "Shop")}`;
}

function sortCategoryList(categories) {
  return [...categories].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    return orderA - orderB || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

function categoryById(categoryId) {
  return state.categories.find((category) => category.id === categoryId);
}

function childCategories(parentId = "") {
  const activeIds = new Set(state.categories.map((category) => category.id));
  return sortCategoryList(state.categories.filter((category) => {
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
  if (categoryId === "all") return new Set(state.categories.map((category) => category.id));
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

function categoryName(categoryId) {
  if (categoryId === "all") return "全部商品";
  const category = categoryById(categoryId);
  if (!category) return "商品分類";

  const names = [category.name];
  let parentId = category.parentId || "";
  const seen = new Set([category.id]);
  while (parentId && !seen.has(parentId)) {
    const parent = categoryById(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId || "";
  }
  return names.join(" / ");
}

function marketProducts() {
  return currentMarket()?.products || [];
}

function productById(productId) {
  return marketProducts().find((entry) => entry.id === productId);
}

function categoryProducts(categoryId) {
  const ids = descendantCategoryIds(categoryId);
  return marketProducts().filter((product) => ids.has(product.categoryId));
}

function categoryImage(categoryId) {
  const category = categoryById(categoryId);
  if (category?.imageUrl) return category.imageUrl;
  const ids = descendantCategoryIds(categoryId);
  const product = marketProducts().find((entry) => ids.has(entry.categoryId) && (
    entry.imageUrl || (entry.variants || []).some((variant) => variant.imageUrl)
  ));
  const variant = product?.variants?.find((entry) => entry.imageUrl);
  return product?.imageUrl || variant?.imageUrl || placeholderImage(category?.name || "分類");
}

function productImage(product) {
  return product?.imageUrl || product?.variants?.find((variant) => variant.imageUrl)?.imageUrl || placeholderImage(product?.name || "商品");
}

function productListImage(product) {
  return product?.imageUrl || placeholderImage(product?.name || "商品");
}

function selectedVariant(product) {
  const variants = product.variants || [];
  const selectedId = state.selectedVariants[product.id] || variants[0]?.id;
  return variants.find((variant) => variant.id === selectedId) || variants[0];
}

function productMinPrice(product) {
  const prices = (product.variants || []).map((variant) => Number(variant.price || 0));
  return prices.length ? Math.min(...prices) : 0;
}

function productMaxPrice(product) {
  const prices = (product.variants || []).map((variant) => Number(variant.price || 0));
  return prices.length ? Math.max(...prices) : 0;
}

function productTotalStock(product) {
  return (product.variants || []).reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function productSearchText(product) {
  return String(product.name || "").toLowerCase();
}

function searchTerms() {
  return String(productSearchEl?.value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function visibleProducts() {
  const terms = searchTerms();
  const products = categoryProducts(state.currentCategoryId).filter((product) => {
    if (!terms.length) return true;
    const text = productSearchText(product);
    return terms.every((term) => text.includes(term));
  });

  switch (productSortEl?.value) {
    case "price-asc":
      return products.sort((a, b) => productMinPrice(a) - productMinPrice(b));
    case "price-desc":
      return products.sort((a, b) => productMaxPrice(b) - productMaxPrice(a));
    default:
      return products;
  }
}

function productPriceText(product) {
  const min = productMinPrice(product);
  const max = productMaxPrice(product);
  return min === max ? formatMoney(min) : `${formatMoney(min)} - ${formatMoney(max)}`;
}

function renderStoreHead() {
  const market = currentMarket();
  const productCount = marketProducts().length;
  const categoryCount = state.categories.length;
  const storeName = market?.name || "拖鞋賣場";
  const storeDescription = market?.description || "精選商品，線上下單。";
  const imageUrl = market?.imageUrl || marketProducts().find((product) => product.imageUrl)?.imageUrl || placeholderImage(storeName || "Shop");

  document.title = storeName;
  if (appHeaderTitleEl) appHeaderTitleEl.textContent = storeName;
  storeNameEl.textContent = storeName;
  marketDescriptionEl.textContent = storeDescription;
  storeAvatarEl.src = imageUrl;
  storeAvatarEl.alt = storeName;
  storeProductCountEl.textContent = productCount;
  storeCategoryCountEl.textContent = categoryCount;
}

function categoryNavButton(categoryId, label, count, depth = 0) {
  return `
    <button
      type="button"
      class="shop-category-button ${state.currentCategoryId === categoryId ? "is-selected" : ""}"
      style="--category-depth: ${depth};"
      data-open-category="${escapeHtml(categoryId)}"
    >
      <span>${escapeHtml(label)}</span>
      <small>${count}</small>
    </button>
  `;
}

function renderCategoryHome() {
  const rows = [
    categoryNavButton("all", "全部商品", categoryProducts("all").length, 0),
    ...sortedCategories().map((category) => categoryNavButton(
      category.id,
      category.name,
      categoryProducts(category.id).length,
      Math.min(categoryDepth(category.id), 5)
    ))
  ];

  categoryLandingEl.innerHTML = rows.join("") || '<p class="empty">尚未建立分類</p>';
}

function layoutBlockCategories(block) {
  const byId = new Map(state.categories.map((category) => [category.id, category]));
  const selected = (Array.isArray(block.categoryIds) ? block.categoryIds : [])
    .map((categoryId) => byId.get(categoryId))
    .filter((category) => category && category.isActive !== false);
  return selected;
}

function layoutProductsForBlock(block) {
  const limit = Math.min(20, Math.max(1, Number(block.limit || 6)));
  if (block.type === "featured-products") {
    const byId = new Map(marketProducts().map((product) => [product.id, product]));
    const selected = (Array.isArray(block.productIds) ? block.productIds : [])
      .map((productId) => byId.get(productId))
      .filter(Boolean);
    return (selected.length ? selected : marketProducts()).slice(0, limit);
  }
  if (block.type === "new-products") return [...marketProducts()].reverse().slice(0, limit);
  if (block.type === "hot-products") {
    return [...marketProducts()]
      .sort((a, b) => productTotalStock(b) - productTotalStock(a))
      .slice(0, limit);
  }
  return [];
}

function renderLayoutBanner(block) {
  const imageUrls = (Array.isArray(block.imageUrls) ? block.imageUrls : []).filter(Boolean);
  const firstImage = imageUrls[0];
  const content = firstImage
    ? `<img src="${escapeHtml(firstImage)}" alt="${escapeHtml(block.title || "賣場看板")}" onerror="this.closest('.store-banner-block').classList.add('has-broken-image');">`
    : `<div class="store-banner-placeholder"><strong>${escapeHtml(block.title || "賣場看板")}</strong><span>尚未設定看板圖片</span></div>`;
  const body = block.linkUrl
    ? `<a href="${escapeHtml(block.linkUrl)}" class="store-banner-link">${content}</a>`
    : content;
  return `
    <section class="store-layout-section store-banner-block">
      ${body}
      ${imageUrls.length > 1 ? `<div class="store-banner-dots">${imageUrls.map((_, index) => `<span class="${index === 0 ? "is-active" : ""}"></span>`).join("")}</div>` : ""}
    </section>
  `;
}

function renderLayoutNotice(block) {
  return `
    <section class="store-layout-section store-notice-block">
      <strong>${escapeHtml(block.title || "賣場公告")}</strong>
      <p>${escapeHtml(block.text || "尚未輸入公告內容")}</p>
    </section>
  `;
}

function renderLayoutCategoryGrid(block) {
  const categories = layoutBlockCategories(block);
  const columns = Math.min(6, Math.max(3, Number(block.columns || 5)));
  return `
    <section class="store-layout-section store-category-section">
      <div class="store-layout-section-head">
        <h2>${escapeHtml(block.title || "分類區")}</h2>
      </div>
      <div class="store-category-grid" style="--store-category-columns: ${columns};">
        ${categories.map((category) => `
          <button type="button" class="store-category-card" data-open-category="${escapeHtml(category.id)}">
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <span>${escapeHtml(category.name)}</span>
          </button>
        `).join("") || '<p class="empty">尚未建立分類</p>'}
      </div>
    </section>
  `;
}

function renderLayoutProductBlock(block) {
  const products = layoutProductsForBlock(block);
  return `
    <section class="store-layout-section store-product-strip-section">
      <div class="store-layout-section-head">
        <h2>${escapeHtml(block.title || "商品區")}</h2>
      </div>
      <div class="store-product-strip">
        ${products.map((product) => `
          <button type="button" class="store-strip-product-card" data-open-category="${escapeHtml(product.categoryId || "all")}">
            <img src="${escapeHtml(productImage(product))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(product.name))}';">
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(productPriceText(product))}</span>
          </button>
        `).join("") || '<p class="empty">目前沒有商品</p>'}
      </div>
    </section>
  `;
}

function renderLayoutBlocks() {
  if (!layoutBlocksEl) return;
  const blocks = Array.isArray(state.storeLayout?.blocks) ? state.storeLayout.blocks : [];
  const visibleBlocks = blocks
    .filter((block) => block.enabled !== false)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  if (!visibleBlocks.length) {
    layoutBlocksEl.innerHTML = "";
    layoutBlocksEl.dataset.hasBlocks = "false";
    layoutBlocksEl.classList.add("hidden");
    return;
  }

  layoutBlocksEl.dataset.hasBlocks = "true";
  layoutBlocksEl.classList.remove("hidden");
  layoutBlocksEl.innerHTML = visibleBlocks.map((block) => {
    if (block.type === "banner") return renderLayoutBanner(block);
    if (block.type === "notice") return renderLayoutNotice(block);
    if (block.type === "category-grid") return renderLayoutCategoryGrid(block);
    if (["featured-products", "new-products", "hot-products"].includes(block.type)) return renderLayoutProductBlock(block);
    return "";
  }).join("");
}

function renderStoreTabs() {
  if (!storeTabsEl) return;
  storeTabsEl.querySelectorAll("[data-store-tab]").forEach((button) => {
    const isCurrent = button.dataset.storeTab === state.currentStoreTab;
    button.classList.toggle("is-current", isCurrent);
    button.setAttribute("aria-selected", isCurrent ? "true" : "false");
  });
}

function renderCategoryDirectory() {
  if (!categoryDirectoryEl) return;
  const categories = sortedCategories().filter((category) => category.isActive !== false);
  categoryDirectoryEl.innerHTML = `
    <section class="store-layout-section store-directory-section">
      <div class="store-layout-section-head">
        <h2>全部分類</h2>
      </div>
      <div class="store-directory-list">
        ${categories.map((category) => `
          <button type="button" class="store-directory-row" style="--category-depth: ${Math.min(categoryDepth(category.id), 5)};" data-open-category="${escapeHtml(category.id)}">
            <img src="${escapeHtml(categoryImage(category.id))}" alt="" onerror="this.src='${escapeHtml(placeholderImage(category.name))}';">
            <span class="store-directory-name">${categoryDepth(category.id) ? "› " : ""}${escapeHtml(category.name)}</span>
            <small>(${categoryProducts(category.id).length})</small>
            <span class="store-directory-chevron" aria-hidden="true">›</span>
          </button>
        `).join("") || '<p class="empty">尚未建立分類</p>'}
      </div>
    </section>
  `;
}

function renderStoreTabPanels() {
  normalizeStoreTabForViewport();
  renderStoreTabs();
  const isStore = state.currentStoreTab === "store";
  const isProducts = state.currentStoreTab === "products";
  const isCategories = state.currentStoreTab === "categories";
  if (layoutBlocksEl) {
    layoutBlocksEl.classList.toggle("hidden", !isStore || layoutBlocksEl.dataset.hasBlocks !== "true");
  }
  productShellEl?.classList.toggle("hidden", !isProducts);
  categoryDirectoryEl?.classList.toggle("hidden", !isCategories);
}

function renderSubCategories() {
  const children = state.currentCategoryId === "all"
    ? childCategories("")
    : childCategories(state.currentCategoryId);

  if (!children.length) {
    subCategoryLandingEl.innerHTML = "";
    subCategoryLandingEl.classList.add("hidden");
    return;
  }

  subCategoryLandingEl.classList.remove("hidden");
  subCategoryLandingEl.innerHTML = children.map((category) => `
    <button type="button" class="shop-sub-category ${state.currentCategoryId === category.id ? "is-selected" : ""}" data-open-category="${escapeHtml(category.id)}">
      ${escapeHtml(category.name)}
    </button>
  `).join("");
}

function renderCatalog() {
  renderStoreHead();
  renderCategoryHome();
  renderLayoutBlocks();
  renderCategoryDirectory();
  categoryTitleEl.textContent = categoryName(state.currentCategoryId);
  renderSubCategories();
  renderProducts();
  renderStoreTabPanels();
}

function renderProducts() {
  const market = currentMarket();
  if (!market) {
    productsEl.innerHTML = '<p class="empty">尚未建立賣場</p>';
    return;
  }

  if (market.products.length === 0) {
    productsEl.innerHTML = '<p class="empty">目前沒有商品</p>';
    return;
  }

  const products = visibleProducts();
  if (products.length === 0) {
    productsEl.innerHTML = '<p class="empty">沒有符合的商品</p>';
    return;
  }

  productsEl.innerHTML = products.map((product) => {
    const selected = selectedVariant(product);
    const imageUrl = productListImage(product);
    const disabled = !selected || selected.stock <= 0;
    const loginRequired = !state.buyer;

    return `
      <article class="shop-product-card" role="button" tabindex="0" data-open-product="${escapeHtml(product.id)}">
        <div class="shop-product-image-wrap">
          <img class="product-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" data-product-image="${escapeHtml(product.id)}">
          ${disabled ? '<span class="soldout-badge">售完</span>' : ""}
        </div>
        <div class="shop-product-body">
          <p class="shop-product-category">${escapeHtml(categoryName(product.categoryId))}</p>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description || "拖鞋商品")}</p>
          <div class="shop-variant-strip" role="list" aria-label="${escapeHtml(product.name)}品項">
            ${(product.variants || []).map((variant) => {
              const isSelected = selected?.id === variant.id;
              const variantImage = variant.imageUrl || product.imageUrl || placeholderImage(variant.name);
              return `
                <button
                  type="button"
                  class="shop-variant-chip ${isSelected ? "is-selected" : ""}"
                  data-select-variant="${escapeHtml(product.id)}"
                  data-variant-id="${escapeHtml(variant.id)}"
                  title="${escapeHtml(`${variant.name} ${variant.barcode}`)}"
                >
                  <img src="${escapeHtml(variantImage)}" alt="">
                  <span>${escapeHtml(variant.name)}</span>
                </button>
              `;
            }).join("")}
          </div>
          <div class="shop-product-meta">
            <strong data-price-line="${escapeHtml(product.id)}">${productPriceText(product)}</strong>
            <span data-stock-line="${escapeHtml(product.id)}">庫存 ${selected?.stock ?? 0}</span>
          </div>
          <div class="shop-product-actions">
            <input type="number" min="1" max="${selected?.stock || 1}" value="1" aria-label="數量" data-add-quantity="${escapeHtml(product.id)}" ${disabled || loginRequired ? "disabled" : ""}>
            <button type="button" data-add-product="${escapeHtml(product.id)}" ${disabled ? "disabled" : ""}>${disabled ? "售完" : loginRequired ? "登入購買" : "加入購物車"}</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function cartKey(marketId, productId, variantId) {
  return `${marketId}|${productId}|${variantId}`;
}

function ensureProductDetailOverlay() {
  let overlay = document.querySelector("#productDetailOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "productDetailOverlay";
    overlay.className = "product-detail-overlay";
    document.body.appendChild(overlay);
  }
  return overlay;
}

function closeProductDetail() {
  state.openProductId = "";
  document.querySelector("#productDetailOverlay")?.remove();
}

function openProductDetail(productId) {
  state.openProductId = productId;
  renderProductDetail(productId);
}

function renderProductDetail(productId = state.openProductId) {
  const product = productById(productId);
  if (!product) {
    closeProductDetail();
    return;
  }

  const selected = selectedVariant(product);
  const variants = product.variants || [];
  const imageUrl = selected?.imageUrl || productListImage(product);
  const stock = Number(selected?.stock || 0);
  const disabled = !selected || stock <= 0;
  const loginRequired = !state.buyer;
  const overlay = ensureProductDetailOverlay();

  overlay.innerHTML = `
    <div class="product-detail-backdrop" data-close-product-detail></div>
    <section class="product-detail-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(product.name)}">
      <button type="button" class="product-detail-close" aria-label="關閉" data-close-product-detail>×</button>
      <div class="product-detail-grid">
        <div class="product-detail-media">
          <img class="product-detail-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}">
        </div>
        <div class="product-detail-body">
          <p class="shop-product-category">${escapeHtml(categoryName(product.categoryId))}</p>
          <h2>${escapeHtml(product.name)}</h2>
          <p>${escapeHtml(product.description || "精選商品")}</p>
          <div class="product-detail-variant-list" role="list" aria-label="${escapeHtml(product.name)}品項">
            ${variants.length ? variants.map((variant) => {
              const isSelected = selected?.id === variant.id;
              const variantImage = variant.imageUrl || product.imageUrl || placeholderImage(variant.name);
              return `
                <button
                  type="button"
                  class="shop-variant-chip product-detail-variant ${isSelected ? "is-selected" : ""}"
                  data-select-variant="${escapeHtml(product.id)}"
                  data-variant-id="${escapeHtml(variant.id)}"
                  title="${escapeHtml(`${variant.name} ${variant.barcode}`)}"
                >
                  <img src="${escapeHtml(variantImage)}" alt="">
                  <span>
                    <strong>${escapeHtml(variant.name)}</strong>
                    <small>${escapeHtml(variant.barcode || "")}</small>
                  </span>
                </button>
              `;
            }).join("") : '<p class="empty">尚未建立品項</p>'}
          </div>
          <div class="product-detail-meta">
            <strong>${selected ? formatMoney(selected.price) : productPriceText(product)}</strong>
            <span>庫存 ${stock}</span>
          </div>
          <div class="product-detail-actions">
            <input type="number" min="1" max="${stock || 1}" value="1" aria-label="數量" data-add-quantity="${escapeHtml(product.id)}" ${disabled || loginRequired ? "disabled" : ""}>
            <button type="button" data-add-product="${escapeHtml(product.id)}" ${disabled ? "disabled" : ""}>${disabled ? "售完" : loginRequired ? "登入購買" : "加入購物車"}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function addToCart(productId) {
  if (!state.buyer) {
    messageEl.textContent = "請先登入買家帳號，再加入購物車";
    window.location.href = "/orders.html";
    return;
  }

  const market = currentMarket();
  const product = market?.products.find((entry) => entry.id === productId);
  const variant = product ? selectedVariant(product) : null;
  if (!market || !product || !variant || variant.stock <= 0) return;

  const key = cartKey(market.id, product.id, variant.id);
  const quantityInput = document.querySelector(`[data-add-quantity="${CSS.escape(product.id)}"]`);
  const addQuantity = Math.max(1, Number(quantityInput?.value || 1));
  const currentQuantity = state.cart[key]?.quantity || 0;
  if (!Number.isInteger(addQuantity) || addQuantity <= 0) {
    messageEl.textContent = "請輸入正確的數量";
    return;
  }

  if (currentQuantity + addQuantity > variant.stock) {
    messageEl.textContent = `庫存不足，最多可買 ${variant.stock}`;
    return;
  }

  state.cart[key] = {
    marketId: market.id,
    marketName: market.name,
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    barcode: variant.barcode,
    price: variant.price,
    stock: variant.stock,
    imageUrl: variant.imageUrl || product.imageUrl,
    quantity: currentQuantity + addQuantity
  };

  saveCart();
  messageEl.textContent = `${product.name} - ${variant.name} x ${addQuantity} 已加入購物車`;
}

document.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-store-tab]");
  if (tabButton) {
    state.currentStoreTab = tabButton.dataset.storeTab || "store";
    normalizeStoreTabForViewport();
    closeProductDetail();
    if (state.currentStoreTab === "products") {
      state.currentCategoryId = "all";
      state.selectedVariants = {};
    }
    renderCatalog();
    return;
  }

  const categoryButton = event.target.closest("[data-open-category]");
  if (categoryButton) {
    state.currentCategoryId = categoryButton.dataset.openCategory;
    state.currentStoreTab = "products";
    state.selectedVariants = {};
    closeProductDetail();
    renderCatalog();
    document.querySelector(".store-product-area")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const closeDetailButton = event.target.closest("[data-close-product-detail]");
  if (closeDetailButton) {
    closeProductDetail();
    return;
  }

  const variantButton = event.target.closest("[data-select-variant]");
  if (variantButton) {
    state.selectedVariants[variantButton.dataset.selectVariant] = variantButton.dataset.variantId;
    if (state.openProductId) {
      renderProductDetail(state.openProductId);
    } else {
      renderProducts();
    }
    return;
  }

  const productCard = event.target.closest("[data-open-product]");
  if (productCard) {
    openProductDetail(productCard.dataset.openProduct);
    return;
  }

  const productId = event.target.dataset.addProduct;
  if (productId) addToCart(productId);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.openProductId) {
    closeProductDetail();
    return;
  }

  const productCard = event.target.closest?.("[data-open-product]");
  if (productCard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openProductDetail(productCard.dataset.openProduct);
  }
});

productSearchEl.addEventListener("input", renderProducts);
productSortEl.addEventListener("change", renderProducts);

desktopStoreMedia.addEventListener("change", () => {
  normalizeStoreTabForViewport();
  renderCatalog();
});

loadBuyerStatus().finally(loadMarkets);
