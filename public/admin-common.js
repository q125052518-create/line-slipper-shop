const logoutButtonEl = document.querySelector("#logoutButton");

logoutButtonEl?.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});
