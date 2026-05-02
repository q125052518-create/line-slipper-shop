const catalogEditorEl = document.querySelector("#catalogEditor");
const marketFormEl = document.querySelector("#marketForm");
const productFormEl = document.querySelector("#productForm");
const newVariantsEl = document.querySelector("#newVariants");
const refreshCatalogEl = document.querySelector("#refreshCatalog");

let catalog = { markets: [] };

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

async function collectVariantsWithImages(container) {
  const rows = Array.from(container.querySelectorAll("[data-variant-row]"));
  return Promise.all(rows.map(async (row) => {
    const file = row.querySelector('[name="variantImageFile"]')?.files?.[0];
    return {
      id: row.dataset.variantId || undefined,
      name: row.querySelector('[name="variantName"]').value,
      barcode: row.querySelector('[name="barcode"]').value,
      price: Number(row.querySelector('[name="price"]').value),
      stock: Number(row.querySelector('[name="stock"]').value),
      imageUrl: file ? await readFileAsDataUrl(file) : row.querySelector('[name="variantImageUrl"]').value
    };
  }));
}

async function productImageFromForm(form, formData) {
  const file = form.elements.imageFile?.files?.[0];
  if (file) return readFileAsDataUrl(file);
  return formData.get("imageUrl") || "";
}

async function marketImageFromForm(form, formData) {
  const file = form.elements.imageFile?.files?.[0];
  if (file) return readFileAsDataUrl(file);
  return formData.get("imageUrl") || "";
}

function imagePreviewMarkup(value, emptyText = "尚未上傳") {
  if (!value) return `<span class="image-preview empty" data-image-preview>${emptyText}</span>`;
  return `<span class="image-preview" data-image-preview><img src="${escapeHtml(value)}" alt="" onerror="this.parentElement.classList.add('empty'); this.parentElement.textContent='圖片無法載入';"></span>`;
}

function resetImageUploaders(form) {
  form.querySelectorAll(".image-uploader").forEach((uploader) => {
    uploader.querySelector('input[type="hidden"]').value = "";
    uploader.querySelector("[data-image-preview]").outerHTML =
      '<span class="image-preview empty" data-image-preview>尚未上傳</span>';
  });
}

function variantRow(variant = {}) {
  return `
    <div class="variant-row" data-variant-row data-variant-id="${escapeHtml(variant.id || "")}">
      <label>
        款式
        <input name="variantName" placeholder="例如 黑色 / 26cm" value="${escapeHtml(variant.name || "")}" required>
      </label>
      <label>
        品項條碼
        <input name="barcode" placeholder="例如 SLP-BK-26" value="${escapeHtml(variant.barcode || "")}" required>
      </label>
      <label>
        售價
        <input name="price" type="number" min="0" step="1" placeholder="例如 390" value="${escapeHtml(variant.price ?? "")}" required>
      </label>
      <label>
        數量
        <input name="stock" type="number" min="0" step="1" placeholder="庫存" value="${escapeHtml(variant.stock ?? 0)}" required>
      </label>
      <label>
        品項圖片
        <span class="image-uploader">
          ${imagePreviewMarkup(variant.imageUrl || "")}
          <input type="file" name="variantImageFile" accept="image/*">
          <input type="hidden" name="variantImageUrl" value="${escapeHtml(variant.imageUrl || "")}">
          <button type="button" data-clear-image>刪除圖片</button>
        </span>
      </label>
      <button type="button" data-remove-variant>刪除</button>
    </div>
  `;
}

function renderMarketOptions() {
  const select = productFormEl.elements.marketId;
  select.innerHTML = catalog.markets.map((market) => `
    <option value="${market.id}">${escapeHtml(market.name)}</option>
  `).join("");
}

