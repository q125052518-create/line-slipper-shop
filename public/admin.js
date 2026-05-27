const catalogEditorEl = document.querySelector("#catalogEditor");
const categoryEditorEl = document.querySelector("#categoryEditor");
const categoryFormEl = document.querySelector("#categoryForm");
const marketFormEl = document.querySelector("#marketForm");
const productFormEl = document.querySelector("#productForm");
const newVariantsEl = document.querySelector("#newVariants");
const refreshCatalogEl = document.querySelector("#refreshCatalog");
const productSearchInputEl = document.querySelector("#productSearchInput");
const productSearchButtonEl = document.querySelector("#productSearchButton");
const productSearchResetEl = document.querySelector("#productSearchReset");
const productListCountEl = document.querySelector("#productListCount");
const productCreateSectionEl = document.querySelector("#productCreateSection");
const productListSectionEl = document.querySelector("#productListSection");

let catalog = { categories: [], markets: [] };
let selectedProductIds = new Set();
let productSearchQuery = "";
let editingProductId = "";
let productViewMode = "list";
let draggedVariantRow = null;
let isPointerDraggingVariant = false;
let productNoticeTimer = null;

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

function showProductNotice(message) {
  let notice = document.querySelector("[data-product-notice]");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "admin-toast";
    notice.dataset.productNotice = "true";
    document.body.appendChild(notice);
  }

  notice.textContent = message;
  notice.classList.add("is-visible");
  clearTimeout(productNoticeTimer);
  productNoticeTimer = setTimeout(() => {
    notice.classList.remove("is-visible");
  }, 2200);
}

function currentMarket() {
  return catalog.markets[0] || null;
}

