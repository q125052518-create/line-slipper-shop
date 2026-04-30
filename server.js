import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import XLSX from "xlsx";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-change-me";
const channelSecret = process.env.LINE_CHANNEL_SECRET || "";
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const dataDir = path.join(__dirname, "data");
const ordersFile = path.join(dataDir, "orders.json");
const catalogFile = path.join(dataDir, "catalog.json");

const defaultCatalog = {
  markets: [
    {
      id: "summer-sale",
      name: "夏季拖鞋賣場",
      description: "涼感、防滑、日常好穿的拖鞋款式。",
      isActive: true,
      products: [
        {
          id: "cloud-slide",
          name: "雲朵厚底拖鞋",
          imageUrl: "https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=900&q=80",
          description: "柔軟厚底，適合居家與外出。",
          variants: [
            { id: "cloud-white-24", name: "白色 / 24cm", barcode: "SLP-CW-24", price: 390, stock: 12 },
            { id: "cloud-white-25", name: "白色 / 25cm", barcode: "SLP-CW-25", price: 390, stock: 8 },
            { id: "cloud-black-26", name: "黑色 / 26cm", barcode: "SLP-CB-26", price: 390, stock: 5 }
          ]
        },
        {
          id: "beach-basic",
          name: "海灘防滑拖鞋",
          imageUrl: "https://images.unsplash.com/photo-1562273138-f46be4ebdf33?auto=format&fit=crop&w=900&q=80",
          description: "輕量止滑，適合浴室、泳池與海邊。",
          variants: [
            { id: "beach-blue-m", name: "藍色 / M", barcode: "SLP-BL-M", price: 250, stock: 20 },
            { id: "beach-blue-l", name: "藍色 / L", barcode: "SLP-BL-L", price: 250, stock: 14 }
          ]
        }
      ]
    }
  ]
};

app.use(express.json({
  limit: "15mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.set("trust proxy", 1);
app.post("/api/auth/login", (req, res) => {
  const { password } = req.body;
  if (String(password || "") !== adminPassword) {
    return res.status(401).json({ message: "密碼不正確" });
  }

  res.setHeader("Set-Cookie", buildSessionCookie(req, createSessionToken()));
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", buildSessionCookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: isAdminAuthenticated(req) });
});

app.use("/admin.html", requireAdminPage);
app.use("/api/admin", requireAdminApi);
app.use(express.static(path.join(__dirname, "public")));

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureJsonFile(ordersFile, []);
  await ensureJsonFile(catalogFile, defaultCatalog);
}

async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
  }
}

async function readJson(filePath, fallback) {
  await ensureStore();
  const content = await fs.readFile(filePath, "utf8");
  return content.trim() ? JSON.parse(content) : fallback;
}

async function writeJson(filePath, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readOrders() {
  return readJson(ordersFile, []);
}

async function writeOrders(orders) {
  return writeJson(ordersFile, orders);
}

function normalizeCatalog(catalog) {
  catalog.markets = Array.isArray(catalog.markets) ? catalog.markets : [];
  for (const market of catalog.markets) {
    market.imageUrl = String(market.imageUrl || "").trim();
    market.products = Array.isArray(market.products) ? market.products : [];
    for (const product of market.products) {
      product.variants = Array.isArray(product.variants) ? product.variants : [];
      for (const variant of product.variants) {
        const stock = Number(variant.stock);
        variant.stock = Number.isInteger(stock) && stock >= 0 ? stock : 0;
        variant.imageUrl = String(variant.imageUrl || "").trim();
      }
    }
  }
  return catalog;
}

async function readCatalog() {
  return normalizeCatalog(await readJson(catalogFile, defaultCatalog));
}

async function writeCatalog(catalog) {
  return writeJson(catalogFile, normalizeCatalog(catalog));
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + 1000 * 60 * 60 * 24
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return false;

  const expected = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function isAdminAuthenticated(req) {
  return verifySessionToken(parseCookies(req).admin_session);
}

function isHttpsRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function buildSessionCookie(req, value, maxAge = 60 * 60 * 24) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return [
    `admin_session=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure
  ].join("; ");
}

function requireAdminPage(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  res.redirect("/login.html");
}

function requireAdminApi(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  res.status(401).json({ message: "請先登入後台" });
}

function verifyLineSignature(req) {
  if (!channelSecret) return false;
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(req.rawBody)
    .digest("base64");
  return hash === signature;
}

async function replyMessage(replyToken, messages) {
  if (!channelAccessToken) return;

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`
    },
    body: JSON.stringify({ replyToken, messages })
  });

  if (!response.ok) console.warn("LINE reply failed:", response.status, await response.text());
}

