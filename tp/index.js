(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var loginButton = document.getElementById("login-btn");
    var message = document.getElementById("landing-message");

    if (!loginButton) return;

    loginButton.addEventListener("click", function () {
      var hasUser = window.TransitPulseStorage && window.TransitPulseStorage.hasUser();

      if (hasUser) {
        window.location.href = "routes.html";
        return;
      }

      if (message) {
        message.textContent = "No saved user on this browser. Please sign up first.";
        message.className = "landing-message is-visible";
      }
    });
  });
})();
