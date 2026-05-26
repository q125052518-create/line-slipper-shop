const filtersFormEl = document.querySelector("#statsFilters");
const refreshStatsButtonEl = document.querySelector("#refreshStatsButton");
const clearStatsFiltersButtonEl = document.querySelector("#clearStatsFiltersButton");
const statsStatusEl = document.querySelector("#statsStatus");
const summaryCardsEl = document.querySelector("#summaryCards");
const statusBreakdownEl = document.querySelector("#statusBreakdown");
const deliveryBreakdownEl = document.querySelector("#deliveryBreakdown");
const dailySalesEl = document.querySelector("#dailySales");
const topItemsEl = document.querySelector("#topItems");
const recentOrdersEl = document.querySelector("#recentOrders");

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

const myshipCreateLabels = {
  pending: "待建單",
  creating: "建單中",
  created: "已建單",
  failed: "建單失敗",
  skipped: "已略過",
  notNeeded: "不需要"
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

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-TW");
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setDefaultDateRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  filtersFormEl.elements.from.value = formatDateInput(firstDay);
  filtersFormEl.elements.to.value = formatDateInput(now);
}

function buildQueryString() {
  const formData = new FormData(filtersFormEl);
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    const text = String(value || "").trim();
    if (text) params.set(key, text);
  }
  return params.toString();
}

function renderSummaryCards(summary) {
  const cards = [
    { label: "有效營收", value: formatMoney(summary.revenue), hint: "未取消訂單總金額" },
    { label: "商品銷售", value: formatMoney(summary.productRevenue), hint: "不含運費" },
    { label: "運費收入", value: formatMoney(summary.shippingRevenue), hint: "未取消訂單" },
    { label: "訂單數", value: formatNumber(summary.orderCount), hint: `有效 ${formatNumber(summary.activeOrderCount)} 筆` },
    { label: "銷售件數", value: formatNumber(summary.itemQuantity), hint: "所有未取消品項數量" },
    { label: "平均客單", value: formatMoney(summary.averageOrderValue), hint: "有效營收 / 有效訂單" },
    { label: "取消金額", value: formatMoney(summary.cancelledRevenue), hint: `${formatNumber(summary.cancelledOrderCount)} 筆取消` },
    { label: "待審取消", value: formatNumber(summary.cancelRequestCount), hint: "買家申請取消待處理" }
  ];

  summaryCardsEl.innerHTML = cards.map((card) => `
    <article class="stat-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.hint)}</small>
    </article>
  `).join("");
}

function renderBreakdown(container, rows, emptyText = "目前沒有資料") {
  if (!rows.length) {
    container.innerHTML = `<p class="empty">${escapeHtml(emptyText)}</p>`;
    return;
  }

  const maxRevenue = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  container.innerHTML = rows.map((row) => {
    const width = Math.max(4, Math.round((Number(row.revenue || 0) / maxRevenue) * 100));
    return `
      <div class="stats-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <small>${formatNumber(row.count)} 筆｜${formatNumber(row.quantity)} 件</small>
        </div>
        <div class="stats-row-value">
          <span>${formatMoney(row.revenue)}</span>
          <div class="stats-bar"><i style="width:${width}%"></i></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderDailySales(rows) {
  if (!rows.length) {
    dailySalesEl.innerHTML = '<p class="empty">目前沒有每日營收資料</p>';
    return;
  }

  const maxRevenue = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  dailySalesEl.innerHTML = rows.map((row) => {
    const width = Math.max(4, Math.round((Number(row.revenue || 0) / maxRevenue) * 100));
    return `
      <div class="stats-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <small>${formatNumber(row.count)} 筆｜${formatNumber(row.quantity)} 件</small>
        </div>
        <div class="stats-row-value">
          <span>${formatMoney(row.revenue)}</span>
          <div class="stats-bar"><i style="width:${width}%"></i></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderTopItems(rows) {
  if (!rows.length) {
    topItemsEl.innerHTML = '<tr><td colspan="7" class="empty-cell">目前沒有銷售品項</td></tr>';
    return;
  }

  topItemsEl.innerHTML = rows.map((item) => `
    <tr>
      <td>
        ${item.imageUrl
          ? `<img class="stats-product-image" src="${escapeHtml(item.imageUrl)}" alt="">`
          : '<span class="stats-image-empty">無圖</span>'}
      </td>
      <td>
        <strong>${escapeHtml(item.productName || "-")}</strong>
        <small>${escapeHtml(item.marketName || "-")}</small>
      </td>
      <td>${escapeHtml(item.variantName || "-")}</td>
      <td>${escapeHtml(item.barcode || "-")}</td>
      <td>${formatNumber(item.quantity)}</td>
      <td>${formatMoney(item.revenue)}</td>
      <td>${item.stock === null ? "-" : formatNumber(item.stock)}</td>
    </tr>
  `).join("");
}

function renderRecentOrders(rows) {
  if (!rows.length) {
    recentOrdersEl.innerHTML = '<tr><td colspan="9" class="empty-cell">目前沒有訂單</td></tr>';
    return;
  }

  recentOrdersEl.innerHTML = rows.map((order) => `
    <tr>
      <td><strong>${escapeHtml(order.id)}</strong></td>
      <td>${escapeHtml(formatDateTime(order.createdAt))}</td>
      <td>${escapeHtml(order.customerName || "-")}</td>
      <td>${escapeHtml(statusLabels[order.status] || order.status || "-")}</td>
      <td>${escapeHtml(order.deliveryMethod || "-")}</td>
      <td>${formatNumber(order.itemQuantity)}</td>
      <td>${formatMoney(order.totalAmount)}</td>
      <td>${escapeHtml(mallbicImportLabels[order.mallbicImportStatus] || order.mallbicImportStatus || "-")}</td>
      <td>${escapeHtml(myshipCreateLabels[order.myshipCreateStatus] || order.myshipCreateStatus || "-")}</td>
    </tr>
  `).join("");
}

async function loadStats() {
  statsStatusEl.textContent = "讀取統計中...";
  const queryString = buildQueryString();
  const response = await fetch(`/api/admin/stats${queryString ? `?${queryString}` : ""}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    statsStatusEl.textContent = data.message || "統計讀取失敗";
    return;
  }

  statsStatusEl.textContent = `最後更新：${formatDateTime(data.generatedAt)}`;
  renderSummaryCards(data.summary || {});
  renderBreakdown(statusBreakdownEl, data.statusBreakdown || [], "目前沒有訂單狀態資料");
  renderBreakdown(deliveryBreakdownEl, data.deliveryBreakdown || [], "目前沒有取貨方式資料");
  renderDailySales(data.dailySales || []);
  renderTopItems(data.topItems || []);
  renderRecentOrders(data.recentOrders || []);
}

filtersFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadStats();
});

refreshStatsButtonEl.addEventListener("click", loadStats);

clearStatsFiltersButtonEl.addEventListener("click", async () => {
  filtersFormEl.reset();
  await loadStats();
});

setDefaultDateRange();
loadStats();