function normalizeVariant(input, existingId) {
  const name = String(input.name || "").trim();
  const barcode = String(input.barcode || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const price = Number(input.price);
  const stock = Number(input.stock);

  if (!name) throw new Error("請填寫品項名稱");
  if (!barcode) throw new Error("請填寫品項條碼");
  if (!Number.isFinite(price) || price < 0) throw new Error("請填寫正確價格");
  if (!Number.isInteger(stock) || stock < 0) throw new Error("請填寫正確庫存");

  return {
    id: existingId || input.id || makeId("variant"),
    name,
    barcode,
    imageUrl,
    price: Math.round(price),
    stock
  };
}

function normalizeProduct(input, existingId) {
  const name = String(input.name || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const description = String(input.description || "").trim();
  const variants = Array.isArray(input.variants) ? input.variants : [];

  if (!name) throw new Error("請填寫商品名稱");
  if (variants.length === 0) throw new Error("請至少建立一個品項");

  return {
    id: existingId || input.id || makeId("product"),
    name,
    imageUrl,
    description,
    variants: variants.map((variant) => normalizeVariant(variant, variant.id))
  };
}

function findCatalogItem(catalog, marketId, productId, variantId) {
  const market = catalog.markets.find((entry) => entry.id === marketId && entry.isActive !== false);
  const product = market?.products.find((entry) => entry.id === productId);
  const variant = product?.variants.find((entry) => entry.id === variantId);
  return { market, product, variant };
}

function buildOrderSummary(order) {
  const lines = order.items
    .map((item) => `${item.productName} - ${item.variantName} x ${item.quantity}`)
    .join("\n");
  return `訂單已建立：${order.id}\n${lines}\n總金額：NT$${order.totalAmount}`;
}

app.get("/api/config", (_req, res) => {
  res.json({ liffId: process.env.LIFF_ID || "" });
});

app.get("/api/markets", async (_req, res) => {
  const catalog = await readCatalog();
  res.json({ markets: catalog.markets.filter((market) => market.isActive !== false) });
});

app.get("/api/admin/catalog", async (_req, res) => {
  res.json(await readCatalog());
});

app.post("/api/admin/markets", async (req, res) => {
  const catalog = await readCatalog();
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "請填寫賣場名稱" });

  const market = {
    id: makeId("market"),
    name,
    imageUrl: String(req.body.imageUrl || "").trim(),
    description: String(req.body.description || "").trim(),
    isActive: req.body.isActive !== false,
    products: []
  };

  catalog.markets.push(market);
  await writeCatalog(catalog);
  res.status(201).json({ market });
});

app.put("/api/admin/markets/:marketId", async (req, res) => {
  const catalog = await readCatalog();
  const market = catalog.markets.find((entry) => entry.id === req.params.marketId);
  if (!market) return res.status(404).json({ message: "找不到賣場" });

  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "請填寫賣場名稱" });

  market.name = name;
  market.imageUrl = String(req.body.imageUrl || "").trim();
  market.description = String(req.body.description || "").trim();
  market.isActive = req.body.isActive !== false;
  await writeCatalog(catalog);
  res.json({ market });
});

