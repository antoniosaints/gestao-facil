$(".datatable thead th:last-child").addClass("text-end");

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

loadSidebarOptionsMenu();