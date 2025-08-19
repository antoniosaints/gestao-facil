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

const TEMPO_MINUTOS = 40; // tempo de inatividade para forçar reload
let ultimaOcultacao = null;

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // salva momento em que aba foi ocultada
    ultimaOcultacao = Date.now();
  } else {
    if (ultimaOcultacao) {
      const diffMin = (Date.now() - ultimaOcultacao) / 60000;
      if (diffMin >= TEMPO_MINUTOS) {
        window.location.reload();
      }
    }
  }
});

