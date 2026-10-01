import crypto from "node:crypto";

export const productImportHeaders = [
  "分類", "子分類", "商品名稱", "商品說明", "商品圖片網址", "款式", "品項條碼", "售價", "數量", "品項圖片網址", "是否上架",
  "商品ID", "主商品貨號", "規格名稱 1", "規格選項 1", "規格名稱 2", "規格選項 2",
  ...Array.from({ length: 8 }, (_, i) => `商品圖片 ${i + 1}`),
  "重量(kg)", "長度(cm)", "寬度(cm)", "高度(cm)", "備貨天數"
];

export function imageValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\/uploads\/product-images\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(text)) return text;
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return text;
  } catch { /* Report invalid sources without fetching them. */ }
  throw new Error("圖片只接受 HTTP(S) 網址或上傳的 PNG、JPG、GIF、WebP");
}

export function productMedia(input) {
  const images = Array.isArray(input.imageUrls) ? input.imageUrls : [input.imageUrl];
  const clean = [...new Set(images.map(imageValue).filter(Boolean))];
  if (clean.length > 9) throw new Error("商品圖片最多 9 張");
  return { imageUrl: clean[0] || "", imageUrls: clean };
}

export function productMetadata(input) {
  const result = { sku: String(input.sku || "").trim(), isActive: input.isActive !== false,
    optionNames: (Array.isArray(input.optionNames) ? input.optionNames : []).slice(0, 2).map((v) => String(v || "").trim()) };
  for (const key of ["weight", "length", "width", "height", "leadDays"]) {
    const value = input[key];
    if (value === "" || value == null) { result[key] = ""; continue; }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (key === "leadDays" && !Number.isInteger(number))) throw new Error("重量、尺寸及備貨天數格式錯誤");
    result[key] = number;
  }
  return result;
}

export function catalogRevision(catalog) {
  return crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}

const aliases = {
  商品說明: ["商品描述"], 商品圖片網址: ["主商品圖片"], 品項圖片網址: ["規格圖片", "選項圖片"],
  品項條碼: ["商品選項貨號", "選項SKU"], 售價: ["價格"], 數量: ["庫存"],
  主商品貨號: ["商品主貨號"], "重量(kg)": ["重量"], "長度(cm)": ["長度"], "寬度(cm)": ["寬度"], "高度(cm)": ["高度"], 備貨天數: ["較長備貨天數"]
};

export function parseImportRows(rows) {
  try {
    if (!Array.isArray(rows) || rows.length > 5001) throw new Error("每次最多匯入 5,000 個品項");
    const canonical = (cell) => {
      const value = String(cell ?? "").trim();
      return Object.keys(aliases).find((key) => aliases[key].includes(value)) || value;
    };
    const headerIndex = rows.findIndex((row) => ["商品名稱", "品項條碼", "售價", "數量"].every((name) => row.map(canonical).includes(name)));
    if (headerIndex < 0) throw new Error("找不到必要欄位：商品名稱、款式或規格選項、品項條碼、售價、數量");
    const headers = rows[headerIndex].map(canonical);
    if (headers.some((h, i) => h && headers.indexOf(h) !== i)) throw new Error("Excel 有重複欄位名稱");
    const items = [];
    for (const [index, row] of rows.slice(headerIndex + 1).entries()) {
      if (row.every((cell) => String(cell ?? "").trim() === "")) continue;
      const get = (name) => String(row[headers.indexOf(name)] ?? "").trim();
      const options = [get("規格選項 1"), get("規格選項 2")];
      const item = { rowNumber: headerIndex + index + 2, productId: get("商品ID"), sku: get("主商品貨號"),
        categoryName: get("分類"), subCategoryName: get("子分類"), productName: get("商品名稱"),
        productDescription: get("商品說明"), productImageUrl: imageValue(get("商品圖片網址")),
        variantImageUrl: imageValue(get("品項圖片網址")), variantName: get("款式") || options.filter(Boolean).join(" / "),
        optionNames: [get("規格名稱 1"), get("規格名稱 2")], options, barcode: get("品項條碼"),
        price: Number(get("售價")), stock: Number(get("數量")) };
      if (!item.productName || !item.variantName || !item.barcode || !get("售價") || !get("數量")) throw new Error(`第 ${item.rowNumber} 列缺少必要資料`);
      if (!Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.stock) || item.stock < 0) throw new Error(`第 ${item.rowNumber} 列價格或庫存格式錯誤`);
      item.price = Math.round(item.price);
      item.imageUrls = [item.productImageUrl, ...Array.from({ length: 8 }, (_, i) => imageValue(get(`商品圖片 ${i + 1}`)))].filter(Boolean);
      for (const [key, header] of Object.entries({ weight: "重量(kg)", length: "長度(cm)", width: "寬度(cm)", height: "高度(cm)", leadDays: "備貨天數" })) {
        if (get(header)) item[key] = get(header);
      }
      Object.assign(item, Object.fromEntries(Object.entries(productMetadata(item)).filter(([key]) => ["weight", "length", "width", "height", "leadDays"].includes(key) && item[key] !== undefined)));
      const active = get("是否上架").toLowerCase();
      if (active && !["是", "上架", "true", "1", "yes", "y", "否", "下架", "false", "0", "no", "n"].includes(active)) throw new Error(`第 ${item.rowNumber} 列是否上架請填是或否`);
      item.isActive = active ? ["是", "上架", "true", "1", "yes", "y"].includes(active) : undefined;
      items.push(item);
    }
    if (!items.length) throw new Error("Excel 沒有可匯入的商品資料");
    return { items, rows: [headers, ...rows.slice(headerIndex + 1)] };
  } catch (error) { return { error: error.message }; }
}

