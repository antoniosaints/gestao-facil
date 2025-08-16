document.querySelectorAll(".dropdown-toggle").forEach((toggle) => {
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    const targetId = toggle.getAttribute("data-target");
    const dropdown = document.getElementById(targetId);
    const arrow = toggle.querySelector(".dropdown-arrow");

    // Close other dropdowns
    document.querySelectorAll(".dropdown-content").forEach((content) => {
      if (content.id !== targetId && !content.classList.contains("hidden")) {
        content.classList.add("hidden");
        const otherArrow = document.querySelector(
          `[data-target="${content.id}"] .dropdown-arrow`
        );
        if (otherArrow) {
          otherArrow.classList.remove("rotate-90");
        }
      }
    });

    // Toggle current dropdown
    dropdown.classList.toggle("hidden");
    arrow.classList.toggle("rotate-90");
  });
});

document
  .getElementById("sidebar-content-sistema")
  .querySelectorAll("a")
  .forEach((item) => {
    item.addEventListener("click", () => {
      if (window.innerWidth < 768) {
        document
          .getElementById("sidebar-content-sistema")
          .classList.add("-translate-x-full");
      }
    });
  });

document.getElementById("openSidebarButton").addEventListener("click", () => {
  document
    .getElementById("sidebar-content-sistema")
    .classList.remove("-translate-x-full");
});

document.getElementById("closeSidebarButton").addEventListener("click", () => {
  document
    .getElementById("sidebar-content-sistema")
    .classList.add("-translate-x-full");
});

function openSideBarMobile() {
  document
    .getElementById("sidebar-content-sistema")
    .classList.remove("-translate-x-full");
}
