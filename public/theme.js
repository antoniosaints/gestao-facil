function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.classList.toggle("dark");

  localStorage.setItem("theme", isDark ? "dark" : "light");

  const iconSun = document.getElementById("icon-sun");
  const iconMoon = document.getElementById("icon-moon");

  if (iconSun && iconMoon) {
    iconSun.classList.toggle("hidden", isDark);
    iconMoon.classList.toggle("hidden", !isDark);
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", isDark ? "#0f172a" : "#ffffff");
  }
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => console.log("Service Worker registrado"))
    .catch((err) => console.error("Erro ao registrar SW:", err));
}

(function () {
  // Verifica o tema salvo no localStorage e aplica
  const savedTheme = localStorage.getItem("theme");
  const html = document.documentElement;
  const isDark = savedTheme === "dark";

  if (isDark) html.classList.add("dark");
  else html.classList.remove("dark");

  // Configura ícones
  const iconSun = document.getElementById("icon-sun");
  const iconMoon = document.getElementById("icon-moon");
  if (iconSun && iconMoon) {
    iconSun.classList.toggle("hidden", isDark);
    iconMoon.classList.toggle("hidden", !isDark);
  }

  // Função para alternar o tema
  window.toggleTheme = function () {
    const isDark = html.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");

    if (iconSun && iconMoon) {
      iconSun.classList.toggle("hidden", isDark);
      iconMoon.classList.toggle("hidden", !isDark);
    }
  };

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", isDark ? "#0f172a" : "#ffffff");
  }
})();
