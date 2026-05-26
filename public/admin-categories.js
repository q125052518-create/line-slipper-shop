const categoryEditorEl = document.querySelector("#categoryEditor");
const categoryFormEl = document.querySelector("#categoryForm");
const refreshCategoriesEl = document.querySelector("#refreshCategories");
const categoryProductListEl = document.querySelector("#categoryProductList");
const categoryProductSearchEl = document.querySelector("#categoryProductSearch");
const bulkCategoryTargetEl = document.querySelector("#bulkCategoryTarget");
const bulkMoveCategoryButtonEl = document.querySelector("#bulkMoveCategoryButton");
const bulkCategorySelectionCountEl = document.querySelector("#bulkCategorySelectionCount");
const selectAllCategoryProductsEl = document.querySelector("#selectAllCategoryProducts");

let catalog = { categories: [], markets: [] };
let selectedProductIds = new Set();
let draggedCategoryRow = null;
let pendingCategoryDrop = null;
let isSavingCategoryOrder = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "操作失敗");
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function categoryImagePreviewMarkup(value) {
  if (!value) return '<span class="image-preview empty" data-category-image-preview>尚未上傳</span>';
  return `
    <span class="image-preview" data-category-image-preview>
      <img src="${escapeHtml(value)}" alt="" onerror="this.parentElement.classList.add('empty'); this.parentElement.textContent='圖片無法載入';">
    </span>
  `;
}

function currentMarket() {
  return catalog.markets[0] || null;
}

function allProducts() {
  return currentMarket()?.products || [];
}

function categoryProductSearchQuery() {
  return String(categoryProductSearchEl?.value || "").trim().toLowerCase();
}

function productSearchText(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return [
    product.name,
    product.description,
    categoryName(product.categoryId),
    ...variants.flatMap((variant) => [variant.name, variant.barcode])
  ].join(" ").toLowerCase();
}

function visibleCategoryProducts() {
  const query = categoryProductSearchQuery();
  if (!query) return [];
  const terms = query.split(/\s+/).filter(Boolean);
  return allProducts().filter((product) => {
    const text = productSearchText(product);
    return terms.every((term) => text.includes(term));
  });
}

function categoryById(categoryId) {
  return catalog.categories.find((category) => category.id === categoryId);
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
  let parentId = categoryById(categoryId)?.parentId || "";
  const seen = new Set([categoryId]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = categoryById(parentId)?.parentId || "";
  }
  return depth;
}

function isDescendantCategory(candidateId, parentId) {
  let currentId = categoryById(candidateId)?.parentId || "";
  const seen = new Set([candidateId]);
  while (currentId && !seen.has(currentId)) {
    if (currentId === parentId) return true;
    seen.add(currentId);
    currentId = categoryById(currentId)?.parentId || "";
  }
  return false;
}

function canUseAsParent(parentId, categoryId) {
  return parentId && parentId !== categoryId && !isDescendantCategory(parentId, categoryId);
}

function categoryOptionLabel(category) {
  const depth = categoryDepth(category.id);
  return `${"  ".repeat(depth)}${depth ? "- " : ""}${category.name}`;
}

