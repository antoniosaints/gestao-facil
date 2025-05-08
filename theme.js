function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.classList.toggle("dark");

  // Salva a preferência no localStorage
  localStorage.setItem("theme", isDark ? "dark" : "light");

  // Atualiza os ícones
  document.getElementById("icon-sun").classList.toggle("hidden", isDark);
  document.getElementById("icon-moon").classList.toggle("hidden", !isDark);
}

// Aplica o tema salvo ao carregar
(function () {
  const savedTheme = localStorage.getItem("theme");
  const html = document.documentElement;
  const isDark = savedTheme === "dark";

  if (isDark) html.classList.add("dark");
  else html.classList.remove("dark");

  // Configura ícones
  document.getElementById("icon-sun").classList.toggle("hidden", isDark);
  document.getElementById("icon-moon").classList.toggle("hidden", !isDark);
})();
