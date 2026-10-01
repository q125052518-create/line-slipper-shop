const ProductEditor = (() => {
  const escape = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const pending = new Set();
  function imagesMarkup(images) {
    return images.map((url, i) => `<div class="media-tile">
      <button type="button" class="media-preview" data-enlarge-image="${escape(url)}" aria-label="放大圖片 ${i + 1}"><img src="${escape(url)}" alt="商品圖片 ${i + 1}"></button>
      <div class="media-tile-controls"><small>${i === 0 ? "主圖" : `附圖 ${i}`}</small>
      <button type="button" data-image-move="${i}" data-direction="-1" title="向前移" aria-label="圖片 ${i + 1} 向前移" ${i === 0 ? "disabled" : ""}>←</button>
      <button type="button" data-image-move="${i}" data-direction="1" title="向後移" aria-label="圖片 ${i + 1} 向後移" ${i === images.length - 1 ? "disabled" : ""}>→</button>
      <button type="button" data-image-remove="${i}" title="移除圖片" aria-label="移除圖片 ${i + 1}">×</button></div></div>`).join("");
  }
  function fields(product = {}) {
    const images = product.imageUrls?.length ? product.imageUrls : [product.imageUrl].filter(Boolean);
    return `<section class="listing-fields"><div class="listing-section-title"><h3>商品資料</h3><label class="listing-toggle"><input type="checkbox" name="isActive" ${product.isActive !== false ? "checked" : ""}>上架</label></div>
      <label>主商品貨號<input name="sku" value="${escape(product.sku)}"></label>
      <h3>商品圖片 <small data-image-count>${images.length} / 9</small></h3>
      <div class="product-gallery-editor" data-gallery><input type="hidden" name="imageUrls" value="${escape(JSON.stringify(images))}">
      <div class="media-grid">${imagesMarkup(images)}</div>
      <div class="gallery-inputs"><label>上傳圖片<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple data-gallery-files></label>
      <label>圖片網址<input type="url" data-gallery-url placeholder="https://"></label><button type="button" data-gallery-add>新增圖片</button></div><p class="message" data-image-message aria-live="polite"></p></div>
      <div class="listing-section-title"><h3>規格設定</h3></div>
      <div class="listing-field-grid">
      ${[0, 1].map((i) => `<label>規格名稱 ${i + 1}<input name="optionName${i + 1}" value="${escape(product.optionNames?.[i])}" placeholder="${i === 0 ? "顏色／款式" : "尺寸"}"></label>`).join("")}
      <label>規格選項 1<input data-option-values="0" placeholder="粉色, 白色"></label><label>規格選項 2<input data-option-values="1" placeholder="M, L"></label>
      </div><button type="button" data-generate-variants>產生規格組合</button>
      <div class="listing-section-title"><h3>包裹資料</h3></div><div class="listing-field-grid package-fields">
      ${[["weight", "重量 (kg)"], ["length", "長度 (cm)"], ["width", "寬度 (cm)"], ["height", "高度 (cm)"], ["leadDays", "備貨天數"]].map(([key, label]) => `<label>${label}<input type="number" min="0" step="${key === "leadDays" ? "1" : "0.001"}" name="${key}" value="${escape(product[key])}"></label>`).join("")}</div>
      <div class="listing-section-title"><h3>選項明細</h3></div><div class="variant-bulk"><label>統一價格<input type="number" data-bulk-price min="0" step="1"></label><label>統一庫存<input type="number" data-bulk-stock min="0" step="1"></label><button type="button" data-apply-variant-values>套用全部選項</button></div></section>`;
  }
  function setImages(gallery, images) {
    if (images.length > 9) throw new Error("商品圖片最多 9 張");
    gallery.querySelector('[name="imageUrls"]').value = JSON.stringify(images);
    gallery.querySelector(".media-grid").innerHTML = imagesMarkup(images);
    gallery.closest(".listing-fields").querySelector("[data-image-count]").textContent = `${images.length} / 9`;
    delete gallery.dataset.uploadError;
  }
  async function upload(file) {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) throw new Error("只支援 PNG、JPG、GIF、WebP");
    if (file.size > 2 * 1024 * 1024) throw new Error("每張圖片不可超過 2 MB");
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const response = await fetch("/api/admin/product-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "圖片上傳失敗");
    return data.imageUrl;
  }
  async function collect(form) {
    await Promise.all([...pending]);
    const failed = form.querySelector("[data-upload-error]");
    if (failed) throw new Error(failed.dataset.uploadError);
    const values = new FormData(form);
    return { imageUrls: JSON.parse(values.get("imageUrls") || "[]"), sku: values.get("sku"), isActive: form.elements.isActive.checked,
      optionNames: [values.get("optionName1") || "", values.get("optionName2") || ""],
      ...Object.fromEntries(["weight", "length", "width", "height", "leadDays"].map((key) => [key, values.get(key)])) };
  }
  document.addEventListener("click", (event) => {
    const zoom = event.target.closest("[data-enlarge-image], .image-preview img");
    if (zoom) {
      let dialog = document.querySelector("#imageZoom");
      if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "imageZoom"; dialog.className = "image-zoom"; dialog.innerHTML = '<form method="dialog"><button aria-label="關閉圖片">×</button></form><img alt="圖片放大">'; document.body.append(dialog); dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); }
      dialog.querySelector("img").src = zoom.dataset.enlargeImage || zoom.src; dialog.showModal(); return;
    }
    const gallery = event.target.closest("[data-gallery]");
    if (!gallery) return;
    try {
      const images = JSON.parse(gallery.querySelector('[name="imageUrls"]').value);
      if (event.target.matches("[data-gallery-add]")) {
        const input = gallery.querySelector("[data-gallery-url]"); const url = input.value.trim();
        if (!/^https?:\/\//i.test(url) || !input.checkValidity()) throw new Error("請輸入有效的 HTTP(S) 圖片網址");
        setImages(gallery, [...new Set([...images, url])]); input.value = "";
      } else if (event.target.matches("[data-image-remove]")) { images.splice(Number(event.target.dataset.imageRemove), 1); setImages(gallery, images); }
      else if (event.target.matches("[data-image-move]")) {
        const i = Number(event.target.dataset.imageMove), j = i + Number(event.target.dataset.direction);
        if (j >= 0 && j < images.length) { [images[i], images[j]] = [images[j], images[i]]; setImages(gallery, images); }
      }
      gallery.querySelector("[data-image-message]").textContent = "";
    } catch (error) { gallery.querySelector("[data-image-message]").textContent = error.message; }
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-gallery-files]")) return;
    const gallery = event.target.closest("[data-gallery]"); const files = [...event.target.files];
    const task = (async () => {
      if (JSON.parse(gallery.querySelector('[name="imageUrls"]').value).length + files.length > 9) throw new Error("商品圖片最多 9 張");
      gallery.querySelector("[data-image-message]").textContent = "圖片上傳中…";
      for (const file of files) {
        const url = await upload(file);
        setImages(gallery, [...new Set([...JSON.parse(gallery.querySelector('[name="imageUrls"]').value), url])]);
      }
      gallery.querySelector("[data-image-message]").textContent = "";
    })();
    pending.add(task);
    task.catch((error) => { gallery.dataset.uploadError = error.message; gallery.querySelector("[data-image-message]").textContent = error.message; }).finally(() => { pending.delete(task); event.target.value = ""; });
  });
  return { fields, collect, upload };
})();
