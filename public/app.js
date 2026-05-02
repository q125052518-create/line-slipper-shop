const CART_KEY = "line-slipper-cart";

const state = {
  markets: [],
  currentMarketId: "",
  selectedVariants: {},
  cart: readCart(),
  buyer: null
};

const marketSelectEl = document.querySelector("#marketSelect");
const marketDescriptionEl = document.querySelector("#marketDescription");
const productsEl = document.querySelector("#products");
const messageEl = document.querySelector("#message");
const cartCountEl = document.querySelector("#cartCount");

async function loadMarkets() {
  const data = await fetch("/api/markets").then((response) => response.json());
  state.markets = data.markets;
  state.currentMarketId = state.markets[0]?.id || "";
  renderMarketOptions();
  renderProducts();
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
  return `https://placehold.co/720x540/f2efe8/1e2720?text=${encodeURIComponent(name || "Slipper")}`;
}

function renderMarketOptions() {
  marketSelectEl.innerHTML = state.markets.map((market) => `
    <option value="${market.id}">${escapeHtml(market.name)}</option>
  `).join("");
  marketSelectEl.value = state.currentMarketId;
}

function selectedVariant(product) {
  const selectedId = state.selectedVariants[product.id] || product.variants[0]?.id;
  return product.variants.find((variant) => variant.id === selectedId) || product.variants[0];
}

function renderProducts() {
  const market = currentMarket();
  marketDescriptionEl.textContent = market?.description || "";

  if (!market) {
    productsEl.innerHTML = '<p class="empty">目前沒有可顯示的賣場</p>';
    return;
  }

  if (market.products.length === 0) {
    productsEl.innerHTML = '<p class="empty">這個賣場目前沒有商品</p>';
    return;
  }

  productsEl.innerHTML = market.products.map((product) => {
    const selected = selectedVariant(product);
    const imageUrl = selected?.imageUrl || product.imageUrl || placeholderImage(product.name);
    const disabled = !selected || selected.stock <= 0;
    const loginRequired = !state.buyer;

    return `
      <article class="product">
        <img class="product-image" src="${escapeHtml(imageUrl || market.imageUrl || placeholderImage(product.name))}" alt="${escapeHtml(product.name)}" data-product-image="${product.id}">
        <div class="product-body">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description || "拖鞋商品")}</p>
          <div class="variant-card-grid" role="list" aria-label="${escapeHtml(product.name)}品項">
            ${product.variants.map((variant) => {
              const isSelected = selected?.id === variant.id;
              const variantImage = variant.imageUrl || product.imageUrl || placeholderImage(variant.name);
              return `
                <button
                  type="button"
                  class="variant-card ${isSelected ? "is-selected" : ""}"
                  data-select-variant="${product.id}"
                  data-variant-id="${variant.id}"
                  ${variant.stock <= 0 ? "data-sold-out=\"true\"" : ""}
                >
                  <img src="${escapeHtml(variantImage)}" alt="${escapeHtml(variant.name)}">
                  <span>${escapeHtml(variant.name)}</span>
                  <small>${escapeHtml(variant.barcode)}</small>
                  <strong>${formatMoney(variant.price)}</strong>
                  <em>庫存 ${variant.stock}</em>
                </button>
              `;
            }).join("")}
          </div>
        </div>
        <div class="product-actions">
          <strong data-price-line="${product.id}">${formatMoney(selected?.price || 0)}</strong>
          <p class="stock-line" data-stock-line="${product.id}">庫存：${selected?.stock ?? 0}</p>
          <label class="quantity-field">
            數量
            <input type="number" min="1" max="${selected?.stock || 1}" value="1" data-add-quantity="${product.id}" ${disabled || loginRequired ? "disabled" : ""}>
          </label>
          <button type="button" data-add-product="${product.id}" ${disabled ? "disabled" : ""}>${disabled ? "售完" : loginRequired ? "登入後加入購物車" : "加入購物車"}</button>
        </div>
      </article>
    `;
  }).join("");
}

function cartKey(marketId, productId, variantId) {
  return `${marketId}|${productId}|${variantId}`;
}

function addToCart(productId) {
  if (!state.buyer) {
    messageEl.textContent = "請先登入買家帳號才能加入購物車";
    window.location.href = "/orders.html";
    return;
  }

  const market = currentMarket();
  const product = market?.products.find((entry) => entry.id === productId);
  const variant = product ? selectedVariant(product) : null;
  if (!market || !product || !variant || variant.stock <= 0) return;

  const key = cartKey(market.id, product.id, variant.id);
  const quantityInput = document.querySelector(`[data-add-quantity="${product.id}"]`);
  const addQuantity = Math.max(1, Number(quantityInput?.value || 1));
  const currentQuantity = state.cart[key]?.quantity || 0;
  if (!Number.isInteger(addQuantity) || addQuantity <= 0) {
    messageEl.textContent = "請輸入正確數量";
    return;
  }

  if (currentQuantity + addQuantity > variant.stock) {
    messageEl.textContent = `庫存不足，目前剩 ${variant.stock}`;
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

marketSelectEl.addEventListener("change", () => {
  state.currentMarketId = marketSelectEl.value;
  state.selectedVariants = {};
  renderProducts();
});

document.addEventListener("click", (event) => {
  const variantButton = event.target.closest("[data-select-variant]");
  if (variantButton) {
    state.selectedVariants[variantButton.dataset.selectVariant] = variantButton.dataset.variantId;
    renderProducts();
    return;
  }

  const productId = event.target.dataset.addProduct;
  if (productId) addToCart(productId);
});

loadBuyerStatus().finally(loadMarkets);
