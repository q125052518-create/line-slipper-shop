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
const adminAccount = process.env.ADMIN_ACCOUNT || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-change-me";
const sevenElevenDeliveryMethod = "7-11 賣貨便";
const sevenElevenShippingFee = Number(process.env.SEVEN_ELEVEN_SHIPPING_FEE || 38);
const sevenElevenFallbackMapUrl = "https://www.ibon.com.tw/retail_inquiry.aspx";
const ecpayMerchantId = String(process.env.ECPAY_MERCHANT_ID || "").trim();
const ecpayHashKey = String(process.env.ECPAY_HASH_KEY || "").trim();
const ecpayHashIv = String(process.env.ECPAY_HASH_IV || "").trim();
const ecpayLogisticsMapUrl = String(process.env.ECPAY_LOGISTICS_MAP_URL || "https://logistics.ecpay.com.tw/Express/map").trim();
const ecpayLogisticsSubType = String(process.env.ECPAY_LOGISTICS_SUB_TYPE || "UNIMARTC2C").trim();
const channelSecret = process.env.LINE_CHANNEL_SECRET || "";
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const seedDataDir = path.join(__dirname, "data");
const dataDir = path.resolve(process.env.DATA_DIR || seedDataDir);
const ordersFile = path.join(dataDir, "orders.json");
const buyersFile = path.join(dataDir, "buyers.json");
const chatsFile = path.join(dataDir, "chats.json");
const catalogFile = path.join(dataDir, "catalog.json");
const storeLayoutFile = path.join(dataDir, "store-layout.json");
const mallbicSyncFile = path.join(dataDir, "mallbic-sync.json");
const mallbicOrderSyncFile = path.join(dataDir, "mallbic-order-sync.json");
const mallbicOrderTemplateFile = path.join(dataDir, "mallbic-order-template.xls");
const myshipOrderSyncFile = path.join(dataDir, "myship-order-sync.json");
const mallbicLoginUrl = process.env.MALLBIC_LOGIN_URL || "https://ec.mallbic.com/Module/0_Login/Login.aspx?sid=g5c071iv";
const mallbicCompanyName = process.env.MALLBIC_COMPANY_NAME || "祥瑞華有限公司";
const mallbicDefaultTimeoutMs = Number(process.env.MALLBIC_DEFAULT_TIMEOUT_MS || 30000);
const mallbicNavTimeoutMs = Number(process.env.MALLBIC_NAV_TIMEOUT_MS || 60000);
const mallbicExportTimeoutMs = Number(process.env.MALLBIC_EXPORT_TIMEOUT_MS || 600000);
const mallbicAutoSyncEnabled = parseEnvFlag(process.env.MALLBIC_AUTO_SYNC_ENABLED, true);
const mallbicAutoSyncIntervalMs = Math.max(60000, Number(process.env.MALLBIC_AUTO_SYNC_INTERVAL_MS || 60 * 60 * 1000));
const mallbicOrderAutoSyncEnabled = parseEnvFlag(process.env.MALLBIC_ORDER_AUTO_SYNC_ENABLED, false);
const mallbicOrderAutoSyncIntervalMs = Math.max(60000, Number(process.env.MALLBIC_ORDER_AUTO_SYNC_INTERVAL_MS || 5 * 60 * 1000));
const myshipProductUrl = String(process.env.MYSHIP_PRODUCT_URL || "https://myship.7-11.com.tw/general/detail/GM2506169881759").trim();
const myshipFacebookEmail = String(process.env.MYSHIP_FACEBOOK_EMAIL || "").trim();
const myshipFacebookPassword = String(process.env.MYSHIP_FACEBOOK_PASSWORD || "").trim();
const myshipAutoOrderEnabled = parseEnvFlag(process.env.MYSHIP_AUTO_ORDER_ENABLED, true);
const myshipAutoOrderIntervalMs = Math.max(60000, Number(process.env.MYSHIP_AUTO_ORDER_INTERVAL_MS || 5 * 60 * 1000));
const myshipAmountSource = String(process.env.MYSHIP_AMOUNT_SOURCE || "productTotal").trim();
const myshipDefaultTimeoutMs = Number(process.env.MYSHIP_DEFAULT_TIMEOUT_MS || 30000);
const myshipNavTimeoutMs = Number(process.env.MYSHIP_NAV_TIMEOUT_MS || 60000);
const myshipBrowserProfileDir = String(process.env.MYSHIP_BROWSER_PROFILE_DIR || path.join(dataDir, "myship-browser-profile")).trim();
const myshipHeadless = parseEnvFlag(process.env.MYSHIP_HEADLESS, true);
const myshipManualLoginWindowMs = Math.max(60000, Number(process.env.MYSHIP_MANUAL_LOGIN_WINDOW_MS || 3 * 60 * 1000));
let mallbicSyncRunning = false;
let mallbicOrderSyncRunning = false;
let mallbicOrderStatusSyncRunning = false;
let myshipOrderSyncRunning = false;
let adminChatEventId = 0;
const adminChatClients = new Set();

const defaultMallbicSyncStatus = {
  enabled: mallbicAutoSyncEnabled,
  intervalMs: mallbicAutoSyncIntervalMs,
  running: false,
  lastTrigger: "",
  lastRunAt: "",
  lastFinishedAt: "",
  lastSuccessAt: "",
  lastError: "",
  lastResult: null
};

const defaultMallbicOrderSyncStatus = {
  enabled: mallbicOrderAutoSyncEnabled,
  intervalMs: mallbicOrderAutoSyncIntervalMs,
  running: false,
  lastTrigger: "",
  lastRunAt: "",
  lastFinishedAt: "",
  lastSuccessAt: "",
  lastError: "",
  lastResult: null
};

const defaultMyshipOrderSyncStatus = {
  enabled: myshipAutoOrderEnabled,
  intervalMs: myshipAutoOrderIntervalMs,
  running: false,
  lastTrigger: "",
  lastRunAt: "",
  lastFinishedAt: "",
  lastSuccessAt: "",
  lastError: "",
  lastResult: null
};