function categoryName(categoryId) {
  const category = categoryById(categoryId);
  if (!category) return "未分類";
  const names = [category.name];
  let parentId = category.parentId || "";
  const seen = new Set([category.id]);
  while (parentId && !seen.has(parentId)) {
    const parent = categoryById(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId || "";
  }
  return names.join(" / ");
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
    `<option value="" ${selectedId ? "" : "selected"}>無上層分類</option>`,
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

function renderCategoryEditor() {
  const categories = sortedCategories();
  categoryEditorEl.innerHTML = categories.length ? `
    <div class="category-drag-list">
      ${categories.map((category) => {
        const depth = Math.min(categoryDepth(category.id), 5);
        return `
          <div class="category-drag-row" style="--category-depth: ${depth};" data-category-row data-category-id="${escapeHtml(category.id)}" data-parent-id="${escapeHtml(category.parentId || "")}" data-depth="${depth}">
            <button type="button" class="category-drag-handle" data-category-drag-handle aria-label="拖曳分類">☷</button>
            <div class="category-image-field">
              <span class="category-image-label">分類圖片</span>
              <label class="category-image-picker" title="點擊更換分類圖片">
                ${categoryImagePreviewMarkup(category.imageUrl || "")}
                <input type="file" accept="image/*" data-category-image-file="${escapeHtml(category.id)}">
              </label>
              <input type="hidden" name="imageUrl" value="${escapeHtml(category.imageUrl || "")}">
              <button type="button" class="category-image-delete" data-clear-category-image="${escapeHtml(category.id)}">刪圖</button>
            </div>
            <label class="category-name-field">
              分類名稱
              <input name="name" value="${escapeHtml(category.name)}" required>
            </label>
            <span class="category-level-label">${depth ? "子分類" : "大分類"}</span>
            <label class="checkbox-row category-active-field">
              <input type="checkbox" name="isActive" ${category.isActive !== false ? "checked" : ""}>
              前台顯示
            </label>
            <button type="button" data-save-category="${escapeHtml(category.id)}">儲存</button>
            <button type="button" data-delete-category="${escapeHtml(category.id)}">刪除</button>
          </div>
        `;
      }).join("")}
    </div>
  ` : '<p class="empty">尚未建立分類</p>';

  if (categoryFormEl.elements.parentId) {
    renderParentCategoryOptions(categoryFormEl.elements.parentId);
  }
  bulkCategoryTargetEl.innerHTML = categoryOptionsMarkup(bulkCategoryTargetEl.value);
}

function updateBulkSelectionUi() {
  const products = visibleCategoryProducts();
  const allProductIds = new Set(allProducts().map((product) => product.id));
  selectedProductIds = new Set([...selectedProductIds].filter((productId) => allProductIds.has(productId)));

  document.querySelectorAll("[data-category-product-select]").forEach((checkbox) => {
    checkbox.checked = selectedProductIds.has(checkbox.dataset.categoryProductSelect);
  });

  const hasVisibleProducts = products.length > 0;
  const allSelected = hasVisibleProducts && products.every((product) => selectedProductIds.has(product.id));
  selectAllCategoryProductsEl.checked = allSelected;
  selectAllCategoryProductsEl.disabled = !hasVisibleProducts;
  bulkMoveCategoryButtonEl.disabled = selectedProductIds.size === 0 || !bulkCategoryTargetEl.value;
  bulkCategorySelectionCountEl.textContent = categoryProductSearchQuery()
    ? `符合 ${products.length} 件｜已選 ${selectedProductIds.size} 件`
    : `已選 ${selectedProductIds.size} 件`;
}

function renderCategoryProductList() {
  const query = categoryProductSearchQuery();
  const products = visibleCategoryProducts();
  if (!allProducts().length) {
    categoryProductListEl.innerHTML = '<p class="empty">目前沒有商品</p>';
    updateBulkSelectionUi();
    return;
  }
  if (!query) {
    categoryProductListEl.innerHTML = '<p class="empty">請輸入商品名稱、款式或品項條碼搜尋商品</p>';
    updateBulkSelectionUi();
    return;
  }
  if (!products.length) {
    categoryProductListEl.innerHTML = '<p class="empty">找不到符合的商品</p>';
    updateBulkSelectionUi();
    return;
  }

  categoryProductListEl.innerHTML = products.map((product) => {
    const imageUrl = product.imageUrl || "https://placehold.co/96x96/f2efe8/1e2720?text=No+Image";
    return `
      <label class="category-product-row">
        <input type="checkbox" data-category-product-select="${escapeHtml(product.id)}" ${selectedProductIds.has(product.id) ? "checked" : ""}>
        <img src="${escapeHtml(imageUrl)}" alt="" onerror="this.src='https://placehold.co/96x96/f2efe8/1e2720?text=No+Image';">
        <span>
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(categoryName(product.categoryId))}</small>
        </span>
      </label>
    `;
  }).join("");
  updateBulkSelectionUi();
}

function renderAll() {
  renderCategoryEditor();
  renderCategoryProductList();
}

async function loadCatalog() {
  catalog = await requestJson("/api/admin/catalog");
  renderAll();
}

function categoryRows() {
  return [...categoryEditorEl.querySelectorAll("[data-category-row]")];
}

function clearCategoryDragState() {
  categoryRows().forEach((row) => row.classList.remove("is-child-target", "is-sort-target", "is-before-target", "is-after-target"));
}

function cleanupCategoryDrag() {
  if (draggedCategoryRow) {
    draggedCategoryRow.classList.remove("is-dragging", "is-child-preview");
    draggedCategoryRow.style.setProperty("--category-depth", draggedCategoryRow.dataset.depth || 0);
  }
  clearCategoryDragState();
  draggedCategoryRow = null;
  pendingCategoryDrop = null;
}

function previewCategoryDrag(event) {
  if (!draggedCategoryRow) return;
  const draggedId = draggedCategoryRow.dataset.categoryId;
  const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest(".category-drag-row");
  clearCategoryDragState();
  if (!targetRow || targetRow === draggedCategoryRow) return;

  const targetId = targetRow.dataset.categoryId;
  const targetRect = targetRow.getBoundingClientRect();
  const inMiddle = event.clientY > targetRect.top + targetRect.height * 0.32 &&
    event.clientY < targetRect.bottom - targetRect.height * 0.32;

  if (inMiddle && canUseAsParent(targetId, draggedId)) {
    const depth = Math.min(Number(targetRow.dataset.depth || 0) + 1, 5);
    targetRow.classList.add("is-child-target");
    draggedCategoryRow.classList.add("is-child-preview");
    draggedCategoryRow.style.setProperty("--category-depth", depth);
    pendingCategoryDrop = { mode: "child", parentId: targetId, targetId };
    targetRow.after(draggedCategoryRow);
    return;
  }

  const before = event.clientY < targetRect.top + targetRect.height / 2;
  const targetParentId = targetRow.dataset.parentId || "";
  const depth = Number(targetRow.dataset.depth || 0);
  targetRow.classList.add("is-sort-target", before ? "is-before-target" : "is-after-target");
  draggedCategoryRow.classList.remove("is-child-preview");
  draggedCategoryRow.style.setProperty("--category-depth", depth);
  pendingCategoryDrop = { mode: "sort", parentId: targetParentId, targetId };
  if (before) {
    targetRow.before(draggedCategoryRow);
  } else {
    targetRow.after(draggedCategoryRow);
  }
}

async function saveCategoryOrderFromDom() {
  if (!draggedCategoryRow || !pendingCategoryDrop || isSavingCategoryOrder) {
    cleanupCategoryDrag();
    return;
  }

  const draggedId = draggedCategoryRow.dataset.categoryId;
  const nextParentId = pendingCategoryDrop.parentId || "";
  const orderByParent = new Map();
  const updates = categoryRows().map((row) => {
    const id = row.dataset.categoryId;
    const category = categoryById(id);
    const parentId = id === draggedId ? nextParentId : category?.parentId || "";
    const sortOrder = orderByParent.get(parentId) || 0;
    orderByParent.set(parentId, sortOrder + 1);
    return { id, parentId, sortOrder };
  });

  isSavingCategoryOrder = true;
  try {
    await requestJson("/api/admin/categories/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: updates })
    });
    await loadCatalog();
  } catch (error) {
    alert(error.message);
    await loadCatalog();
  } finally {
    isSavingCategoryOrder = false;
    cleanupCategoryDrag();
  }
}

categoryFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(categoryFormEl);
  const sortOrderValue = formData.get("sortOrder");

  try {
    await requestJson("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        parentId: formData.get("parentId") || "",
        sortOrder: sortOrderValue === null || sortOrderValue === "" ? undefined : Number(sortOrderValue)
      })
    });
    categoryFormEl.reset();
    await loadCatalog();
  } catch (error) {
    alert(error.message);
  }
});

