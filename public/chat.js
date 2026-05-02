const chatMessagesEl = document.querySelector("#chatMessages");
const chatFormEl = document.querySelector("#buyerChatForm");
const chatMessageEl = document.querySelector("#chatMessage");
const chatBuyerSummaryEl = document.querySelector("#chatBuyerSummary");
const refreshChatButtonEl = document.querySelector("#refreshChatButton");

let currentBuyer = null;
let chatLoading = false;
let lastChatSignature = "";

const CHAT_REFRESH_MS = 3000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function renderMessages(messages = []) {
  if (!messages.length) {
    chatMessagesEl.innerHTML = '<p class="empty">還沒有訊息，可以直接傳訊息給賣家。</p>';
    return;
  }

  chatMessagesEl.innerHTML = messages.map((message) => `
    <article class="chat-bubble ${message.sender === "buyer" ? "is-buyer" : "is-seller"}">
      <p>${escapeHtml(message.text)}</p>
      <time>${escapeHtml(formatDateTime(message.createdAt))}</time>
    </article>
  `).join("");
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function loadBuyerStatus() {
  const response = await fetch("/api/buyer/status");
  const data = await response.json();
  if (!data.authenticated) {
    window.location.href = "/orders.html";
    return false;
  }

  currentBuyer = data.buyer;
  chatBuyerSummaryEl.textContent = `${currentBuyer.name || "買家"}，可以在這裡傳訊息給賣家。`;
  return true;
}

function chatSignature(messages = []) {
  return messages.map((message) => `${message.id}:${message.sender}:${message.createdAt}:${message.text}`).join("|");
}

async function loadChat({ force = false } = {}) {
  if (chatLoading) return;
  if (document.hidden && !force) return;

  chatLoading = true;
  try {
    const response = await fetch("/api/buyer/chat");
    if (response.status === 401) {
      window.location.href = "/orders.html";
      return;
    }

    const data = await response.json();
    const messages = data.messages || [];
    const nextSignature = chatSignature(messages);
    if (force || nextSignature !== lastChatSignature) {
      lastChatSignature = nextSignature;
      renderMessages(messages);
    }
  } finally {
    chatLoading = false;
  }
}

chatFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  chatMessageEl.textContent = "";

  const text = chatFormEl.elements.text.value.trim();
  if (!text) {
    chatMessageEl.textContent = "請輸入訊息";
    return;
  }

  const response = await fetch("/api/buyer/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const data = await response.json();

  if (!response.ok) {
    chatMessageEl.textContent = data.message || "訊息送出失敗";
    return;
  }

  chatFormEl.reset();
  renderMessages(data.messages || []);
});

refreshChatButtonEl.addEventListener("click", () => loadChat({ force: true }));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentBuyer) loadChat({ force: true });
});

loadBuyerStatus().then((authenticated) => {
  if (!authenticated) return;
  loadChat({ force: true });
  setInterval(loadChat, CHAT_REFRESH_MS);
});
