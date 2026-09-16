const LAST_PHONE_KEY = "line-slipper-order-phone";
const LAST_ORDER_ID_KEY = "line-slipper-last-order-id";

const lookupFormEl = document.querySelector("#orderLookupForm");
const lookupMessageEl = document.querySelector("#lookupMessage");
const refreshOrdersButtonEl = document.querySelector("#refreshOrdersButton");
const orderSummaryEl = document.querySelector("#orderSummary");
const ordersEl = document.querySelector("#orders");

let currentLookup = null;

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

function formatSevenElevenStore(order) {
  const store = order.sevenElevenStore || {};
  const parts = [store.id, store.name, store.address].filter(Boolean);
  return parts.length ? parts.join(" / ") : "-";
}

function placeholderImage(name) {
  return `https://placehold.co/160x160/f2efe8/1e2720?text=${encodeURIComponent(name || "Item")}`;
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
  if (!orders.length) {
    ordersEl.innerHTML = '<p class="empty">尚未查詢到訂單。</p>';
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
        <div><dt>7-11 門市</dt><dd>${escapeHtml(formatSevenElevenStore(order))}</dd></div>
        <div><dt>運費</dt><dd>${formatMoney(order.shippingFee || 0)}</dd></div>
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

function lookupValues() {
  const formData = new FormData(lookupFormEl);
  return {
    orderId: String(formData.get("orderId") || "").trim(),
    phone: String(formData.get("phone") || "").trim()
  };
}

async function loadOrders() {
  const lookup = lookupValues();
  if (!lookup.orderId || !lookup.phone) {
    lookupMessageEl.textContent = "請輸入訂單編號與結帳手機";
    return false;
  }

  lookupMessageEl.textContent = "查詢中...";
  ordersEl.innerHTML = '<p class="empty">讀取訂單中...</p>';
  const response = await fetch("/api/orders/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lookup)
  });
  const data = await response.json();

  if (!response.ok) {
    currentLookup = null;
    refreshOrdersButtonEl.classList.add("hidden");
    orderSummaryEl.textContent = "沒有符合的訂單。";
    lookupMessageEl.textContent = data.message || "訂單查詢失敗";
    renderOrders([]);
    return false;
  }

  currentLookup = lookup;
  localStorage.setItem(LAST_ORDER_ID_KEY, lookup.orderId);
  localStorage.setItem(LAST_PHONE_KEY, lookup.phone);
  refreshOrdersButtonEl.classList.remove("hidden");
  orderSummaryEl.textContent = "已核對訂單編號與結帳手機。";
  lookupMessageEl.textContent = "查詢完成";
  renderOrders(data.orders || []);
  return true;
}

lookupFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadOrders();
});

refreshOrdersButtonEl.addEventListener("click", loadOrders);

ordersEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cancel-order]");
  const orderId = button?.dataset.cancelOrder;
  if (!orderId || !currentLookup) return;

  if (!confirm(`確定要申請取消訂單 ${orderId}？賣家同意後才會正式取消。`)) return;

  button.disabled = true;
  lookupMessageEl.textContent = "送出取消申請中...";
  const response = await fetch("/api/orders/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, phone: currentLookup.phone })
  });
  const data = await response.json();

  if (!response.ok) {
    lookupMessageEl.textContent = data.message || "申請取消失敗";
    button.disabled = false;
    return;
  }

  await loadOrders();
  lookupMessageEl.textContent = data.message || "取消申請已送出";
});

lookupFormEl.elements.orderId.value = localStorage.getItem(LAST_ORDER_ID_KEY) || "";
lookupFormEl.elements.phone.value = localStorage.getItem(LAST_PHONE_KEY) || "";
renderOrders([]);

if (lookupFormEl.elements.orderId.value && lookupFormEl.elements.phone.value) {
  loadOrders();
}