categoryEditorEl.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-category-drag-handle]");
  if (!handle || isSavingCategoryOrder) return;
  const row = handle.closest(".category-drag-row");
  if (!row) return;

  event.preventDefault();
  draggedCategoryRow = row;
  pendingCategoryDrop = null;
  row.classList.add("is-dragging");
});

document.addEventListener("pointermove", (event) => {
  if (!draggedCategoryRow) return;
  event.preventDefault();
  previewCategoryDrag(event);
});

document.addEventListener("pointerup", () => {
  if (!draggedCategoryRow) return;
  saveCategoryOrderFromDom();
});

document.addEventListener("pointercancel", cleanupCategoryDrag);

function categoryPayloadFromRow(categoryId, row) {
  const category = categoryById(categoryId);
  return {
    name: row.querySelector('[name="name"]').value,
    imageUrl: row.querySelector('[name="imageUrl"]')?.value || "",
    parentId: category?.parentId || "",
    sortOrder: category?.sortOrder || 0,
    isActive: row.querySelector('[name="isActive"]').checked
  };
}

async function saveCategoryRow(categoryId, row) {
  await requestJson(`/api/admin/categories/${encodeURIComponent(categoryId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(categoryPayloadFromRow(categoryId, row))
  });
}

function setCategoryImageValue(row, value) {
  const hidden = row.querySelector('[name="imageUrl"]');
  if (hidden) hidden.value = value || "";
  const fileInput = row.querySelector('[data-category-image-file]');
  if (fileInput) fileInput.value = "";
  const preview = row.querySelector("[data-category-image-preview]");
  if (preview) preview.outerHTML = categoryImagePreviewMarkup(value || "");
}

categoryEditorEl.addEventListener("click", async (event) => {
  const clearCategoryImageId = event.target.dataset.clearCategoryImage;
  if (clearCategoryImageId) {
    const row = event.target.closest(".category-drag-row");
    if (!row) return;
    try {
      setCategoryImageValue(row, "");
      await saveCategoryRow(clearCategoryImageId, row);
      await loadCatalog();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const saveCategoryId = event.target.dataset.saveCategory;
  if (saveCategoryId) {
    const row = event.target.closest(".category-drag-row");
    const category = categoryById(saveCategoryId);
    if (!row || !category) return;

    try {
      await requestJson(`/api/admin/categories/${encodeURIComponent(saveCategoryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: row.querySelector('[name="name"]').value,
          imageUrl: row.querySelector('[name="imageUrl"]')?.value || "",
          parentId: category.parentId || "",
          sortOrder: category.sortOrder || 0,
          isActive: row.querySelector('[name="isActive"]').checked
        })
      });
      await loadCatalog();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const categoryId = event.target.dataset.deleteCategory;
  if (!categoryId) return;
  if (!confirm("確定刪除這個分類？商品會移到預設分類，子分類會改成無上層分類。")) return;

  try {
    await requestJson(`/api/admin/categories/${encodeURIComponent(categoryId)}`, { method: "DELETE" });
    await loadCatalog();
  } catch (error) {
    alert(error.message);
  }
});

