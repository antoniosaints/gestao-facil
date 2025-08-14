htmx.on("htmx:responseError", (e) => {
  showNotification(
    JSON.parse(e.detail.xhr.responseText)?.message ||
      "Erro inesperado na requisição",
    "error"
  );
  if (e.detail.xhr.status === 401) {
    showNotification("Sua sessão expirou", "error");
    renewSessionUserByRefreshToken();
  }
});

htmx.on("htmx:afterRequest", (e) => {
  if (e.detail.xhr.status === 401) {
    showNotification("Sua sessão expirou", "error");
    renewSessionUserByRefreshToken();
  }
});

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);

  if (response.status === 401) {
    showNotification("Sua sessão expirou", "error");
    renewSessionUserByRefreshToken();
  }

  return response;
};

(function (open) {
  XMLHttpRequest.prototype.open = function (method, url, async, user, pass) {
    this.addEventListener("load", function () {
      if (this.status === 401) {
        showNotification("Sua sessão expirou", "error");
        renewSessionUserByRefreshToken();
      }
    });
    open.call(this, method, url, async, user, pass);
  };
})(XMLHttpRequest.prototype.open);

function renewSessionUserByRefreshToken() {
  $.ajax({
    url: `/api/auth/renew`,
    method: "GET",
    headers: {
      Authorization:
        "Bearer " + localStorage.getItem("gestao_facil:refreshToken"),
    },
    contentType: "application/json",
    dataType: "json",
    success: (response) => {
      localStorage.setItem("gestao_facil:token", response.data.token);
      localStorage.setItem(
        "gestao_facil:refreshToken",
        response.data.refreshToken
      );
      localStorage.setItem("gestao_facil:usuario", response.data.id);
      localStorage.setItem("gestao_facil:username", response.data.nome);
      localStorage.setItem("gestao_facil:permissao", response.data.permissao);
      localStorage.setItem("gestao_facil:isauth", true);

      showNotification("Token de sessão renovado!", "success");
    },
    error: (xhr) => {
      console.log(xhr);
      localStorage.removeItem("gestao_facil:token");
      localStorage.removeItem("gestao_facil:refreshToken");
      localStorage.removeItem("gestao_facil:usuario");
      localStorage.removeItem("gestao_facil:username");
      localStorage.removeItem("gestao_facil:permissao");
      localStorage.setItem("gestao_facil:isauth", false);
      window.location.href = "/login";
    },
  }).then(() => {
    htmx.ajax("GET", location.pathname, { target: "#content" });
  });
}
