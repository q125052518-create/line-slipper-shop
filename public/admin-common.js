const adminMenuSections = [
  {
    title: "訂單管理",
    links: [
      { href: "/admin-orders.html", label: "訂單後台" },
      { href: "/admin-tools.html", label: "匯入同步" }
    ]
  },
  {
    title: "商品管理",
    links: [
      { href: "/admin-market.html", label: "賣場設定" },
      { href: "/admin.html", label: "我的商品" },
      { href: "/admin-categories.html", label: "分類管理" },
      { href: "/admin-layout.html", label: "賣場布置" },
      { href: "/admin-stats.html", label: "數據統計" }
    ]
  },
  {
    title: "客服管理",
    links: [
      { href: "/admin-chat.html", label: "買家聊聊" }
    ]
  },
  {
    title: "系統",
    links: [
      { href: "/", label: "下單頁" }
    ],
    logout: true
  }
];

function isCurrentAdminPath(href) {
  const currentPath = window.location.pathname || "/admin.html";
  return currentPath === href;
}

function renderAdminSidebar() {
  if (document.querySelector(".admin-sidebar")) return;
  document.body.classList.add("admin-page");

  const sidebar = document.createElement("aside");
  sidebar.className = "admin-sidebar";
  sidebar.innerHTML = `
    <div class="admin-sidebar-brand">
      <p class="eyebrow">Admin</p>
      <h2>拖鞋賣場</h2>
    </div>
    <nav class="admin-menu" aria-label="後台選單">
      ${adminMenuSections.map((section) => `
        <section class="admin-menu-section">
          <div class="admin-menu-title">
            <span>${section.title}</span>
            <span aria-hidden="true">⌃</span>
          </div>
          <div class="admin-menu-links">
            ${section.links.map((link) => `
              <a class="admin-menu-link ${isCurrentAdminPath(link.href) ? "is-current" : ""}" href="${link.href}">
                ${link.label}
              </a>
            `).join("")}
            ${section.logout ? '<button type="button" class="admin-menu-link admin-menu-button" data-admin-logout>登出</button>' : ""}
          </div>
        </section>
      `).join("")}
    </nav>
  `;
  document.body.insertBefore(sidebar, document.body.firstChild);
}

async function logoutAdmin() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
}

renderAdminSidebar();

document.querySelectorAll("#logoutButton, [data-admin-logout]").forEach((button) => {
  button.addEventListener("click", logoutAdmin);
});
