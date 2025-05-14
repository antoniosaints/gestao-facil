$(".datatable thead th:last-child").addClass("text-end");

document.addEventListener("DOMContentLoaded", () => {
  fetch(`/auth/check`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
    },
  })
    .then((res) => res.json())
    .then((html) => {
      if (html.authenticated) {
        htmx.ajax("GET", html.view, { target: "#content", swap: "innerHTML" });
      } else {
        localStorage.removeItem("gestao_facil:token");
        window.location.href = "/login";
      }
    })
    .catch(() => {
      localStorage.removeItem("gestao_facil:token");
      window.location.href = "/login";
    });
});

function loadPage(pagePath) {
  htmx
    .ajax("GET", pagePath, {
      target: "#content",
      swap: "innerHTML",
      headers: {
        Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
      },
    })
    .catch((error) => {
      console.error("Request failed:", error);
    });

  htmx.on("htmx:responseError", (e) => {
    console.error("HTMX response error:", e.detail.xhr);
    if (e.detail.xhr.status === 401) {
      localStorage.removeItem("gestao_facil:token");
      localStorage.setItem("gestao_facil:isauth", false);
      window.location.href = "/login";
    }
  });
}
