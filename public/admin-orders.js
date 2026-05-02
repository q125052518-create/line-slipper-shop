const ordersEl = document.querySelector("#orders");
const refreshOrdersButtonEl = document.querySelector("#refreshOrdersButton");

const statusLabels = {
  pending: "新訂單",
  processing: "處理中",
  shipped: "已出貨",
  cancelled: "取消"
};

const mallbicImportLabels = {
  pending: "待匯入",
  imported: "已匯入",
  importFailed: "匯入失敗",
  skipped: "已略過"
};

const mallbicCancelLabels = {
  pending: "待取消",
  cancelled: "已取消",
  cancelFailed: "取消失敗",
  notNeeded: "不用取消"
};

const cancelRequestLabels = {
  pending: "買家申請取消，等待同意",
  approved: "已同意取消",
  rejected: "已拒絕取消"
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

function renderCancelRequest(order) {
  const request = order.cancelRequest || {};
  if (!request.status) return "-";

  const time = request.requestedAt ? `｜${formatDateTime(request.requestedAt)}` : "";
  return `${cancelRequestLabels[request.status] || request.status}${time}`;
}

async function loadOrders() {
  const data = await fetch("/api/orders").then((response) => response.json());

  if (data.orders.length === 0) {
    ordersEl.innerHTML = '<p class="empty">目前沒有訂單</p>';
    return;
  }

  ordersEl.innerHTML = data.orders.map((order) => {
    const hasCancelRequest = order.cancelRequest?.status === "pending";

    return `
      <article class="order ${hasCancelRequest ? "has-cancel-request" : ""}">
        <div class="order-head">
          <div>
            <h3>${escapeHtml(order.id)}</h3>
            <p>${formatDateTime(order.createdAt)}</p>
          </div>
          <select data-order-status="${escapeHtml(order.id)}">
            ${Object.entries(statusLabels).map(([value, label]) => `
              <option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </div>
        <dl>
          <div><dt>姓名</dt><dd>${escapeHtml(order.customerName || "-")}</dd></div>
          <div><dt>電話</dt><dd>${escapeHtml(order.phone || "-")}</dd></div>
          <div><dt>取貨</dt><dd>${escapeHtml(order.deliveryMethod || "-")}</dd></div>
          <div><dt>地址</dt><dd>${escapeHtml(order.deliveryAddress || "-")}</dd></div>
          <div><dt>金額</dt><dd>${formatMoney(order.totalAmount)}</dd></div>
          <div><dt>取消申請</dt><dd>${escapeHtml(renderCancelRequest(order))}</dd></div>
          <div><dt>墨筆克匯入</dt><dd>${escapeHtml(mallbicImportLabels[order.mallbic?.importStatus] || order.mallbic?.importStatus || "待匯入")}</dd></div>
          <div><dt>墨筆克訂單號</dt><dd>${escapeHtml(order.mallbic?.mallbicOrderNo || "-")}</dd></div>
          <div><dt>墨筆克取消</dt><dd>${escapeHtml(mallbicCancelLabels[order.mallbic?.cancelStatus] || order.mallbic?.cancelStatus || "-")}</dd></div>
        </dl>
        <ul>
          ${(order.items || []).map((item) => `
            <li>${escapeHtml(item.marketName)} / ${escapeHtml(item.productName)} / ${escapeHtml(item.variantName)} / ${escapeHtml(item.barcode)} x ${item.quantity}，${formatMoney(item.subtotal)}</li>
          `).join("")}
        </ul>
        ${order.note ? `<p class="note">備註：${escapeHtml(order.note)}</p>` : ""}
        ${hasCancelRequest ? `
          <div class="order-actions cancel-request-actions">
            <strong>買家申請取消這筆訂單</strong>
            <button type="button" data-approve-cancel="${escapeHtml(order.id)}">同意取消</button>
            <button type="button" class="secondary-button" data-reject-cancel="${escapeHtml(order.id)}">拒絕</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

document.addEventListener("change", async (event) => {
  const orderId = event.target.dataset.orderStatus;
  if (!orderId) return;

  const previousValue = event.target.querySelector("option[selected]")?.value;
  event.target.disabled = true;
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: event.target.value })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.message || "更新訂單狀態失敗");
    if (previousValue) event.target.value = previousValue;
  }

  await loadOrders();
});

ordersEl.addEventListener("click", async (event) => {
  const approveId = event.target.dataset.approveCancel;
  const rejectId = event.target.dataset.rejectCancel;
  if (!approveId && !rejectId) return;

  const isApprove = Boolean(approveId);
  const orderId = approveId || rejectId;
  const confirmed = confirm(isApprove ? `確定同意取消訂單 ${orderId}？` : `確定拒絕取消訂單 ${orderId}？`);
  if (!confirmed) return;

  event.target.disabled = true;
  const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel-request/${isApprove ? "approve" : "reject"}`, {
    method: "POST"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.message || "處理取消申請失敗");
    event.target.disabled = false;
    return;
  }

  await loadOrders();
});

refreshOrdersButtonEl.addEventListener("click", loadOrders);
loadOrders();
