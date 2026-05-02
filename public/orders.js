const LAST_PHONE_KEY = "line-slipper-order-phone";

const authPanelEl = document.querySelector("#buyerAuthPanel");
const loginFormEl = document.querySelector("#buyerLoginForm");
const registerFormEl = document.querySelector("#buyerRegisterForm");
const authMessageEl = document.querySelector("#authMessage");
const logoutButtonEl = document.querySelector("#buyerLogoutButton");
const refreshOrdersButtonEl = document.querySelector("#refreshOrdersButton");
const buyerSummaryEl = document.querySelector("#buyerSummary");
const ordersEl = document.querySelector("#orders");

let currentBuyer = null;

const statusLabels = {
  pending: "新訂單",
  processing: "處理中",
  shipped: "已出貨",
  cancelled: "取消"
};

const cancelRequestLabels = {
  pending: "取消申請審核中",
  approved: "取消申請已同意",
  rejected: "取消申請已拒絕"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  return `NT$${Number(value || 0).toLocaleString("zh-TW")}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function placeholderImage(name) {
  return `https://placehold.co/160x160/f2efe8/1e2720?text=${encodeURIComponent(name || "Item")}`;
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  loginFormEl.classList.toggle("hidden", !isLogin);
  registerFormEl.classList.toggle("hidden", isLogin);
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.authMode === mode);
  });
  authMessageEl.textContent = "";
}

function renderAuthState() {
  const loggedIn = Boolean(currentBuyer);
  document.body.classList.toggle("buyer-logged-in", loggedIn);
  authPanelEl.classList.toggle("hidden", loggedIn);
  logoutButtonEl.classList.toggle("hidden", !loggedIn);
  refreshOrdersButtonEl.classList.toggle("hidden", !loggedIn);
  buyerSummaryEl.textContent = loggedIn
    ? `${currentBuyer.name || "買家"}，以下是你的訂單紀錄。`
    : "請先登入買家帳號。";
}

function renderCancelRequest(order) {
  const request = order.cancelRequest || {};
  if (!request.status) return "";
  const time = request.requestedAt ? `｜${formatDateTime(request.requestedAt)}` : "";
  return `${cancelRequestLabels[request.status] || request.status}${time}`;
}

function renderOrderAction(order) {
  if (order.cancelRequest?.status === "pending") {
    return '<span class="muted">取消申請已送出，等待賣家同意</span>';
  }

  if (order.canCancel) {
    return `<button type="button" data-cancel-order="${escapeHtml(order.id)}">申請取消訂單</button>`;
  }

  if (order.status === "cancelled") {
    return '<span class="muted">訂單已取消</span>';
  }

  return '<span class="muted">此狀態不能申請取消</span>';
}