categoryEditorEl.addEventListener("change", async (event) => {
  const categoryId = event.target.dataset.categoryImageFile;
  if (!categoryId) return;
  const file = event.target.files?.[0];
  const row = event.target.closest(".category-drag-row");
  if (!file || !row) return;

  try {
    const dataUrl = await readFileAsDataUrl(file);
    setCategoryImageValue(row, dataUrl);
    await saveCategoryRow(categoryId, row);
    await loadCatalog();
  } catch (error) {
    alert(error.message);
  }
});

categoryProductListEl.addEventListener("change", (event) => {
  const productId = event.target.dataset.categoryProductSelect;
  if (!productId) return;

  if (event.target.checked) {
    selectedProductIds.add(productId);
  } else {
    selectedProductIds.delete(productId);
  }
  updateBulkSelectionUi();
});

selectAllCategoryProductsEl.addEventListener("change", () => {
  const products = visibleCategoryProducts();
  if (selectAllCategoryProductsEl.checked) {
    for (const product of products) selectedProductIds.add(product.id);
  } else {
    for (const product of products) selectedProductIds.delete(product.id);
  }
  updateBulkSelectionUi();
});

categoryProductSearchEl.addEventListener("input", renderCategoryProductList);

bulkCategoryTargetEl.addEventListener("change", updateBulkSelectionUi);

bulkMoveCategoryButtonEl.addEventListener("click", async () => {
  const categoryId = bulkCategoryTargetEl.value;
  if (!categoryId) return alert("請先選擇目標分類");
  if (!selectedProductIds.size) return alert("請先勾選商品");

  try {
    const result = await requestJson("/api/admin/products/bulk-category", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productIds: [...selectedProductIds],
        categoryId
      })
    });
    selectedProductIds.clear();
    await loadCatalog();
    alert(`已移入 ${result.movedCount} 件商品`);
  } catch (error) {
    alert(error.message);
  }
});

refreshCategoriesEl.addEventListener("click", loadCatalog);

loadCatalog().catch((error) => {
  categoryEditorEl.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
});
