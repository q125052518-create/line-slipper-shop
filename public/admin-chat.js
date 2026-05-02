const chatListEl = document.querySelector("#chatList");
const chatThreadHeadEl = document.querySelector("#chatThreadHead");
const chatThreadMessagesEl = document.querySelector("#chatThreadMessages");
const sellerChatFormEl = document.querySelector("#sellerChatForm");
const sellerChatMessageEl = document.querySelector("#sellerChatMessage");
const refreshChatsButtonEl = document.querySelector("#refreshChatsButton");

let selectedChatBuyerId = "";
let adminChatLoading = false;
let chatStream = null;
let reconnectTimer = null;
let lastListSignature = "";
let lastThreadSignature = "";

const CHAT_REFRESH_MS = 1500;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "尚未執行";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function cacheBust(url) {
  return `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;
}

async function fetchJson(url) {
  const response = await fetch(cacheBust(url), { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "讀取失敗");
  }
  return data;
}

function listSignature(conversations = []) {
  return conversations
    .map((conversation) => {
      const lastMessage = conversation.lastMessage || {};
      return [
        conversation.buyerId,
        conversation.updatedAt,
        conversation.sellerUnreadCount,
        lastMessage.id,
        lastMessage.text,
        lastMessage.createdAt
      ].join(":");
    })
    .join("|");
}

function messageSignature(messages = []) {
  return messages
    .map((message) => [
      message.id,
      message.sender,
      message.text,
      message.createdAt,
      message.readByBuyerAt
    ].join(":"))
    .join("|");
}

function renderAdminChatMessages(messages = []) {
  if (!messages.length) {
    chatThreadMessagesEl.innerHTML = '<p class="empty">這個對話還沒有訊息</p>';
    return;
  }

  chatThreadMessagesEl.innerHTML = messages.map((message) => `
    <article class="chat-bubble ${message.sender === "buyer" ? "is-buyer" : "is-seller"}">
      <p>${escapeHtml(message.text)}</p>
      <time>${escapeHtml(message.sender === "buyer" ? "買家" : (message.readByBuyerAt ? "已讀" : "未讀"))}｜${escapeHtml(formatDateTime(message.createdAt))}</time>
    </article>
  `).join("");
  chatThreadMessagesEl.scrollTop = chatThreadMessagesEl.scrollHeight;
}

function renderChatList(conversations = []) {
  if (!conversations.length) {
    chatListEl.innerHTML = '<p class="empty">目前沒有買家訊息</p>';
    return;
  }

  chatListEl.innerHTML = conversations.map((conversation) => {
    const lastMessage = conversation.lastMessage;
    const senderLabel = lastMessage?.sender === "seller" ? "賣家" : "買家";
    const unread = Number(conversation.sellerUnreadCount || 0);

    return `
      <button type="button" class="admin-chat-list-item ${selectedChatBuyerId === conversation.buyerId ? "is-selected" : ""}" data-chat-buyer-id="${escapeHtml(conversation.buyerId)}">
        <span>
          <strong>${escapeHtml(conversation.buyerName || "未命名買家")}</strong>
          <small>${escapeHtml(conversation.buyerPhone || "-")}</small>
        </span>
        ${unread > 0 ? `<em>未讀 ${unread}</em>` : ""}
        <p>${lastMessage ? `${senderLabel}：${escapeHtml(lastMessage.text)}` : "尚無訊息"}</p>
      </button>
    `;
  }).join("");
}

async function loadChats({ force = false } = {}) {
  const data = await fetchJson("/api/admin/chats");
  const conversations = data.conversations || [];
  const nextSignature = listSignature(conversations);
  if (force || nextSignature !== lastListSignature) {
    lastListSignature = nextSignature;
    renderChatList(conversations);
  }
}

async function loadChatThread(buyerId, { silent = false, force = false } = {}) {
  const isSwitchingThread = selectedChatBuyerId !== buyerId;
  selectedChatBuyerId = buyerId;
  if (isSwitchingThread) lastThreadSignature = "";
  if (!silent) sellerChatMessageEl.textContent = "";

  const data = await fetchJson(`/api/admin/chats/${encodeURIComponent(buyerId)}`);
  const messages = data.messages || [];
  const nextSignature = messageSignature(messages);

  chatThreadHeadEl.innerHTML = `
    <h3>${escapeHtml(data.buyerName || "未命名買家")}</h3>
    <p class="muted">${escapeHtml(data.buyerPhone || "-")}</p>
  `;
  sellerChatFormEl.classList.remove("hidden");

  if (force || nextSignature !== lastThreadSignature) {
    lastThreadSignature = nextSignature;
    renderAdminChatMessages(messages);
  }

  await loadChats({ force });
}

async function refreshChatsLive({ force = false } = {}) {
  if (adminChatLoading) return;

  adminChatLoading = true;
  try {
    if (selectedChatBuyerId) {
      await loadChatThread(selectedChatBuyerId, { silent: true, force });
    } else {
      await loadChats({ force });
    }
  } catch (error) {
    sellerChatMessageEl.textContent = error.message || "聊聊更新失敗";
  } finally {
    adminChatLoading = false;
  }
}

function connectChatStream() {
  if (!window.EventSource) return;

  if (chatStream) chatStream.close();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  chatStream = new EventSource("/api/admin/chats/stream");
  chatStream.addEventListener("ready", () => refreshChatsLive({ force: true }));
  chatStream.addEventListener("chat", () => refreshChatsLive({ force: true }));
  chatStream.onerror = () => {
    chatStream?.close();
    reconnectTimer = setTimeout(connectChatStream, 3000);
  };
}

refreshChatsButtonEl.addEventListener("click", () => refreshChatsLive({ force: true }));

chatListEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-chat-buyer-id]");
  if (!button) return;

  try {
    await loadChatThread(button.dataset.chatBuyerId, { force: true });
  } catch (error) {
    sellerChatMessageEl.textContent = error.message || "讀取對話失敗";
  }
});

sellerChatFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  sellerChatMessageEl.textContent = "";
  if (!selectedChatBuyerId) {
    sellerChatMessageEl.textContent = "請先選擇買家對話";
    return;
  }

  const text = sellerChatFormEl.elements.text.value.trim();
  if (!text) {
    sellerChatMessageEl.textContent = "請輸入回覆內容";
    return;
  }

  const response = await fetch(`/api/admin/chats/${encodeURIComponent(selectedChatBuyerId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const data = await response.json();

  if (!response.ok) {
    sellerChatMessageEl.textContent = data.message || "回覆失敗";
    return;
  }

  sellerChatFormEl.reset();
  lastThreadSignature = "";
  renderAdminChatMessages(data.messages || []);
  await loadChats({ force: true });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshChatsLive({ force: true });
});
window.addEventListener("focus", () => refreshChatsLive({ force: true }));
window.addEventListener("pageshow", () => refreshChatsLive({ force: true }));

connectChatStream();
refreshChatsLive({ force: true });
setInterval(() => refreshChatsLive(), CHAT_REFRESH_MS);
