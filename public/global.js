$(".datatable thead th:last-child").addClass("text-end");

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

function loadPage(pagePath) {
  htmx.ajax("GET", pagePath, {
    target: "#content",
    swap: "innerHTML",
    headers: {
      Authorization: "Bearer " + localStorage.getItem("gestao_facil:token"),
    },
  });
}

document.addEventListener("htmx:afterSwap", (event) => {
  const url = event.detail.requestConfig.path;
  if (url === "/sidebar/menu") {
    return;
  }
  if (event.detail.requestConfig.verb === "get") {
    history.pushState({}, "", url);
  }
});

window.addEventListener("popstate", () => {
  htmx.ajax("GET", location.pathname, { target: "#content" });
});