function renderOrders(orders) {
  if (!currentBuyer) {
    ordersEl.innerHTML = '<p class="empty">登入後會自動顯示你的訂單。</p>';
    return;
  }

  if (!orders.length) {
    ordersEl.innerHTML = '<p class="empty">目前沒有訂單紀錄。</p>';
    return;
  }

  ordersEl.innerHTML = orders.map((order) => `
    <article class="order buyer-order">
      <div class="order-head buyer-order-head">
        <div>
          <h3>${escapeHtml(order.id)}</h3>
          <p>${formatDateTime(order.createdAt)}</p>
        </div>
        <strong class="status-pill ${order.status === "cancelled" ? "is-cancelled" : ""}">
          ${escapeHtml(statusLabels[order.status] || order.status)}
        </strong>
      </div>

      <dl class="buyer-order-summary">
        <div><dt>姓名</dt><dd>${escapeHtml(order.customerName || "-")}</dd></div>
        <div><dt>手機</dt><dd>${escapeHtml(order.phone || "-")}</dd></div>
        <div><dt>取貨方式</dt><dd>${escapeHtml(order.deliveryMethod || "-")}</dd></div>
        <div><dt>地址</dt><dd>${escapeHtml(order.deliveryAddress || "-")}</dd></div>
      </dl>

      <div class="buyer-order-items">
        ${(order.items || []).map((item) => `
          <div class="buyer-order-item">
            <img src="${escapeHtml(item.variantImageUrl || placeholderImage(item.productName))}" alt="${escapeHtml(item.variantName || item.productName)}">
            <div class="buyer-order-item-main">
              <p class="buyer-order-market">${escapeHtml(item.marketName || "")}</p>
              <strong>${escapeHtml(item.productName || "-")}</strong>
              <span>${escapeHtml(item.variantName || "-")} / ${escapeHtml(item.barcode || "-")}</span>
              <small>數量 ${Number(item.quantity || 0).toLocaleString("zh-TW")}</small>
            </div>
            <div class="buyer-order-item-price">
              <span>小計</span>
              <strong>${formatMoney(item.subtotal)}</strong>
            </div>
          </div>
        `).join("")}
      </div>

      ${order.note ? `<p class="note">備註：${escapeHtml(order.note)}</p>` : ""}
      ${order.cancelRequest?.status ? `<p class="note">取消申請：${escapeHtml(renderCancelRequest(order))}</p>` : ""}

      <div class="buyer-order-footer">
        <div class="buyer-order-total">
          <span>訂單金額</span>
          <strong>${formatMoney(order.totalAmount)}</strong>
        </div>
        ${renderOrderAction(order)}
      </div>
    </article>
  `).join("");
}

async function loadBuyerStatus() {
  const response = await fetch("/api/buyer/status");
  const data = await response.json();
  currentBuyer = data.authenticated ? data.buyer : null;
  renderAuthState();

  if (currentBuyer) {
    localStorage.setItem(LAST_PHONE_KEY, currentBuyer.phone || "");
    await loadOrders();
  } else {
    renderOrders([]);
  }
}

async function loadOrders() {
  if (!currentBuyer) return;

  ordersEl.innerHTML = '<p class="empty">讀取訂單中...</p>';
  const response = await fetch("/api/buyer/orders");
  const data = await response.json();

  if (!response.ok) {
    ordersEl.innerHTML = `<p class="empty">${escapeHtml(data.message || "訂單讀取失敗")}</p>`;
    return;
  }

  renderOrders(data.orders || []);
}

async function submitAuthForm(form, endpoint) {
  authMessageEl.textContent = "處理中...";
  const formData = new FormData(form);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  const data = await response.json();

  if (!response.ok) {
    authMessageEl.textContent = data.message || "登入失敗";
    return;
  }

  if (data.redirectTo) {
    window.location.href = data.redirectTo;
    return;
  }

  currentBuyer = data.buyer;
  localStorage.setItem(LAST_PHONE_KEY, currentBuyer.phone || "");
  form.reset();
  window.location.href = "/";
}

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

loginFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAuthForm(loginFormEl, "/api/buyer/login");
});

registerFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAuthForm(registerFormEl, "/api/buyer/register");
});

refreshOrdersButtonEl.addEventListener("click", loadOrders);

ordersEl.addEventListener("click", async (event) => {
  const orderId = event.target.dataset.cancelOrder;
  if (!orderId) return;

  if (!confirm(`確定要申請取消訂單 ${orderId}？賣家同意後才會正式取消。`)) return;

  event.target.disabled = true;
  const response = await fetch(`/api/buyer/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
  const data = await response.json();

  if (!response.ok) {
    alert(data.message || "申請取消失敗");
    event.target.disabled = false;
    return;
  }

  alert(data.message || "取消申請已送出");
  await loadOrders();
});

loginFormEl.elements.phone.value = localStorage.getItem(LAST_PHONE_KEY) || "";
registerFormEl.elements.phone.value = localStorage.getItem(LAST_PHONE_KEY) || "";
setAuthMode("login");
loadBuyerStatus();
