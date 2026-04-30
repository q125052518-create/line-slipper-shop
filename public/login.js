const formEl = document.querySelector("#loginForm");
const messageEl = document.querySelector("#message");

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "";

  const formData = new FormData(formEl);
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: formData.get("password") })
  });

  if (!response.ok) {
    const data = await response.json();
    messageEl.textContent = data.message || "登入失敗";
    return;
  }

  window.location.href = "/admin.html";
});