app.delete("/api/admin/markets/:marketId", async (req, res) => {
  const catalog = await readCatalog();
  catalog.markets = catalog.markets.filter((entry) => entry.id !== req.params.marketId);
  await writeCatalog(catalog);
  res.sendStatus(204);
});

app.post("/api/admin/markets/:marketId/products", async (req, res) => {
  const catalog = await readCatalog();
  const market = catalog.markets.find((entry) => entry.id === req.params.marketId);
  if (!market) return res.status(404).json({ message: "找不到賣場" });

  try {
    const product = normalizeProduct(req.body);
    market.products.push(product);
    await writeCatalog(catalog);
    res.status(201).json({ product });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.put("/api/admin/products/:productId", async (req, res) => {
  const catalog = await readCatalog();
  const market = catalog.markets.find((entry) => entry.products.some((product) => product.id === req.params.productId));
  const index = market?.products.findIndex((product) => product.id === req.params.productId) ?? -1;
  if (!market || index < 0) return res.status(404).json({ message: "找不到商品" });

  try {
    market.products[index] = normalizeProduct(req.body, req.params.productId);
    await writeCatalog(catalog);
    res.json({ product: market.products[index] });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.delete("/api/admin/products/:productId", async (req, res) => {
  const catalog = await readCatalog();
  for (const market of catalog.markets) {
    market.products = market.products.filter((product) => product.id !== req.params.productId);
  }
  await writeCatalog(catalog);
  res.sendStatus(204);
});

app.post("/api/admin/inventory/import", async (req, res) => {
  const { fileBase64 } = req.body;
  if (!fileBase64) return res.status(400).json({ message: "請選擇 Excel 檔案" });

  let rows;
  try {
    const buffer = Buffer.from(String(fileBase64).split(",").pop(), "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  } catch {
    return res.status(400).json({ message: "Excel 檔案讀取失敗" });
  }

  const parsed = parseInventoryRows(rows);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const catalog = await readCatalog();
  const barcodeMap = new Map();
  for (const market of catalog.markets) {
    for (const product of market.products) {
      for (const variant of product.variants) {
        barcodeMap.set(String(variant.barcode).trim().toUpperCase(), variant);
      }
    }
  }

  const updated = [];
  const unmatched = [];
  for (const item of parsed.items) {
    const variant = barcodeMap.get(item.barcode.toUpperCase());
    if (!variant) {
      unmatched.push(item.barcode);
      continue;
    }

    variant.stock = item.quantity;
    updated.push({ barcode: item.barcode, quantity: item.quantity });
  }

  await writeCatalog(catalog);
  res.json({
    updatedCount: updated.length,
    unmatchedCount: unmatched.length,
    updated,
    unmatched
  });
});

app.post("/api/admin/products/import", async (req, res) => {
  const { fileBase64 } = req.body;
  if (!fileBase64) return res.status(400).json({ message: "請選擇 Excel 檔案" });

  let rows;
  try {
    const buffer = Buffer.from(String(fileBase64).split(",").pop(), "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  } catch {
    return res.status(400).json({ message: "Excel 檔案讀取失敗" });
  }

  const parsed = parseProductImportRows(rows);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const catalog = await readCatalog();
  let createdMarkets = 0;
  let createdProducts = 0;
  let createdVariants = 0;
  let updatedVariants = 0;

  for (const item of parsed.items) {
    let market = catalog.markets.find((entry) => entry.name.trim() === item.marketName);
    if (!market) {
      market = {
        id: makeId("market"),
        name: item.marketName,
        description: "",
        isActive: item.isActive,
        products: []
      };
      catalog.markets.push(market);
      createdMarkets += 1;
    }

    market.isActive = item.isActive;
    let product = market.products.find((entry) => entry.name.trim() === item.productName);
    if (!product) {
      product = {
        id: makeId("product"),
        name: item.productName,
        imageUrl: item.productImageUrl,
        description: item.productDescription,
        variants: []
      };
      market.products.push(product);
      createdProducts += 1;
    } else {
      product.description = item.productDescription || product.description || "";
      product.imageUrl = item.productImageUrl || product.imageUrl || "";
    }

    const variant = product.variants.find((entry) => entry.barcode.trim().toUpperCase() === item.barcode.toUpperCase());
    if (variant) {
      variant.name = item.variantName;
      variant.price = item.price;
      variant.stock = item.stock;
      variant.imageUrl = item.variantImageUrl || variant.imageUrl || "";
      updatedVariants += 1;
    } else {
      product.variants.push({
        id: makeId("variant"),
        name: item.variantName,
        barcode: item.barcode,
        imageUrl: item.variantImageUrl,
        price: item.price,
        stock: item.stock
      });
      createdVariants += 1;
    }
  }

  await writeCatalog(catalog);
  res.json({
    importedRows: parsed.items.length,
    createdMarkets,
    createdProducts,
    createdVariants,
    updatedVariants
  });
});

function parseInventoryRows(rows) {
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map((cell) => String(cell).trim());
    return cells.includes("品項條碼") && cells.includes("數量");
  });

  if (headerIndex < 0) return { error: "找不到欄位：品項條碼、數量" };

  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const barcodeIndex = headers.indexOf("品項條碼");
  const quantityIndex = headers.indexOf("數量");
  const items = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const barcode = String(row[barcodeIndex] || "").trim();
    const rawQuantity = row[quantityIndex];
    if (!barcode && rawQuantity === "") continue;

    const quantity = Number(rawQuantity);
    if (!barcode || !Number.isInteger(quantity) || quantity < 0) {
      return { error: `資料格式錯誤：${barcode || "空白條碼"}` };
    }

    items.push({ barcode, quantity });
  }

  if (items.length === 0) return { error: "Excel 沒有可匯入的資料" };
  return { items };
}

function parseProductImportRows(rows) {
  const requiredHeaders = ["賣場名稱", "商品名稱", "款式", "品項條碼", "售價", "數量"];
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map((cell) => String(cell).trim());
    return requiredHeaders.every((header) => cells.includes(header));
  });

  if (headerIndex < 0) {
    return { error: `找不到必要欄位：${requiredHeaders.join("、")}` };
  }

  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const indexOf = (name) => headers.indexOf(name);
  const marketIndex = indexOf("賣場名稱");
  const productIndex = indexOf("商品名稱");
  const descriptionIndex = indexOf("商品說明");
  const productImageIndex = indexOf("商品圖片網址");
  const variantIndex = indexOf("款式");
  const barcodeIndex = indexOf("品項條碼");
  const priceIndex = indexOf("售價");
  const stockIndex = indexOf("數量");
  const variantImageIndex = indexOf("品項圖片網址");
  const activeIndex = indexOf("是否上架");

  const items = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const marketName = String(row[marketIndex] || "").trim();
    const productName = String(row[productIndex] || "").trim();
    const variantName = String(row[variantIndex] || "").trim();
    const barcode = String(row[barcodeIndex] || "").trim();
    const price = Number(row[priceIndex]);
    const stock = Number(row[stockIndex]);

    if (!marketName && !productName && !variantName && !barcode) continue;
    if (!marketName || !productName || !variantName || !barcode) {
      return { error: `資料缺少必要欄位：${barcode || productName || marketName || "空白列"}` };
    }
    if (!Number.isFinite(price) || price < 0) return { error: `${barcode} 售價格式錯誤` };
    if (!Number.isInteger(stock) || stock < 0) return { error: `${barcode} 數量格式錯誤` };

    items.push({
      marketName,
      productName,
      productDescription: descriptionIndex >= 0 ? String(row[descriptionIndex] || "").trim() : "",
      productImageUrl: productImageIndex >= 0 ? String(row[productImageIndex] || "").trim() : "",
      variantName,
      barcode,
      price: Math.round(price),
      stock,
      variantImageUrl: variantImageIndex >= 0 ? String(row[variantImageIndex] || "").trim() : "",
      isActive: activeIndex >= 0 ? parseActiveValue(row[activeIndex]) : true
    });
  }

  if (items.length === 0) return { error: "Excel 沒有可匯入的商品資料" };
  return { items };
}

function parseActiveValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return ["是", "上架", "true", "1", "yes", "y"].includes(text);
}

app.get("/api/orders", async (_req, res) => {
  const orders = await readOrders();
  res.json({ orders: orders.slice().reverse() });
});

app.post("/api/orders", async (req, res) => {
  const { lineUserId, customerName, phone, deliveryMethod, deliveryAddress, note, items } = req.body;
  const cleanDeliveryMethod = String(deliveryMethod || "").trim();
  const cleanDeliveryAddress = String(deliveryAddress || "").trim();

  if (!["宅配", "自行取貨"].includes(cleanDeliveryMethod)) {
    return res.status(400).json({ message: "請選擇取貨方式" });
  }

  if (cleanDeliveryMethod === "宅配" && !cleanDeliveryAddress) {
    return res.status(400).json({ message: "宅配請填寫地址" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "請至少選擇一項商品" });
  }

  const catalog = await readCatalog();
  let normalizedItems;

  try {
    normalizedItems = items.map((item) => {
      const quantity = Number(item.quantity);
      const found = findCatalogItem(catalog, item.marketId, item.productId, item.variantId);

      if (!found.market || !found.product || !found.variant) throw new Error("商品品項不存在");
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("數量不正確");
      if (found.variant.stock < quantity) {
        throw new Error(`${found.product.name} - ${found.variant.name} 庫存不足，目前剩 ${found.variant.stock}`);
      }

      return {
        marketId: found.market.id,
        marketName: found.market.name,
        productId: found.product.id,
        productName: found.product.name,
        variantId: found.variant.id,
        variantName: found.variant.name,
        variantImageUrl: found.variant.imageUrl || found.product.imageUrl || "",
        barcode: found.variant.barcode,
        price: found.variant.price,
        quantity,
        subtotal: found.variant.price * quantity
      };
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  for (const item of normalizedItems) {
    const { variant } = findCatalogItem(catalog, item.marketId, item.productId, item.variantId);
    variant.stock -= item.quantity;
  }
  await writeCatalog(catalog);

  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
  const order = {
    id: `ORD-${Date.now()}`,
    lineUserId: lineUserId || "guest",
    customerName: customerName || "",
    phone: phone || "",
    deliveryMethod: cleanDeliveryMethod,
    deliveryAddress: cleanDeliveryMethod === "宅配" ? cleanDeliveryAddress : "",
    note: note || "",
    items: normalizedItems,
    totalAmount,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  const orders = await readOrders();
  orders.push(order);
  await writeOrders(orders);

  res.status(201).json({ order, summary: buildOrderSummary(order) });
});

app.patch("/api/orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const allowedStatuses = new Set(["pending", "accepted", "packing", "shipped", "completed", "cancelled"]);

  if (!allowedStatuses.has(status)) return res.status(400).json({ message: "訂單狀態不正確" });

  const orders = await readOrders();
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ message: "找不到訂單" });

  order.status = status;
  order.updatedAt = new Date().toISOString();
  await writeOrders(orders);
  res.json({ order });
});

app.post("/webhook", async (req, res) => {
  if (!verifyLineSignature(req)) return res.status(401).send("Invalid signature");

  for (const event of req.body.events || []) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    if (text.includes("下單") || text.includes("拖鞋") || text.includes("賣場")) {
      await replyMessage(event.replyToken, [
        { type: "text", text: `請點這裡看拖鞋賣場：${req.protocol}://${req.get("host")}/` }
      ]);
    }
  }

  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`LINE slipper order system running at http://localhost:${port}`);
});
