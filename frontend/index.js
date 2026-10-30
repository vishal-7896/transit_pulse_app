(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var hasUser = Boolean(window.TransitPulseStorage && window.TransitPulseStorage.hasUser());
    var primaryButtons = document.querySelectorAll(".js-primary-cta");
    var secondaryLinks = document.querySelectorAll(".js-secondary-cta");

    if (hasUser) {
      primaryButtons.forEach(function (btn) { btn.textContent = "Open routes"; });
      secondaryLinks.forEach(function (link) {
        link.textContent = "Starred stops";
        link.setAttribute("href", "starred.html");
      });
    } else {
      primaryButtons.forEach(function (btn) { btn.textContent = "Login / Sign Up"; });
      secondaryLinks.forEach(function (link) {
        link.textContent = "Get Started";
        link.setAttribute("href", "register.html");
      });
    }

    primaryButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = hasUser ? "Opening routes..." : "Opening login...";
        window.location.href = hasUser ? "routes.html" : "register.html";
      });
    });

    secondaryLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        link.style.opacity = "0.7";
        link.textContent = hasUser ? "Loading starred..." : "Opening...";
      });
    });
  });
})();