function renderCatalog() {
  renderMarketOptions();

  if (catalog.markets.length === 0) {
    catalogEditorEl.innerHTML = '<p class="empty">尚未建立賣場</p>';
    return;
  }

  catalogEditorEl.innerHTML = catalog.markets.map((market) => `
    <article class="market-editor" data-market-id="${market.id}">
      <form class="market-edit-form">
        <div class="order-head">
          <h3>${escapeHtml(market.name)}</h3>
          <button type="button" data-delete-market="${market.id}">刪除賣場</button>
        </div>
        <label>
          賣場名稱
          <input name="name" value="${escapeHtml(market.name)}" required>
        </label>
        <label>
          賣場說明
          <textarea name="description" rows="2">${escapeHtml(market.description || "")}</textarea>
        </label>
        <label>
          賣場封面圖
          <span class="image-uploader">
            ${imagePreviewMarkup(market.imageUrl || "")}
            <input type="file" name="imageFile" accept="image/*">
            <input type="hidden" name="imageUrl" value="${escapeHtml(market.imageUrl || "")}">
            <button type="button" data-clear-image>刪除圖片</button>
          </span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="isActive" ${market.isActive !== false ? "checked" : ""}>
          前台顯示
        </label>
        <button type="submit">儲存賣場</button>
      </form>

      <div class="product-editor-list">
        ${market.products.map((product) => `
          <form class="product-edit-form" data-product-id="${product.id}">
            <div class="product-edit-head">
              <img src="${escapeHtml(product.imageUrl || "https://placehold.co/120x90/f2efe8/1e2720?text=Slipper")}" alt="" onerror="this.src='https://placehold.co/120x90/f2efe8/1e2720?text=No+Image';">
              <div>
                <h4>${escapeHtml(product.name)}</h4>
                <p>${escapeHtml(product.description || "")}</p>
              </div>
              <button type="button" data-delete-product="${product.id}">刪除商品</button>
            </div>
            <label>
              商品名稱
              <input name="name" value="${escapeHtml(product.name)}" required>
            </label>
            <label>
              商品圖片
              <span class="image-uploader">
                ${imagePreviewMarkup(product.imageUrl || "")}
                <input type="file" name="imageFile" accept="image/*">
                <input type="hidden" name="imageUrl" value="${escapeHtml(product.imageUrl || "")}">
                <button type="button" data-clear-image>刪除圖片</button>
              </span>
            </label>
            <label>
              商品說明
              <textarea name="description" rows="2">${escapeHtml(product.description || "")}</textarea>
            </label>
            <div class="variant-editor">
              ${product.variants.map((variant) => variantRow(variant)).join("")}
            </div>
            <button type="button" data-add-variant>新增品項</button>
            <button type="submit">儲存商品</button>
          </form>
        `).join("") || '<p class="empty">這個賣場還沒有商品</p>'}
      </div>
    </article>
  `).join("");
}

async function loadCatalog() {
  catalog = await fetch("/api/admin/catalog").then((response) => response.json());
  renderCatalog();
}

marketFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(marketFormEl);
  const imageUrl = await marketImageFromForm(marketFormEl, formData);

  await fetch("/api/admin/markets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: formData.get("name"),
      imageUrl,
      description: formData.get("description"),
      isActive: formData.get("isActive") === "on"
    })
  });

  marketFormEl.reset();
  resetImageUploaders(marketFormEl);
  marketFormEl.elements.isActive.checked = true;
  await loadCatalog();
});

productFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(productFormEl);
  const marketId = formData.get("marketId");
  const imageUrl = await productImageFromForm(productFormEl, formData);

  await fetch(`/api/admin/markets/${marketId}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: formData.get("name"),
      imageUrl,
      description: formData.get("description"),
      variants: await collectVariantsWithImages(newVariantsEl)
    })
  });

  productFormEl.reset();
  resetImageUploaders(productFormEl);
  newVariantsEl.innerHTML = variantRow();
  await loadCatalog();
});

document.addEventListener("click", async (event) => {
  if (event.target.matches("[data-add-variant]")) {
    const editor = event.target.closest("form").querySelector(".variant-editor");
    editor.insertAdjacentHTML("beforeend", variantRow());
  }

  if (event.target.matches("[data-clear-image]")) {
    const uploader = event.target.closest(".image-uploader");
    uploader.querySelector('input[type="hidden"]').value = "";
    const fileInput = uploader.querySelector('input[type="file"]');
    fileInput.value = "";
    uploader.querySelector("[data-image-preview]").outerHTML =
      '<span class="image-preview empty" data-image-preview>尚未上傳</span>';
  }

  if (event.target.matches("[data-remove-variant]")) {
    const editor = event.target.closest(".variant-editor");
    if (editor.querySelectorAll("[data-variant-row]").length > 1) {
      event.target.closest("[data-variant-row]").remove();
    }
  }

  const marketId = event.target.dataset.deleteMarket;
  if (marketId && confirm("確定刪除這個賣場？")) {
    await fetch(`/api/admin/markets/${marketId}`, { method: "DELETE" });
    await loadCatalog();
  }

  const productId = event.target.dataset.deleteProduct;
  if (productId && confirm("確定刪除這個商品？")) {
    await fetch(`/api/admin/products/${productId}`, { method: "DELETE" });
    await loadCatalog();
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.matches(".market-edit-form")) {
    event.preventDefault();
    const marketId = event.target.closest("[data-market-id]").dataset.marketId;
    const formData = new FormData(event.target);
    const imageUrl = await marketImageFromForm(event.target, formData);

    await fetch(`/api/admin/markets/${marketId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        imageUrl,
        description: formData.get("description"),
        isActive: formData.get("isActive") === "on"
      })
    });

    await loadCatalog();
  }

  if (event.target.matches(".product-edit-form")) {
    event.preventDefault();
    const productId = event.target.dataset.productId;
    const formData = new FormData(event.target);
    const imageUrl = await productImageFromForm(event.target, formData);

    await fetch(`/api/admin/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        imageUrl,
        description: formData.get("description"),
        variants: await collectVariantsWithImages(event.target.querySelector(".variant-editor"))
      })
    });

    await loadCatalog();
  }
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

refreshCatalogEl.addEventListener("click", loadCatalog);

newVariantsEl.innerHTML = variantRow();
loadCatalog();
