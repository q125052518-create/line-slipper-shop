const marketFormEl = document.querySelector("#marketForm");
const marketMessageEl = document.querySelector("#marketMessage");

let currentMarket = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "操作失敗");
  return data;
}

function imagePreviewMarkup(value, emptyText = "尚未上傳") {
  if (!value) return `<span class="image-preview empty" data-image-preview>${emptyText}</span>`;
  return `<span class="image-preview" data-image-preview><img src="${escapeHtml(value)}" alt="" onerror="this.parentElement.classList.add('empty'); this.parentElement.textContent='圖片無法載入';"></span>`;
}

function setMessage(message, isError = false) {
  marketMessageEl.textContent = message || "";
  marketMessageEl.classList.toggle("is-error", isError);
}

function setImageUploaderValue(form, value) {
  const uploader = form.querySelector(".image-uploader");
  if (!uploader) return;
  uploader.querySelector('input[type="hidden"]').value = value || "";
  const fileInput = uploader.querySelector('input[type="file"]');
  if (fileInput) fileInput.value = "";
  uploader.querySelector("[data-image-preview]").outerHTML = imagePreviewMarkup(value || "");
}

async function marketImageFromForm(form, formData) {
  const file = form.elements.imageFile?.files?.[0];
  if (file) return readFileAsDataUrl(file);
  return formData.get("imageUrl") || "";
}

function renderMarketForm(market) {
  currentMarket = market;
  marketFormEl.dataset.marketId = market.id;
  marketFormEl.elements.name.value = market.name || "";
  marketFormEl.elements.description.value = market.description || "";
  marketFormEl.elements.isActive.checked = market.isActive !== false;
  setImageUploaderValue(marketFormEl, market.imageUrl || "");
}

async function loadMarket() {
  setMessage("");
  const catalog = await requestJson("/api/admin/catalog");
  const market = catalog.markets?.[0];
  if (!market) {
    setMessage("尚未建立賣場", true);
    marketFormEl.querySelectorAll("input, textarea, button").forEach((element) => {
      element.disabled = true;
    });
    return;
  }
  renderMarketForm(market);
}

marketFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentMarket) return;

  const formData = new FormData(marketFormEl);
  const imageUrl = await marketImageFromForm(marketFormEl, formData);
  setMessage("儲存中...");

  try {
    await requestJson(`/api/admin/markets/${encodeURIComponent(currentMarket.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        imageUrl,
        description: formData.get("description"),
        isActive: formData.get("isActive") === "on"
      })
    });
    await loadMarket();
    setMessage("賣場設定已儲存");
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.matches("[data-clear-image]")) return;
  const uploader = event.target.closest(".image-uploader");
  uploader.querySelector('input[type="hidden"]').value = "";
  const fileInput = uploader.querySelector('input[type="file"]');
  fileInput.value = "";
  uploader.querySelector("[data-image-preview]").outerHTML =
    '<span class="image-preview empty" data-image-preview>尚未上傳</span>';
});

document.addEventListener("change", async (event) => {
  if (!event.target.matches('.image-uploader input[type="file"]')) return;

  const file = event.target.files[0];
  if (!file) return;
  const uploader = event.target.closest(".image-uploader");
  const dataUrl = await readFileAsDataUrl(file);
  uploader.querySelector('input[type="hidden"]').value = dataUrl;
  uploader.querySelector("[data-image-preview]").outerHTML =
    `<span class="image-preview" data-image-preview><img src="${dataUrl}" alt=""></span>`;
});

loadMarket().catch((error) => {
  setMessage(error.message, true);
});