function sortCategoryList(categories) {
  return [...categories].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    return orderA - orderB || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

function sortedCategories() {
  const categories = catalog.categories || [];
  const byParent = new Map();
  for (const category of categories) {
    const parentId = category.parentId || "";
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(category);
  }

  const result = [];
  const appendChildren = (parentId) => {
    for (const category of sortCategoryList(byParent.get(parentId) || [])) {
      result.push(category);
      appendChildren(category.id);
    }
  };
  appendChildren("");

  for (const category of sortCategoryList(categories)) {
    if (!result.some((entry) => entry.id === category.id)) result.push(category);
  }
  return result;
}

function categoryDepth(categoryId) {
  let depth = 0;
  let parentId = catalog.categories.find((category) => category.id === categoryId)?.parentId || "";
  const seen = new Set([categoryId]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = catalog.categories.find((category) => category.id === parentId)?.parentId || "";
  }
  return depth;
}

function isDescendantCategory(candidateId, parentId) {
  let currentId = catalog.categories.find((category) => category.id === candidateId)?.parentId || "";
  const seen = new Set([candidateId]);
  while (currentId && !seen.has(currentId)) {
    if (currentId === parentId) return true;
    seen.add(currentId);
    currentId = catalog.categories.find((category) => category.id === currentId)?.parentId || "";
  }
  return false;
}

function categoryOptionLabel(category) {
  const depth = categoryDepth(category.id);
  return `${"　".repeat(depth)}${depth ? "└ " : ""}${category.name}`;
}

function categoryName(categoryId) {
  const category = catalog.categories.find((entry) => entry.id === categoryId);
  if (!category) return "未分類";
  const names = [category.name];
  let parentId = category.parentId || "";
  const seen = new Set([category.id]);
  while (parentId && !seen.has(parentId)) {
    const parent = catalog.categories.find((entry) => entry.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId || "";
  }
  return names.join(" / ");
}

function productVariants(product) {
  return Array.isArray(product.variants) ? product.variants : [];
}

function productImage(product) {
  return product.imageUrl || productVariants(product).find((variant) => variant.imageUrl)?.imageUrl || "";
}

function productStock(product) {
  return productVariants(product).reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function productPriceLabel(product) {
  const prices = productVariants(product)
    .map((variant) => Number(variant.price))
    .filter((price) => Number.isFinite(price));
  if (prices.length === 0) return "NT$0";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `NT$${min.toLocaleString("zh-TW")}` : `NT$${min.toLocaleString("zh-TW")} - ${max.toLocaleString("zh-TW")}`;
}

function productBarcodeLabel(product) {
  const barcodes = [...new Set(productVariants(product).map((variant) => String(variant.barcode || "").trim()).filter(Boolean))];
  if (barcodes.length === 0) return "未設定貨號";
  if (barcodes.length === 1) return barcodes[0];
  return `${barcodes[0]} 等 ${barcodes.length} 個貨號`;
}

function productSearchText(product) {
  return [
    product.id,
    product.name,
    product.description,
    categoryName(product.categoryId),
    ...productVariants(product).flatMap((variant) => [
      variant.id,
      variant.name,
      variant.barcode,
      variant.price,
      variant.stock
    ])
  ].join(" ").toLowerCase();
}

function sortedProductsForMarket(market) {
  return [...(market.products || [])].sort((a, b) => {
    const categoryA = catalog.categories.find((category) => category.id === a.categoryId)?.sortOrder ?? 0;
    const categoryB = catalog.categories.find((category) => category.id === b.categoryId)?.sortOrder ?? 0;
    return categoryA - categoryB || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

function filterProducts(products) {
  const terms = productSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return products;
  return products.filter((product) => {
    const text = productSearchText(product);
    return terms.every((term) => text.includes(term));
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

function setImageUploaderValue(form, value) {
  const uploader = form.querySelector(".image-uploader");
  if (!uploader) return;
  uploader.querySelector('input[type="hidden"]').value = value || "";
  const fileInput = uploader.querySelector('input[type="file"]');
  if (fileInput) fileInput.value = "";
  uploader.querySelector("[data-image-preview]").outerHTML = imagePreviewMarkup(value || "");
}

function resetImageUploaders(form) {
  form.querySelectorAll(".image-uploader").forEach((uploader) => {
    uploader.querySelector('input[type="hidden"]').value = "";
    const fileInput = uploader.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = "";
    uploader.querySelector("[data-image-preview]").outerHTML =
      '<span class="image-preview empty" data-image-preview>尚未上傳</span>';
  });
}

function showProductList({ scroll = true } = {}) {
  productViewMode = "list";
  productCreateSectionEl?.classList.add("hidden");
  productListSectionEl?.classList.remove("hidden");
  if (scroll) productListSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showProductCreate() {
  productViewMode = "create";
  editingProductId = "";
  productListSectionEl?.classList.add("hidden");
  productCreateSectionEl?.classList.remove("hidden");
  if (productFormEl) {
    productFormEl.reset();
    resetImageUploaders(productFormEl);
    renderCategoryOptions(productFormEl.elements.categoryId);
  }
  if (newVariantsEl) newVariantsEl.innerHTML = variantRow();
  productCreateSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCategoryOptions(select, selectedId = "") {
  const categories = sortedCategories();
  select.innerHTML = categoryOptionsMarkup(selectedId);
  select.value = categories.some((category) => category.id === selectedId)
    ? selectedId
    : categories[0]?.id || "";
}

function categoryOptionsMarkup(selectedId = "") {
  return sortedCategories().map((category) => `
    <option value="${escapeHtml(category.id)}" ${category.id === selectedId ? "selected" : ""}>
      ${escapeHtml(categoryOptionLabel(category))}
    </option>
  `).join("");
}

function parentCategoryOptionsMarkup(selectedId = "", excludeId = "") {
  const categories = sortedCategories().filter((category) => (
    category.id !== excludeId && !isDescendantCategory(category.id, excludeId)
  ));
  return [
    `<option value="" ${selectedId ? "" : "selected"}>最上層分類</option>`,
    ...categories.map((category) => `
      <option value="${escapeHtml(category.id)}" ${category.id === selectedId ? "selected" : ""}>
        ${escapeHtml(categoryOptionLabel(category))}
      </option>
    `)
  ].join("");
}

function renderParentCategoryOptions(select, selectedId = "", excludeId = "") {
  select.innerHTML = parentCategoryOptionsMarkup(selectedId, excludeId);
}

function variantRow(variant = {}) {
  return `
    <div class="variant-row variant-row-draggable" data-variant-row data-variant-id="${escapeHtml(variant.id || "")}" draggable="true">
      <button type="button" class="variant-drag-handle" data-variant-drag-handle aria-label="拖曳排序">☷</button>
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
      <label class="variant-image-field">
        品項圖片
        <span class="image-uploader variant-image-uploader">
          ${imagePreviewMarkup(variant.imageUrl || "")}
          <input type="file" name="variantImageFile" accept="image/*">
          <input type="hidden" name="variantImageUrl" value="${escapeHtml(variant.imageUrl || "")}">
          <button type="button" data-clear-image>刪除圖片</button>
        </span>
      </label>
      <button type="button" class="danger-button" data-remove-variant>刪除</button>
    </div>
  `;
}

function variantDragAfterElement(container, y) {
  const rows = [...container.querySelectorAll("[data-variant-row]:not(.is-dragging)")];
  return rows.reduce((closest, row) => {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: row };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function moveDraggedVariantRow(clientY) {
  if (!draggedVariantRow) return;
  const editor = draggedVariantRow.closest(".variant-editor");
  if (!editor) return;

  const afterElement = variantDragAfterElement(editor, clientY);
  if (afterElement) {
    editor.insertBefore(draggedVariantRow, afterElement);
  } else {
    editor.appendChild(draggedVariantRow);
  }
}

function cleanupVariantDrag() {
  if (draggedVariantRow) {
    draggedVariantRow.classList.remove("is-dragging");
    delete draggedVariantRow.dataset.dragReady;
  }
  draggedVariantRow = null;
  isPointerDraggingVariant = false;
}

function renderStoreForm() {
  const market = currentMarket();
  if (!marketFormEl) return;
  if (!market) return;
  marketFormEl.dataset.marketId = market.id;
  marketFormEl.elements.name.value = market.name || "";
  marketFormEl.elements.description.value = market.description || "";
  marketFormEl.elements.isActive.checked = market.isActive !== false;
  setImageUploaderValue(marketFormEl, market.imageUrl || "");
}

function renderCategoryEditor() {
  categoryEditorEl.innerHTML = sortedCategories().map((category, index) => `
    <form class="category-edit-form" data-category-id="${escapeHtml(category.id)}">
      <label>
        分類名稱
        <input name="name" value="${escapeHtml(category.name)}" required>
      </label>
      <label>
        上層分類
        <select name="parentId">
          ${parentCategoryOptionsMarkup(category.parentId || "", category.id)}
        </select>
      </label>
      <label>
        排序
        <input name="sortOrder" type="number" step="1" value="${escapeHtml(category.sortOrder ?? index)}">
      </label>
      <label class="checkbox-row">
        <input type="checkbox" name="isActive" ${category.isActive !== false ? "checked" : ""}>
        前台顯示
      </label>
      <button type="submit">儲存</button>
      <button type="button" data-delete-category="${escapeHtml(category.id)}">刪除</button>
    </form>
  `).join("");
}

function bulkCategoryToolbarMarkup(products) {
  const hasProducts = products.length > 0;
  const allSelected = hasProducts && products.every((product) => selectedProductIds.has(product.id));

  return `
    <div class="bulk-category-toolbar">
      <label class="checkbox-row">
        <input type="checkbox" data-select-all-products ${allSelected ? "checked" : ""} ${hasProducts ? "" : "disabled"}>
        全選目前顯示商品
      </label>
      <label>
        移入分類
        <select data-bulk-category-target ${hasProducts ? "" : "disabled"}>
          ${categoryOptionsMarkup()}
        </select>
      </label>
      <button type="button" data-bulk-move-category ${selectedProductIds.size ? "" : "disabled"}>移入勾選商品</button>
      <span class="bulk-selection-count" data-bulk-selection-count>已選 ${selectedProductIds.size} 件</span>
    </div>
  `;
}

function productCardMarkup(product) {
  const imageUrl = productImage(product) || "https://placehold.co/320x320/f2efe8/1e2720?text=No+Image";

  return `
    <article class="admin-product-card">
      <label class="admin-product-card-check" title="勾選後可批量移入分類">
        <input type="checkbox" data-select-product="${escapeHtml(product.id)}" ${selectedProductIds.has(product.id) ? "checked" : ""}>
      </label>
      <button type="button" class="admin-product-card-image" data-edit-product="${escapeHtml(product.id)}" aria-label="編輯 ${escapeHtml(product.name)}">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" onerror="this.src='https://placehold.co/320x320/f2efe8/1e2720?text=No+Image';">
      </button>
      <div class="admin-product-card-body">
        <p class="category-pill">${escapeHtml(categoryName(product.categoryId))}</p>
        <h3>${escapeHtml(product.name)}</h3>
        <p class="admin-product-card-code">${escapeHtml(productBarcodeLabel(product))}</p>
        <p class="admin-product-card-price">${escapeHtml(productPriceLabel(product))}</p>
        <div class="admin-product-card-meta">
          <span>品項 ${productVariants(product).length}</span>
          <span>庫存 ${productStock(product)}</span>
        </div>
      </div>
      <div class="admin-product-card-actions">
        <button type="button" data-edit-product="${escapeHtml(product.id)}">編輯</button>
        <button type="button" class="danger-button" data-delete-product="${escapeHtml(product.id)}">刪除</button>
      </div>
    </article>
  `;
}

function productEditFormMarkup(product) {
  const imageUrl = productImage(product) || "https://placehold.co/120x90/f2efe8/1e2720?text=Slipper";

  return `
    <div class="product-edit-navigation">
      <button type="button" class="secondary-button" data-back-product-list>返回商品列表</button>
      <span>${escapeHtml(product.name)}</span>
    </div>
    <form class="product-edit-form product-edit-form-single" data-product-id="${escapeHtml(product.id)}">
      <div class="product-edit-head">
        <img src="${escapeHtml(imageUrl)}" alt="" onerror="this.src='https://placehold.co/120x90/f2efe8/1e2720?text=No+Image';">
        <div>
          <p class="category-pill">${escapeHtml(categoryName(product.categoryId))}</p>
          <h4>${escapeHtml(product.name)}</h4>
          <p>${escapeHtml(product.description || "")}</p>
          <p class="product-edit-summary">${escapeHtml(productBarcodeLabel(product))}｜${escapeHtml(productPriceLabel(product))}｜庫存 ${productStock(product)}</p>
        </div>
        <div class="product-edit-head-actions">
          <button type="submit">儲存商品</button>
          <button type="button" class="danger-button" data-delete-product="${escapeHtml(product.id)}">刪除商品</button>
        </div>
      </div>
      <label>
        分類
        <select name="categoryId" required>
          ${categoryOptionsMarkup(product.categoryId)}
        </select>
      </label>
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
        ${productVariants(product).map((variant) => variantRow(variant)).join("")}
      </div>
      <button type="button" data-add-variant>新增品項</button>
    </form>
  `;
}

function renderCatalog() {
  renderStoreForm();
  if (categoryEditorEl) renderCategoryEditor();
  if (categoryFormEl?.elements.parentId) renderParentCategoryOptions(categoryFormEl.elements.parentId);
  renderCategoryOptions(productFormEl.elements.categoryId);

  const market = currentMarket();
  if (!market) {
    catalogEditorEl.innerHTML = '<p class="empty">尚未建立賣場</p>';
    return;
  }

  const allProducts = sortedProductsForMarket(market);
  const products = filterProducts(allProducts);
  const productIds = new Set(allProducts.map((product) => product.id));
  selectedProductIds = new Set([...selectedProductIds].filter((productId) => productIds.has(productId)));
  const editingProduct = editingProductId
    ? allProducts.find((product) => product.id === editingProductId)
    : null;

  if (editingProductId && !editingProduct) editingProductId = "";
  if (productSearchInputEl && productSearchInputEl.value !== productSearchQuery) {
    productSearchInputEl.value = productSearchQuery;
  }
  if (productListCountEl) {
    productListCountEl.textContent = productSearchQuery
      ? `符合 ${products.length} / 全部 ${allProducts.length} 件商品`
      : `共 ${allProducts.length} 件商品`;
  }
  const emptyProductMessage = productSearchQuery ? "目前沒有符合的商品" : "目前還沒有商品";

  catalogEditorEl.innerHTML = `
    <article class="market-editor" data-market-id="${escapeHtml(market.id)}">
      ${editingProduct
        ? productEditFormMarkup(editingProduct)
        : `
          <div class="admin-product-list-actions">
            <button type="button" class="admin-add-product-button" data-create-product>+ 新增商品</button>
          </div>
          ${bulkCategoryToolbarMarkup(products)}
          <div class="admin-product-card-grid">
            ${products.map((product) => productCardMarkup(product)).join("") || `<p class="empty product-list-empty">${escapeHtml(emptyProductMessage)}</p>`}
          </div>
        `}
    </article>
  `;
}

function updateBulkSelectionUi() {
  const checkboxes = Array.from(document.querySelectorAll("[data-select-product]"));
  const allCheckbox = document.querySelector("[data-select-all-products]");
  const moveButton = document.querySelector("[data-bulk-move-category]");
  const countEl = document.querySelector("[data-bulk-selection-count]");

  for (const checkbox of checkboxes) {
    checkbox.checked = selectedProductIds.has(checkbox.dataset.selectProduct);
  }

  const allSelected = checkboxes.length > 0 && checkboxes.every((checkbox) => checkbox.checked);
  if (allCheckbox) allCheckbox.checked = allSelected;
  if (moveButton) moveButton.disabled = selectedProductIds.size === 0;
  if (countEl) countEl.textContent = `已選 ${selectedProductIds.size} 件`;
}

async function loadCatalog() {
  catalog = await requestJson("/api/admin/catalog");
  renderCatalog();
}

marketFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const market = currentMarket();
  const formData = new FormData(marketFormEl);
  const imageUrl = await marketImageFromForm(marketFormEl, formData);

  try {
    await requestJson(`/api/admin/markets/${encodeURIComponent(market.id)}`, {
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
  } catch (error) {
    alert(error.message);
  }
});

categoryFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(categoryFormEl);

  try {
    await requestJson("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        parentId: formData.get("parentId"),
        sortOrder: Number(formData.get("sortOrder"))
      })
    });
    categoryFormEl.reset();
    await loadCatalog();
  } catch (error) {
    alert(error.message);
  }
});

productFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const market = currentMarket();
  if (!market) return;

  const formData = new FormData(productFormEl);
  const imageUrl = await productImageFromForm(productFormEl, formData);

  try {
    await requestJson(`/api/admin/markets/${encodeURIComponent(market.id)}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: formData.get("categoryId"),
        name: formData.get("name"),
        imageUrl,
        description: formData.get("description"),
        variants: await collectVariantsWithImages(newVariantsEl)
      })
    });

    productFormEl.reset();
    resetImageUploaders(productFormEl);
    renderCategoryOptions(productFormEl.elements.categoryId);
    newVariantsEl.innerHTML = variantRow();
    await loadCatalog();
    showProductList();
    showProductNotice("已成功");
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-create-product]")) {
    showProductCreate();
    return;
  }

  if (event.target.closest("[data-bulk-move-category]")) {
    const categorySelect = document.querySelector("[data-bulk-category-target]");
    const categoryId = categorySelect?.value || "";
    if (selectedProductIds.size === 0) return alert("請先勾選要移入分類的商品");
    if (!categoryId) return alert("請選擇目標分類");

    try {
      const result = await requestJson("/api/admin/products/bulk-category", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: [...selectedProductIds],
          categoryId
        })
      });
      selectedProductIds = new Set();
      await loadCatalog();
      alert(`已移入 ${result.movedCount} 件商品`);
    } catch (error) {
      alert(error.message);
    }
    return;
  }

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

  const categoryId = event.target.dataset.deleteCategory;
  if (categoryId && confirm("確定刪除這個分類？分類內商品會改到第一個分類。")) {
    try {
      await requestJson(`/api/admin/categories/${encodeURIComponent(categoryId)}`, { method: "DELETE" });
      await loadCatalog();
    } catch (error) {
      alert(error.message);
    }
  }

  const productId = event.target.dataset.deleteProduct;
  if (productId && confirm("確定刪除這個商品？")) {
    await fetch(`/api/admin/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
    if (editingProductId === productId) editingProductId = "";
    await loadCatalog();
    return;
  }

  const editProductButton = event.target.closest("[data-edit-product]");
  if (editProductButton) {
    editingProductId = editProductButton.dataset.editProduct;
    renderCatalog();
    catalogEditorEl.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (event.target.closest("[data-back-product-list]")) {
    editingProductId = "";
    showProductList();
    renderCatalog();
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.matches(".category-edit-form")) {
    event.preventDefault();
    const categoryId = event.target.dataset.categoryId;
    const formData = new FormData(event.target);

    try {
      await requestJson(`/api/admin/categories/${encodeURIComponent(categoryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          parentId: formData.get("parentId"),
          sortOrder: Number(formData.get("sortOrder")),
          isActive: formData.get("isActive") === "on"
        })
      });
      await loadCatalog();
    } catch (error) {
      alert(error.message);
    }
  }

  if (event.target.matches(".product-edit-form")) {
    event.preventDefault();
    const productId = event.target.dataset.productId;
    const formData = new FormData(event.target);
    const imageUrl = await productImageFromForm(event.target, formData);

    try {
      await requestJson(`/api/admin/products/${encodeURIComponent(productId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: formData.get("categoryId"),
          name: formData.get("name"),
          imageUrl,
          description: formData.get("description"),
          variants: await collectVariantsWithImages(event.target.querySelector(".variant-editor"))
        })
      });
      editingProductId = "";
      await loadCatalog();
      showProductList();
      showProductNotice("已成功");
    } catch (error) {
      alert(error.message);
    }
  }
});

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  document.querySelectorAll("[data-variant-row][data-drag-ready]").forEach((row) => {
    delete row.dataset.dragReady;
  });

  const handle = event.target.closest("[data-variant-drag-handle]");
  if (!handle) return;
  const row = handle.closest("[data-variant-row]");
  if (!row) return;
  event.preventDefault();
  row.dataset.dragReady = "true";
  draggedVariantRow = row;
  isPointerDraggingVariant = true;
  draggedVariantRow.classList.add("is-dragging");
});

document.addEventListener("pointermove", (event) => {
  if (!isPointerDraggingVariant || !draggedVariantRow) return;
  event.preventDefault();
  moveDraggedVariantRow(event.clientY);
});

document.addEventListener("pointerup", cleanupVariantDrag);
document.addEventListener("pointercancel", cleanupVariantDrag);

document.addEventListener("dragstart", (event) => {
  const row = event.target.closest("[data-variant-row]");
  if (!row || row.dataset.dragReady !== "true") {
    event.preventDefault();
    return;
  }

  draggedVariantRow = row;
  if (!draggedVariantRow) return;
  draggedVariantRow.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedVariantRow.dataset.variantId || "new-variant");
});

document.addEventListener("dragover", (event) => {
  if (!draggedVariantRow) return;
  const editor = event.target.closest(".variant-editor");
  if (!editor || !editor.contains(draggedVariantRow)) return;

  event.preventDefault();
  moveDraggedVariantRow(event.clientY);
});

document.addEventListener("drop", (event) => {
  if (!draggedVariantRow) return;
  const editor = event.target.closest(".variant-editor");
  if (editor && editor.contains(draggedVariantRow)) event.preventDefault();
});

document.addEventListener("dragend", cleanupVariantDrag);

document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-select-product]")) {
    const productId = event.target.dataset.selectProduct;
    if (event.target.checked) {
      selectedProductIds.add(productId);
    } else {
      selectedProductIds.delete(productId);
    }
    updateBulkSelectionUi();
    return;
  }

  if (event.target.matches("[data-select-all-products]")) {
    const checkboxes = Array.from(document.querySelectorAll("[data-select-product]"));
    for (const checkbox of checkboxes) {
      if (event.target.checked) {
        selectedProductIds.add(checkbox.dataset.selectProduct);
      } else {
        selectedProductIds.delete(checkbox.dataset.selectProduct);
      }
    }
    updateBulkSelectionUi();
    return;
  }

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

productSearchInputEl?.addEventListener("input", (event) => {
  productSearchQuery = event.target.value;
  editingProductId = "";
  renderCatalog();
});

productSearchButtonEl?.addEventListener("click", () => {
  productSearchQuery = productSearchInputEl?.value || "";
  editingProductId = "";
  renderCatalog();
});

productSearchResetEl?.addEventListener("click", () => {
  productSearchQuery = "";
  editingProductId = "";
  if (productSearchInputEl) productSearchInputEl.value = "";
  renderCatalog();
});

newVariantsEl.innerHTML = variantRow();
loadCatalog().catch((error) => {
  catalogEditorEl.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
});