const defaultCatalog = {
  categories: [
    {
      id: "default-category",
      name: "一般商品",
      imageUrl: "",
      isActive: true,
      parentId: "",
      sortOrder: 0
    }
  ],
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
          categoryId: "default-category",
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
          categoryId: "default-category",
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

const defaultStoreLayout = {
  version: 2,
  blocks: [
    {
      id: "banner-default",
      type: "banner",
      title: "賣場看板",
      enabled: true,
      imageUrls: [],
      linkUrl: "",
      sortOrder: 0
    },
    {
      id: "notice-default",
      type: "notice",
      title: "賣場公告",
      enabled: true,
      text: "新品陸續上架中，下單前可先聊聊確認現貨。",
      sortOrder: 1
    },
    {
      id: "category-grid-default",
      type: "category-grid",
      title: "分類區",
      enabled: true,
      categoryIds: [],
      columns: 5,
      sortOrder: 2
    },
    {
      id: "featured-products-default",
      type: "featured-products",
      title: "主打商品",
      enabled: true,
      productIds: [],
      limit: 6,
      sortOrder: 3
    },
    {
      id: "new-products-default",
      type: "new-products",
      title: "新上架",
      enabled: true,
      limit: 6,
      sortOrder: 4
    },
    {
      id: "hot-products-default",
      type: "hot-products",
      title: "熱銷商品",
      enabled: true,
      limit: 6,
      sortOrder: 5
    }
  ]
};

app.use(express.json({
  limit: "15mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.set("trust proxy", 1);
app.post("/api/auth/login", (req, res) => {
  const password = String(req.body?.password || "").trim();
  if (password !== adminPassword) {
    return res.status(401).json({ message: "密碼不正確" });
  }

  res.setHeader("Set-Cookie", [
    buildSessionCookie(req, createSessionToken()),
    buildBuyerSessionCookie(req, "", 0)
  ]);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", buildSessionCookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: isAdminAuthenticated(req) });
});

app.post("/api/buyer/register", async (req, res) => {
  const parsed = validateBuyerInput(req.body || {}, { requireName: true });
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const buyers = await readBuyers();
  if (buyers.some((buyer) => buyer.phoneNormalized === parsed.phoneNormalized)) {
    return res.status(409).json({ message: "這個手機號碼已經註冊，請直接登入" });
  }

  const buyer = {
    id: makeId("BUYER"),
    name: parsed.name,
    phone: parsed.phone,
    phoneNormalized: parsed.phoneNormalized,
    passwordHash: hashBuyerPassword(parsed.password),
    createdAt: new Date().toISOString(),
    updatedAt: ""
  };
  buyers.push(buyer);
  await writeBuyers(buyers);

  res.setHeader("Set-Cookie", [
    buildBuyerSessionCookie(req, createSessionToken({ buyerId: buyer.id }, 60 * 60 * 24 * 30)),
    buildSessionCookie(req, "", 0)
  ]);
  res.status(201).json({ buyer: publicBuyerView(buyer) });
});

app.post("/api/buyer/login", async (req, res) => {
  const loginAccount = String(req.body?.account ?? req.body?.phone ?? "").trim();
  const loginPassword = String(req.body?.password || "").trim();
  const isAdminAccount = loginAccount.toLowerCase() === adminAccount.toLowerCase();
  if (isAdminAccount) {
    if (loginPassword !== adminPassword) {
      return res.status(401).json({ message: "管理員密碼不正確" });
    }

    res.setHeader("Set-Cookie", [
      buildSessionCookie(req, createSessionToken()),
      buildBuyerSessionCookie(req, "", 0)
    ]);
    return res.json({ role: "admin", redirectTo: "/admin.html" });
  }

  const parsed = validateBuyerInput(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const buyers = await readBuyers();
  const buyer = buyers.find((entry) => entry.phoneNormalized === parsed.phoneNormalized);
  if (!buyer || !verifyBuyerPassword(parsed.password, buyer.passwordHash)) {
    return res.status(401).json({ message: "帳號或密碼不正確" });
  }

  res.setHeader("Set-Cookie", [
    buildBuyerSessionCookie(req, createSessionToken({ buyerId: buyer.id }, 60 * 60 * 24 * 30)),
    buildSessionCookie(req, "", 0)
  ]);
  res.json({ buyer: publicBuyerView(buyer) });
});

app.post("/api/buyer/logout", (req, res) => {
  res.setHeader("Set-Cookie", buildBuyerSessionCookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/buyer/status", async (req, res) => {
  const buyer = await getBuyerFromRequest(req);
  res.json({ authenticated: Boolean(buyer), buyer: buyer ? publicBuyerView(buyer) : null });
});

app.get("/api/buyer/chat", requireBuyerApi, async (req, res) => {
  const chats = await readChats();
  const conversation = findOrCreateConversation(chats, req.buyer);
  const changed = markSellerMessagesReadByBuyer(conversation);
  await writeChats(chats);
  if (changed) notifyAdminChatClients("buyer-read", { buyerId: conversation.buyerId });
  res.json(publicBuyerChatView(conversation));
});

app.post("/api/buyer/chat/messages", requireBuyerApi, async (req, res) => {
  const text = cleanChatText(req.body?.text);
  if (!text) return res.status(400).json({ message: "請輸入訊息" });

  const chats = await readChats();
  const conversation = findOrCreateConversation(chats, req.buyer);
  markSellerMessagesReadByBuyer(conversation);
  appendChatMessage(conversation, "buyer", text, req.body?.orderId);
  await writeChats(chats);
  notifyAdminChatClients("buyer-message", { buyerId: conversation.buyerId });

  res.status(201).json(publicBuyerChatView(conversation));
});

app.get("/api/admin/chats", requireAdminApi, async (_req, res) => {
  const chats = await readChats();
  const conversations = chats
    .filter((chat) => (chat.messages || []).length > 0)
    .map(publicAdminChatListView)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ conversations });
});

app.get("/api/admin/chats/stream", requireAdminApi, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  adminChatClients.add(res);
  sendAdminChatEvent(res, "ready", { ok: true });

  const heartbeat = setInterval(() => {
    sendAdminChatEvent(res, "ping", { at: new Date().toISOString() });
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    adminChatClients.delete(res);
  });
});

app.get("/api/admin/chats/:buyerId", requireAdminApi, async (req, res) => {
  const chats = await readChats();
  const conversation = chats.find((chat) => chat.buyerId === req.params.buyerId);
  if (!conversation) return res.status(404).json({ message: "找不到這個對話" });

  const hadUnread = Number(conversation.sellerUnreadCount || 0) > 0;
  conversation.sellerUnreadCount = 0;
  await writeChats(chats);
  if (hadUnread) notifyAdminChatClients("seller-read", { buyerId: conversation.buyerId });
  res.json(publicAdminChatView(conversation));
});

app.post("/api/admin/chats/:buyerId/messages", requireAdminApi, async (req, res) => {
  const text = cleanChatText(req.body?.text);
  if (!text) return res.status(400).json({ message: "請輸入回覆內容" });

  const buyers = await readBuyers();
  const buyer = buyers.find((entry) => entry.id === req.params.buyerId);
  if (!buyer) return res.status(404).json({ message: "找不到買家" });

  const chats = await readChats();
  const conversation = findOrCreateConversation(chats, buyer);
  appendChatMessage(conversation, "seller", text, req.body?.orderId);
  await writeChats(chats);
  notifyAdminChatClients("seller-message", { buyerId: conversation.buyerId });

  res.status(201).json(publicAdminChatView(conversation));
});

app.use(["/admin.html", "/admin-market.html", "/admin-categories.html", "/admin-layout.html", "/admin-chat.html", "/admin-tools.html", "/admin-orders.html", "/admin-stats.html"], requireAdminPage);
app.use("/api/admin", requireAdminApi);
app.use(express.static(path.join(__dirname, "public")));

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureJsonFile(ordersFile, []);
  await ensureJsonFile(buyersFile, []);
  await ensureJsonFile(chatsFile, []);
  await ensureJsonFile(catalogFile, defaultCatalog, path.join(seedDataDir, "catalog.json"));
  await ensureJsonFile(storeLayoutFile, defaultStoreLayout, path.join(seedDataDir, "store-layout.json"));
  await ensureJsonFile(mallbicSyncFile, defaultMallbicSyncStatus);
  await ensureJsonFile(mallbicOrderSyncFile, defaultMallbicOrderSyncStatus);
  await ensureJsonFile(myshipOrderSyncFile, defaultMyshipOrderSyncStatus);
  await ensureSeedFile(mallbicOrderTemplateFile, path.join(seedDataDir, "mallbic-order-template.xls"));
}

async function ensureSeedFile(filePath, seedFilePath) {
  try {
    await fs.access(filePath);
  } catch {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.copyFile(seedFilePath, filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function ensureJsonFile(filePath, fallback, seedFilePath = "") {
  try {
    await fs.access(filePath);
  } catch {
    if (seedFilePath && path.resolve(seedFilePath) !== path.resolve(filePath)) {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.copyFile(seedFilePath, filePath);
        return;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
  }
}

async function readJson(filePath, fallback) {
  await ensureStore();
  const content = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  return content.trim() ? JSON.parse(content) : fallback;
}

async function writeJson(filePath, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readOrders() {
  return normalizeOrders(await readJson(ordersFile, []));
}

async function writeOrders(orders) {
  return writeJson(ordersFile, normalizeOrders(orders));
}

async function readBuyers() {
  return normalizeBuyers(await readJson(buyersFile, []));
}

async function writeBuyers(buyers) {
  return writeJson(buyersFile, normalizeBuyers(buyers));
}

async function readChats() {
  return normalizeChats(await readJson(chatsFile, []));
}

async function writeChats(chats) {
  return writeJson(chatsFile, normalizeChats(chats));
}

function normalizeOrders(orders) {
  if (!Array.isArray(orders)) return [];

  return orders.map((order) => {
    const nextOrder = order && typeof order === "object" ? order : {};
    nextOrder.items = Array.isArray(nextOrder.items) ? nextOrder.items : [];
    nextOrder.status = normalizeOrderStatus(nextOrder.status);
    nextOrder.cancelRequest = normalizeCancelRequest(nextOrder.cancelRequest);
    nextOrder.mallbic = normalizeOrderMallbicSync(nextOrder);
    nextOrder.myship = normalizeOrderMyshipSync(nextOrder);
    return nextOrder;
  });
}

function normalizeOrderStatus(status) {
  const cleanStatus = String(status || "").trim();
  if (["pending", "new", "新訂單"].includes(cleanStatus)) return "pending";
  if (["processing", "accepted", "packing", "處理中", "已接單", "包裝中", "備貨中"].includes(cleanStatus)) return "processing";
  if (["shipped", "completed", "已出貨", "已完成"].includes(cleanStatus)) return "shipped";
  if (["cancelled", "canceled", "取消", "已取消"].includes(cleanStatus)) return "cancelled";
  return "pending";
}

function normalizeCancelRequest(cancelRequest) {
  const current = cancelRequest && typeof cancelRequest === "object" ? cancelRequest : {};
  const status = String(current.status || "").trim();
  const normalizedStatus = ["pending", "approved", "rejected"].includes(status) ? status : "";

  return {
    status: normalizedStatus,
    requestedAt: normalizedStatus ? String(current.requestedAt || "") : "",
    requestedBy: normalizedStatus ? String(current.requestedBy || "") : "",
    resolvedAt: ["approved", "rejected"].includes(normalizedStatus) ? String(current.resolvedAt || "") : "",
    resolvedBy: ["approved", "rejected"].includes(normalizedStatus) ? String(current.resolvedBy || "") : "",
    note: String(current.note || "")
  };
}

function normalizeBuyers(buyers) {
  if (!Array.isArray(buyers)) return [];

  return buyers
    .filter((buyer) => buyer && typeof buyer === "object")
    .map((buyer) => ({
      id: buyer.id || makeId("BUYER"),
      name: String(buyer.name || "").trim(),
      phone: String(buyer.phone || "").trim(),
      phoneNormalized: normalizePhone(buyer.phoneNormalized || buyer.phone),
      passwordHash: buyer.passwordHash || "",
      createdAt: buyer.createdAt || new Date().toISOString(),
      updatedAt: buyer.updatedAt || ""
    }))
    .filter((buyer) => buyer.phoneNormalized && buyer.passwordHash);
}

function normalizeChats(chats) {
  if (!Array.isArray(chats)) return [];

  return chats
    .filter((chat) => chat && typeof chat === "object")
    .map((chat) => ({
      buyerId: String(chat.buyerId || "").trim(),
      buyerName: String(chat.buyerName || "").trim(),
      buyerPhone: String(chat.buyerPhone || "").trim(),
      sellerUnreadCount: Math.max(0, Number(chat.sellerUnreadCount || 0)),
      messages: Array.isArray(chat.messages)
        ? chat.messages
            .filter((message) => message && typeof message === "object")
            .map((message) => ({
              id: String(message.id || makeId("MSG")),
              sender: message.sender === "seller" ? "seller" : "buyer",
              text: String(message.text || "").slice(0, 2000),
              orderId: String(message.orderId || "").trim(),
              createdAt: message.createdAt || new Date().toISOString(),
              readByBuyerAt: message.sender === "seller" ? String(message.readByBuyerAt || "") : ""
            }))
        : [],
      createdAt: chat.createdAt || new Date().toISOString(),
      updatedAt: chat.updatedAt || chat.createdAt || new Date().toISOString()
    }))
    .filter((chat) => chat.buyerId);
}

function normalizeOrderMallbicSync(order) {
  const current = order.mallbic && typeof order.mallbic === "object" ? order.mallbic : {};
  const cancelled = current.cancelStatus === "cancelled";
  const lookupOnlyFailed = current.importStatus === "importFailed" && isMallbicPostImportLookupError(current.importError);
  const importStatus = lookupOnlyFailed
    ? "imported"
    : current.importStatus || (order.status === "cancelled" ? "skipped" : "pending");
  const imported = importStatus === "imported";
  const cancelStatus = current.cancelStatus || (order.status === "cancelled" && imported ? "pending" : "");
  const fallbackImportedAt = lookupOnlyFailed ? order.updatedAt || order.createdAt || "" : "";
  const fallbackImportRowCount = lookupOnlyFailed
    ? (order.items || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0)
    : 0;

  return {
    importStatus,
    importedAt: current.importedAt || fallbackImportedAt,
    importError: lookupOnlyFailed ? "" : current.importError || "",
    importFileName: current.importFileName || "",
    importRowCount: Number(current.importRowCount || fallbackImportRowCount || 0),
    mallbicOrderNo: current.mallbicOrderNo || "",
    cancelStatus: cancelled ? "cancelled" : cancelStatus,
    cancelledAt: current.cancelledAt || "",
    cancelError: current.cancelError || ""
  };
}

function normalizeOrderMyshipSync(order) {
  const current = order.myship && typeof order.myship === "object" ? order.myship : {};
  const isSevenEleven = isSevenElevenOrder(order);
  const rawStatus = String(current.createStatus || "").trim();
  const createStatus = ["pending", "creating", "created", "failed", "skipped", "notNeeded"].includes(rawStatus)
    ? rawStatus
    : isSevenEleven ? "pending" : "notNeeded";

  return {
    createStatus: isSevenEleven ? createStatus : "notNeeded",
    createdAt: String(current.createdAt || ""),
    updatedAt: String(current.updatedAt || ""),
    error: String(current.error || ""),
    productUrl: String(current.productUrl || myshipProductUrl || ""),
    quantity: Math.max(0, Number(current.quantity || 0)),
    orderNo: String(current.orderNo || ""),
    lastScreenshot: String(current.lastScreenshot || "")
  };
}

function isSevenElevenOrder(order) {
  return String(order?.deliveryMethod || "").includes("7-11");
}

function isMallbicPostImportLookupError(error) {
  const message = String(error || "");
  return message.includes("select.platform-select") || message.includes("平台篩選欄位");
}

function normalizeCatalog(catalog) {
  catalog.categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  catalog.categories = catalog.categories
    .map((category, index) => ({
      id: String(category.id || makeId("category")).trim(),
      name: String(category.name || "").trim(),
      imageUrl: String(category.imageUrl || "").trim(),
      isActive: category.isActive !== false,
      parentId: String(category.parentId || "").trim(),
      sortOrder: Number.isFinite(Number(category.sortOrder)) ? Number(category.sortOrder) : index
    }))
    .filter((category) => category.id && category.name);
  if (catalog.categories.length === 0) {
    catalog.categories.push({
      id: "default-category",
      name: "一般商品",
      imageUrl: "",
      isActive: true,
      parentId: "",
      sortOrder: 0
    });
  }
  const categoryIds = new Set(catalog.categories.map((category) => category.id));
  for (const category of catalog.categories) {
    category.parentId = category.parentId && categoryIds.has(category.parentId) && category.parentId !== category.id
      ? category.parentId
      : "";
  }
  for (const category of catalog.categories) {
    const seen = new Set([category.id]);
    let parentId = category.parentId;
    while (parentId) {
      if (seen.has(parentId)) {
        category.parentId = "";
        break;
      }
      seen.add(parentId);
      parentId = catalog.categories.find((entry) => entry.id === parentId)?.parentId || "";
    }
  }

  catalog.markets = Array.isArray(catalog.markets) ? catalog.markets : [];
  if (catalog.markets.length === 0) {
    catalog.markets.push({
      id: "main-market",
      name: "拖鞋賣場",
      imageUrl: "",
      description: "",
      isActive: true,
      products: []
    });
  }

  const mainMarket = catalog.markets[0];
  const usedProductIds = new Set((mainMarket.products || []).map((product) => product.id).filter(Boolean));
  for (const extraMarket of catalog.markets.slice(1)) {
    for (const product of extraMarket.products || []) {
      if (product.id && usedProductIds.has(product.id)) product.id = makeId("product");
      if (product.id) usedProductIds.add(product.id);
      (mainMarket.products ||= []).push(product);
    }
  }
  catalog.markets = [mainMarket];

  const activeCategoryIds = new Set(catalog.categories.map((category) => category.id));
  const fallbackCategoryId = catalog.categories[0].id;
  for (const market of catalog.markets) {
    market.id = String(market.id || "main-market").trim() || "main-market";
    market.name = String(market.name || "拖鞋賣場").trim() || "拖鞋賣場";
    market.description = String(market.description || "").trim();
    market.isActive = market.isActive !== false;
    market.imageUrl = String(market.imageUrl || "").trim();
    market.products = Array.isArray(market.products) ? market.products : [];
    for (const product of market.products) {
      product.categoryId = activeCategoryIds.has(product.categoryId) ? product.categoryId : fallbackCategoryId;
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

function normalizeStoreLayout(layout, catalog = null) {
  const categoryIds = new Set((catalog?.categories || []).map((category) => category.id));
  const productIds = new Set((catalog?.markets || []).flatMap((market) => (
    (market.products || []).map((product) => product.id).filter(Boolean)
  )));
  const sourceBlocks = Array.isArray(layout?.blocks) ? layout.blocks : defaultStoreLayout.blocks;
  const uniqueStringList = (items, allowedIds = null) => (
    (Array.isArray(items) ? items : [])
      .map((item) => String(item || "").trim())
      .filter((item, index, list) => (
        item &&
        list.indexOf(item) === index &&
        (!allowedIds?.size || allowedIds.has(item))
      ))
  );
  const normalizeLimit = (value, fallback = 6) => Math.min(20, Math.max(1, Number.isFinite(Number(value)) ? Number(value) : fallback));
  const normalizeBlock = (block, index) => {
    const type = String(block.type || "").trim();
    const base = {
      id: String(block.id || makeId("layout-block")).trim() || makeId("layout-block"),
      type,
      title: String(block.title || "").trim(),
      enabled: block.enabled !== false,
      sortOrder: Number.isFinite(Number(block.sortOrder)) ? Number(block.sortOrder) : index
    };

    if (type === "banner") {
      return {
        ...base,
        title: base.title || "賣場看板",
        imageUrls: uniqueStringList(block.imageUrls),
        linkUrl: String(block.linkUrl || "").trim()
      };
    }
    if (type === "notice") {
      return {
        ...base,
        title: base.title || "賣場公告",
        text: String(block.text || "").trim()
      };
    }
    if (type === "category-grid") {
      return {
        ...base,
        title: base.title || "分類區",
        categoryIds: uniqueStringList(block.categoryIds, categoryIds),
        columns: Math.min(6, Math.max(3, Number.isFinite(Number(block.columns)) ? Number(block.columns) : 5))
      };
    }
    if (type === "featured-products") {
      return {
        ...base,
        title: base.title || "主打商品",
        productIds: uniqueStringList(block.productIds, productIds),
        limit: normalizeLimit(block.limit)
      };
    }
    if (type === "new-products") {
      return {
        ...base,
        title: base.title || "新上架",
        limit: normalizeLimit(block.limit)
      };
    }
    if (type === "hot-products") {
      return {
        ...base,
        title: base.title || "熱銷商品",
        limit: normalizeLimit(block.limit)
      };
    }
    return null;
  };

  let blocks = sourceBlocks.map(normalizeBlock).filter(Boolean);
  if (!blocks.length) blocks = defaultStoreLayout.blocks.map((block, index) => normalizeBlock(block, index)).filter(Boolean);

  const layoutVersion = Number(layout?.version || 0);
  const hasOnlyOldCategoryBlock = layoutVersion < 2 &&
    blocks.length === 1 &&
    blocks[0].type === "category-grid" &&
    blocks[0].id === "category-grid-default";
  if (hasOnlyOldCategoryBlock) {
    const oldCategoryBlock = blocks[0];
    blocks = defaultStoreLayout.blocks.map((block, index) => {
      if (block.type === "category-grid") return normalizeBlock({ ...block, ...oldCategoryBlock, sortOrder: index }, index);
      return normalizeBlock({ ...block, sortOrder: index }, index);
    }).filter(Boolean);
  }

  blocks.sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    version: defaultStoreLayout.version,
    blocks: blocks.map((block, index) => ({ ...block, sortOrder: index }))
  };
}

async function readCatalog() {
  return normalizeCatalog(await readJson(catalogFile, defaultCatalog));
}

async function writeCatalog(catalog) {
  return writeJson(catalogFile, normalizeCatalog(catalog));
}

async function readStoreLayout() {
  const catalog = await readCatalog();
  return normalizeStoreLayout(await readJson(storeLayoutFile, defaultStoreLayout), catalog);
}

async function writeStoreLayout(layout) {
  const catalog = await readCatalog();
  return writeJson(storeLayoutFile, normalizeStoreLayout(layout, catalog));
}

async function readMallbicSyncStatus() {
  return {
    ...defaultMallbicSyncStatus,
    ...await readJson(mallbicSyncFile, defaultMallbicSyncStatus),
    enabled: mallbicAutoSyncEnabled,
    intervalMs: mallbicAutoSyncIntervalMs,
    running: mallbicSyncRunning
  };
}

async function writeMallbicSyncStatus(status) {
  const nextStatus = {
    ...defaultMallbicSyncStatus,
    ...status,
    enabled: mallbicAutoSyncEnabled,
    intervalMs: mallbicAutoSyncIntervalMs,
    running: typeof status.running === "boolean" ? status.running : mallbicSyncRunning
  };
  await writeJson(mallbicSyncFile, nextStatus);
  return nextStatus;
}

async function readMallbicOrderSyncStatus() {
  return {
    ...defaultMallbicOrderSyncStatus,
    ...await readJson(mallbicOrderSyncFile, defaultMallbicOrderSyncStatus),
    enabled: mallbicOrderAutoSyncEnabled,
    intervalMs: mallbicOrderAutoSyncIntervalMs,
    running: mallbicOrderSyncRunning
  };
}

async function writeMallbicOrderSyncStatus(status) {
  const nextStatus = {
    ...defaultMallbicOrderSyncStatus,
    ...status,
    enabled: mallbicOrderAutoSyncEnabled,
    intervalMs: mallbicOrderAutoSyncIntervalMs,
    running: typeof status.running === "boolean" ? status.running : mallbicOrderSyncRunning
  };
  await writeJson(mallbicOrderSyncFile, nextStatus);
  return nextStatus;
}

async function readMyshipOrderSyncStatus() {
  return {
    ...defaultMyshipOrderSyncStatus,
    ...await readJson(myshipOrderSyncFile, defaultMyshipOrderSyncStatus),
    enabled: myshipAutoOrderEnabled,
    intervalMs: myshipAutoOrderIntervalMs,
    running: myshipOrderSyncRunning
  };
}

async function writeMyshipOrderSyncStatus(status) {
  const nextStatus = {
    ...defaultMyshipOrderSyncStatus,
    ...status,
    enabled: myshipAutoOrderEnabled,
    intervalMs: myshipAutoOrderIntervalMs,
    running: typeof status.running === "boolean" ? status.running : myshipOrderSyncRunning
  };
  await writeJson(myshipOrderSyncFile, nextStatus);
  return nextStatus;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "未知錯誤");
}

function parseEnvFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function isEcpayMapEnabled() {
  return Boolean(ecpayMerchantId && ecpayHashKey && ecpayHashIv);
}

function missingEcpayMapKeys() {
  return [
    ["ECPAY_MERCHANT_ID", ecpayMerchantId],
    ["ECPAY_HASH_KEY", ecpayHashKey],
    ["ECPAY_HASH_IV", ecpayHashIv]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function buildPublicUrl(req, pathname) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configuredBaseUrl) return `${configuredBaseUrl}${pathname}`;
  return `${req.protocol}://${req.get("host")}${pathname}`;
}

function encodeEcpayCheckMacValue(value) {
  return encodeURIComponent(value)
    .toLowerCase()
    .replaceAll("%20", "+")
    .replaceAll("%2d", "-")
    .replaceAll("%5f", "_")
    .replaceAll("%2e", ".")
    .replaceAll("%21", "!")
    .replaceAll("%2a", "*")
    .replaceAll("%28", "(")
    .replaceAll("%29", ")");
}

function createEcpayCheckMacValue(fields) {
  const sortedKeys = Object.keys(fields).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const sortedPayload = sortedKeys.map((key) => `${key}=${fields[key]}`).join("&");
  const raw = `HashKey=${ecpayHashKey}&${sortedPayload}&HashIV=${ecpayHashIv}`;
  return crypto.createHash("md5").update(encodeEcpayCheckMacValue(raw)).digest("hex").toUpperCase();
}

function buildEcpayTradeNo() {
  return `MAP${Date.now().toString(36).toUpperCase()}${crypto.randomInt(1000, 9999)}`.slice(0, 20);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function createSessionToken(payload = {}, maxAgeSeconds = 60 * 60 * 24) {
  const encodedPayload = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + maxAgeSeconds * 1000
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function decodeSessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function verifySessionToken(token) {
  return Boolean(decodeSessionToken(token));
}

function isAdminAuthenticated(req) {
  return verifySessionToken(parseCookies(req).admin_session);
}

function isHttpsRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function buildNamedSessionCookie(req, name, value, maxAge = 60 * 60 * 24) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure
  ].join("; ");
}

function buildSessionCookie(req, value, maxAge = 60 * 60 * 24) {
  return buildNamedSessionCookie(req, "admin_session", value, maxAge);
}

function buildBuyerSessionCookie(req, value, maxAge = 60 * 60 * 24 * 30) {
  return buildNamedSessionCookie(req, "buyer_session", value, maxAge);
}

function requireAdminPage(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  res.redirect("/login.html");
}

function requireAdminApi(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  res.status(401).json({ message: "請先登入後台" });
}

async function getBuyerFromRequest(req) {
  const session = decodeSessionToken(parseCookies(req).buyer_session);
  if (!session?.buyerId) return null;

  const buyers = await readBuyers();
  return buyers.find((buyer) => buyer.id === session.buyerId) || null;
}

async function requireBuyerApi(req, res, next) {
  const buyer = await getBuyerFromRequest(req);
  if (!buyer) return res.status(401).json({ message: "請先登入買家帳號" });

  req.buyer = buyer;
  next();
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
  const categoryId = String(input.categoryId || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const description = String(input.description || "").trim();
  const variants = Array.isArray(input.variants) ? input.variants : [];

  if (!name) throw new Error("請填寫商品名稱");
  if (variants.length === 0) throw new Error("請至少建立一個品項");

  return {
    id: existingId || input.id || makeId("product"),
    name,
    categoryId,
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

function findCatalogItemAnyStatus(catalog, marketId, productId, variantId) {
  const market = catalog.markets.find((entry) => entry.id === marketId);
  const product = market?.products.find((entry) => entry.id === productId);
  const variant = product?.variants.find((entry) => entry.id === variantId);
  return { market, product, variant };
}

function buildOrderSummary(order) {
  const lines = order.items
    .map((item) => `${item.productName} - ${item.variantName} x ${item.quantity}`)
    .join("\n");
  const shippingLine = Number(order.shippingFee || 0) > 0 ? `\n運費：NT$${order.shippingFee}` : "";
  return `訂單已建立：${order.id}\n${lines}${shippingLine}\n總金額：NT$${order.totalAmount}`;
}

const buyerCancelableStatuses = new Set(["pending", "processing"]);

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function publicBuyerView(buyer) {
  return {
    id: buyer.id,
    name: buyer.name,
    phone: buyer.phone
  };
}

function cleanChatText(value) {
  return String(value || "").trim().slice(0, 2000);
}

function updateConversationBuyer(conversation, buyer) {
  conversation.buyerId = buyer.id;
  conversation.buyerName = buyer.name || "";
  conversation.buyerPhone = buyer.phone || "";
}

function findOrCreateConversation(chats, buyer) {
  let conversation = chats.find((chat) => chat.buyerId === buyer.id);
  if (!conversation) {
    conversation = {
      buyerId: buyer.id,
      buyerName: buyer.name || "",
      buyerPhone: buyer.phone || "",
      sellerUnreadCount: 0,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    chats.push(conversation);
  }

  updateConversationBuyer(conversation, buyer);
  return conversation;
}

function appendChatMessage(conversation, sender, text, orderId = "") {
  const now = new Date().toISOString();
  const message = {
    id: makeId("MSG"),
    sender,
    text,
    orderId: String(orderId || "").trim(),
    createdAt: now,
    readByBuyerAt: ""
  };
  conversation.messages.push(message);
  conversation.updatedAt = now;
  if (sender === "buyer") conversation.sellerUnreadCount = Math.max(0, Number(conversation.sellerUnreadCount || 0)) + 1;
  return message;
}

function markSellerMessagesReadByBuyer(conversation) {
  const now = new Date().toISOString();
  let changed = false;

  for (const message of conversation.messages || []) {
    if (message.sender === "seller" && !message.readByBuyerAt) {
      message.readByBuyerAt = now;
      changed = true;
    }
  }

  if (changed) conversation.updatedAt = now;
  return changed;
}

function sendAdminChatEvent(res, eventName, payload = {}) {
  adminChatEventId += 1;
  res.write(`id: ${adminChatEventId}\n`);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function notifyAdminChatClients(reason, payload = {}) {
  for (const client of adminChatClients) {
    try {
      sendAdminChatEvent(client, "chat", {
        reason,
        at: new Date().toISOString(),
        ...payload
      });
    } catch {
      adminChatClients.delete(client);
    }
  }
}

function publicBuyerChatView(conversation) {
  return {
    buyer: {
      id: conversation.buyerId,
      name: conversation.buyerName,
      phone: conversation.buyerPhone
    },
    messages: conversation.messages || [],
    updatedAt: conversation.updatedAt || ""
  };
}

function publicAdminChatListView(conversation) {
  const messages = conversation.messages || [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  return {
    buyerId: conversation.buyerId,
    buyerName: conversation.buyerName || "",
    buyerPhone: conversation.buyerPhone || "",
    sellerUnreadCount: conversation.sellerUnreadCount || 0,
    lastMessage,
    updatedAt: conversation.updatedAt || ""
  };
}

function publicAdminChatView(conversation) {
  return {
    ...publicAdminChatListView(conversation),
    messages: conversation.messages || []
  };
}

function hashBuyerPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("base64url");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyBuyerPassword(password, storedHash) {
  const [method, salt, hash] = String(storedHash || "").split("$");
  if (method !== "pbkdf2" || !salt || !hash) return false;

  const candidate = hashBuyerPassword(password, salt).split("$")[2];
  const candidateBuffer = Buffer.from(candidate);
  const hashBuffer = Buffer.from(hash);
  return candidateBuffer.length === hashBuffer.length && crypto.timingSafeEqual(candidateBuffer, hashBuffer);
}

function validateBuyerInput({ name = "", phone = "", password = "" }, { requireName = false } = {}) {
  const cleanName = String(name || "").trim();
  const cleanPhone = String(phone || "").trim();
  const phoneNormalized = normalizePhone(cleanPhone);
  const cleanPassword = String(password || "");

  if (requireName && !cleanName) return { error: "請輸入姓名" };
  if (phoneNormalized.length < 8) return { error: "請輸入正確的手機號碼" };
  if (cleanPassword.length < 6) return { error: "密碼至少需要 6 個字" };

  return { name: cleanName, phone: cleanPhone, phoneNormalized, password: cleanPassword };
}

function canBuyerRequestCancelOrder(order) {
  return buyerCancelableStatuses.has(order.status) && order.cancelRequest?.status !== "pending";
}

function publicOrderView(order) {
  return {
    id: order.id,
    customerName: order.customerName || "",
    phone: order.phone || "",
    deliveryMethod: order.deliveryMethod || "",
    deliveryAddress: order.deliveryAddress || "",
    sevenElevenStore: order.sevenElevenStore || null,
    note: order.note || "",
    items: order.items || [],
    productTotal: order.productTotal || Math.max(0, Number(order.totalAmount || 0) - Number(order.shippingFee || 0)),
    shippingFee: order.shippingFee || 0,
    totalAmount: order.totalAmount || 0,
    status: order.status || "pending",
    cancelRequest: normalizeCancelRequest(order.cancelRequest),
    canCancel: canBuyerRequestCancelOrder(order),
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || "",
    cancelledAt: order.cancelledAt || ""
  };
}

function findBuyerOrders(orders, { phone, orderId = "" }) {
  const cleanPhone = normalizePhone(phone);
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanPhone) return [];

  return orders
    .filter((order) => normalizePhone(order.phone) === cleanPhone)
    .filter((order) => !cleanOrderId || order.id === cleanOrderId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function prepareCancelledOrder(order, actor = "buyer") {
  const now = new Date().toISOString();
  order.status = "cancelled";
  order.updatedAt = now;
  order.cancelledAt = order.cancelledAt || order.updatedAt;
  order.cancelledBy = actor;
  order.cancelRequest = normalizeCancelRequest(order.cancelRequest);
  if (order.cancelRequest.status === "pending") {
    order.cancelRequest.status = "approved";
    order.cancelRequest.resolvedAt = now;
    order.cancelRequest.resolvedBy = actor;
  }
  order.mallbic = normalizeOrderMallbicSync(order);

  if (order.mallbic.importStatus === "imported" && order.mallbic.cancelStatus !== "cancelled") {
    order.mallbic.cancelStatus = "pending";
    order.mallbic.cancelError = "";
  } else if (order.mallbic.importStatus !== "imported") {
    order.mallbic.importStatus = "skipped";
    order.mallbic.importError = "";
    order.mallbic.cancelStatus = "notNeeded";
  }
}

function requestCancelOrder(order, actor = "buyer") {
  const now = new Date().toISOString();
  order.cancelRequest = {
    status: "pending",
    requestedAt: now,
    requestedBy: actor,
    resolvedAt: "",
    resolvedBy: "",
    note: ""
  };
  order.updatedAt = now;
}

function rejectCancelRequest(order, actor = "admin") {
  const now = new Date().toISOString();
  order.cancelRequest = {
    ...normalizeCancelRequest(order.cancelRequest),
    status: "rejected",
    resolvedAt: now,
    resolvedBy: actor
  };
  order.updatedAt = now;
}

function restoreOrderStock(catalog, order) {
  if (order.stockRestoredAt) return 0;

  let restoredCount = 0;
  for (const item of order.items || []) {
    const { variant } = findCatalogItemAnyStatus(catalog, item.marketId, item.productId, item.variantId);
    if (!variant) continue;
    variant.stock = Number(variant.stock || 0) + Number(item.quantity || 0);
    restoredCount += Number(item.quantity || 0);
  }

  order.stockRestoredAt = new Date().toISOString();
  return restoredCount;
}

function buildAdminStats(orders, catalog, query) {
  const now = new Date();
  const from = parseStatsDate(query.from, false);
  const to = parseStatsDate(query.to, true);
  const statusFilter = normalizeStatsStatusFilter(query.status);
  const variantLookup = buildVariantLookup(catalog);
  const filteredOrders = orders.filter((order) => {
    const createdAt = getOrderCreatedAt(order);
    if (from && createdAt < from.getTime()) return false;
    if (to && createdAt > to.getTime()) return false;
    if (statusFilter !== "all" && normalizeOrderStatus(order.status) !== statusFilter) return false;
    return true;
  });

  const summary = {
    orderCount: filteredOrders.length,
    activeOrderCount: 0,
    cancelledOrderCount: 0,
    pendingOrderCount: 0,
    processingOrderCount: 0,
    shippedOrderCount: 0,
    cancelRequestCount: 0,
    revenue: 0,
    productRevenue: 0,
    shippingRevenue: 0,
    cancelledRevenue: 0,
    itemQuantity: 0,
    buyerCount: 0,
    averageOrderValue: 0
  };

  const buyerKeys = new Set();
  const statusMap = new Map();
  const deliveryMap = new Map();
  const dailyMap = new Map();
  const itemMap = new Map();

  for (const order of filteredOrders) {
    const status = normalizeOrderStatus(order.status);
    const isCancelled = status === "cancelled";
    const totalAmount = getOrderTotalAmount(order);
    const productTotal = getOrderProductTotal(order);
    const shippingFee = getOrderShippingFee(order);
    const quantity = getOrderItemQuantity(order);
    const deliveryMethod = String(order.deliveryMethod || "未填寫").trim() || "未填寫";
    const dayKey = formatStatsDateKey(order.createdAt);
    const buyerKey = order.buyerId || normalizePhone(order.phone) || order.phone || order.customerName || "";

    if (buyerKey) buyerKeys.add(buyerKey);
    if (order.cancelRequest?.status === "pending") summary.cancelRequestCount += 1;

    summary[`${status}OrderCount`] = Number(summary[`${status}OrderCount`] || 0) + 1;
    if (isCancelled) {
      summary.cancelledRevenue += totalAmount;
    } else {
      summary.activeOrderCount += 1;
      summary.revenue += totalAmount;
      summary.productRevenue += productTotal;
      summary.shippingRevenue += shippingFee;
      summary.itemQuantity += quantity;
    }

    addStatsBucket(statusMap, status, {
      label: getOrderStatusLabel(status),
      count: 1,
      revenue: isCancelled ? 0 : totalAmount,
      quantity: isCancelled ? 0 : quantity
    });
    addStatsBucket(deliveryMap, deliveryMethod, {
      label: deliveryMethod,
      count: 1,
      revenue: isCancelled ? 0 : totalAmount,
      quantity: isCancelled ? 0 : quantity
    });
    addStatsBucket(dailyMap, dayKey, {
      label: dayKey,
      count: isCancelled ? 0 : 1,
      revenue: isCancelled ? 0 : totalAmount,
      quantity: isCancelled ? 0 : quantity
    });

    if (!isCancelled) {
      for (const item of order.items || []) {
        const lookupKey = item.variantId || item.barcode || `${item.productId || ""}:${item.variantName || ""}`;
        const catalogVariant = variantLookup.get(item.variantId) || variantLookup.get(item.barcode) || {};
        const quantityValue = Math.max(0, Number(item.quantity || 0));
        const revenueValue = Number.isFinite(Number(item.subtotal))
          ? Math.max(0, Number(item.subtotal || 0))
          : Math.max(0, Number(item.price || 0)) * quantityValue;
        const current = itemMap.get(lookupKey) || {
          key: lookupKey,
          marketName: item.marketName || catalogVariant.marketName || "",
          productName: item.productName || catalogVariant.productName || "",
          variantName: item.variantName || catalogVariant.variantName || "",
          barcode: item.barcode || catalogVariant.barcode || "",
          imageUrl: item.variantImageUrl || catalogVariant.imageUrl || "",
          stock: Number.isFinite(Number(catalogVariant.stock)) ? Number(catalogVariant.stock) : null,
          quantity: 0,
          revenue: 0,
          orderIds: new Set()
        };
        current.quantity += quantityValue;
        current.revenue += revenueValue;
        current.orderIds.add(order.id);
        itemMap.set(lookupKey, current);
      }
    }
  }

  summary.buyerCount = buyerKeys.size;
  summary.cancelledOrderCount = filteredOrders.filter((order) => normalizeOrderStatus(order.status) === "cancelled").length;
  summary.averageOrderValue = summary.activeOrderCount ? Math.round(summary.revenue / summary.activeOrderCount) : 0;

  return {
    generatedAt: now.toISOString(),
    filters: {
      from: query.from || "",
      to: query.to || "",
      status: statusFilter
    },
    summary,
    statusBreakdown: buildStatsList(statusMap, ["pending", "processing", "shipped", "cancelled"]),
    deliveryBreakdown: buildStatsList(deliveryMap),
    dailySales: buildStatsList(dailyMap).sort((a, b) => String(a.key).localeCompare(String(b.key))),
    topItems: [...itemMap.values()]
      .map((item) => ({
        ...item,
        orderCount: item.orderIds.size,
        orderIds: undefined
      }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
      .slice(0, 30),
    recentOrders: filteredOrders
      .slice()
      .sort((a, b) => getOrderCreatedAt(b) - getOrderCreatedAt(a))
      .slice(0, 20)
      .map((order) => ({
        id: order.id,
        customerName: order.customerName || "",
        phone: order.phone || "",
        status: normalizeOrderStatus(order.status),
        deliveryMethod: order.deliveryMethod || "",
        totalAmount: getOrderTotalAmount(order),
        itemQuantity: getOrderItemQuantity(order),
        createdAt: order.createdAt || "",
        mallbicImportStatus: order.mallbic?.importStatus || "",
        myshipCreateStatus: order.myship?.createStatus || ""
      }))
  };
}

function parseStatsDate(value, endOfDay) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timePart = endOfDay ? "T23:59:59.999+08:00" : "T00:00:00.000+08:00";
  const date = new Date(`${text}${timePart}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeStatsStatusFilter(value) {
  const text = String(value || "all").trim();
  if (text === "all") return "all";
  return normalizeOrderStatus(text);
}

function buildVariantLookup(catalog) {
  const lookup = new Map();
  for (const market of catalog.markets || []) {
    for (const product of market.products || []) {
      for (const variant of product.variants || []) {
        const value = {
          marketName: market.name || "",
          productName: product.name || "",
          variantName: variant.name || "",
          barcode: variant.barcode || "",
          imageUrl: variant.imageUrl || product.imageUrl || "",
          stock: Number(variant.stock || 0)
        };
        if (variant.id) lookup.set(variant.id, value);
        if (variant.barcode) lookup.set(variant.barcode, value);
      }
    }
  }
  return lookup;
}

function getOrderCreatedAt(order) {
  const time = new Date(order.createdAt || order.updatedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getOrderTotalAmount(order) {
  const total = Number(order.totalAmount);
  if (Number.isFinite(total) && total >= 0) return total;
  return getOrderProductTotal(order) + getOrderShippingFee(order);
}

function getOrderProductTotal(order) {
  const productTotal = Number(order.productTotal);
  if (Number.isFinite(productTotal) && productTotal >= 0) return productTotal;
  return (order.items || []).reduce((sum, item) => {
    const subtotal = Number(item.subtotal);
    if (Number.isFinite(subtotal) && subtotal >= 0) return sum + subtotal;
    return sum + Math.max(0, Number(item.price || 0)) * Math.max(0, Number(item.quantity || 0));
  }, 0);
}

function getOrderShippingFee(order) {
  const shippingFee = Number(order.shippingFee);
  return Number.isFinite(shippingFee) && shippingFee >= 0 ? shippingFee : 0;
}

function getOrderItemQuantity(order) {
  return (order.items || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0);
}

function getOrderStatusLabel(status) {
  return {
    pending: "新訂單",
    processing: "處理中",
    shipped: "已出貨",
    cancelled: "取消"
  }[normalizeOrderStatus(status)] || "新訂單";
}

function formatStatsDateKey(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "未填日期";
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

function addStatsBucket(map, key, value) {
  const bucket = map.get(key) || {
    key,
    label: value.label || key,
    count: 0,
    revenue: 0,
    quantity: 0
  };
  bucket.count += Number(value.count || 0);
  bucket.revenue += Number(value.revenue || 0);
  bucket.quantity += Number(value.quantity || 0);
  map.set(key, bucket);
}

function buildStatsList(map, order = null) {
  const list = [...map.values()];
  if (Array.isArray(order)) {
    const orderIndex = new Map(order.map((key, index) => [key, index]));
    return list.sort((a, b) => (orderIndex.get(a.key) ?? 999) - (orderIndex.get(b.key) ?? 999));
  }
  return list.sort((a, b) => b.revenue - a.revenue || b.count - a.count || String(a.label).localeCompare(String(b.label), "zh-Hant"));
}

app.get("/api/config", (_req, res) => {
  res.json({ liffId: process.env.LIFF_ID || "" });
});

app.get("/api/logistics/ecpay-map-status", (req, res) => {
  const missingKeys = missingEcpayMapKeys();
  res.json({
    enabled: missingKeys.length === 0,
    missingKeys,
    logisticsSubType: ecpayLogisticsSubType,
    replyUrl: buildPublicUrl(req, "/api/logistics/ecpay-store-callback")
  });
});

app.post("/api/logistics/ecpay-map", (req, res) => {
  const missingKeys = missingEcpayMapKeys();
  if (!isEcpayMapEnabled()) {
    return res.json({
      enabled: false,
      missingKeys,
      fallbackUrl: sevenElevenFallbackMapUrl,
      message: `Render 尚未讀到綠界電子地圖金鑰：${missingKeys.join("、")}。請確認已儲存後重新部署。`
    });
  }

  const device = String(req.body?.device || "").trim() || (/Mobile|Android|iPhone|iPad/i.test(req.headers["user-agent"] || "") ? "1" : "0");
  const fields = {
    MerchantID: ecpayMerchantId,
    MerchantTradeNo: buildEcpayTradeNo(),
    LogisticsType: "CVS",
    LogisticsSubType: ecpayLogisticsSubType,
    IsCollection: "N",
    ServerReplyURL: buildPublicUrl(req, "/api/logistics/ecpay-store-callback"),
    ExtraData: "cart",
    Device: device === "1" ? "1" : "0"
  };
  fields.CheckMacValue = createEcpayCheckMacValue(fields);

  res.json({ enabled: true, action: ecpayLogisticsMapUrl, fields });
});

app.post("/api/logistics/ecpay-store-callback", (req, res) => {
  const store = {
    id: String(req.body?.CVSStoreID || "").trim(),
    name: String(req.body?.CVSStoreName || "").trim(),
    address: String(req.body?.CVSAddress || "").trim(),
    telephone: String(req.body?.CVSTelephone || "").trim(),
    logisticsSubType: String(req.body?.LogisticsSubType || "").trim()
  };
  const storeJson = JSON.stringify(store).replaceAll("<", "\\u003c");

  res.type("html").send(`<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>已選擇 7-11 門市</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f1ea; color: #0f1f1a; margin: 0; padding: 40px 20px; }
      main { max-width: 520px; margin: 0 auto; background: #fffdf8; border: 1px solid #d8d0c4; border-radius: 8px; padding: 24px; }
      a { color: #127a64; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>已選擇 7-11 門市</h1>
      <p>${htmlEscape(store.name || "門市")} ${store.address ? `｜${htmlEscape(store.address)}` : ""}</p>
      <p>正在回到購物車...</p>
      <p><a href="/cart.html?store=selected">沒有自動跳轉時點這裡</a></p>
    </main>
    <script>
      sessionStorage.setItem("line-slipper-selected-seven-eleven-store", ${JSON.stringify(storeJson)});
      location.replace("/cart.html?store=selected");
    </script>
  </body>
</html>`);
});

app.get("/api/markets", async (_req, res) => {
  const catalog = await readCatalog();
  const activeMarkets = catalog.markets.filter((market) => market.isActive !== false);
  res.json({
    categories: catalog.categories.filter((category) => category.isActive !== false),
    markets: activeMarkets.length ? activeMarkets : catalog.markets.slice(0, 1)
  });
});

app.get("/api/store-layout", async (_req, res) => {
  res.json(await readStoreLayout());
});

app.get("/api/admin/catalog", async (_req, res) => {
  res.json(await readCatalog());
});

app.get("/api/admin/store-layout", async (_req, res) => {
  res.json(await readStoreLayout());
});

app.put("/api/admin/store-layout", async (req, res) => {
  await writeStoreLayout(req.body || {});
  res.json(await readStoreLayout());
});

app.post("/api/admin/categories", async (req, res) => {
  const catalog = await readCatalog();
  const name = String(req.body.name || "").trim();
  const parentId = String(req.body.parentId || "").trim();
  if (!name) return res.status(400).json({ message: "請填寫分類名稱" });
  if (parentId && !catalog.categories.some((entry) => entry.id === parentId)) {
    return res.status(400).json({ message: "找不到上層分類" });
  }

  const category = {
    id: makeId("category"),
    name,
    imageUrl: String(req.body.imageUrl || "").trim(),
    isActive: req.body.isActive !== false,
    parentId,
    sortOrder: Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : catalog.categories.length
  };
  catalog.categories.push(category);
  await writeCatalog(catalog);
  res.status(201).json({ category });
});

app.put("/api/admin/categories/reorder", async (req, res) => {
  const catalog = await readCatalog();
  const updates = Array.isArray(req.body?.categories) ? req.body.categories : [];
  const categoryIds = new Set(catalog.categories.map((category) => category.id));
  if (updates.length !== catalog.categories.length) {
    return res.status(400).json({ message: "分類排序資料不完整" });
  }

  const seenIds = new Set();
  const updateMap = new Map();
  for (const update of updates) {
    const id = String(update.id || "").trim();
    const parentId = String(update.parentId || "").trim();
    const sortOrder = Number(update.sortOrder);
    if (!categoryIds.has(id)) return res.status(400).json({ message: "分類不存在" });
    if (seenIds.has(id)) return res.status(400).json({ message: "分類排序資料重複" });
    if (parentId && !categoryIds.has(parentId)) return res.status(400).json({ message: "上層分類不存在" });
    if (parentId === id) return res.status(400).json({ message: "分類不能放到自己底下" });
    seenIds.add(id);
    updateMap.set(id, {
      parentId,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0
    });
  }

  for (const category of catalog.categories) {
    let ancestorId = updateMap.get(category.id)?.parentId || "";
    const visited = new Set([category.id]);
    while (ancestorId) {
      if (visited.has(ancestorId)) {
        return res.status(400).json({ message: "分類不能放到自己的子分類底下" });
      }
      visited.add(ancestorId);
      ancestorId = updateMap.get(ancestorId)?.parentId || "";
    }
  }

  for (const category of catalog.categories) {
    const update = updateMap.get(category.id);
    category.parentId = update.parentId;
    category.sortOrder = update.sortOrder;
  }

  await writeCatalog(catalog);
  res.json({ categories: catalog.categories });
});

app.put("/api/admin/categories/:categoryId", async (req, res) => {
  const catalog = await readCatalog();
  const category = catalog.categories.find((entry) => entry.id === req.params.categoryId);
  if (!category) return res.status(404).json({ message: "找不到分類" });

  const name = String(req.body.name || "").trim();
  const parentId = String(req.body.parentId || "").trim();
  if (!name) return res.status(400).json({ message: "請填寫分類名稱" });
  if (parentId === category.id) return res.status(400).json({ message: "上層分類不能選自己" });
  if (parentId && !catalog.categories.some((entry) => entry.id === parentId)) {
    return res.status(400).json({ message: "找不到上層分類" });
  }
  let ancestorId = parentId;
  while (ancestorId) {
    if (ancestorId === category.id) return res.status(400).json({ message: "上層分類不能選自己的子分類" });
    ancestorId = catalog.categories.find((entry) => entry.id === ancestorId)?.parentId || "";
  }

  category.name = name;
  category.imageUrl = String(req.body.imageUrl || "").trim();
  category.isActive = req.body.isActive !== false;
  category.parentId = parentId;
  category.sortOrder = Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : category.sortOrder;
  await writeCatalog(catalog);
  res.json({ category });
});

app.delete("/api/admin/categories/:categoryId", async (req, res) => {
  const catalog = await readCatalog();
  if (catalog.categories.length <= 1) return res.status(400).json({ message: "至少要保留一個分類" });
  const exists = catalog.categories.some((entry) => entry.id === req.params.categoryId);
  if (!exists) return res.status(404).json({ message: "找不到分類" });

  catalog.categories = catalog.categories.filter((entry) => entry.id !== req.params.categoryId);
  const fallbackCategoryId = catalog.categories[0]?.id || "default-category";
  for (const category of catalog.categories) {
    if (category.parentId === req.params.categoryId) category.parentId = "";
  }
  for (const market of catalog.markets) {
    for (const product of market.products || []) {
      if (product.categoryId === req.params.categoryId) product.categoryId = fallbackCategoryId;
    }
  }
  await writeCatalog(catalog);
  res.sendStatus(204);
});

app.get("/api/admin/stats", async (req, res) => {
  const orders = await readOrders();
  const catalog = await readCatalog();
  res.json(buildAdminStats(orders, catalog, req.query || {}));
});

app.post("/api/admin/markets", async (req, res) => {
  const catalog = await readCatalog();
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "請填寫賣場名稱" });

  const market = catalog.markets[0];
  market.name = name;
  market.imageUrl = String(req.body.imageUrl || "").trim();
  market.description = String(req.body.description || "").trim();
  market.isActive = req.body.isActive !== false;
  await writeCatalog(catalog);
  res.json({ market });
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
  res.status(400).json({ message: "系統只保留一個賣場，不能刪除" });
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

app.put("/api/admin/products/bulk-category", async (req, res) => {
  const catalog = await readCatalog();
  const productIds = Array.isArray(req.body.productIds)
    ? req.body.productIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const categoryId = String(req.body.categoryId || "").trim();

  if (productIds.length === 0) return res.status(400).json({ message: "請先勾選商品" });
  if (!catalog.categories.some((category) => category.id === categoryId)) {
    return res.status(400).json({ message: "找不到目標分類" });
  }

  const selectedIds = new Set(productIds);
  const moved = [];
  for (const market of catalog.markets) {
    for (const product of market.products || []) {
      if (!selectedIds.has(product.id)) continue;
      product.categoryId = categoryId;
      moved.push(product.id);
    }
  }

  if (moved.length === 0) return res.status(404).json({ message: "找不到可移動的商品" });
  await writeCatalog(catalog);
  res.json({ movedCount: moved.length, categoryId });
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

  const buffer = Buffer.from(String(fileBase64).split(",").pop(), "base64");
  const parsed = parseInventoryWorkbook(buffer);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const catalog = await readCatalog();
  const result = applyInventoryItems(catalog, parsed.items);

  await writeCatalog(catalog);
  res.json({
    importedRows: parsed.items.length,
    sourceSheet: parsed.sourceSheet,
    ...result
  });
});

app.post("/api/admin/mallbic/sync-inventory", async (_req, res) => {
  if (mallbicSyncRunning) {
    return res.status(409).json({ message: "墨筆克同步正在執行中，請稍後再試" });
  }

  try {
    res.json(await runMallbicInventorySync("manual"));
  } catch (error) {
    console.error("Mallbic inventory sync failed:", error);
    res.status(500).json({ message: `墨筆克同步失敗：${getErrorMessage(error)}` });
  }
});

app.get("/api/admin/mallbic/sync-status", async (_req, res) => {
  res.json(await readMallbicSyncStatus());
});

app.post("/api/admin/mallbic/sync-orders", async (_req, res) => {
  if (mallbicOrderSyncRunning) {
    return res.status(409).json({ message: "墨筆克訂單同步正在執行中，請稍後再試" });
  }

  try {
    res.json(await runMallbicOrderSync("manual"));
  } catch (error) {
    console.error("Mallbic order sync failed:", error);
    res.status(500).json({ message: `墨筆克訂單同步失敗：${getErrorMessage(error)}` });
  }
});

app.post("/api/admin/mallbic/update-order-statuses", async (_req, res) => {
  if (mallbicOrderSyncRunning || mallbicOrderStatusSyncRunning) {
    return res.status(409).json({ message: "墨筆克訂單狀態更新正在執行中，請稍後再試" });
  }

  try {
    res.json(await runMallbicOrderStatusSync("manual"));
  } catch (error) {
    console.error("Mallbic order status sync failed:", error);
    res.status(500).json({ message: `墨筆克訂單狀態更新失敗：${getErrorMessage(error)}` });
  }
});

app.get("/api/admin/mallbic/order-sync-status", async (_req, res) => {
  const orders = await readOrders();
  const pendingImport = orders.filter((order) => shouldImportOrderToMallbic(order)).length;
  const pendingCancel = orders.filter((order) => shouldCancelOrderInMallbic(order)).length;
  const pendingStatusUpdate = orders.filter((order) => shouldUpdateOrderStatusFromMallbic(order)).length;
  res.json({
    ...await readMallbicOrderSyncStatus(),
    pendingImport,
    pendingCancel,
    pendingStatusUpdate,
    statusUpdateRunning: mallbicOrderStatusSyncRunning
  });
});

app.post("/api/admin/myship/create-orders", async (_req, res) => {
  if (myshipOrderSyncRunning) {
    return res.status(409).json({ message: "賣貨便建單正在執行中，請稍後再試" });
  }

  try {
    res.json(await runMyshipOrderSync("manual"));
  } catch (error) {
    console.error("MyShip order sync failed:", error);
    res.status(500).json({ message: `賣貨便建單失敗：${getErrorMessage(error)}` });
  }
});

app.post("/api/admin/myship/open-login-window", async (_req, res) => {
  try {
    res.json(await openMyshipLoginWindow());
  } catch (error) {
    console.error("MyShip login window failed:", error);
    res.status(500).json({ message: `賣貨便登入視窗開啟失敗：${getErrorMessage(error)}` });
  }
});

app.get("/api/admin/myship/order-sync-status", async (_req, res) => {
  const orders = await readOrders();
  res.json({
    ...await readMyshipOrderSyncStatus(),
    pendingCreate: orders.filter((order) => shouldCreateOrderInMyship(order)).length,
    productUrl: myshipProductUrl,
    amountSource: myshipAmountSource,
    missingKeys: missingMyshipKeys(),
    credentialHint: {
      facebookAccountSet: Boolean(myshipFacebookEmail),
      facebookAccountLength: myshipFacebookEmail.length,
      facebookPasswordSet: Boolean(myshipFacebookPassword),
      facebookPasswordLength: myshipFacebookPassword.length
    }
  });
});

app.get("/api/admin/myship/screenshots/:filename", async (req, res) => {
  const filename = path.basename(String(req.params.filename || ""));
  if (!filename || !filename.endsWith(".png")) {
    return res.status(400).json({ message: "截圖檔名不正確" });
  }

  const screenshotPath = path.join(dataDir, filename);
  try {
    await fs.access(screenshotPath);
    res.sendFile(screenshotPath);
  } catch {
    res.status(404).json({ message: "找不到截圖" });
  }
});

function missingMyshipKeys() {
  return [
    ["MYSHIP_PRODUCT_URL", myshipProductUrl],
    ["MYSHIP_FACEBOOK_EMAIL", myshipFacebookEmail],
    ["MYSHIP_FACEBOOK_PASSWORD", myshipFacebookPassword]
  ].filter(([, value]) => !String(value || "").trim()).map(([key]) => key);
}

function getMyshipCredentials() {
  const missingKeys = missingMyshipKeys();
  if (missingKeys.length) {
    throw new Error(`請先在 Render 環境變數設定 ${missingKeys.join(", ")}`);
  }
  return {
    productUrl: myshipProductUrl,
    email: myshipFacebookEmail,
    password: myshipFacebookPassword
  };
}

function shouldCreateOrderInMyship(order) {
  if (!isSevenElevenOrder(order)) return false;
  if (normalizeOrderStatus(order.status) === "cancelled") return false;
  const status = normalizeOrderMyshipSync(order).createStatus;
  return !["created", "creating", "skipped", "notNeeded"].includes(status);
}

function getMyshipOrderQuantity(order) {
  const quantity = Number(order?.[myshipAmountSource]);
  const fallbackQuantity = Number(order?.totalAmount || order?.productTotal || 0);
  return Math.max(1, Math.round(Number.isFinite(quantity) && quantity > 0 ? quantity : fallbackQuantity));
}

async function runMyshipOrderSync(trigger) {
  if (myshipOrderSyncRunning) throw new Error("賣貨便建單正在執行中，請稍後再試");

  const credentials = getMyshipCredentials();
  const startedAt = new Date().toISOString();
  myshipOrderSyncRunning = true;
  await writeMyshipOrderSyncStatus({
    ...await readMyshipOrderSyncStatus(),
    running: true,
    lastTrigger: trigger,
    lastRunAt: startedAt,
    lastFinishedAt: "",
    lastError: ""
  });

  const result = {
    pendingCreate: 0,
    createdOrders: 0,
    failedOrders: 0,
    created: [],
    failed: []
  };

  try {
    const orders = await readOrders();
    const targetOrders = orders.filter((order) => shouldCreateOrderInMyship(order));
    result.pendingCreate = targetOrders.length;

    if (targetOrders.length > 0) {
      const runningAt = new Date().toISOString();
      for (const order of targetOrders) {
        order.myship = normalizeOrderMyshipSync(order);
        order.myship.createStatus = "creating";
        order.myship.updatedAt = runningAt;
        order.myship.error = "";
        order.myship.productUrl = credentials.productUrl;
        order.myship.quantity = getMyshipOrderQuantity(order);
      }
      await writeOrders(orders);

      try {
        await withMyshipPage(async (page) => {
          await myshipLoginWithFacebook(page, credentials);

          for (const order of targetOrders) {
            try {
              const created = await createMyshipOrder(page, order, credentials);
              const now = new Date().toISOString();
              order.myship.createStatus = "created";
              order.myship.createdAt = now;
              order.myship.updatedAt = now;
              order.myship.error = "";
              order.myship.orderNo = created.orderNo || "";
              order.myship.lastScreenshot = "";
              result.createdOrders += 1;
              result.created.push({ orderId: order.id, orderNo: order.myship.orderNo, quantity: order.myship.quantity });
            } catch (error) {
              const screenshot = await myshipSaveScreenshot(page, `myship-order-failed-${order.id}`).catch(() => "");
              const message = getErrorMessage(error);
              order.myship.createStatus = "failed";
              order.myship.updatedAt = new Date().toISOString();
              order.myship.error = message;
              order.myship.lastScreenshot = screenshot;
              result.failedOrders += 1;
              result.failed.push({ orderId: order.id, message, screenshot });
            }
          }
        });
      } catch (error) {
        const message = getErrorMessage(error);
        for (const order of targetOrders) {
          if (order.myship?.createStatus === "created") continue;
          order.myship = normalizeOrderMyshipSync(order);
          order.myship.createStatus = "failed";
          order.myship.updatedAt = new Date().toISOString();
          order.myship.error = message;
          result.failedOrders += 1;
          result.failed.push({ orderId: order.id, message, screenshot: "" });
        }
      }

      await writeOrders(orders);
    }

    const finishedAt = new Date().toISOString();
    const lastError = result.failed.map((item) => `${item.orderId}: ${item.message}`).join("；");
    await writeMyshipOrderSyncStatus({
      running: false,
      lastTrigger: trigger,
      lastRunAt: startedAt,
      lastFinishedAt: finishedAt,
      lastSuccessAt: result.failedOrders === 0 ? finishedAt : (await readMyshipOrderSyncStatus()).lastSuccessAt,
      lastError,
      lastResult: result
    });

    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await writeMyshipOrderSyncStatus({
      running: false,
      lastTrigger: trigger,
      lastRunAt: startedAt,
      lastFinishedAt: finishedAt,
      lastError: getErrorMessage(error)
    });
    throw error;
  } finally {
    myshipOrderSyncRunning = false;
    const currentStatus = await readMyshipOrderSyncStatus();
    if (currentStatus.running) await writeMyshipOrderSyncStatus({ ...currentStatus, running: false });
  }
}

async function launchChromiumBrowser() {
  const { chromium } = await import("playwright");
  await ensureChromiumBrowserInstalled(chromium);
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
}

async function launchMyshipContext() {
  const { chromium } = await import("playwright");
  await ensureChromiumBrowserInstalled(chromium);
  await fs.mkdir(myshipBrowserProfileDir, { recursive: true });
  return chromium.launchPersistentContext(myshipBrowserProfileDir, {
    headless: myshipHeadless,
    locale: "zh-TW",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
}

async function ensureChromiumBrowserInstalled(chromium) {
  const executablePath = chromium.executablePath();
  try {
    await fs.access(executablePath);
    return;
  } catch {}

  const { spawn } = await import("child_process");
  await new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(command, ["playwright", "install", "chromium"], {
      cwd: __dirname,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Playwright Chromium 安裝逾時"));
    }, 5 * 60 * 1000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`Playwright Chromium 安裝失敗 (${code}): ${output.slice(-1200)}`));
    });
  });
}

async function withMyshipPage(task) {
  const context = await launchMyshipContext();

  try {
    const page = await context.newPage();
    for (const existingPage of context.pages()) {
      if (existingPage === page) continue;
      await existingPage.close().catch(() => {});
    }
    page.setDefaultTimeout(myshipDefaultTimeoutMs);
    page.setDefaultNavigationTimeout(myshipNavTimeoutMs);
    page.on("dialog", async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    return await task(page);
  } finally {
    await context.close();
  }
}

async function openMyshipLoginWindow() {
  if (myshipHeadless) {
    throw new Error("MYSHIP_HEADLESS 目前是 true，無法開啟可手動登入的賣貨便視窗");
  }

  const context = await launchMyshipContext();
  try {
    const page = await context.newPage();
    for (const existingPage of context.pages()) {
      if (existingPage === page) continue;
      await existingPage.close().catch(() => {});
    }
    page.setDefaultTimeout(myshipDefaultTimeoutMs);
    page.setDefaultNavigationTimeout(myshipNavTimeoutMs);
    page.on("dialog", async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    await page.goto(myshipProductUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    if (await myshipNeedsLogin(page)) {
      await myshipSubmitExternalLogin(page, "Facebook");
    } else {
      await myshipDismissDialogs(page);
    }

    await page.waitForTimeout(myshipManualLoginWindowMs);
    const activePage = context.pages().find((entry) => entry.url().includes("myship.7-11.com.tw")) || page;
    const url = activePage.url();
    const text = await myshipBodyText(activePage);
    const needsLogin = await myshipNeedsLogin(activePage).catch(() => true);
    const blocked = url.includes("facebook.com") || /系統忙碌中|Code[:：]\s*(109|E0001)/i.test(text);

    return {
      ok: !needsLogin && !blocked,
      url,
      message: !needsLogin && !blocked
        ? "賣貨便登入狀態已保存"
        : "登入狀態尚未確認，請確認視窗內是否已完成 Facebook/賣貨便登入"
    };
  } finally {
    await context.close();
  }
}

async function myshipLoginWithFacebook(page, credentials) {
  await page.goto(credentials.productUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  if (!await myshipNeedsLogin(page)) {
    await myshipDismissDialogs(page);
    return;
  }

  const context = page.context();
  const popupPromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);
  await myshipSubmitExternalLogin(page, "Facebook");

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null),
    wait(2500)
  ]);

  const popup = await popupPromise;
  const facebookPage = popup || context.pages().find((entry) => entry.url().includes("facebook.com")) || (page.url().includes("facebook.com") ? page : null);

  if (!facebookPage) {
    await page.waitForTimeout(2000);
    const afterClickText = await myshipBodyText(page);
    if (!afterClickText.includes("Facebook 登入") && !afterClickText.includes("登入")) return;
    throw new Error("賣貨便沒有開啟 Facebook 登入頁，請確認賣貨便登入流程是否改版");
  }

  await facebookPage.waitForLoadState("domcontentloaded").catch(() => {});
  const challengeBeforeLogin = await myshipDetectFacebookChallenge(facebookPage);
  if (challengeBeforeLogin) throw new Error(challengeBeforeLogin);

  const emailInput = facebookPage.locator("input[name='email'], input#email, input[autocomplete*='username']").first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  if (await emailInput.count()) {
    await emailInput.fill(credentials.email);
  }
  const passInput = facebookPage.locator("input[name='pass'], input#pass, input[type='password']").first();
  await passInput.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  if (await passInput.count()) {
    await passInput.fill(credentials.password);
    await passInput.press("Enter").catch(() => {});
  }

  await Promise.race([
    facebookPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
    wait(5000)
  ]);

  const challengeAfterLogin = await myshipDetectFacebookChallenge(facebookPage);
  if (challengeAfterLogin) throw new Error(challengeAfterLogin);

  if (facebookPage.url().includes("facebook.com")) {
    await myshipClickOptional(facebookPage, [
      "div[role='button']:has-text('繼續')",
      "button:has-text('繼續')",
      "input[type='submit']",
      "div[role='button']:has-text('Continue')",
      "button:has-text('Continue')"
    ], "Facebook 繼續授權");
    await Promise.race([
      facebookPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
      wait(3000)
    ]);
  }

  if (facebookPage.url().includes("facebook.com")) {
    throw new Error("Facebook 登入未完成，仍停在 Facebook 登入頁；請確認賣貨便 Facebook 帳密是否正確，或帳號是否需要手機驗證/安全驗證");
  }

  if (facebookPage !== page) {
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(3000);
  } else if (!page.url().includes("myship.7-11.com.tw")) {
    await page.waitForURL(/myship\.7-11\.com\.tw/, { timeout: 30000 }).catch(() => {});
  }

  await page.goto(credentials.productUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await myshipNeedsLogin(page)) {
    throw new Error("Facebook 登入沒有完成，賣貨便仍要求登入，可能需要手機驗證、雙重驗證或安全檢查");
  }
  await myshipDismissDialogs(page);
}

async function createMyshipOrder(page, order, credentials) {
  const quantity = getMyshipOrderQuantity(order);
  await page.goto(credentials.productUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await myshipDismissDialogs(page);
  await myshipAssertReadyForProductAction(page);
  if (await myshipIsFacebookLoginVisible(page)) {
    throw new Error("賣貨便尚未登入，無法建立購物車，請確認 Facebook 帳密或安全驗證");
  }

  await myshipClickFirst(page, [
    ".product_size_switch span[data-spec-name='金額']",
    ".product_size_switch span[data-spec-price='1']"
  ], "賣貨便金額規格");

  await page.locator("input.qty.available").first().fill(String(quantity));
  await myshipClickFirst(page, [
    "button[onclick*='addAndCreateCart']",
    "button.btn-addtocart:has-text('直接結帳')"
  ], "賣貨便直接結帳");

  let enteredCart = await myshipWaitForCartConfirm(page);
  if (!enteredCart) {
    await myshipClickFirst(page, [
      "button[onclick*='addToCart']",
      "button.btn-addtocart:has-text('加入購物車')"
    ], "賣貨便加入購物車");
    await page.waitForTimeout(1200);
    await myshipDismissDialogs(page);
    await myshipClickFirst(page, [
      "button[onclick*='createCart']",
      "button.btn-addtocart:has-text('直接結帳')",
      "button:has-text('直接結帳')"
    ], "賣貨便購物車直接結帳");
    enteredCart = await myshipWaitForCartConfirm(page);
  }
  await myshipDismissDialogs(page);

  const stillLogin = await myshipBodyText(page);
  if (stillLogin.includes("Facebook 登入") && stillLogin.includes("為保障交易安全")) {
    throw new Error("賣貨便要求重新登入，Facebook 登入沒有成功");
  }

  await myshipConfirmCartAmount(page, quantity);

  const filled = await myshipFillCheckoutData(page, order);
  if (!filled.name || !filled.phone) {
    throw new Error("賣貨便結帳頁找不到可填的姓名或手機欄位，請提供結帳頁截圖讓我補欄位");
  }
  if (isSevenElevenOrder(order) && !filled.store) {
    throw new Error("賣貨便結帳頁找不到可填的 7-11 門市欄位，可能需要另開賣貨便門市地圖流程");
  }

  await myshipClickFirst(page, [
    "button:has-text('確認送出')",
    "button:has-text('送出訂單')",
    "button:has-text('送出')",
    "button:has-text('下一步')",
    "input[type='submit']"
  ], "賣貨便送出訂單");

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
    wait(5000)
  ]);
  await myshipDismissDialogs(page);

  const text = await myshipBodyText(page);
  const orderNo = extractMyshipOrderNo(`${text}\n${page.url()}`);
  if (!orderNo && !/成功|完成|成立|訂單/.test(text)) {
    throw new Error("賣貨便沒有出現建單成功訊息，請檢查後台截圖或賣貨便是否有未填欄位");
  }

  return { orderNo };
}

async function myshipWaitForCartConfirm(page, timeout = 30000) {
  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout }),
    page.waitForURL(/\/cart\/confirm\//, { timeout }),
    page.locator("#btnNext, button#btnNext, input#btnNext").first().waitFor({ timeout })
  ]).catch(() => {});
  return await page.locator("#btnNext, button#btnNext, input#btnNext").first().count() > 0;
}

async function myshipConfirmCartAmount(page, quantity) {
  const hasRecipientFields = await page.locator("#RcvName, input[name='RcvName'], #RcvMobile, input[name='RcvMobile']").count();
  if (hasRecipientFields) return;

  const qtyInput = page.locator("input[name='Card_Qty_1'], input[id^='Card_Qty'], input[name*='Card_Qty'], input.qty").first();
  if (await qtyInput.count()) {
    await myshipSetInputValue(page, qtyInput, String(quantity));
  }

  const agree = page.locator("#Agree, input[name='Agree'], input[type='checkbox'][name*='Agree']").first();
  if (await agree.count()) {
    await agree.check({ force: true }).catch(async () => {
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (!input) return;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, "#Agree");
    });
  }

  await myshipClickFirst(page, [
    "#btnNext",
    "button#btnNext",
    "input#btnNext",
    "button:has-text('下一步')",
    "button:has-text('確認')",
    "input[type='submit']"
  ], "賣貨便購物車下一步");

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
    page.locator("#RcvName, input[name='RcvName'], #RcvMobile, input[name='RcvMobile']").first().waitFor({ timeout: 30000 })
  ]).catch(() => {});
  await myshipDismissDialogs(page);
}

async function myshipFillCheckoutData(page, order) {
  const store = order.sevenElevenStore || {};
  return page.evaluate(({ name, phone, storeId, storeName, storeAddress }) => {
    const setElementValue = (element, value) => {
      if (!element || value === undefined || value === null || value === "") return false;
      if ("value" in element) {
        element.focus?.();
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        element.textContent = value;
      }
      return true;
    };
    const setFirst = (selectors, value) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (setElementValue(element, value)) return true;
      }
      return false;
    };

    const directName = setFirst(["#RcvName", "input[name='RcvName']", "#ReceiverName", "input[name='ReceiverName']"], name);
    const directPhone = setFirst(["#RcvMobile", "input[name='RcvMobile']", "#ReceiverMobile", "input[name='ReceiverMobile']"], phone);
    const directStoreId = setFirst(["#RcvStoreID", "input[name='RcvStoreID']", "#CvsStoreID", "input[name='CvsStoreID']", "input[name='StoreID']"], storeId);
    const directStoreName = setFirst(["#RcvStoreName", "input[name='RcvStoreName']", "#CvsStoreName", "input[name='CvsStoreName']", "input[name='StoreName']"], storeName);
    const directStoreAddress = setFirst(["#RcvStoreAddress", "input[name='RcvStoreAddress']", "#CvsStoreAddress", "input[name='CvsStoreAddress']", "input[name='StoreAddress']"], storeAddress);

    const inputs = [...document.querySelectorAll("input, textarea")];
    const visibleInputs = inputs.filter((input) => {
      const type = String(input.getAttribute("type") || "").toLowerCase();
      if (["hidden", "button", "submit", "checkbox", "radio"].includes(type)) return false;
      if (input.disabled || input.readOnly) return false;
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const normalize = (value) => String(value || "").toLowerCase();
    const describe = (input) => normalize([
      input.name,
      input.id,
      input.placeholder,
      input.title,
      input.getAttribute("aria-label"),
      input.closest("label")?.innerText,
      input.parentElement?.innerText
    ].filter(Boolean).join(" "));
    const setValue = (input, value) => {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const fillMatching = (words, value) => {
      if (!value) return 0;
      let count = 0;
      for (const input of visibleInputs) {
        const info = describe(input);
        if (!words.some((word) => info.includes(word))) continue;
        setValue(input, value);
        count += 1;
      }
      return count;
    };

    const nameCount = fillMatching(["receivername", "recipientname", "consigneename", "收件人", "取件人", "姓名", "名字"], name);
    const phoneCount = fillMatching(["receivermobile", "recipientmobile", "mobile", "phone", "tel", "手機", "電話"], phone);
    const storeIdCount = fillMatching(["storeid", "cvsstoreid", "門市代號", "店號"], storeId);
    const storeNameCount = fillMatching(["storename", "cvsstorename", "門市名稱", "門市店名", "店名"], storeName);
    const storeAddressCount = fillMatching(["storeaddress", "cvsaddress", "門市地址", "地址"], storeAddress);

    return {
      name: directName || nameCount > 0,
      phone: directPhone || phoneCount > 0,
      store: directStoreId || directStoreName || directStoreAddress || storeIdCount + storeNameCount + storeAddressCount > 0
    };
  }, {
    name: order.customerName || "",
    phone: order.phone || "",
    storeId: store.id || "",
    storeName: store.name || "",
    storeAddress: store.address || order.deliveryAddress || ""
  });
}

async function myshipSetInputValue(page, locator, value) {
  await locator.fill(value).catch(async () => {
    const handle = await locator.elementHandle();
    if (!handle) throw new Error("找不到賣貨便金額輸入欄位");
    await page.evaluate(({ element, nextValue }) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, { element: handle, nextValue: value });
  });
  await page.waitForTimeout(800);
}

async function myshipDismissDialogs(page) {
  for (let round = 0; round < 3; round += 1) {
    let clicked = false;
    for (const selector of [
      "#alertify-ok",
      ".alertify-button-ok",
      "button.mfp-close",
      "button:has-text('OK')",
      "button:has-text('確定')"
    ]) {
      const locator = page.locator(selector).first();
      if (await locator.count() && await locator.isVisible().catch(() => false)) {
        await locator.click({ timeout: 1500, force: true }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(250);
  }
}

async function myshipIsFacebookLoginVisible(page) {
  return await page
    .locator("#loginModal.show button.btn-soclial-login-facebook, .modal.show button.btn-soclial-login-facebook, button.btn-soclial-login-facebook:visible")
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
}

async function myshipNeedsLogin(page) {
  if (page.url().includes("facebook.com") || page.url().includes("access.line.me")) return true;
  if (await myshipIsFacebookLoginVisible(page)) return true;
  const loginAlert = await page
    .locator("#alertify .alertify-message, .alertify-message")
    .first()
    .innerText({ timeout: 1000 })
    .catch(() => "");
  return /請登入|登入.*開始選購|uniopen/i.test(loginAlert);
}

async function myshipSubmitExternalLogin(page, provider) {
  const submitted = await page.evaluate((targetProvider) => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((entry) => String(entry.action || "").includes("/SocialNetwork/ExternalLogin"));
    if (!form) return false;
    const button = form.querySelector(`button[name="provider"][value="${targetProvider}"]`);
    if (!button) return false;
    button.click();
    return true;
  }, provider);

  if (!submitted) {
    throw new Error(`找不到賣貨便 ${provider} 登入表單`);
  }
}

async function myshipClickOptional(page, selectors, label) {
  try {
    await myshipClickFirst(page, selectors, label);
    return true;
  } catch {
    return false;
  }
}

async function myshipClickFirst(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (!count) continue;

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (!await item.isVisible().catch(() => false)) continue;
      try {
        await item.click({ timeout: 8000 });
        return true;
      } catch {
        // try the next selector
      }
    }

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      try {
        await item.click({ timeout: 8000, force: true });
        return true;
      } catch {
        // try the next matching element
      }
    }
  }

  const bodyText = (await myshipBodyText(page)).replace(/\s+/g, " ").slice(0, 700);
  throw new Error(`找不到賣貨便按鈕/欄位：${label}｜目前網址：${page.url()}｜頁面文字：${bodyText}`);
}

async function myshipBodyText(page) {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

async function myshipAssertReadyForProductAction(page) {
  const url = page.url();
  const text = await myshipBodyText(page);
  if (url.includes("facebook.com")) {
    throw new Error("Facebook 登入沒有完成，賣貨便仍被導向 Facebook 登入頁，可能需要人工驗證或帳號被安全檢查");
  }
  if (/系統忙碌中|Code[:：]\s*109|E0001/i.test(text)) {
    throw new Error(`賣貨便目前回傳系統忙碌或錯誤，請稍後再試｜${text.replace(/\s+/g, " ").slice(0, 180)}`);
  }
}

async function myshipDetectFacebookChallenge(page) {
  const url = page.url();
  const text = await myshipBodyText(page);
  if (!url.includes("facebook.com")) return "";
  if (/checkpoint|captcha|recover|two_factor|approvals|login_help/i.test(url)) {
    return "Facebook 出現安全驗證，請先人工登入一次或改用不會觸發驗證的帳號";
  }
  if (/驗證|安全檢查|雙重驗證|確認身分|captcha|checkpoint/i.test(text)) {
    return "Facebook 出現安全驗證，請先人工登入一次或改用不會觸發驗證的帳號";
  }
  return "";
}

function extractMyshipOrderNo(text) {
  const cleanText = String(text || "");
  const match = cleanText.match(/(?:訂單編號|訂單號碼|訂單號|交易編號)[^\nA-Z0-9]*([A-Z0-9-]{6,})/i);
  if (match) return match[1];
  const directMatch = cleanText.match(/\bC[MC]\d{8,}\b/i);
  return directMatch ? directMatch[0].toUpperCase() : "";
}

async function myshipSaveScreenshot(page, prefix) {
  const cleanPrefix = String(prefix || "myship-error").replace(/[^\w.-]+/g, "-").slice(0, 80);
  const filename = `${cleanPrefix}-${Date.now()}.png`;
  const filePath = path.join(dataDir, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  return filename;
}

function getMallbicCredentials() {
  const account = String(process.env.MALLBIC_ACCOUNT || "").trim();
  const password = String(process.env.MALLBIC_PASSWORD || "").trim();
  if (!account || !password) {
    throw new Error("請先在 Render 環境變數設定 MALLBIC_ACCOUNT 和 MALLBIC_PASSWORD");
  }
  return { account, password };
}

async function runMallbicInventorySync(trigger) {
  if (mallbicSyncRunning) throw new Error("墨筆克同步正在執行中，請稍後再試");

  const startedAt = new Date().toISOString();
  mallbicSyncRunning = true;
  await writeMallbicSyncStatus({
    ...await readMallbicSyncStatus(),
    running: true,
    lastTrigger: trigger,
    lastRunAt: startedAt,
    lastFinishedAt: "",
    lastError: ""
  });

  try {
    const exported = await exportMallbicInventoryWorkbook(getMallbicCredentials());
    const parsed = parseInventoryWorkbook(exported.buffer);
    if (parsed.error) throw new Error(parsed.error);

    const catalog = await readCatalog();
    const result = applyInventoryItems(catalog, parsed.items);
    await writeCatalog(catalog);

    const finishedAt = new Date().toISOString();
    const response = {
      importedRows: parsed.items.length,
      sourceFile: exported.suggestedFilename,
      sourceSheet: parsed.sourceSheet,
      ...result
    };

    await writeMallbicSyncStatus({
      running: false,
      lastTrigger: trigger,
      lastRunAt: startedAt,
      lastFinishedAt: finishedAt,
      lastSuccessAt: finishedAt,
      lastError: "",
      lastResult: {
        importedRows: response.importedRows,
        updatedCount: response.updatedCount,
        unmatchedCount: response.unmatchedCount,
        sourceFile: response.sourceFile,
        sourceSheet: response.sourceSheet
      }
    });

    return response;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await writeMallbicSyncStatus({
      running: false,
      lastTrigger: trigger,
      lastRunAt: startedAt,
      lastFinishedAt: finishedAt,
      lastError: getErrorMessage(error)
    });
    throw error;
  } finally {
    mallbicSyncRunning = false;
    const currentStatus = await readMallbicSyncStatus();
    if (currentStatus.running) await writeMallbicSyncStatus({ ...currentStatus, running: false });
  }
}

function shouldImportOrderToMallbic(order) {
  return order.status !== "cancelled" && order.mallbic?.importStatus !== "imported";
}

function shouldCancelOrderInMallbic(order) {
  return order.status === "cancelled"
    && order.mallbic?.importStatus === "imported"
    && order.mallbic?.cancelStatus !== "cancelled";
}

function shouldUpdateOrderStatusFromMallbic(order) {
  return normalizeOrderStatus(order.status) === "pending";
}

function mallbicOrderDeliveryMethod(order) {
  return ["宅配", sevenElevenDeliveryMethod].includes(order.deliveryMethod) ? "快遞[代收]" : "面交[代收]";
}

function mallbicOrderAddress(order) {
  if (order.deliveryMethod === "宅配") return order.deliveryAddress || "";
  if (order.deliveryMethod === sevenElevenDeliveryMethod) {
    const store = order.sevenElevenStore || {};
    return [store.id, store.name, store.address].filter(Boolean).join(" ");
  }
  return "";
}

function expandMallbicOrderRows(order) {
  const rows = [];
  for (const item of order.items || []) {
    const quantity = Math.max(0, Number(item.quantity || 0));
    for (let index = 0; index < quantity; index += 1) {
      rows.push({
        orderId: order.id,
        customerName: order.customerName || "",
        phone: order.phone || "",
        barcode: item.barcode || "",
        quantity: 1,
        subtotal: Number(item.price || 0),
        deliveryMethod: mallbicOrderDeliveryMethod(order),
        address: mallbicOrderAddress(order)
      });
    }
  }
  return rows;
}

function buildMallbicOrderImportWorkbook(orders) {
  const templateWorkbook = XLSX.readFile(mallbicOrderTemplateFile, { cellStyles: true });
  const sheetName = templateWorkbook.SheetNames[0];
  const templateSheet = templateWorkbook.Sheets[sheetName];
  const columnCount = 23;
  const headerRow = Array.from({ length: columnCount }, (_, columnIndex) => {
    const cell = templateSheet[XLSX.utils.encode_cell({ r: 0, c: columnIndex })];
    return cell?.v ?? "";
  });
  const patternRow = Array.from({ length: columnCount }, (_, columnIndex) => {
    const cell = templateSheet[XLSX.utils.encode_cell({ r: 1, c: columnIndex })];
    return cell?.v ?? "";
  });
  const mallbicRows = orders.flatMap((order) => expandMallbicOrderRows(order));
  if (mallbicRows.length === 0) throw new Error("沒有可匯入墨筆克的訂單明細");

  const values = [
    headerRow,
    ...mallbicRows.map((row) => {
      const output = [...patternRow];
      output[0] = output[0] || "自訂交易";
      output[1] = output[1] || "1";
      output[2] = row.customerName;
      output[4] = row.phone;
      output[5] = row.barcode;
      output[8] = row.quantity;
      output[9] = row.subtotal;
      output[11] = output[11] || "貨到付款";
      output[12] = row.deliveryMethod;
      output[13] = row.address;
      output[16] = row.orderId;
      return output;
    })
  ];

  const outputSheet = XLSX.utils.aoa_to_sheet(values);
  outputSheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: values.length - 1, c: columnCount - 1 }
  });
  templateWorkbook.Sheets[sheetName] = outputSheet;

  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return {
    buffer: XLSX.write(templateWorkbook, { type: "buffer", bookType: "biff8" }),
    filename: `line-orders-${timestamp}.xls`,
    rowCount: mallbicRows.length,
    orderCount: orders.length
  };
}

async function withMallbicPage(task) {
  const browser = await launchChromiumBrowser();

  try {
    const context = await browser.newContext({ acceptDownloads: true, locale: "zh-TW" });
    const page = await context.newPage();
    page.setDefaultTimeout(mallbicDefaultTimeoutMs);
    page.setDefaultNavigationTimeout(mallbicNavTimeoutMs);
    page.on("dialog", async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    await mallbicLoginIfNeeded(page, getMallbicCredentials());
    await mallbicDismissBlockingDialogs(page);
    await mallbicTrySelectCompany(page, mallbicCompanyName);
    await mallbicDismissBlockingDialogs(page);

    return await task(page);
  } finally {
    await browser.close();
  }
}

async function runMallbicOrderSync(trigger) {
  if (mallbicOrderSyncRunning) throw new Error("墨筆克訂單同步正在執行中，請稍後再試");

  const startedAt = new Date().toISOString();
  mallbicOrderSyncRunning = true;
  await writeMallbicOrderSyncStatus({
    ...await readMallbicOrderSyncStatus(),
    running: true,
    lastTrigger: trigger,
    lastRunAt: startedAt,
    lastFinishedAt: "",
    lastError: ""
  });

  try {
    const orders = await readOrders();
    const importOrders = orders.filter((order) => shouldImportOrderToMallbic(order));
    const cancelOrders = orders.filter((order) => shouldCancelOrderInMallbic(order));
    const errors = [];
    let importResult = { importedOrders: 0, importedRows: 0, sourceFile: "" };
    const cancelResults = [];

    if (importOrders.length > 0) {
      try {
        const workbook = buildMallbicOrderImportWorkbook(importOrders);
        const lookupErrors = [];
        const mallbicResult = await withMallbicPage(async (page) => {
          const result = await importMallbicOrdersWorkbook(page, workbook);
          const orderNumbers = {};
          for (const order of importOrders) {
            try {
              orderNumbers[order.id] = await lookupMallbicOrderNumber(page, order.id);
            } catch (error) {
              lookupErrors.push(`${order.id} 查訂單號失敗：${getErrorMessage(error)}`);
              orderNumbers[order.id] = "";
            }
          }
          return { ...result, orderNumbers };
        });
        const importedAt = new Date().toISOString();
        for (const order of importOrders) {
          order.mallbic.importStatus = "imported";
          order.mallbic.importedAt = importedAt;
          order.mallbic.importError = "";
          order.mallbic.importFileName = workbook.filename;
          order.mallbic.importRowCount = expandMallbicOrderRows(order).length;
          order.mallbic.mallbicOrderNo = mallbicResult.orderNumbers?.[order.id] || "";
        }
        importResult = {
          importedOrders: importOrders.length,
          importedRows: workbook.rowCount,
          sourceFile: workbook.filename,
          mallbicMessage: mallbicResult.message,
          mallbicImportedCount: mallbicResult.importedCount,
          mallbicOrderNumbers: mallbicResult.orderNumbers || {},
          lookupErrors
        };
      } catch (error) {
        const message = getErrorMessage(error);
        for (const order of importOrders) {
          order.mallbic.importStatus = "importFailed";
          order.mallbic.importError = message;
        }
        errors.push(message);
      }
    }

    if (cancelOrders.length > 0 && errors.length === 0) {
      await withMallbicPage(async (page) => {
        for (const order of cancelOrders) {
          try {
            const result = await cancelMallbicOrder(page, order);
            order.mallbic.cancelStatus = "cancelled";
            order.mallbic.cancelledAt = new Date().toISOString();
            order.mallbic.cancelError = "";
            cancelResults.push({ orderId: order.id, ok: true, message: result.message });
          } catch (error) {
            const message = getErrorMessage(error);
            order.mallbic.cancelStatus = "cancelFailed";
            order.mallbic.cancelError = message;
            cancelResults.push({ orderId: order.id, ok: false, message });
            errors.push(`${order.id} 取消失敗：${message}`);
          }
        }
      });
    }

    await writeOrders(orders);
    const finishedAt = new Date().toISOString();
    const response = {
      pendingImport: importOrders.length,
      pendingCancel: cancelOrders.length,
      importedOrders: importResult.importedOrders,
      importedRows: importResult.importedRows,
      sourceFile: importResult.sourceFile,
      cancelledOrders: cancelResults.filter((result) => result.ok).length,
      failedCancels: cancelResults.filter((result) => !result.ok).length,
      errors
    };

    await writeMallbicOrderSyncStatus({
      running: false,
      lastTrigger: trigger,
      lastRunAt: startedAt,
      lastFinishedAt: finishedAt,
      lastSuccessAt: errors.length === 0 ? finishedAt : (await readMallbicOrderSyncStatus()).lastSuccessAt,
      lastError: errors.join("；"),
      lastResult: response
    });

    return response;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await writeMallbicOrderSyncStatus({
      running: false,
      lastTrigger: trigger,
      lastRunAt: startedAt,
      lastFinishedAt: finishedAt,
      lastError: getErrorMessage(error)
    });
    throw error;
  } finally {
    mallbicOrderSyncRunning = false;
    const currentStatus = await readMallbicOrderSyncStatus();
    if (currentStatus.running) await writeMallbicOrderSyncStatus({ ...currentStatus, running: false });
  }
}

async function runMallbicOrderStatusSync(trigger) {
  if (mallbicOrderStatusSyncRunning) throw new Error("墨筆克訂單狀態更新正在執行中，請稍後再試");

  const startedAt = new Date().toISOString();
  mallbicOrderStatusSyncRunning = true;
  await writeMallbicOrderSyncStatus({
    ...await readMallbicOrderSyncStatus(),
    lastStatusTrigger: trigger,
    lastStatusRunAt: startedAt,
    lastStatusFinishedAt: "",
    lastStatusError: ""
  });

  try {
    const orders = await readOrders();
    const targetOrders = orders.filter((order) => shouldUpdateOrderStatusFromMallbic(order));
    const checked = [];
    const updated = [];

    if (targetOrders.length > 0) {
      await withMallbicPage(async (page) => {
        for (const order of targetOrders) {
          const keyword = order.mallbic?.mallbicOrderNo || order.id;
          const mallbicOrderNo = await lookupMallbicOrderInStatus(page, keyword, "3");
          const found = Boolean(mallbicOrderNo);
          checked.push({
            orderId: order.id,
            keyword,
            found,
            mallbicOrderNo
          });

          if (found) {
            order.status = "processing";
            order.updatedAt = new Date().toISOString();
            order.mallbic = normalizeOrderMallbicSync(order);
            order.mallbic.importStatus = "imported";
            order.mallbic.importedAt = order.mallbic.importedAt || order.updatedAt;
            order.mallbic.importError = "";
            order.mallbic.importRowCount = order.mallbic.importRowCount || expandMallbicOrderRows(order).length;
            if (mallbicOrderNo && !order.mallbic.mallbicOrderNo) {
              order.mallbic.mallbicOrderNo = mallbicOrderNo;
            }
            updated.push(order.id);
          }
        }
      });
    }

    await writeOrders(orders);
    const finishedAt = new Date().toISOString();
    const response = {
      pendingStatusUpdate: targetOrders.length,
      checkedOrders: checked.length,
      updatedOrders: updated.length,
      unchangedOrders: checked.filter((item) => !item.found).length,
      updated,
      checked
    };

    await writeMallbicOrderSyncStatus({
      ...await readMallbicOrderSyncStatus(),
      lastStatusTrigger: trigger,
      lastStatusRunAt: startedAt,
      lastStatusFinishedAt: finishedAt,
      lastStatusSuccessAt: finishedAt,
      lastStatusError: "",
      lastStatusResult: response
    });

    return response;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await writeMallbicOrderSyncStatus({
      ...await readMallbicOrderSyncStatus(),
      lastStatusTrigger: trigger,
      lastStatusRunAt: startedAt,
      lastStatusFinishedAt: finishedAt,
      lastStatusError: getErrorMessage(error)
    });
    throw error;
  } finally {
    mallbicOrderStatusSyncRunning = false;
  }
}

function applyInventoryItems(catalog, items) {
  const barcodeMap = new Map();
  for (const market of catalog.markets) {
    for (const product of market.products) {
      for (const variant of product.variants) {
        barcodeMap.set(normalizeBarcode(variant.barcode), variant);
      }
    }
  }

  const updated = [];
  const unmatched = [];
  for (const item of items) {
    const variant = barcodeMap.get(normalizeBarcode(item.barcode));
    if (!variant) {
      unmatched.push(item.barcode);
      continue;
    }

    variant.stock = item.quantity;
    updated.push({ barcode: item.barcode, quantity: item.quantity });
  }

  return {
    updatedCount: updated.length,
    unmatchedCount: unmatched.length,
    updated,
    unmatched
  };
}

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
  const market = catalog.markets[0];
  let createdCategories = 0;
  let createdProducts = 0;
  let createdVariants = 0;
  let updatedVariants = 0;

  for (const item of parsed.items) {
    let category = null;
    if (item.categoryName) {
      category = catalog.categories.find((entry) => entry.name.trim() === item.categoryName && !entry.parentId);
      if (!category) {
        category = {
          id: makeId("category"),
          name: item.categoryName,
          imageUrl: "",
          isActive: true,
          parentId: "",
          sortOrder: catalog.categories.length
        };
        catalog.categories.push(category);
        createdCategories += 1;
      }
    }
    category ||= catalog.categories[0];
    if (item.subCategoryName) {
      let subCategory = catalog.categories.find((entry) => (
        entry.name.trim() === item.subCategoryName
        && entry.parentId === category.id
      ));
      if (!subCategory) {
        subCategory = {
          id: makeId("category"),
          name: item.subCategoryName,
          imageUrl: "",
          isActive: true,
          parentId: category.id,
          sortOrder: catalog.categories.length
        };
        catalog.categories.push(subCategory);
        createdCategories += 1;
      }
      category = subCategory;
    }
    const categoryId = category.id;

    market.isActive = item.isActive;
    let product = market.products.find((entry) => entry.name.trim() === item.productName && entry.categoryId === categoryId);
    if (!product) {
      product = {
        id: makeId("product"),
        name: item.productName,
        categoryId,
        imageUrl: item.productImageUrl,
        description: item.productDescription,
        variants: []
      };
      market.products.push(product);
      createdProducts += 1;
    } else {
      product.categoryId = categoryId;
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
    createdMarkets: 0,
    createdCategories,
    createdProducts,
    createdVariants,
    updatedVariants
  });
});

const inventoryBarcodeHeaders = [
  "品項條碼",
  "商品選項貨號",
  "商品選項條碼",
  "貨號",
  "條碼",
  "SKU",
  "sku"
];

const inventoryAvailableHeaders = [
  "可用庫存"
];

const inventoryDemandHeaders = [
  "需求"
];

const inventoryQuantityHeaders = [
  "庫存量",
  "庫存數量",
  "商品庫存",
  "現有庫存",
  "可用庫存",
  "可售數量",
  "總庫存",
  "庫存",
  "數量"
];

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .replace(/[　\s：:]/g, "")
    .toLowerCase();
}

function normalizeBarcode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function findHeaderIndex(headers, aliases) {
  const normalized = headers.map(normalizeHeader);
  const targets = aliases.map(normalizeHeader);

  for (const target of targets) {
    const exactIndex = normalized.indexOf(target);
    if (exactIndex >= 0) return exactIndex;
  }

  for (const target of targets) {
    const containsIndex = normalized.findIndex((header) => header && header.includes(target));
    if (containsIndex >= 0) return containsIndex;
  }

  return -1;
}

function parseStockInteger(value, { blankAsZero = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return blankAsZero ? 0 : null;
  const normalized = String(value).trim().replace(/,/g, "");
  const quantity = Number(normalized);
  if (Number.isInteger(quantity)) return quantity;
  return blankAsZero ? 0 : null;
}

function parseInventoryQuantity(row, { quantityIndex, availableIndex, demandIndex }) {
  const hasAvailable = availableIndex >= 0;
  const hasDemand = demandIndex >= 0;

  if (hasAvailable && hasDemand) {
    const available = parseStockInteger(row[availableIndex]);
    const demand = parseStockInteger(row[demandIndex], { blankAsZero: true });
    if (available === null || demand === null) return null;
    return Math.max(0, available - demand);
  }

  const rawQuantity = row[quantityIndex];
  const quantity = parseStockInteger(rawQuantity);
  return quantity !== null && quantity >= 0 ? quantity : null;
}

function parseInventoryWorkbook(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { error: "Excel 檔案讀取失敗" };
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const parsed = parseInventoryRows(rows);
    if (!parsed.error) {
      return { ...parsed, sourceSheet: sheetName };
    }
  }

  return { error: "找不到庫存欄位，Excel 需要有品項條碼/商品選項貨號，以及庫存量/數量" };
}

function parseInventoryRows(rows) {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map((cell) => String(cell).trim());
    const hasAvailableAndDemand = findHeaderIndex(headers, inventoryAvailableHeaders) >= 0
      && findHeaderIndex(headers, inventoryDemandHeaders) >= 0;
    return findHeaderIndex(headers, inventoryBarcodeHeaders) >= 0
      && (hasAvailableAndDemand || findHeaderIndex(headers, inventoryQuantityHeaders) >= 0);
  });

  if (headerIndex < 0) return { error: "找不到欄位：品項條碼、可用庫存/需求 或 數量" };

  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const barcodeIndex = findHeaderIndex(headers, inventoryBarcodeHeaders);
  const quantityIndex = findHeaderIndex(headers, inventoryQuantityHeaders);
  const availableIndex = findHeaderIndex(headers, inventoryAvailableHeaders);
  const demandIndex = findHeaderIndex(headers, inventoryDemandHeaders);
  const itemMap = new Map();

  for (let offset = 0; offset < rows.slice(headerIndex + 1).length; offset += 1) {
    const row = rows[headerIndex + 1 + offset];
    const barcode = String(row[barcodeIndex] || "").trim();
    const rawQuantity = availableIndex >= 0 ? row[availableIndex] : row[quantityIndex];
    const rawDemand = demandIndex >= 0 ? row[demandIndex] : "";
    const quantityIsBlank = rawQuantity === null || rawQuantity === undefined || String(rawQuantity).trim() === "";
    const demandIsBlank = rawDemand === null || rawDemand === undefined || String(rawDemand).trim() === "";
    if (!barcode && quantityIsBlank) continue;

    const quantity = parseInventoryQuantity(row, { quantityIndex, availableIndex, demandIndex });
    if (!barcode || quantity === null) {
      return { error: `資料格式錯誤：第 ${headerIndex + offset + 2} 列，${barcode || "空白條碼"}` };
    }

    itemMap.set(normalizeBarcode(barcode), {
      barcode,
      quantity,
      availableStock: availableIndex >= 0 ? parseStockInteger(rawQuantity) : undefined,
      demand: demandIndex >= 0 && !demandIsBlank ? parseStockInteger(rawDemand, { blankAsZero: true }) : undefined
    });
  }

  const items = [...itemMap.values()];
  if (items.length === 0) return { error: "Excel 沒有可匯入的資料" };
  return { items };
}

function quoteTextSelector(value) {
  return JSON.stringify(String(value || ""));
}

function mallbicRoots(page) {
  return [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
}

async function mallbicFindFirst(page, selectors, { visible = true } = {}) {
  for (const root of mallbicRoots(page)) {
    for (const selector of selectors) {
      let locator;
      let count;
      try {
        locator = root.locator(selector);
        count = Math.min(await locator.count(), 30);
      } catch {
        continue;
      }

      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        if (!visible) return item;
        try {
          if (await item.isVisible()) return item;
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

async function mallbicClickFirst(page, selectors, label, timeout = mallbicDefaultTimeoutMs) {
  const item = await mallbicFindFirst(page, selectors);
  if (!item) throw new Error(`找不到墨筆克按鈕/欄位：${label}`);

  try {
    await item.scrollIntoViewIfNeeded({ timeout });
  } catch {
    // Some Mallbic elements are already in view or inside frames that reject scrolling.
  }

  try {
    await item.click({ timeout });
  } catch {
    await item.click({ timeout, force: true });
  }

  return item;
}

async function mallbicDismissBlockingDialogs(page) {
  const blockingTexts = ["未讀訊息", "提醒您", "警告"];
  let dismissed = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pageText = await mallbicPageText(page);
    if (!blockingTexts.some((text) => pageText.includes(text))) return dismissed;

    const closeButton = await mallbicFindFirst(page, [
      "#dlg_alert__0 .btn_close_m",
      ".our_dlg_base .btn_close_m",
      ".our_dlg_title_content .btn_close_m",
      ".btn_close_m",
      ".ui-dialog:has-text('未讀訊息') .ui-dialog-titlebar-close",
      ".ui-dialog:has-text('提醒您') .ui-dialog-titlebar-close",
      ".ui-dialog:has-text('警告') .ui-dialog-titlebar-close",
      ".ui-dialog-titlebar-close",
      "[aria-label='Close']",
      "[title='Close']",
      "[title='關閉']",
      "[title*='ESC']",
      ".layui-layer-close",
      ".jconfirm-closeIcon",
      ".btn_close",
      ".close",
      "button:has-text('關閉')",
      "button:has-text('取消')",
      "span:has-text('關閉')"
    ]);

    if (!closeButton) break;

    try {
      await closeButton.click({ timeout: 5000 });
    } catch {
      await closeButton.click({ timeout: 5000, force: true });
    }

    dismissed = true;
    await wait(500);
  }

  return dismissed;
}

async function mallbicWaitDomReady(page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: mallbicNavTimeoutMs });
  } catch {
    // Mallbic sometimes keeps background requests alive; continue with visible element checks.
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    // Network idle is a nice-to-have for this admin panel.
  }
}

async function mallbicPageText(page) {
  const parts = [];
  for (const root of mallbicRoots(page)) {
    try {
      const text = await root.locator("body").innerText({ timeout: 1000 });
      if (text) parts.push(text);
    } catch {
      // Ignore frames that cannot be inspected.
    }
  }
  return parts.join("\n");
}

async function mallbicIsLoggedIn(page) {
  return Boolean(await mallbicFindFirst(page, ["#mode_good", "a#mode_good", "a:has-text('庫存管理')"]));
}

async function mallbicLoginIfNeeded(page, { account, password }) {
  await page.goto(mallbicLoginUrl, { waitUntil: "domcontentloaded", timeout: mallbicNavTimeoutMs });
  await mallbicWaitDomReady(page);
  await wait(1000);

  if (await mallbicIsLoggedIn(page)) return;

  const passwordInput = await mallbicFindFirst(page, ["input[type='password']"]);
  if (!passwordInput) return;

  const accountInput = await mallbicFindFirst(page, [
    "input[type='text']",
    "input[type='email']",
    "input:not([type])",
    "input[name*='account' i]",
    "input[name*='user' i]",
    "input[id*='account' i]",
    "input[id*='user' i]",
    "input[id*='login' i]"
  ]);

  if (!accountInput) throw new Error("墨筆克未登入，而且找不到帳號輸入框");
  await accountInput.fill(account, { timeout: mallbicDefaultTimeoutMs });
  await passwordInput.fill(password, { timeout: mallbicDefaultTimeoutMs });

  const loginButton = await mallbicFindFirst(page, [
    "#btnLogin",
    "#btn_login",
    "#login",
    "button:has-text('登入')",
    "input[type='submit']",
    "input[type='button'][value*='登入']",
    ".btn_text_m:has-text('登入')",
    "text=登入"
  ]);

  if (loginButton) {
    try {
      await loginButton.click({ timeout: mallbicDefaultTimeoutMs });
    } catch {
      await loginButton.click({ timeout: mallbicDefaultTimeoutMs, force: true });
    }
  } else {
    await passwordInput.press("Enter");
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await mallbicWaitDomReady(page);
    if (await mallbicIsLoggedIn(page)) return;
    if (!await mallbicFindFirst(page, ["input[type='password']"])) return;
    await wait(1000);
  }

  throw new Error("墨筆克登入失敗：登入後仍停在登入頁");
}

async function mallbicTrySelectCompany(page, companyName) {
  const cleanName = String(companyName || "").trim();
  if (!cleanName) return;

  try {
    const text = await mallbicPageText(page);
    if (text.includes(cleanName) && await mallbicIsLoggedIn(page)) return;
  } catch {
    // Continue with clickable company selectors below.
  }

  const quoted = quoteTextSelector(cleanName);
  const selectors = [
    `text=${cleanName}`,
    `a:has-text(${quoted})`,
    `li:has-text(${quoted})`,
    `div:has-text(${quoted})`,
    `span:has-text(${quoted})`
  ];

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const item = await mallbicFindFirst(page, selectors);
    if (item) {
      try {
        await item.click({ timeout: 5000 });
      } catch {
        try {
          await item.click({ timeout: 5000, force: true });
        } catch {
          // Keep current company if the click is blocked.
        }
      }
      await mallbicWaitDomReady(page);
      await wait(1000);
      return;
    }
    await wait(500);
  }
}

async function mallbicOpenInventoryPage(page) {
  const inventoryUrl = new URL("/Module/1_Main/Main.aspx#frame=mode_good", mallbicLoginUrl).href;
  await page.goto(inventoryUrl, { waitUntil: "domcontentloaded", timeout: mallbicNavTimeoutMs });
  await mallbicWaitDomReady(page);
  await wait(3000);
  await mallbicDismissBlockingDialogs(page);

  const exportButton = await mallbicFindFirst(page, [
    "li.tool_btn.ignore-mbc-title[title='匯出商品資料']",
    "li[title='匯出商品資料']",
    "li:has-text('匯出商品資料')",
    "text=匯出商品資料"
  ]);
  if (exportButton) return;

  await mallbicClickFirst(page, ["#mode_good", "a#mode_good", "a:has-text('庫存管理')"], "庫存管理");
  await mallbicWaitDomReady(page);
  await wait(3000);
  await mallbicDismissBlockingDialogs(page);
}

async function mallbicFillFirst(page, selectors, value, label, timeout = mallbicDefaultTimeoutMs) {
  const item = await mallbicFindFirst(page, selectors);
  if (!item) throw new Error(`找不到墨筆克欄位：${label}`);
  await item.fill(String(value || ""), { timeout });
  return item;
}

async function mallbicSelectFirst(page, selectors, value, label, timeout = mallbicDefaultTimeoutMs) {
  const item = await mallbicFindFirst(page, selectors);
  if (!item) throw new Error(`找不到墨筆克選單：${label}`);
  await item.selectOption(String(value), { timeout });
  return item;
}

async function mallbicSetInputFilesFirst(page, selectors, file, label, timeout = mallbicDefaultTimeoutMs) {
  const item = await mallbicFindFirst(page, selectors, { visible: false });
  if (!item) throw new Error(`找不到墨筆克上傳欄位：${label}`);
  await item.setInputFiles(file, { timeout });
  return item;
}

async function mallbicOpenOrderPage(page) {
  const orderUrl = new URL("/Module/1_Main/Main.aspx#frame=mode_order", mallbicLoginUrl).href;
  await page.goto(orderUrl, { waitUntil: "domcontentloaded", timeout: mallbicNavTimeoutMs });
  await mallbicWaitDomReady(page);
  await wait(3000);
  await mallbicDismissBlockingDialogs(page);

  const orderPageReady = await mallbicFindFirst(page, [
    "#mode_order.selected",
    "a#mode_order",
    "a:has-text('訂單管理')",
    "div.tgd_body:has-text('功能')",
    "#option",
    "#search"
  ]);
  if (orderPageReady) return;

  await mallbicClickFirst(page, ["#mode_order", "a#mode_order", "a:has-text('訂單管理')"], "訂單管理");
  await mallbicWaitDomReady(page);
  await wait(3000);
  await mallbicDismissBlockingDialogs(page);
}

async function waitForMallbicText(page, patterns, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let lastText = "";
  while (Date.now() < deadline) {
    const text = await mallbicPageText(page);
    lastText = text;
    const found = patterns.find((pattern) => text.includes(pattern));
    if (found) return { found, text };

    for (const root of mallbicRoots(page)) {
      for (const pattern of patterns) {
        try {
          const locator = root.getByText(pattern, { exact: false }).first();
          if (await locator.isVisible({ timeout: 500 })) {
            const locatorText = await locator.innerText({ timeout: 500 }).catch(() => "");
            return { found: pattern, text: [text, locatorText].filter(Boolean).join("\n") };
          }
        } catch {
          // Keep polling other frames/selectors.
        }
      }
    }

    await wait(1000);
  }

  const screenshotName = `mallbic-order-timeout-${Date.now()}.png`;
  const screenshotPath = path.join(__dirname, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  const snippet = lastText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  throw new Error(`等待墨筆克結果逾時：${patterns.join("、")}；已截圖 ${screenshotName}${snippet ? `；最後畫面：${snippet}` : ""}`);
}

async function importMallbicOrdersWorkbook(page, workbook) {
  await mallbicOpenOrderPage(page);
  await mallbicClickFirst(page, [
    "div.tgd_body:has-text('功能')",
    ".tgd_body:has-text('功能')",
    "text=功能"
  ], "功能");
  await wait(500);
  await mallbicClickFirst(page, [
    "li[dropdown-name='手動匯入平台訂單']",
    "li:has-text('手動匯入平台訂單')",
    "text=手動匯入平台訂單"
  ], "手動匯入平台訂單");
  await wait(1000);
  await mallbicClickFirst(page, [
    "span:has-text('其他類型')",
    "li:has-text('其他類型')",
    "button:has-text('其他類型')"
  ], "其他類型");
  await wait(500);

  await mallbicSetInputFilesFirst(page, ["input#fileToUpload", "input[name='fileToUpload']", "input[type='file']"], {
    name: workbook.filename,
    mimeType: "application/vnd.ms-excel",
    buffer: workbook.buffer
  }, "訂單 Excel");
  await mallbicClickFirst(page, ["#a_upload", "span#a_upload", "span:has-text('上傳')", "text=上傳"], "上傳");
  await wait(1500);

  const result = await waitForMallbicText(page, ["已經成功匯入", "成功匯入", "匯入失敗", "錯誤", "無效的商品資料"], 120000);
  const failureLine = result.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("匯入失敗") || line.includes("錯誤") || line.includes("無效的商品資料"));
  if (failureLine) {
    throw new Error(`墨筆克訂單匯入失敗：${failureLine}`);
  }

  const countMatch = result.text.match(/共新增了\s*(\d+)\s*筆訂單資料/);
  await mallbicCloseOpenDialogs(page);
  return {
    importedCount: countMatch ? Number(countMatch[1]) : null,
    message: result.text.split(/\r?\n/).find((line) => line.includes("成功匯入")) || "墨筆克訂單匯入成功"
  };
}

async function mallbicCloseOpenDialogs(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closeButton = await mallbicFindFirst(page, [
      ".our_dlg_base .btn_close_m",
      ".our_dlg_title_content .btn_close_m",
      ".btn_close_m",
      ".ui-dialog-titlebar-close",
      "[title*='ESC']",
      "[title='關閉']"
    ]);
    if (!closeButton) return;

    try {
      await closeButton.click({ timeout: 5000 });
    } catch {
      await closeButton.click({ timeout: 5000, force: true }).catch(() => {});
    }
    await wait(500);
  }
}

async function mallbicSelectCustomTransactionPlatform(page, { required = false } = {}) {
  const platformSelect = await mallbicFindFirst(page, [
    "select.platform-select",
    ".platform-select",
    "select:has(option[value='2'])"
  ], { visible: false });

  if (!platformSelect) {
    if (required) throw new Error("找不到墨筆克平台篩選欄位：自訂交易");
    return false;
  }

  try {
    await platformSelect.evaluate((select) => {
      select.value = "2";
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  } catch {
    try {
      await platformSelect.selectOption("2", { timeout: 3000, force: true });
    } catch {
      await platformSelect.selectOption({ label: "自訂交易" }, { timeout: 3000, force: true });
    }
  }

  await wait(500);
  return true;
}

async function mallbicSearchOrders(page, keyword, status = "-1") {
  await mallbicOpenOrderPage(page);
  await mallbicCloseOpenDialogs(page);

  if (!await mallbicFindFirst(page, ["#srch_status", "select#srch_status"])) {
    await mallbicClickFirst(page, ["#option", "a#option[title*='搜尋']", "a#option"], "搜尋選項");
    await wait(500);
  }

  await mallbicSelectFirst(page, ["#srch_status", "select#srch_status"], status, "訂單狀態");
  const platformSelectedBeforeSearch = await mallbicSelectCustomTransactionPlatform(page);
  await mallbicFillFirst(page, [
    "textarea[title*='搜尋']",
    "textarea.deactive",
    "textarea"
  ], keyword, "訂單號");
  await mallbicClickFirst(page, ["#search", "a#search[title*='搜尋']", "a#search"], "搜尋");
  await wait(1500);

  const platformSelectedAfterSearch = await mallbicSelectCustomTransactionPlatform(page, { required: !platformSelectedBeforeSearch });
  if (!platformSelectedBeforeSearch && platformSelectedAfterSearch) {
    await mallbicClickFirst(page, ["#search", "a#search[title*='搜尋']", "a#search"], "搜尋");
  }

  await wait(4000);
}

async function extractMallbicOrderNumberFromSearch(page) {
  for (const root of mallbicRoots(page)) {
    for (const selector of ["tr.cls_txn_first_row a#link_txn", "a#link_txn"]) {
      try {
        const locator = root.locator(selector);
        const count = Math.min(await locator.count(), 10);
        for (let index = 0; index < count; index += 1) {
          const item = locator.nth(index);
          if (!await item.isVisible().catch(() => false)) continue;
          const text = (await item.innerText({ timeout: 1000 }).catch(() => "")).trim();
          if (/^\d{6,}$/.test(text)) return text;
        }
      } catch {
        // Try the next selector/root.
      }
    }

    try {
      const row = root.locator("tr.cls_txn_first_row[id]").first();
      const rowId = (await row.getAttribute("id", { timeout: 1000 }).catch(() => "") || "").trim();
      if (/^\d{6,}$/.test(rowId)) return rowId;
    } catch {
      // Continue with checkbox fallback.
    }

    try {
      const checkbox = root.locator("input[name='chk_order_txn']").first();
      const value = (await checkbox.getAttribute("value", { timeout: 1000 }).catch(() => "") || "").trim();
      const orderNumber = value.split("|")[0];
      if (/^\d{6,}$/.test(orderNumber)) return orderNumber;
    } catch {
      // No usable row in this frame.
    }
  }

  return "";
}

async function lookupMallbicOrderNumber(page, orderId) {
  await mallbicSearchOrders(page, orderId, "-1");
  return extractMallbicOrderNumberFromSearch(page);
}

async function lookupMallbicOrderInStatus(page, keyword, status) {
  await mallbicSearchOrders(page, keyword, status);
  return extractMallbicOrderNumberFromSearch(page);
}

async function cancelMallbicOrder(page, order) {
  await mallbicOpenOrderPage(page);
  await mallbicClickFirst(page, ["#option", "a#option[title='搜尋選項']", "a[title='搜尋選項']"], "搜尋選項");
  await wait(500);
  await mallbicSelectFirst(page, ["#srch_status", "select#srch_status"], "0", "訂單狀態");
  await mallbicFillFirst(page, [
    "textarea[title*='搜尋多組關鍵字']",
    "textarea.deactive",
    "textarea"
  ], order.mallbic?.mallbicOrderNo || order.id, "訂單號");
  await mallbicClickFirst(page, ["#search", "a#search[title*='搜尋']", "a#search"], "搜尋");
  await wait(3000);
  await mallbicClickFirst(page, ["#chk_select_all", "input#chk_select_all"], "全選訂單");
  await wait(500);
  await mallbicClickFirst(page, [
    "#ddlist_cancel",
    "li#ddlist_cancel",
    "li[title*='取消交易']",
    "li:has-text('取消交易')"
  ], "取消交易");
  await wait(500);
  await mallbicClickFirst(page, [
    "li[dropdown-name='買家取消']",
    "li:has-text('買家取消')",
    "text=買家取消"
  ], "買家取消");
  await wait(500);
  await mallbicClickFirst(page, ["#a_confirm", "span#a_confirm", "span:has-text('確認')", "text=確認"], "確認取消");
  await wait(1000);

  return { message: "墨筆克取消訂單已送出" };
}

async function exportMallbicInventoryWorkbook({ account, password }) {
  const browser = await launchChromiumBrowser();

  try {
    const context = await browser.newContext({ acceptDownloads: true, locale: "zh-TW" });
    const page = await context.newPage();
    page.setDefaultTimeout(mallbicDefaultTimeoutMs);
    page.setDefaultNavigationTimeout(mallbicNavTimeoutMs);
    page.on("dialog", async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    await mallbicLoginIfNeeded(page, { account, password });
    await mallbicDismissBlockingDialogs(page);
    await mallbicTrySelectCompany(page, mallbicCompanyName);
    await mallbicDismissBlockingDialogs(page);
    await mallbicOpenInventoryPage(page);
    await mallbicDismissBlockingDialogs(page);

    const exportSelectors = [
      "li.tool_btn.ignore-mbc-title[title='匯出商品資料']",
      "li[title='匯出商品資料']",
      "li:has-text('匯出商品資料')",
      "text=匯出商品資料"
    ];

    const downloadPromise = page.waitForEvent("download", { timeout: mallbicExportTimeoutMs });
    downloadPromise.catch(() => {});
    await mallbicClickFirst(page, exportSelectors, "匯出商品資料");

    const confirmDeadline = Date.now() + 30000;
    while (Date.now() < confirmDeadline) {
      const downloadStarted = await Promise.race([
        downloadPromise.then(() => true),
        wait(500).then(() => false)
      ]);
      if (downloadStarted) break;

      await mallbicDismissBlockingDialogs(page);
      const okButton = await mallbicFindFirst(page, ["#btn_ok", "span#btn_ok", "button:has-text('確定')", "text=確定"]);
      if (okButton) {
        try {
          await okButton.click({ timeout: 5000 });
        } catch {
          await okButton.click({ timeout: 5000, force: true });
        }
        break;
      }
    }

    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("墨筆克匯出完成，但下載檔案無法讀取");

    return {
      buffer: await fs.readFile(downloadPath),
      suggestedFilename: download.suggestedFilename()
    };
  } finally {
    await browser.close();
  }
}

function parseProductImportRows(rows) {
  const requiredHeaders = ["商品名稱", "款式", "品項條碼", "售價", "數量"];
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
  const categoryIndex = indexOf("分類");
  const subCategoryIndex = indexOf("子分類");
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
    const marketName = marketIndex >= 0 ? String(row[marketIndex] || "").trim() : "";
    const categoryName = categoryIndex >= 0 ? String(row[categoryIndex] || "").trim() : "";
    const subCategoryName = subCategoryIndex >= 0 ? String(row[subCategoryIndex] || "").trim() : "";
    const productName = String(row[productIndex] || "").trim();
    const variantName = String(row[variantIndex] || "").trim();
    const barcode = String(row[barcodeIndex] || "").trim();
    const price = Number(row[priceIndex]);
    const stock = Number(row[stockIndex]);

    if (!categoryName && !marketName && !productName && !variantName && !barcode) continue;
    if (!productName || !variantName || !barcode) {
      return { error: `資料缺少必要欄位：${barcode || productName || categoryName || "空白列"}` };
    }
    if (!Number.isFinite(price) || price < 0) return { error: `${barcode} 售價格式錯誤` };
    if (!Number.isInteger(stock) || stock < 0) return { error: `${barcode} 數量格式錯誤` };

    items.push({
      marketName,
      categoryName,
      subCategoryName,
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

app.get("/api/orders", requireAdminApi, async (_req, res) => {
  const orders = await readOrders();
  res.json({ orders: orders.slice().reverse() });
});

app.post("/api/admin/orders/:id/cancel-request/approve", async (req, res) => {
  const orders = await readOrders();
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ message: "找不到訂單" });
  if (order.cancelRequest?.status !== "pending") {
    return res.status(400).json({ message: "這筆訂單目前沒有待審核的取消申請" });
  }

  const catalog = await readCatalog();
  restoreOrderStock(catalog, order);
  prepareCancelledOrder(order, "admin");

  await writeCatalog(catalog);
  await writeOrders(orders);

  res.json({ order, message: "已同意取消訂單" });
});

app.post("/api/admin/orders/:id/cancel-request/reject", async (req, res) => {
  const orders = await readOrders();
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ message: "找不到訂單" });
  if (order.cancelRequest?.status !== "pending") {
    return res.status(400).json({ message: "這筆訂單目前沒有待審核的取消申請" });
  }

  rejectCancelRequest(order, "admin");
  await writeOrders(orders);

  res.json({ order, message: "已拒絕取消申請" });
});

app.get("/api/buyer/orders", requireBuyerApi, async (req, res) => {
  const orders = await readOrders();
  const matchedOrders = findBuyerOrders(orders, { phone: req.buyer.phone }).map(publicOrderView);

  res.json({ orders: matchedOrders });
});

app.post("/api/buyer/orders/:id/cancel", requireBuyerApi, async (req, res) => {
  const orders = await readOrders();
  const order = findBuyerOrders(orders, { phone: req.buyer.phone, orderId: req.params.id })[0];
  if (!order) return res.status(404).json({ message: "查不到這筆訂單" });
  if (!canBuyerRequestCancelOrder(order)) {
    return res.status(400).json({ message: order.cancelRequest?.status === "pending" ? "這筆訂單已送出取消申請，請等待賣家確認" : "這筆訂單目前不能申請取消，請聯絡賣家處理" });
  }

  requestCancelOrder(order, "buyer");
  await writeOrders(orders);

  res.json({ order: publicOrderView(order), message: "取消申請已送出，等待賣家同意" });
});

app.post("/api/orders/lookup", requireBuyerApi, async (req, res) => {
  const { phone, orderId } = req.body || {};
  const orders = await readOrders();
  const matchedOrders = findBuyerOrders(orders, { phone: req.buyer.phone || phone, orderId }).map(publicOrderView);

  res.json({ orders: matchedOrders });
});

app.post("/api/orders/cancel", requireBuyerApi, async (req, res) => {
  const { orderId } = req.body || {};
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanOrderId) {
    return res.status(400).json({ message: "請輸入訂單編號" });
  }

  const orders = await readOrders();
  const order = findBuyerOrders(orders, { phone: req.buyer.phone, orderId: cleanOrderId })[0];
  if (!order) return res.status(404).json({ message: "查不到這筆訂單，請確認手機號碼與訂單編號" });
  if (!canBuyerRequestCancelOrder(order)) {
    return res.status(400).json({ message: order.cancelRequest?.status === "pending" ? "這筆訂單已送出取消申請，請等待賣家確認" : "這筆訂單目前不能申請取消，請聯絡賣家處理" });
  }

  requestCancelOrder(order, "buyer");
  await writeOrders(orders);

  res.json({ order: publicOrderView(order), message: "取消申請已送出，等待賣家同意" });
});

app.post("/api/orders", requireBuyerApi, async (req, res) => {
  const { lineUserId, customerName, phone, deliveryMethod, deliveryAddress, note, items } = req.body;
  const buyer = req.buyer;
  const orderCustomerName = String(buyer?.name || customerName || "").trim();
  const orderPhone = String(buyer?.phone || phone || "").trim();
  const cleanDeliveryMethod = String(deliveryMethod || "").trim();
  const cleanDeliveryAddress = String(deliveryAddress || "").trim();
  const rawSevenElevenStore = req.body?.sevenElevenStore || {};
  const cleanSevenElevenStore = {
    id: String(rawSevenElevenStore.id || rawSevenElevenStore.code || req.body?.sevenElevenStoreId || "").trim(),
    name: String(rawSevenElevenStore.name || req.body?.sevenElevenStoreName || "").trim(),
    address: String(rawSevenElevenStore.address || req.body?.sevenElevenStoreAddress || "").trim()
  };

  if (!["宅配", "自行取貨", sevenElevenDeliveryMethod].includes(cleanDeliveryMethod)) {
    return res.status(400).json({ message: "請選擇取貨方式" });
  }

  if (cleanDeliveryMethod === "宅配" && !cleanDeliveryAddress) {
    return res.status(400).json({ message: "宅配請填寫地址" });
  }

  if (cleanDeliveryMethod === sevenElevenDeliveryMethod) {
    if (!cleanSevenElevenStore.id || !cleanSevenElevenStore.name || !cleanSevenElevenStore.address) {
      return res.status(400).json({ message: "請填寫 7-11 門市店號、名稱與地址" });
    }
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

  const productTotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
  const shippingFee = cleanDeliveryMethod === sevenElevenDeliveryMethod ? sevenElevenShippingFee : 0;
  const totalAmount = productTotal + shippingFee;
  const order = {
    id: `ORD-${Date.now()}`,
    buyerId: buyer?.id || "",
    lineUserId: lineUserId || "guest",
    customerName: orderCustomerName,
    phone: orderPhone,
    deliveryMethod: cleanDeliveryMethod,
    deliveryAddress: cleanDeliveryMethod === "宅配"
      ? cleanDeliveryAddress
      : cleanDeliveryMethod === sevenElevenDeliveryMethod
        ? cleanSevenElevenStore.address
        : "",
    sevenElevenStore: cleanDeliveryMethod === sevenElevenDeliveryMethod ? cleanSevenElevenStore : null,
    note: note || "",
    items: normalizedItems,
    productTotal,
    shippingFee,
    totalAmount,
    status: "pending",
    mallbic: {
      importStatus: "pending",
      importedAt: "",
      importError: "",
      importFileName: "",
      importRowCount: 0,
      mallbicOrderNo: "",
      cancelStatus: "",
      cancelledAt: "",
      cancelError: ""
    },
    myship: {
      createStatus: cleanDeliveryMethod === sevenElevenDeliveryMethod ? "pending" : "notNeeded",
      createdAt: "",
      updatedAt: "",
      error: "",
      productUrl: myshipProductUrl,
      quantity: 0,
      orderNo: "",
      lastScreenshot: ""
    },
    createdAt: new Date().toISOString()
  };

  const orders = await readOrders();
  orders.push(order);
  await writeOrders(orders);

  queueMyshipOrderSync("order-created");

  res.status(201).json({ order, summary: buildOrderSummary(order) });
});

app.patch("/api/orders/:id/status", requireAdminApi, async (req, res) => {
  const status = normalizeOrderStatus(req.body?.status);
  const allowedStatuses = new Set(["pending", "processing", "shipped", "cancelled"]);

  if (!allowedStatuses.has(status)) return res.status(400).json({ message: "訂單狀態不正確" });

  const orders = await readOrders();
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ message: "找不到訂單" });

  if (status === "cancelled") {
    const catalog = await readCatalog();
    restoreOrderStock(catalog, order);
    prepareCancelledOrder(order, "admin");
    await writeCatalog(catalog);
  } else {
    order.status = status;
    order.updatedAt = new Date().toISOString();
    order.mallbic = normalizeOrderMallbicSync(order);
  }
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

function startMallbicAutoSync() {
  if (!mallbicAutoSyncEnabled) {
    console.log("Mallbic hourly inventory sync is disabled.");
    return;
  }

  if (!String(process.env.MALLBIC_ACCOUNT || "").trim() || !String(process.env.MALLBIC_PASSWORD || "").trim()) {
    console.warn("Mallbic hourly inventory sync is enabled, but MALLBIC_ACCOUNT/MALLBIC_PASSWORD are not set.");
    return;
  }

  const intervalMinutes = Math.round(mallbicAutoSyncIntervalMs / 60000);
  console.log(`Mallbic hourly inventory sync enabled. Interval: ${intervalMinutes} minutes.`);

  const runAutoSync = async () => {
    if (mallbicSyncRunning) {
      console.log("Mallbic hourly inventory sync skipped because another sync is running.");
      return;
    }

    try {
      const result = await runMallbicInventorySync("auto");
      console.log(`Mallbic hourly inventory sync finished. Updated ${result.updatedCount} items.`);
    } catch (error) {
      console.error("Mallbic hourly inventory sync failed:", error);
    }
  };

  setTimeout(runAutoSync, mallbicAutoSyncIntervalMs);
  setInterval(runAutoSync, mallbicAutoSyncIntervalMs);
}

function startMallbicOrderAutoSync() {
  if (!mallbicOrderAutoSyncEnabled) {
    console.log("Mallbic order sync is disabled.");
    return;
  }

  if (!String(process.env.MALLBIC_ACCOUNT || "").trim() || !String(process.env.MALLBIC_PASSWORD || "").trim()) {
    console.warn("Mallbic order sync is enabled, but MALLBIC_ACCOUNT/MALLBIC_PASSWORD are not set.");
    return;
  }

  const intervalMinutes = Math.round(mallbicOrderAutoSyncIntervalMs / 60000);
  console.log(`Mallbic order sync enabled. Interval: ${intervalMinutes} minutes.`);

  const runAutoSync = async () => {
    if (mallbicOrderSyncRunning) {
      console.log("Mallbic order sync skipped because another sync is running.");
      return;
    }

    try {
      const result = await runMallbicOrderSync("auto");
      console.log(`Mallbic order sync finished. Imported ${result.importedOrders} orders, cancelled ${result.cancelledOrders} orders.`);
    } catch (error) {
      console.error("Mallbic order sync failed:", error);
    }
  };

  setTimeout(runAutoSync, mallbicOrderAutoSyncIntervalMs);
  setInterval(runAutoSync, mallbicOrderAutoSyncIntervalMs);
}

function queueMyshipOrderSync(trigger) {
  if (!myshipAutoOrderEnabled) return;
  if (myshipOrderSyncRunning) return;
  if (missingMyshipKeys().length) {
    console.warn("MyShip auto order sync is enabled, but MYSHIP_* variables are not fully set.");
    return;
  }

  setTimeout(async () => {
    if (myshipOrderSyncRunning) return;
    try {
      const result = await runMyshipOrderSync(trigger);
      console.log(`MyShip order sync finished. Created ${result.createdOrders} orders, failed ${result.failedOrders}.`);
    } catch (error) {
      console.error("MyShip order sync failed:", error);
    }
  }, 1000);
}

function startMyshipOrderAutoSync() {
  if (!myshipAutoOrderEnabled) {
    console.log("MyShip order sync is disabled.");
    return;
  }

  if (missingMyshipKeys().length) {
    console.warn("MyShip order sync is enabled, but MYSHIP_* variables are not fully set.");
    return;
  }

  const intervalMinutes = Math.round(myshipAutoOrderIntervalMs / 60000);
  console.log(`MyShip order sync enabled. Interval: ${intervalMinutes} minutes.`);
  setTimeout(() => queueMyshipOrderSync("auto"), myshipAutoOrderIntervalMs);
  setInterval(() => queueMyshipOrderSync("auto"), myshipAutoOrderIntervalMs);
}

app.listen(port, () => {
  console.log(`LINE slipper order system running at http://localhost:${port}`);
  startMallbicAutoSync();
  startMallbicOrderAutoSync();
  startMyshipOrderAutoSync();
});