export function applyProductImport(catalog, items, makeId) {
  const market = catalog.markets[0];
  const stats = { importedRows: items.length, createdMarkets: 0, createdCategories: 0, createdProducts: 0, createdVariants: 0, updatedVariants: 0 };
  const seen = new Set();
  const metadata = new Map();
  const changes = [];
  for (const item of items) {
    const barcode = item.barcode.toUpperCase();
    if (seen.has(barcode)) throw new Error(`重複品項條碼：${item.barcode}`);
    seen.add(barcode);
    let category = catalog.categories[0];
    if (item.categoryName) {
      category = catalog.categories.find((c) => c.name === item.categoryName && !c.parentId);
      if (!category) {
        category = { id: makeId("category"), name: item.categoryName, parentId: "", isActive: true, sortOrder: catalog.categories.length };
        catalog.categories.push(category); stats.createdCategories++;
      }
    }
    if (item.subCategoryName) {
      let child = catalog.categories.find((c) => c.name === item.subCategoryName && c.parentId === category.id);
      if (!child) { child = { id: makeId("category"), name: item.subCategoryName, parentId: category.id, isActive: true, sortOrder: catalog.categories.length }; catalog.categories.push(child); stats.createdCategories++; }
      category = child;
    }
    const matches = market.products.filter((p) => item.productId ? p.id === item.productId : item.sku ? p.sku === item.sku : p.name.trim() === item.productName && p.categoryId === category.id);
    if (matches.length > 1) throw new Error(`商品無法唯一定位：${item.productName}，請填商品ID`);
    let product = matches[0];
    if (item.productId && !product) throw new Error(`找不到商品ID：${item.productId}`);
    const owner = market.products.find((p) => p.variants.some((v) => String(v.barcode).toUpperCase() === barcode));
    if (owner && owner !== product) throw new Error(`品項條碼 ${item.barcode} 已屬於 ${owner.name}，請核對商品ID／主貨號`);
    if (!product) {
      product = { id: makeId("product"), name: item.productName, categoryId: category.id, description: "", imageUrl: "", imageUrls: [], variants: [], isActive: true };
      market.products.push(product); stats.createdProducts++;
    }
    const shared = { name: item.productName };
    if (item.categoryName || item.subCategoryName || !product.categoryId) shared.categoryId = category.id;
    if (item.sku) shared.sku = item.sku;
    if (item.productDescription) shared.description = item.productDescription;
    if (item.imageUrls.length) Object.assign(shared, productMedia({ imageUrls: item.imageUrls }));
    if (item.isActive !== undefined) shared.isActive = item.isActive;
    if (item.optionNames.some(Boolean)) shared.optionNames = item.optionNames;
    for (const key of ["weight", "length", "width", "height", "leadDays"]) if (item[key] !== undefined) shared[key] = item[key];
    const previous = metadata.get(product.id) || {};
    for (const [key, value] of Object.entries(shared)) {
      if (key in previous && JSON.stringify(previous[key]) !== JSON.stringify(value)) throw new Error(`同一商品多列的 ${key} 不一致：${item.productName}`);
    }
    metadata.set(product.id, { ...previous, ...shared });
    Object.assign(product, shared);
    let variant = product.variants.find((v) => String(v.barcode).toUpperCase() === barcode);
    const action = variant ? "更新品項" : "新增品項";
    if (variant) stats.updatedVariants++;
    else { variant = { id: makeId("variant"), barcode: item.barcode }; product.variants.push(variant); stats.createdVariants++; }
    Object.assign(variant, { name: item.variantName, price: item.price, stock: item.stock });
    if (item.variantImageUrl) variant.imageUrl = item.variantImageUrl;
    if (item.options.some(Boolean)) variant.options = item.options;
    changes.push({ rowNumber: item.rowNumber, action, productName: product.name, variantName: variant.name, barcode: variant.barcode, price: variant.price, stock: variant.stock, imageUrl: variant.imageUrl || product.imageUrl || "" });
  }
  return { ...stats, changes };
}
