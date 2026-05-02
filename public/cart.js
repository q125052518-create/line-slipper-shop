const CART_KEY = "line-slipper-cart";

const state = {
  markets: [],
  cart: readCart(),
  lineUserId: "guest",
  buyer: null
};

const cartEl = document.querySelector("#cart");
const totalEl = document.querySelector("#total");
const formEl = document.querySelector("#orderForm");
const messageEl = document.querySelector("#message");
const deliveryMethodEl = document.querySelector("#deliveryMethod");
const addressFieldEl = document.querySelector("#addressField");
const deliveryAddressEl = document.querySelector("#deliveryAddress");

async function initLiff() {
  const config = await fetch("/api/config").then((response) => response.json());
  if (!config.liffId || !window.liff) return;

  await liff.init({ liffId: config.liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  const profile = await liff.getProfile();
  state.lineUserId = profile.userId;
}

async function loadMarkets() {
  const data = await fetch("/api/markets").then((response) => response.json());
  state.markets = data.markets;
  refreshCartFromCatalog();
  renderCart();
}

async function loadBuyerStatus() {
  try {
    const data = await fetch("/api/buyer/status").then((response) => response.json());
    state.buyer = data.authenticated ? data.buyer : null;
    if (state.buyer) {
      if (formEl.elements.customerName && !formEl.elements.customerName.value) {
        formEl.elements.customerName.value = state.buyer.name || "";
      }
      if (formEl.elements.phone && !formEl.elements.phone.value) {
        formEl.elements.phone.value = state.buyer.phone || "";
      }
    }
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
}

function clearCart() {
  state.cart = {};
  saveCart();
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

function findCatalogItem(cartItem) {
  const market = state.markets.find((entry) => entry.id === cartItem.marketId);
  const product = market?.products.find((entry) => entry.id === cartItem.productId);
  const variant = product?.variants.find((entry) => entry.id === cartItem.variantId);
  return market && product && variant ? { market, product, variant } : null;
}

function refreshCartFromCatalog() {
  for (const [key, cartItem] of Object.entries(state.cart)) {
    const found = findCatalogItem(cartItem);
    if (!found || found.variant.stock <= 0) {
      delete state.cart[key];
      continue;
    }

    state.cart[key] = {
      ...cartItem,
      marketName: found.market.name,
      productName: found.product.name,
      variantName: found.variant.name,
      barcode: found.variant.barcode,
      price: found.variant.price,
      stock: found.variant.stock,
      imageUrl: found.variant.imageUrl || found.product.imageUrl,
      quantity: Math.min(cartItem.quantity, found.variant.stock)
    };
  }
  saveCart();
}

function renderCart() {
  const items = Object.entries(state.cart);
  const submitButton = formEl.querySelector('button[type="submit"]');

  if (items.length === 0) {
    cartEl.innerHTML = '<p class="empty">購物車是空的，請先回賣場加入商品。</p>';
    totalEl.textContent = formatMoney(0);
    submitButton.disabled = true;
    return;
  }

  submitButton.disabled = !state.buyer;
  if (!state.buyer) {
    messageEl.textContent = "請先登入買家帳號才能結帳";
  }

  cartEl.innerHTML = items.map(([key, item]) => `
    <div class="cart-item cart-item-full">
      <img class="cart-thumb" src="${escapeHtml(item.imageUrl || placeholderImage(item.productName))}" alt="${escapeHtml(item.variantName)}">
      <div>
        <strong>${escapeHtml(item.productName)}</strong>
        <span>${escapeHtml(item.variantName)} / ${escapeHtml(item.barcode)}</span>
        <span>${escapeHtml(item.marketName)}</span>
        <span>${formatMoney(item.price)} / 雙，庫存 ${item.stock}</span>
      </div>
      <div class="quantity">
        <button type="button" data-minus="${key}">-</button>
        <span>${item.quantity}</span>
        <button type="button" data-plus="${key}" ${item.quantity >= item.stock ? "disabled" : ""}>+</button>
      </div>
      <button type="button" data-remove="${key}">移除</button>
    </div>
  `).join("");

  const total = items.reduce((sum, [, item]) => sum + item.price * item.quantity, 0);
  totalEl.textContent = formatMoney(total);
}

function placeholderImage(name) {
  return `https://placehold.co/720x540/f2efe8/1e2720?text=${encodeURIComponent(name || "Slipper")}`;
}

function changeQuantity(key, delta) {
  const item = state.cart[key];
  if (!item) return;

  const next = item.quantity + delta;
  if (next <= 0) {
    delete state.cart[key];
  } else if (next <= item.stock) {
    item.quantity = next;
  } else {
    messageEl.textContent = `庫存不足，目前剩 ${item.stock}`;
  }

  saveCart();
  renderCart();
}

function updateDeliveryAddressVisibility() {
  const isShipping = deliveryMethodEl.value === "宅配";
  addressFieldEl.classList.toggle("hidden", !isShipping);
  deliveryAddressEl.required = isShipping;
  if (!isShipping) deliveryAddressEl.value = "";
}

deliveryMethodEl.addEventListener("change", updateDeliveryAddressVisibility);

document.addEventListener("click", (event) => {
  const plusKey = event.target.dataset.plus;
  const minusKey = event.target.dataset.minus;
  const removeKey = event.target.dataset.remove;

  if (plusKey) changeQuantity(plusKey, 1);
  if (minusKey) changeQuantity(minusKey, -1);
  if (removeKey) {
    delete state.cart[removeKey];
    saveCart();
    renderCart();
  }
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "";

  if (!state.buyer) {
    messageEl.textContent = "請先登入買家帳號才能結帳";
    window.location.href = "/orders.html";
    return;
  }

  const items = Object.values(state.cart).map((item) => ({
    marketId: item.marketId,
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity
  }));

  if (items.length === 0) {
    messageEl.textContent = "請先加入商品到購物車";
    return;
  }

  const formData = new FormData(formEl);
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lineUserId: state.lineUserId,
      customerName: formData.get("customerName"),
      phone: formData.get("phone"),
      deliveryMethod: formData.get("deliveryMethod"),
      deliveryAddress: formData.get("deliveryAddress"),
      note: formData.get("note"),
      items
    })
  });

  const data = await response.json();
  if (!response.ok) {
    messageEl.textContent = data.message || "送出失敗";
    await loadMarkets();
    return;
  }

  localStorage.setItem("line-slipper-order-phone", String(formData.get("phone") || ""));
  localStorage.setItem("line-slipper-last-order-id", data.order.id);
  clearCart();
  formEl.reset();
  updateDeliveryAddressVisibility();
  renderCart();
  messageEl.textContent = `${data.summary}\n可到「我的訂單」查詢或取消訂單。`;
});

updateDeliveryAddressVisibility();
initLiff().finally(async () => {
  await loadBuyerStatus();
  await loadMarkets();
});
