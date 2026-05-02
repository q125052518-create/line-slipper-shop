const inventoryImportFormEl = document.querySelector("#inventoryImportForm");
const inventoryImportMessageEl = document.querySelector("#inventoryImportMessage");
const mallbicSyncButtonEl = document.querySelector("#mallbicSyncButton");
const mallbicSyncStatusEl = document.querySelector("#mallbicSyncStatus");
const mallbicSyncMessageEl = document.querySelector("#mallbicSyncMessage");
const mallbicOrderSyncButtonEl = document.querySelector("#mallbicOrderSyncButton");
const mallbicOrderSyncStatusEl = document.querySelector("#mallbicOrderSyncStatus");
const mallbicOrderSyncMessageEl = document.querySelector("#mallbicOrderSyncMessage");
const mallbicOrderStatusButtonEl = document.querySelector("#mallbicOrderStatusButton");
const mallbicOrderStatusMessageEl = document.querySelector("#mallbicOrderStatusMessage");
const productImportFormEl = document.querySelector("#productImportForm");
const productImportMessageEl = document.querySelector("#productImportMessage");

function formatDateTime(value) {
  if (!value) return "尚未執行";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function renderMallbicSyncStatus(status) {
  const intervalMinutes = Math.round(Number(status.intervalMs || 0) / 60000);
  const mode = status.enabled ? `自動同步：每 ${intervalMinutes} 分鐘` : "自動同步：未啟用";
  const running = status.running ? "目前正在同步中。" : "";
  const success = `最後成功：${formatDateTime(status.lastSuccessAt)}`;
  const finished = status.lastFinishedAt ? `最後完成：${formatDateTime(status.lastFinishedAt)}` : "";
  const result = status.lastResult
    ? `上次更新 ${status.lastResult.updatedCount} 筆，找不到 ${status.lastResult.unmatchedCount} 筆`
    : "";
  const error = status.lastError ? `上次錯誤：${status.lastError}` : "";
  mallbicSyncStatusEl.textContent = [mode, success, finished, result, running, error].filter(Boolean).join("｜");
}

function renderMallbicOrderSyncStatus(status) {
  const intervalMinutes = Math.round(Number(status.intervalMs || 0) / 60000);
  const mode = status.enabled ? `自動同步：每 ${intervalMinutes} 分鐘` : "自動同步：未啟用";
  const pending = `待匯入 ${status.pendingImport || 0} 筆｜待取消 ${status.pendingCancel || 0} 筆｜待狀態更新 ${status.pendingStatusUpdate || 0} 筆`;
  const running = status.running || status.statusUpdateRunning ? "目前正在同步中。" : "";
  const success = `最後成功：${formatDateTime(status.lastSuccessAt)}`;
  const finished = status.lastFinishedAt ? `最後完成：${formatDateTime(status.lastFinishedAt)}` : "";
  const result = status.lastResult
    ? `上次匯入 ${status.lastResult.importedOrders || 0} 筆訂單 / ${status.lastResult.importedRows || 0} 列，取消 ${status.lastResult.cancelledOrders || 0} 筆`
    : "";
  const statusResult = status.lastStatusResult
    ? `上次狀態更新：檢查 ${status.lastStatusResult.checkedOrders || 0} 筆，改成處理中 ${status.lastStatusResult.updatedOrders || 0} 筆`
    : "";
  const error = status.lastError ? `上次錯誤：${status.lastError}` : "";
  const statusError = status.lastStatusError ? `狀態更新錯誤：${status.lastStatusError}` : "";
  mallbicOrderSyncStatusEl.textContent = [mode, pending, success, finished, result, statusResult, running, error, statusError].filter(Boolean).join("｜");
}

async function loadMallbicSyncStatus() {
  try {
    const status = await fetch("/api/admin/mallbic/sync-status").then((response) => response.json());
    renderMallbicSyncStatus(status);
  } catch {
    mallbicSyncStatusEl.textContent = "同步狀態讀取失敗";
  }
}

async function loadMallbicOrderSyncStatus() {
  try {
    const status = await fetch("/api/admin/mallbic/order-sync-status").then((response) => response.json());
    renderMallbicOrderSyncStatus(status);
  } catch {
    mallbicOrderSyncStatusEl.textContent = "訂單同步狀態讀取失敗";
  }
}

inventoryImportFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  inventoryImportMessageEl.textContent = "匯入中...";

  const file = inventoryImportFormEl.elements.inventoryFile.files[0];
  if (!file) {
    inventoryImportMessageEl.textContent = "請選擇 Excel 檔案";
    return;
  }

  const fileBase64 = await readFileAsDataUrl(file);
  const response = await fetch("/api/admin/inventory/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64 })
  });
  const data = await response.json();

  if (!response.ok) {
    inventoryImportMessageEl.textContent = data.message || "匯入失敗";
    return;
  }

  const unmatched = data.unmatched?.length ? `，找不到 ${data.unmatched.length} 筆：${data.unmatched.join(", ")}` : "";
  inventoryImportMessageEl.textContent = `已更新 ${data.updatedCount} 筆庫存${unmatched}`;
  inventoryImportFormEl.reset();
});

productImportFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  productImportMessageEl.textContent = "匯入中...";

  const file = productImportFormEl.elements.productFile.files[0];
  if (!file) {
    productImportMessageEl.textContent = "請選擇 Excel 檔案";
    return;
  }

  const fileBase64 = await readFileAsDataUrl(file);
  const response = await fetch("/api/admin/products/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64 })
  });
  const data = await response.json();

  if (!response.ok) {
    productImportMessageEl.textContent = data.message || "匯入失敗";
    return;
  }

  productImportMessageEl.textContent =
    `匯入 ${data.importedRows} 列，新增賣場 ${data.createdMarkets} 個，新增商品 ${data.createdProducts} 個，新增品項 ${data.createdVariants} 個，更新品項 ${data.updatedVariants} 個`;
  productImportFormEl.reset();
});

mallbicSyncButtonEl.addEventListener("click", async () => {
  mallbicSyncButtonEl.disabled = true;
  mallbicSyncMessageEl.textContent = "正在登入墨筆克並匯出 Excel，這可能需要 1 到 3 分鐘...";

  try {
    const response = await fetch("/api/admin/mallbic/sync-inventory", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      mallbicSyncMessageEl.textContent = data.message || "墨筆克同步失敗";
      return;
    }

    const unmatched = data.unmatched?.length
      ? `\n找不到 ${data.unmatched.length} 筆：${data.unmatched.slice(0, 20).join(", ")}${data.unmatched.length > 20 ? "..." : ""}`
      : "";
    mallbicSyncMessageEl.textContent =
      `同步完成：讀到 ${data.importedRows} 筆，已更新 ${data.updatedCount} 筆庫存${unmatched}`;
    await loadMallbicSyncStatus();
  } catch {
    mallbicSyncMessageEl.textContent = "墨筆克同步失敗，請稍後再試";
  } finally {
    mallbicSyncButtonEl.disabled = false;
    await loadMallbicSyncStatus();
  }
});

mallbicOrderSyncButtonEl.addEventListener("click", async () => {
  const confirmed = confirm("這會把尚未匯入訂單的姓名、手機、地址、商品條碼上傳到墨筆克，並把已取消訂單同步取消。確定執行？");
  if (!confirmed) return;

  mallbicOrderSyncButtonEl.disabled = true;
  mallbicOrderSyncMessageEl.textContent = "正在建立自建單 Excel 並登入墨筆克同步訂單...";

  try {
    const response = await fetch("/api/admin/mallbic/sync-orders", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      mallbicOrderSyncMessageEl.textContent = data.message || "墨筆克訂單同步失敗";
      return;
    }

    const errors = data.errors?.length ? `；錯誤：${data.errors.join("；")}` : "";
    mallbicOrderSyncMessageEl.textContent =
      `訂單同步完成：匯入 ${data.importedOrders || 0} 筆 / ${data.importedRows || 0} 列，取消 ${data.cancelledOrders || 0} 筆${errors}`;
    await loadMallbicOrderSyncStatus();
  } catch {
    mallbicOrderSyncMessageEl.textContent = "墨筆克訂單同步失敗，請稍後再試";
  } finally {
    mallbicOrderSyncButtonEl.disabled = false;
    await loadMallbicOrderSyncStatus();
  }
});

mallbicOrderStatusButtonEl.addEventListener("click", async () => {
  const confirmed = confirm("這會把本系統的新訂單拿去墨筆克搜尋，搜尋狀態選「出貨中」。搜尋得到就改成處理中，搜尋不到不會變動。確定執行？");
  if (!confirmed) return;

  mallbicOrderStatusButtonEl.disabled = true;
  mallbicOrderStatusMessageEl.textContent = "正在登入墨筆克並搜尋新訂單狀態...";

  try {
    const response = await fetch("/api/admin/mallbic/update-order-statuses", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      mallbicOrderStatusMessageEl.textContent = data.message || "墨筆克訂單狀態更新失敗";
      return;
    }

    mallbicOrderStatusMessageEl.textContent =
      `狀態更新完成：檢查 ${data.checkedOrders || 0} 筆，改成處理中 ${data.updatedOrders || 0} 筆，未找到 ${data.unchangedOrders || 0} 筆`;
    await loadMallbicOrderSyncStatus();
  } catch {
    mallbicOrderStatusMessageEl.textContent = "墨筆克訂單狀態更新失敗，請稍後再試";
  } finally {
    mallbicOrderStatusButtonEl.disabled = false;
    await loadMallbicOrderSyncStatus();
  }
});

loadMallbicSyncStatus();
loadMallbicOrderSyncStatus();
setInterval(loadMallbicSyncStatus, 60 * 1000);
setInterval(loadMallbicOrderSyncStatus, 60 * 1000);
