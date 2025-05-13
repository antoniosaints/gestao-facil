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
        localStorage.setItem("gestao_facil:isauth", true);
        htmx.ajax("GET", html.view, { target: "body", swap: "innerHTML" });
      } else {
        localStorage.removeItem("gestao_facil:token");
        localStorage.setItem("gestao_facil:isauth", false);
        htmx.ajax("GET", "partials/login.html", {
          target: "body",
          swap: "innerHTML",
        });
      }
    })
    .catch(() => {
      localStorage.removeItem("gestao_facil:token");
      localStorage.setItem("gestao_facil:isauth", false);
      htmx.ajax("GET", "partials/login.html", {
        target: "body",
        swap: "innerHTML",
      });
    });
});

function isAuthenticated() {
  const token = localStorage.getItem("gestao_facil:isauth");
  return token === "true"; // simples, pode evoluir com verificação de expiração
}

const unprotectedPages = [
  "partials/login.html",
  "partials/recuperar-senha.html",
];

function loadPage(pagePath) {
  const isUnprotected = unprotectedPages.includes(pagePath);

  if (!isUnprotected && !isAuthenticated()) {
    htmx.ajax("GET", "partials/login.html", {
      target: "body",
      swap: "innerHTML",
    });
    return;
  }

  htmx.ajax("GET", pagePath, {
    target: "#content",
    swap: "innerHTML",
  });
}
