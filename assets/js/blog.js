(function initBlogPage() {
  "use strict";

  const menuToggle = document.getElementById("menuToggle");
  const navbar = document.getElementById("navbar");
  if (menuToggle && navbar) {
    menuToggle.addEventListener("click", () => navbar.classList.toggle("show"));
  }

  (async function syncAuthHeader() {
    if (!window.RangMayAuth) return;
    if (typeof window.RangMayAuth.initBackendMode === "function") {
      await window.RangMayAuth.initBackendMode();
    }
    if (typeof window.RangMayAuth.renderHeaderAuthState === "function") {
      window.RangMayAuth.renderHeaderAuthState("headerAuthArea");
    }
  })();
})();
