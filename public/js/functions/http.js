async function htmxRequest(url, target) {
  return await htmx.ajax("GET", url, {
    target,
    swap: "innerHTML",
    headers: {
      Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
    },
  });
}

async function loadPage(pagePath) {
  return await htmxRequest(pagePath, "#content");
}

async function loadSidebarOptionsMenu() {
  return await htmxRequest("/sidebar/menu", "#content-sidebar-menu");
}

// Intercepta globalmente erros do htmx
htmx.on("body", "htmx:responseError", async (e) => {
  const msg =
    JSON.parse(e.detail.xhr.responseText)?.message ||
    "Erro inesperado na requisição";

  showNotification(msg, "error");

  if (e.detail.xhr.status === 401) await handleUnauthorized();
});

// Intercepta globalmente erros do fetch
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.status === 401) await handleUnauthorized();
  return response;
};

async function handleUnauthorized() {
  showNotification("Sua sessão expirou", "error");
  await renewSessionUserByRefreshToken();
}

async function renewSessionUserByRefreshToken() {
  const refreshToken = localStorage.getItem("gestao_facil:refreshToken");
  if (!refreshToken) return (window.location.href = "/login");

  try {
    const response = await fetch(`/api/auth/renew`, {
      method: "GET",
      headers: { Authorization: "Bearer " + refreshToken },
    });

    if (!response.ok) throw new Error("Falha ao renovar sessão");

    const data = await response.json();

    localStorage.setItem("gestao_facil:token", data.data.token);
    localStorage.setItem("gestao_facil:refreshToken", data.data.refreshToken);
    localStorage.setItem("gestao_facil:usuario", data.data.id);
    localStorage.setItem("gestao_facil:username", data.data.nome);
    localStorage.setItem("gestao_facil:permissao", data.data.permissao);
    localStorage.setItem("gestao_facil:isauth", true);

    showNotification("Token de sessão renovado!", "success");
    await loadSidebarOptionsMenu();
    atualizarLogoSistema();
    htmx.ajax("GET", location.pathname, { target: "#content" });
  } catch (err) {
    console.error(err);
    localStorage.clear();
    localStorage.setItem("gestao_facil:isauth", false);
    window.location.href = "/login";
  }
}
