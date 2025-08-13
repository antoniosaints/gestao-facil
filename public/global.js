$(".datatable thead th:last-child").addClass("text-end");

document.addEventListener("DOMContentLoaded", () => {
  fetch(`/api/auth/check`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
    },
  })
    .then((res) => res.json())
    .then((html) => {
      if (html.authenticated) {
        loadPage(html.view);
      } else {
        localStorage.removeItem("gestao_facil:token");
        window.location.href = "/login";
      }
    })
    .catch(() => {
      localStorage.removeItem("gestao_facil:token");
      window.location.href = "/login";
    });

  htmx
    .ajax("GET", "/sidebar/menu", {
      target: "#content-sidebar-menu",
      swap: "innerHTML",
      headers: {
        Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
      },
    })
    .catch((error) => {
      console.error("Request failed:", error);
    });
});

function loadPage(pagePath) {
  htmx.ajax("GET", pagePath, {
    target: "#content",
    swap: "innerHTML",
    headers: {
      Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
    },
  });
}

htmx.on("htmx:responseError", (e) => {
  showNotification(
    JSON.parse(e.detail.xhr.responseText)?.message ||
      "Erro inesperado na requisição",
    "error"
  );
  if (e.detail.xhr.status === 401) {
    showNotification("Sua sessão expirou", "error");

    $.ajax({
      url: `/api/auth/renew`,
      method: "GET",
      headers: {
        Authorization: "Bearer " + localStorage.getItem("gestao_facil:refreshToken"),
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

        showNotification(
          "Token de sessão renovado!",
          "success"
        );
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
    });
  }
});
