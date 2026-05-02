async function fetchJsonOrNull(url) {
  try {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function refreshHeaderAuth() {
  const [adminStatus, buyerStatus] = await Promise.all([
    fetchJsonOrNull("/api/auth/status"),
    fetchJsonOrNull("/api/buyer/status")
  ]);

  const isBuyer = Boolean(buyerStatus?.authenticated);
  const isAdmin = Boolean(adminStatus?.authenticated) && !isBuyer;

  document.querySelectorAll("[data-admin-link]").forEach((element) => {
    element.classList.toggle("hidden", !isAdmin);
  });

  document.querySelectorAll("[data-buyer-logout]").forEach((element) => {
    element.classList.toggle("hidden", !isBuyer);
  });

  document.querySelectorAll("[data-buyer-chat]").forEach((element) => {
    element.classList.toggle("hidden", !isBuyer);
  });
}

document.addEventListener("click", async (event) => {
  const logoutButton = event.target.closest("[data-buyer-logout]");
  if (!logoutButton) return;

  logoutButton.disabled = true;
  await fetch("/api/buyer/logout", { method: "POST" });

  if (window.location.pathname.endsWith("/orders.html") || window.location.pathname.endsWith("/chat.html")) {
    window.location.reload();
    return;
  }

  logoutButton.disabled = false;
  await refreshHeaderAuth();
});

refreshHeaderAuth();
