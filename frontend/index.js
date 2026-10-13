(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var hasUser = Boolean(window.TransitPulseStorage && window.TransitPulseStorage.hasUser());
    var primaryButtons = document.querySelectorAll(".js-primary-cta");
    var secondaryLinks = document.querySelectorAll(".js-secondary-cta");

    // Signed in: the buttons become shortcuts into the app.
    if (hasUser) {
      primaryButtons.forEach(function (btn) { btn.textContent = "Open routes"; });
      secondaryLinks.forEach(function (link) {
        link.textContent = "Starred stops";
        link.setAttribute("href", "starred.html");
      });
    }

    primaryButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (hasUser) {
          window.location.href = "routes.html";
          return;
        }
        // Show the hint right under whichever button group was clicked.
        var group = btn.closest("section");
        var message = group && group.querySelector(".landing-message");
        if (message) {
          message.textContent = "No saved user on this browser. Please sign up first.";
          message.className = "landing-message is-visible";
        }
      });
    });
  });
})();
