(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var hasUser = Boolean(window.TransitPulseStorage && window.TransitPulseStorage.hasUser());
    var primaryButtons = document.querySelectorAll(".js-primary-cta");
    var secondaryLinks = document.querySelectorAll(".js-secondary-cta");
    var topBarAuth = document.getElementById("top-bar-auth");
    var profileLink = document.querySelector(".js-profile-link");
    var userInitial = document.querySelector(".js-user-initial");
    var userName = document.querySelector(".js-user-name");

    var urlParams = new URLSearchParams(window.location.search);
    var src = urlParams.get("src");
    if (src && window.TransitPulseAPI && window.TransitPulseAPI.logScan) {
      TransitPulseAPI.logScan(src).catch(function () {});
      try {
        sessionStorage.setItem("tp_scan_src", src);
      } catch (e) {}
    }

    if (hasUser) {
      if (topBarAuth) topBarAuth.classList.add("is-hidden");
      if (profileLink) profileLink.classList.remove("is-hidden");
      var currentName = (window.TransitPulseStorage && window.TransitPulseStorage.getUserName()) || "Profile";
      if (userName) userName.textContent = currentName;
      if (userInitial) userInitial.textContent = currentName.charAt(0).toUpperCase() || "C";
    } else {
      if (topBarAuth) topBarAuth.classList.remove("is-hidden");
      if (profileLink) profileLink.classList.add("is-hidden");
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