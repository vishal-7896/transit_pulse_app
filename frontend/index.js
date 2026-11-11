(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var hasUser = Boolean(window.TransitPulseStorage && window.TransitPulseStorage.hasUser());
    var primaryButtons = document.querySelectorAll(".js-primary-cta");
    var secondaryLinks = document.querySelectorAll(".js-secondary-cta");
    var topLink = document.querySelector(".js-top-link");

    var urlParams = new URLSearchParams(window.location.search);
    var src = urlParams.get("src");
    if (src && window.TransitPulseAPI && window.TransitPulseAPI.logScan) {
      TransitPulseAPI.logScan(src).catch(function () {});
      try {
        sessionStorage.setItem("tp_scan_src", src);
      } catch (e) {}
    }

    if (topLink) {
      topLink.textContent = hasUser ? "Profile" : "Log in";
      topLink.setAttribute("href", hasUser ? "profile.html" : "register.html");
    }

    primaryButtons.forEach(function (btn) {
      btn.textContent = hasUser ? "Open routes" : "Browse live routes";
    });

    secondaryLinks.forEach(function (link) {
      if (hasUser) {
        link.textContent = "Starred stops";
        link.setAttribute("href", "starred.html");
      } else {
        link.textContent = "How it works";
        link.setAttribute("href", "#what-is");
      }
    });

    primaryButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = "Opening routes...";
        window.location.href = "routes.html";
      });
    });

    secondaryLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        if (hasUser) {
          link.style.opacity = "0.7";
          link.textContent = "Loading starred...";
        }
      });
    });
  });
})();
